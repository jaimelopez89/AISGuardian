#!/usr/bin/env python3
"""
Simple REST API backend that reads from Aiven Kafka and serves to frontend.
Uses FastAPI with Server-Sent Events for real-time updates.
"""

import asyncio
import json
import os
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from confluent_kafka import Consumer, KafkaError
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Load environment variables
env_path = Path('.env')
if not env_path.exists():
    env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

app = FastAPI(title="AIS Guardian API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory vessel state (last known position for each MMSI)
vessel_state: Dict[str, dict] = {}
# Vessel trails: store last N positions per vessel for trail visualization
vessel_trails: Dict[str, deque] = defaultdict(lambda: deque(maxlen=50))
TRAIL_MAX_POINTS = 50  # Max trail points per vessel
alerts_list: list = []
MAX_ALERTS = 500

# Kafka consumer configuration
def get_kafka_config(group_id: str) -> dict:
    return {
        'bootstrap.servers': os.getenv('KAFKA_BOOTSTRAP_SERVERS'),
        'security.protocol': 'SSL',
        'ssl.ca.location': os.getenv('KAFKA_SSL_CA_CERT', './ca.pem'),
        'ssl.certificate.location': os.getenv('KAFKA_SSL_CERT', './service.cert'),
        'ssl.key.location': os.getenv('KAFKA_SSL_KEY', './service.key'),
        'group.id': group_id,
        'auto.offset.reset': 'earliest',
        'enable.auto.commit': True,
    }


async def consume_vessels():
    """Background task to consume AIS positions from Kafka."""
    config = get_kafka_config('ais-guardian-api-vessels')
    consumer = Consumer(config)
    consumer.subscribe(['ais-raw'])

    print("Started vessel consumer")

    while True:
        try:
            msg = consumer.poll(0.1)
            if msg is None:
                await asyncio.sleep(0.05)
                continue
            if msg.error():
                if msg.error().code() != KafkaError._PARTITION_EOF:
                    print(f"Consumer error: {msg.error()}")
                continue

            data = json.loads(msg.value())
            mmsi = data.get('mmsi')
            if mmsi:
                vessel_state[mmsi] = data
                # Store position in trail history
                lat = data.get('latitude')
                lon = data.get('longitude')
                ts = data.get('timestamp', datetime.now(timezone.utc).isoformat())
                if lat and lon:
                    # Only add if position changed significantly (avoid duplicates)
                    trail = vessel_trails[mmsi]
                    if len(trail) == 0 or (
                        abs(trail[-1][0] - lat) > 0.0001 or
                        abs(trail[-1][1] - lon) > 0.0001
                    ):
                        trail.append((lat, lon, ts))

        except Exception as e:
            print(f"Error consuming vessel: {e}")
            await asyncio.sleep(1)


async def consume_alerts():
    """Background task to consume alerts from Kafka."""
    config = get_kafka_config('ais-guardian-api-alerts-v2')
    consumer = Consumer(config)
    consumer.subscribe(['alerts'])

    print("Started alerts consumer")

    while True:
        try:
            msg = consumer.poll(0.1)
            if msg is None:
                await asyncio.sleep(0.05)
                continue
            if msg.error():
                if msg.error().code() != KafkaError._PARTITION_EOF:
                    print(f"Consumer error: {msg.error()}")
                continue

            data = json.loads(msg.value())
            alerts_list.insert(0, data)
            # Keep only last N alerts
            if len(alerts_list) > MAX_ALERTS:
                alerts_list.pop()

        except Exception as e:
            print(f"Error consuming alert: {e}")
            await asyncio.sleep(1)


@app.on_event("startup")
async def startup_event():
    """Start background Kafka consumers."""
    asyncio.create_task(consume_vessels())
    asyncio.create_task(consume_alerts())


@app.get("/api/vessels")
async def get_vessels(
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
):
    """Get current vessel positions."""
    vessels = list(vessel_state.values())

    # Filter by bounding box if provided
    if all([min_lat, max_lat, min_lon, max_lon]):
        vessels = [
            v for v in vessels
            if min_lat <= v.get('latitude', 0) <= max_lat
            and min_lon <= v.get('longitude', 0) <= max_lon
        ]

    return {
        "vessels": vessels,
        "count": len(vessels),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/alerts")
async def get_alerts(limit: int = Query(100, le=500)):
    """Get recent alerts."""
    return {
        "alerts": alerts_list[:limit],
        "count": len(alerts_list[:limit]),
        "total": len(alerts_list),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/vessel/{mmsi}")
async def get_vessel(mmsi: str):
    """Get single vessel by MMSI."""
    vessel = vessel_state.get(mmsi)
    if vessel:
        return vessel
    return {"error": "Vessel not found"}


@app.get("/api/trails")
async def get_trails(mmsi: Optional[str] = Query(None)):
    """Get vessel trails (recent position history).

    Returns trails as GeoJSON LineStrings for easy mapping.
    If mmsi is provided, returns only that vessel's trail.
    """
    if mmsi:
        # Single vessel trail
        trail = vessel_trails.get(mmsi, [])
        if len(trail) < 2:
            return {"trails": [], "count": 0}

        coordinates = [[point[1], point[0]] for point in trail]  # GeoJSON is [lon, lat]
        return {
            "trails": [{
                "mmsi": mmsi,
                "coordinates": coordinates,
                "timestamps": [point[2] for point in trail],
                "point_count": len(coordinates)
            }],
            "count": 1
        }

    # All vessel trails
    trails = []
    for vessel_mmsi, trail in vessel_trails.items():
        if len(trail) >= 2:  # Need at least 2 points for a line
            coordinates = [[point[1], point[0]] for point in trail]  # GeoJSON is [lon, lat]
            vessel = vessel_state.get(vessel_mmsi, {})
            trails.append({
                "mmsi": vessel_mmsi,
                "coordinates": coordinates,
                "timestamps": [point[2] for point in trail],
                "point_count": len(coordinates),
                "ship_name": vessel.get('ship_name', ''),
                "ship_type": vessel.get('ship_type', 0)
            })

    return {
        "trails": trails,
        "count": len(trails),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/stats")
async def get_stats():
    """Get current statistics."""
    return {
        "total_vessels": len(vessel_state),
        "total_alerts": len(alerts_list),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/stream/vessels")
async def stream_vessels():
    """Server-Sent Events stream of vessel updates."""
    async def event_generator():
        last_sent = {}
        while True:
            # Find vessels that have changed
            changed = []
            for mmsi, vessel in vessel_state.items():
                if mmsi not in last_sent or last_sent[mmsi] != vessel:
                    changed.append(vessel)
                    last_sent[mmsi] = vessel.copy()

            if changed:
                data = json.dumps({"vessels": changed})
                yield f"data: {data}\n\n"

            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )


@app.get("/api/stream/alerts")
async def stream_alerts():
    """Server-Sent Events stream of new alerts."""
    async def event_generator():
        last_count = 0
        while True:
            if len(alerts_list) > last_count:
                new_alerts = alerts_list[:len(alerts_list) - last_count]
                data = json.dumps({"alerts": new_alerts})
                yield f"data: {data}\n\n"
                last_count = len(alerts_list)

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
