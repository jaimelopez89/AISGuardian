#!/usr/bin/env python3
"""
Simple REST API backend that reads from Aiven Kafka and serves to frontend.
Uses FastAPI with Server-Sent Events for real-time updates.
"""

print("=== AIS Guardian API starting ===", flush=True)

import asyncio
import base64
import json
import os
import tempfile
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional
import uuid

from confluent_kafka import Consumer, KafkaError, TopicPartition
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import redis

# Load environment variables
env_path = Path('.env')
if not env_path.exists():
    env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

# Handle SSL certificates - either from files or base64 env vars (for Railway)
SSL_CERT_DIR = None

def setup_ssl_certs():
    """Setup SSL certificates from base64 env vars if files don't exist."""
    global SSL_CERT_DIR

    ca_path = os.getenv('KAFKA_SSL_CA_CERT', './ca.pem')
    cert_path = os.getenv('KAFKA_SSL_CERT', './service.cert')
    key_path = os.getenv('KAFKA_SSL_KEY', './service.key')

    # Check if we have base64-encoded certs in env vars
    ca_b64 = os.getenv('KAFKA_SSL_CA_CERT_BASE64')
    cert_b64 = os.getenv('KAFKA_SSL_CERT_BASE64')
    key_b64 = os.getenv('KAFKA_SSL_KEY_BASE64')

    if ca_b64 and cert_b64 and key_b64:
        # Create temp directory for certs
        SSL_CERT_DIR = tempfile.mkdtemp(prefix='kafka_ssl_')

        # Write decoded certs to temp files
        ca_path = os.path.join(SSL_CERT_DIR, 'ca.pem')
        cert_path = os.path.join(SSL_CERT_DIR, 'service.cert')
        key_path = os.path.join(SSL_CERT_DIR, 'service.key')

        with open(ca_path, 'wb') as f:
            f.write(base64.b64decode(ca_b64))
        with open(cert_path, 'wb') as f:
            f.write(base64.b64decode(cert_b64))
        with open(key_path, 'wb') as f:
            f.write(base64.b64decode(key_b64))

        print(f"SSL certs written to {SSL_CERT_DIR}", flush=True)

        # Update env vars to point to temp files
        os.environ['KAFKA_SSL_CA_CERT'] = ca_path
        os.environ['KAFKA_SSL_CERT'] = cert_path
        os.environ['KAFKA_SSL_KEY'] = key_path

# Setup SSL certs on import
setup_ssl_certs()

app = FastAPI(title="AIS Guardian API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "ais-guardian-api"}


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}

# In-memory vessel state (last known position for each MMSI)
vessel_state: Dict[str, dict] = {}
vessel_last_seen: Dict[str, float] = {}  # MMSI -> timestamp for TTL eviction
# Vessel trails: in-memory cache backed by Valkey
vessel_trails: Dict[str, deque] = defaultdict(lambda: deque(maxlen=500))
TRAIL_MAX_POINTS = 500  # Max trail points per vessel
TRAIL_LOOKBACK_HOURS = 24  # How far back to seek on startup
TRAIL_TTL_SECONDS = 72 * 3600  # Keep trails for 72 hours in Valkey

# Memory limits to prevent unbounded growth
MAX_VESSELS_IN_MEMORY = 15000  # Max vessels to keep in memory
VESSEL_TTL_HOURS = 24  # Remove vessels not seen in this time
CLEANUP_INTERVAL_SECONDS = 300  # Run cleanup every 5 minutes
_last_cleanup_time = 0.0

# Alerts storage - using deque for O(1) append/pop
alerts_list: deque = deque(maxlen=1000)
MAX_ALERTS = 1000  # Max alerts to store in memory

# =============================================================================
# INCIDENT CORRELATION ENGINE
# Groups related alerts into unified incidents for better threat assessment
# =============================================================================

@dataclass
class Incident:
    """A correlated incident grouping multiple related alerts."""
    id: str
    mmsi: str
    ship_name: str
    severity: str  # CRITICAL, HIGH, MEDIUM, LOW
    status: str  # ACTIVE, RESOLVED, MONITORING
    title: str
    description: str
    alert_types: List[str] = field(default_factory=list)
    alerts: List[dict] = field(default_factory=list)
    first_alert_time: str = ""
    last_alert_time: str = ""
    location: dict = field(default_factory=dict)  # {lat, lon}
    risk_score: int = 0
    created_at: str = ""
    updated_at: str = ""

# Incident storage
incidents: Dict[str, Incident] = {}  # id -> Incident
vessel_incidents: Dict[str, str] = {}  # mmsi -> active incident id
MAX_INCIDENTS = 500
INCIDENT_WINDOW_MINUTES = 30  # Group alerts within this window

# Severity weights for different alert types (higher = more severe)
ALERT_SEVERITY_WEIGHTS = {
    'CABLE_PROXIMITY': 90,
    'ANCHOR_DRAGGING': 95,
    'SANCTIONS_MATCH': 85,
    'AIS_SPOOFING': 80,
    'DARK_EVENT': 70,
    'GEOFENCE_VIOLATION': 60,
    'RENDEZVOUS': 50,
    'CONVOY': 40,
    'FISHING_PATTERN': 45,
    'HIGH_RISK_SCORE': 75,
}

# Alert type relationships (types that often occur together in an incident)
RELATED_ALERT_TYPES = {
    'DARK_EVENT': ['CABLE_PROXIMITY', 'AIS_SPOOFING', 'GEOFENCE_VIOLATION'],
    'CABLE_PROXIMITY': ['ANCHOR_DRAGGING', 'DARK_EVENT'],
    'ANCHOR_DRAGGING': ['CABLE_PROXIMITY'],
    'AIS_SPOOFING': ['DARK_EVENT', 'SANCTIONS_MATCH'],
    'SANCTIONS_MATCH': ['DARK_EVENT', 'AIS_SPOOFING', 'RENDEZVOUS'],
    'RENDEZVOUS': ['SANCTIONS_MATCH', 'DARK_EVENT'],
}

def calculate_incident_severity(alert_types: List[str]) -> tuple:
    """Calculate incident severity and risk score from alert types."""
    if not alert_types:
        return 'LOW', 0

    total_score = sum(ALERT_SEVERITY_WEIGHTS.get(t, 30) for t in alert_types)
    # Bonus for multiple correlated alert types
    if len(alert_types) >= 3:
        total_score = int(total_score * 1.3)
    elif len(alert_types) >= 2:
        total_score = int(total_score * 1.15)

    # Cap at 100
    risk_score = min(100, total_score // len(alert_types) if alert_types else 0)

    if risk_score >= 85 or 'ANCHOR_DRAGGING' in alert_types:
        severity = 'CRITICAL'
    elif risk_score >= 70 or 'CABLE_PROXIMITY' in alert_types:
        severity = 'HIGH'
    elif risk_score >= 50:
        severity = 'MEDIUM'
    else:
        severity = 'LOW'

    return severity, risk_score

def generate_incident_title(alert_types: List[str], ship_name: str) -> str:
    """Generate a human-readable incident title."""
    if 'ANCHOR_DRAGGING' in alert_types and 'CABLE_PROXIMITY' in alert_types:
        return f"Potential Cable Threat: {ship_name} dragging anchor near infrastructure"
    elif 'ANCHOR_DRAGGING' in alert_types:
        return f"Anchor Dragging Alert: {ship_name}"
    elif 'CABLE_PROXIMITY' in alert_types and 'DARK_EVENT' in alert_types:
        return f"Suspicious Activity: {ship_name} went dark near cable zone"
    elif 'CABLE_PROXIMITY' in alert_types:
        return f"Cable Zone Intrusion: {ship_name}"
    elif 'SANCTIONS_MATCH' in alert_types:
        return f"Sanctioned Vessel Activity: {ship_name}"
    elif 'AIS_SPOOFING' in alert_types:
        return f"Potential AIS Spoofing: {ship_name}"
    elif 'DARK_EVENT' in alert_types:
        return f"AIS Transmission Gap: {ship_name}"
    elif 'RENDEZVOUS' in alert_types:
        return f"Ship-to-Ship Meeting: {ship_name}"
    else:
        return f"Maritime Alert: {ship_name}"

def generate_incident_description(incident: Incident) -> str:
    """Generate a detailed incident description."""
    alert_count = len(incident.alerts)
    duration_text = ""

    if incident.first_alert_time and incident.last_alert_time:
        try:
            first = datetime.fromisoformat(incident.first_alert_time.replace('Z', '+00:00'))
            last = datetime.fromisoformat(incident.last_alert_time.replace('Z', '+00:00'))
            duration = last - first
            if duration.total_seconds() > 3600:
                duration_text = f" over {duration.total_seconds() / 3600:.1f} hours"
            elif duration.total_seconds() > 60:
                duration_text = f" over {duration.total_seconds() / 60:.0f} minutes"
        except:
            pass

    types_text = ", ".join(incident.alert_types)
    return f"{alert_count} related alerts ({types_text}){duration_text}"

def correlate_alert(alert: dict) -> Optional[str]:
    """
    Correlate an incoming alert with existing incidents or create a new one.
    Returns the incident ID if correlated/created.
    """
    mmsi = alert.get('mmsi', '')
    if not mmsi:
        return None

    alert_type = alert.get('alert_type', 'UNKNOWN')
    alert_time = alert.get('timestamp', datetime.now(timezone.utc).isoformat())
    ship_name = alert.get('ship_name', alert.get('details', {}).get('ship_name', f'MMSI {mmsi}'))
    lat = alert.get('latitude', alert.get('details', {}).get('latitude', 0))
    lon = alert.get('longitude', alert.get('details', {}).get('longitude', 0))

    now = datetime.now(timezone.utc)

    # Check if vessel has an active incident
    active_incident_id = vessel_incidents.get(mmsi)
    if active_incident_id and active_incident_id in incidents:
        incident = incidents[active_incident_id]

        # Check if incident is still within time window
        try:
            last_time = datetime.fromisoformat(incident.last_alert_time.replace('Z', '+00:00'))
            if (now - last_time) < timedelta(minutes=INCIDENT_WINDOW_MINUTES):
                # Add to existing incident
                if alert_type not in incident.alert_types:
                    incident.alert_types.append(alert_type)
                incident.alerts.append(alert)
                incident.last_alert_time = alert_time
                incident.updated_at = now.isoformat()
                if lat and lon:
                    incident.location = {'lat': lat, 'lon': lon}

                # Recalculate severity
                incident.severity, incident.risk_score = calculate_incident_severity(incident.alert_types)
                incident.title = generate_incident_title(incident.alert_types, ship_name)
                incident.description = generate_incident_description(incident)

                return active_incident_id
        except:
            pass

    # Create new incident
    incident_id = str(uuid.uuid4())[:8]
    incident = Incident(
        id=incident_id,
        mmsi=mmsi,
        ship_name=ship_name,
        severity='MEDIUM',
        status='ACTIVE',
        title=generate_incident_title([alert_type], ship_name),
        description='',
        alert_types=[alert_type],
        alerts=[alert],
        first_alert_time=alert_time,
        last_alert_time=alert_time,
        location={'lat': lat, 'lon': lon} if lat and lon else {},
        risk_score=ALERT_SEVERITY_WEIGHTS.get(alert_type, 30),
        created_at=now.isoformat(),
        updated_at=now.isoformat(),
    )
    incident.severity, incident.risk_score = calculate_incident_severity(incident.alert_types)
    incident.description = generate_incident_description(incident)

    incidents[incident_id] = incident
    vessel_incidents[mmsi] = incident_id

    # Cleanup old incidents if we have too many
    if len(incidents) > MAX_INCIDENTS:
        # Remove oldest resolved incidents first
        sorted_incidents = sorted(
            incidents.items(),
            key=lambda x: (x[1].status != 'RESOLVED', x[1].updated_at)
        )
        for old_id, old_incident in sorted_incidents[:len(incidents) - MAX_INCIDENTS]:
            del incidents[old_id]
            if vessel_incidents.get(old_incident.mmsi) == old_id:
                del vessel_incidents[old_incident.mmsi]

    return incident_id

# =============================================================================
# END INCIDENT CORRELATION ENGINE
# =============================================================================

# Valkey (Redis-compatible) connection for persistent trail storage
valkey_client = None

def setup_valkey():
    """Setup Valkey connection for persistent trail storage."""
    global valkey_client
    valkey_host = os.getenv('VALKEY_HOST')
    valkey_port = os.getenv('VALKEY_PORT', '28738')
    valkey_password = os.getenv('VALKEY_PASSWORD')

    if valkey_host and valkey_password:
        try:
            valkey_client = redis.Redis(
                host=valkey_host,
                port=int(valkey_port),
                password=valkey_password,
                ssl=True,
                ssl_cert_reqs=None,
                decode_responses=True
            )
            # Test connection
            valkey_client.ping()
            print(f"Connected to Valkey at {valkey_host}:{valkey_port}", flush=True)

            # Load existing trails count
            keys = valkey_client.keys('trail:*')
            print(f"Found {len(keys)} existing vessel trails in Valkey", flush=True)
            return True
        except Exception as e:
            print(f"Failed to connect to Valkey: {e}", flush=True)
            valkey_client = None
            return False
    else:
        print("Valkey not configured (VALKEY_HOST/VALKEY_PASSWORD not set)", flush=True)
        return False

def save_trail_point(mmsi: str, lat: float, lon: float, ts: str):
    """Save a trail point to Valkey."""
    if not valkey_client:
        return
    try:
        # Parse timestamp to get score
        score = datetime.now(timezone.utc).timestamp()
        if ts:
            try:
                # Handle various timestamp formats
                ts_clean = ts.replace(' UTC', '').strip()
                if 'T' in ts_clean:
                    dt = datetime.fromisoformat(ts_clean.replace('Z', '+00:00'))
                else:
                    parts = ts_clean.rsplit(' ', 1)
                    dt_str = parts[0][:26] if '.' in parts[0] else parts[0][:19]
                    fmt = '%Y-%m-%d %H:%M:%S.%f' if '.' in dt_str else '%Y-%m-%d %H:%M:%S'
                    dt = datetime.strptime(dt_str, fmt)
                score = dt.timestamp()
            except:
                pass

        key = f"trail:{mmsi}"
        point = json.dumps({'lat': lat, 'lon': lon, 'ts': ts})
        valkey_client.zadd(key, {point: score})

        # Set TTL on the key (refresh it)
        valkey_client.expire(key, TRAIL_TTL_SECONDS)

        # Trim old points (keep last TRAIL_MAX_POINTS)
        valkey_client.zremrangebyrank(key, 0, -(TRAIL_MAX_POINTS + 1))
    except Exception as e:
        pass  # Don't crash on Valkey errors

def get_trails_from_valkey(mmsi: str = None) -> List[dict]:
    """Get trails from Valkey."""
    if not valkey_client:
        return []

    try:
        if mmsi:
            keys = [f"trail:{mmsi}"]
        else:
            keys = valkey_client.keys('trail:*')

        trails = []
        for key in keys:
            vessel_mmsi = key.replace('trail:', '') if isinstance(key, str) else key.decode().replace('trail:', '')
            points = valkey_client.zrange(key, 0, -1, withscores=True)

            if len(points) >= 2:
                coordinates = []
                timestamps = []
                for point_json, score in points:
                    try:
                        point = json.loads(point_json)
                        coordinates.append([point['lon'], point['lat']])
                        timestamps.append(point.get('ts', ''))
                    except:
                        pass

                if len(coordinates) >= 2:
                    trails.append({
                        'mmsi': vessel_mmsi,
                        'coordinates': coordinates,
                        'timestamps': timestamps,
                        'point_count': len(coordinates)
                    })

        return trails
    except Exception as e:
        print(f"Error getting trails from Valkey: {e}", flush=True)
        return []

# Initialize Valkey on module load
setup_valkey()


def cleanup_stale_vessels():
    """
    Remove vessels that haven't been seen recently to prevent memory growth.
    Also enforces max vessel limit by removing oldest vessels.
    """
    global _last_cleanup_time

    now = time.time()

    # Only run cleanup every CLEANUP_INTERVAL_SECONDS
    if now - _last_cleanup_time < CLEANUP_INTERVAL_SECONDS:
        return 0

    _last_cleanup_time = now
    removed_count = 0
    cutoff_time = now - (VESSEL_TTL_HOURS * 3600)

    # Remove vessels not seen within TTL
    stale_mmsis = [
        mmsi for mmsi, last_seen in vessel_last_seen.items()
        if last_seen < cutoff_time
    ]

    for mmsi in stale_mmsis:
        vessel_state.pop(mmsi, None)
        vessel_trails.pop(mmsi, None)
        vessel_last_seen.pop(mmsi, None)
        # Also clean up from incident tracking
        vessel_incidents.pop(mmsi, None)
        removed_count += 1

    # If still over limit, remove oldest vessels
    if len(vessel_state) > MAX_VESSELS_IN_MEMORY:
        # Sort by last seen time and remove oldest
        sorted_vessels = sorted(vessel_last_seen.items(), key=lambda x: x[1])
        to_remove = len(vessel_state) - MAX_VESSELS_IN_MEMORY + 1000  # Remove extra buffer

        for mmsi, _ in sorted_vessels[:to_remove]:
            vessel_state.pop(mmsi, None)
            vessel_trails.pop(mmsi, None)
            vessel_last_seen.pop(mmsi, None)
            vessel_incidents.pop(mmsi, None)
            removed_count += 1

    if removed_count > 0:
        print(f"Cleanup: removed {removed_count} stale vessels, {len(vessel_state)} remaining", flush=True)

    return removed_count


def load_trail_from_valkey(mmsi: str) -> bool:
    """
    Lazy-load a single vessel's trail from Valkey into memory.
    Returns True if trail was loaded, False otherwise.
    """
    if not valkey_client:
        return False

    try:
        key = f"trail:{mmsi}"
        points = valkey_client.zrange(key, 0, -1, withscores=True)

        if points:
            trail = vessel_trails[mmsi]
            for point_json, score in points:
                try:
                    point = json.loads(point_json)
                    trail.append((point['lat'], point['lon'], point.get('ts', '')))
                except:
                    pass
            return True
    except Exception as e:
        pass
    return False


def get_active_vessel_count_from_valkey() -> int:
    """Get count of vessels with trails in Valkey (for stats)."""
    if not valkey_client:
        return 0
    try:
        keys = valkey_client.keys('trail:*')
        return len(keys)
    except:
        return 0


# Log Valkey trail count on startup (but don't load into memory)
if valkey_client:
    trail_count = get_active_vessel_count_from_valkey()
    print(f"Valkey contains {trail_count} vessel trails (lazy-loaded on demand)", flush=True)

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


def consume_vessels_thread():
    """Background thread to consume AIS positions from Kafka."""
    config = get_kafka_config('ais-guardian-api-vessels-v6')
    print(f"Vessel consumer config: bootstrap={config['bootstrap.servers']}, ca={config['ssl.ca.location']}", flush=True)
    consumer = Consumer(config)

    # Track partitions that need seeking
    partitions_to_seek = []
    seek_done = False

    def on_assign(c, partitions):
        """Mark partitions for seeking after assignment."""
        nonlocal partitions_to_seek
        print(f"Vessel consumer assigned: {partitions}", flush=True)
        partitions_to_seek = list(partitions)

    consumer.subscribe(['ais-raw'], on_assign=on_assign)

    print("Vessel consumer subscribed to ais-raw, waiting for partition assignment...", flush=True)

    # Trigger partition assignment with initial poll
    consumer.poll(1.0)
    print("Initial poll done, partitions should be assigned", flush=True)

    msg_count = 0
    poll_count = 0
    seek_done = False

    while True:
        try:
            # Perform seek after first poll when partitions are ready
            if partitions_to_seek and not seek_done:
                print(f"Performing seek to {TRAIL_LOOKBACK_HOURS}h ago...", flush=True)
                lookback_ms = int((datetime.now(timezone.utc).timestamp() - (TRAIL_LOOKBACK_HOURS * 3600)) * 1000)
                tps_with_time = [TopicPartition(p.topic, p.partition, lookback_ms) for p in partitions_to_seek]

                try:
                    offsets = consumer.offsets_for_times(tps_with_time, timeout=10.0)
                    for tp in offsets:
                        if tp.offset >= 0:
                            print(f"  Partition {tp.partition}: seeking to offset {tp.offset}", flush=True)
                            consumer.seek(tp)
                        else:
                            print(f"  Partition {tp.partition}: no historical offset, using earliest", flush=True)
                    seek_done = True
                    print("Seek complete, starting consumption...", flush=True)
                except Exception as e:
                    print(f"Seek failed: {e}, will retry...", flush=True)

            poll_count += 1
            if poll_count <= 3 or poll_count % 30 == 0:
                print(f"Vessel consumer poll #{poll_count}", flush=True)
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() != KafkaError._PARTITION_EOF:
                    print(f"Consumer error: {msg.error()}", flush=True)
                continue

            data = json.loads(msg.value())
            msg_count += 1
            if msg_count % 100 == 0:
                print(f"Vessel consumer: received {msg_count} messages, {len(vessel_state)} vessels", flush=True)
            mmsi = data.get('mmsi')
            if mmsi:
                vessel_state[mmsi] = data
                vessel_last_seen[mmsi] = time.time()  # Track for TTL eviction

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
                        # Also save to Valkey for persistence
                        save_trail_point(mmsi, lat, lon, ts)

                # Periodically cleanup stale vessels to prevent memory growth
                cleanup_stale_vessels()

        except Exception as e:
            print(f"Error consuming vessel: {e}", flush=True)
            time.sleep(1)


def consume_alerts_thread():
    """Background thread to consume alerts from Kafka."""
    config = get_kafka_config('ais-guardian-api-alerts-v4')
    print(f"Alerts consumer config: bootstrap={config['bootstrap.servers']}", flush=True)
    consumer = Consumer(config)

    def on_assign(c, partitions):
        print(f"Alerts consumer assigned: {partitions}", flush=True)

    consumer.subscribe(['alerts'], on_assign=on_assign)

    print("Alerts consumer subscribed to alerts topic, waiting for partition assignment...", flush=True)
    msg_count = 0
    poll_count = 0

    while True:
        try:
            poll_count += 1
            if poll_count <= 3 or poll_count % 30 == 0:
                print(f"Alerts consumer poll #{poll_count}, total alerts: {len(alerts_list)}", flush=True)

            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() != KafkaError._PARTITION_EOF:
                    print(f"Alerts consumer error: {msg.error()}", flush=True)
                continue

            data = json.loads(msg.value())
            msg_count += 1
            alert_type = data.get('alert_type', 'unknown')
            print(f"Alerts consumer: received alert #{msg_count} - {alert_type}", flush=True)

            # Correlate alert into incidents
            incident_id = correlate_alert(data)
            if incident_id:
                data['incident_id'] = incident_id

            # Add to front of deque (O(1) operation, auto-evicts old items due to maxlen)
            alerts_list.appendleft(data)

        except Exception as e:
            print(f"Error consuming alert: {e}", flush=True)
            time.sleep(1)


@app.on_event("startup")
def startup_event():
    """Start background Kafka consumer threads."""
    # Start vessel consumer thread
    vessel_thread = threading.Thread(target=consume_vessels_thread, daemon=True)
    vessel_thread.start()

    # Start alerts consumer thread
    alerts_thread = threading.Thread(target=consume_alerts_thread, daemon=True)
    alerts_thread.start()


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
async def get_alerts(limit: int = Query(250, le=1000)):
    """Get recent alerts."""
    # Convert deque to list for slicing and JSON serialization
    alerts = list(alerts_list)[:limit]
    return {
        "alerts": alerts,
        "count": len(alerts),
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
    Uses lazy-loading from Valkey - only loads requested trails into memory.
    """
    if mmsi:
        # Single vessel trail - lazy load from Valkey if not in memory
        trail = vessel_trails.get(mmsi)
        if trail is None or len(trail) < 2:
            # Try to load from Valkey
            load_trail_from_valkey(mmsi)
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

    # All vessel trails - only return what's already in memory (active vessels)
    # This prevents loading all trails from Valkey which would defeat the purpose
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
        "total_incidents": len(incidents),
        "active_incidents": sum(1 for i in incidents.values() if i.status == 'ACTIVE'),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/incidents")
async def get_incidents(
    severity: Optional[str] = Query(None, description="Filter by severity: CRITICAL, HIGH, MEDIUM, LOW"),
    status: Optional[str] = Query(None, description="Filter by status: ACTIVE, RESOLVED, MONITORING"),
    limit: int = Query(50, le=200),
):
    """
    Get correlated incidents.

    Incidents group related alerts from the same vessel within a time window,
    providing a unified view of potential threats.
    """
    incident_list = list(incidents.values())

    # Apply filters
    if severity:
        incident_list = [i for i in incident_list if i.severity == severity.upper()]
    if status:
        incident_list = [i for i in incident_list if i.status == status.upper()]

    # Sort by severity (CRITICAL first), then by updated_at (most recent first)
    severity_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
    incident_list.sort(key=lambda x: (severity_order.get(x.severity, 4), -hash(x.updated_at)))

    # Convert to dict for JSON serialization
    result = []
    for incident in incident_list[:limit]:
        result.append({
            'id': incident.id,
            'mmsi': incident.mmsi,
            'ship_name': incident.ship_name,
            'severity': incident.severity,
            'status': incident.status,
            'title': incident.title,
            'description': incident.description,
            'alert_types': incident.alert_types,
            'alert_count': len(incident.alerts),
            'first_alert_time': incident.first_alert_time,
            'last_alert_time': incident.last_alert_time,
            'location': incident.location,
            'risk_score': incident.risk_score,
            'created_at': incident.created_at,
            'updated_at': incident.updated_at,
        })

    return {
        "incidents": result,
        "count": len(result),
        "total": len(incidents),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/incidents/{incident_id}")
async def get_incident(incident_id: str):
    """
    Get a single incident with full alert timeline.

    Returns the incident details including all correlated alerts
    in chronological order for incident investigation.
    """
    incident = incidents.get(incident_id)
    if not incident:
        return {"error": "Incident not found"}

    # Sort alerts by timestamp for timeline view
    sorted_alerts = sorted(
        incident.alerts,
        key=lambda x: x.get('timestamp', ''),
    )

    return {
        'id': incident.id,
        'mmsi': incident.mmsi,
        'ship_name': incident.ship_name,
        'severity': incident.severity,
        'status': incident.status,
        'title': incident.title,
        'description': incident.description,
        'alert_types': incident.alert_types,
        'alerts': sorted_alerts,  # Full alert timeline
        'alert_count': len(incident.alerts),
        'first_alert_time': incident.first_alert_time,
        'last_alert_time': incident.last_alert_time,
        'location': incident.location,
        'risk_score': incident.risk_score,
        'created_at': incident.created_at,
        'updated_at': incident.updated_at,
        # Include vessel info if available
        'vessel': vessel_state.get(incident.mmsi, {}),
    }


@app.get("/api/vessel/{mmsi}/incidents")
async def get_vessel_incidents(mmsi: str):
    """Get all incidents for a specific vessel."""
    vessel_incident_list = [
        {
            'id': i.id,
            'severity': i.severity,
            'status': i.status,
            'title': i.title,
            'alert_types': i.alert_types,
            'alert_count': len(i.alerts),
            'risk_score': i.risk_score,
            'created_at': i.created_at,
            'updated_at': i.updated_at,
        }
        for i in incidents.values()
        if i.mmsi == mmsi
    ]

    return {
        "mmsi": mmsi,
        "incidents": vessel_incident_list,
        "count": len(vessel_incident_list),
    }


@app.get("/api/stream/vessels")
async def stream_vessels():
    """Server-Sent Events stream of vessel updates."""
    async def event_generator():
        # Track last sent timestamp per vessel (memory-efficient vs storing full vessel data)
        last_sent_ts: Dict[str, str] = {}
        while True:
            # Find vessels that have changed (compare timestamps, not full objects)
            changed = []
            for mmsi, vessel in vessel_state.items():
                vessel_ts = vessel.get('timestamp', '')
                if mmsi not in last_sent_ts or last_sent_ts[mmsi] != vessel_ts:
                    changed.append(vessel)
                    last_sent_ts[mmsi] = vessel_ts

            # Cleanup old entries not in vessel_state anymore
            if len(last_sent_ts) > len(vessel_state) * 1.5:
                current_mmsis = set(vessel_state.keys())
                stale_keys = [k for k in last_sent_ts if k not in current_mmsis]
                for k in stale_keys:
                    del last_sent_ts[k]

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
            current_count = len(alerts_list)
            if current_count > last_count:
                # Get new alerts (they're at the front of the deque)
                new_count = current_count - last_count
                new_alerts = list(alerts_list)[:new_count]  # Convert deque slice to list
                data = json.dumps({"alerts": new_alerts})
                yield f"data: {data}\n\n"
                last_count = current_count

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"=== Starting uvicorn on port {port} ===", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=port)
