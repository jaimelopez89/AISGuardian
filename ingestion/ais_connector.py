#!/usr/bin/env python3
"""
AIS Connector - WebSocket client that ingests AIS data from AISStream.io
and produces messages to Kafka.

Usage:
    python ais_connector.py

Environment variables required:
    - AISSTREAM_API_KEY: Your AISStream.io API key
    - KAFKA_BOOTSTRAP_SERVERS: Kafka broker address
    - KAFKA_SSL_CA_CERT: Path to CA certificate (for Aiven)
    - KAFKA_SSL_CERT: Path to client certificate (for Aiven)
    - KAFKA_SSL_KEY: Path to client key (for Aiven)
"""

import asyncio
import base64
import json
import logging
import os
import signal
import ssl
import sys
import tempfile
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional

import certifi
import websockets
from confluent_kafka import Producer
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables from project root
# Look in current directory first, then parent directory
env_path = Path('.env')
if not env_path.exists():
    env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)


def setup_ssl_certs():
    """Setup SSL certificates from base64 env vars if files don't exist (for Railway)."""
    ca_b64 = os.getenv('KAFKA_SSL_CA_CERT_BASE64')
    cert_b64 = os.getenv('KAFKA_SSL_CERT_BASE64')
    key_b64 = os.getenv('KAFKA_SSL_KEY_BASE64')

    if ca_b64 and cert_b64 and key_b64:
        ssl_dir = tempfile.mkdtemp(prefix='kafka_ssl_')

        ca_path = os.path.join(ssl_dir, 'ca.pem')
        cert_path = os.path.join(ssl_dir, 'service.cert')
        key_path = os.path.join(ssl_dir, 'service.key')

        with open(ca_path, 'wb') as f:
            f.write(base64.b64decode(ca_b64))
        with open(cert_path, 'wb') as f:
            f.write(base64.b64decode(cert_b64))
        with open(key_path, 'wb') as f:
            f.write(base64.b64decode(key_b64))

        os.environ['KAFKA_SSL_CA_CERT'] = ca_path
        os.environ['KAFKA_SSL_CERT'] = cert_path
        os.environ['KAFKA_SSL_KEY'] = key_path

        logging.info(f"SSL certs written to {ssl_dir}")

# Setup SSL certs on import
setup_ssl_certs()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# AISStream WebSocket URL
AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"

# Kafka topic for raw AIS messages
RAW_TOPIC = "ais-raw"


@dataclass
class AISPosition:
    """Normalized AIS position message."""
    mmsi: str
    timestamp: str
    latitude: float
    longitude: float
    course_over_ground: Optional[float]
    speed_over_ground: Optional[float]
    heading: Optional[float]
    nav_status: Optional[int]
    ship_name: Optional[str]
    ship_type: Optional[int]
    imo_number: Optional[str]
    call_sign: Optional[str]
    destination: Optional[str]
    eta: Optional[str]
    draught: Optional[float]
    dimension_a: Optional[int]
    dimension_b: Optional[int]
    dimension_c: Optional[int]
    dimension_d: Optional[int]
    message_type: int
    raw_message: dict

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(asdict(self), default=str)


class AISConnector:
    """
    Connects to AISStream.io WebSocket and produces messages to Kafka.

    Handles reconnection, message normalization, and rate limiting
    to stay within Aiven free tier limits (250 kb/s).
    """

    def __init__(
        self,
        api_key: str,
        kafka_config: dict,
        bounding_boxes: list[list[list[float]]],
        message_types: Optional[list[int]] = None,
        rate_limit_kbps: float = 200  # Stay under 250 kb/s limit
    ):
        self.api_key = api_key
        self.kafka_config = kafka_config
        self.bounding_boxes = bounding_boxes
        self.message_types = message_types or [1, 2, 3, 5, 18, 19, 24]  # Position + static data
        self.rate_limit_kbps = rate_limit_kbps

        self.producer: Optional[Producer] = None
        self.running = False
        self.messages_received = 0
        self.messages_produced = 0
        self.bytes_produced = 0
        self.last_rate_check = datetime.now(timezone.utc)

    def _create_producer(self) -> Producer:
        """Create Kafka producer with SSL configuration for Aiven."""
        config = {
            'bootstrap.servers': self.kafka_config['bootstrap_servers'],
            'client.id': 'ais-connector',
            'acks': 'all',
            'retries': 3,
            'retry.backoff.ms': 1000,
            'compression.type': 'gzip',  # Reduce bandwidth usage
        }

        # Add SSL configuration if certificates are provided
        if self.kafka_config.get('ssl_ca_cert'):
            config.update({
                'security.protocol': 'SSL',
                'ssl.ca.location': self.kafka_config['ssl_ca_cert'],
                'ssl.certificate.location': self.kafka_config['ssl_cert'],
                'ssl.key.location': self.kafka_config['ssl_key'],
            })

        return Producer(config)

    def _delivery_callback(self, err, msg):
        """Callback for Kafka message delivery reports."""
        if err:
            logger.error(f"Message delivery failed: {err}")
        else:
            self.messages_produced += 1
            self.bytes_produced += len(msg.value())

    def _normalize_message(self, raw_msg: dict) -> Optional[AISPosition]:
        """
        Normalize AISStream message to our standard format.

        AISStream sends messages in this format:
        {
            "MessageType": "PositionReport",
            "MetaData": {
                "MMSI": 123456789,
                "ShipName": "...",
                "latitude": 12.345,
                "longitude": 67.890,
                "time_utc": "..."
            },
            "Message": {
                "PositionReport": { ... } or
                "ShipStaticData": { ... }
            }
        }
        """
        try:
            meta = raw_msg.get("MetaData", {})
            msg_type = raw_msg.get("MessageType", "")
            message = raw_msg.get("Message", {})

            mmsi = str(meta.get("MMSI", ""))
            if not mmsi:
                return None

            # Extract position data based on message type
            if msg_type == "PositionReport":
                pos_data = message.get("PositionReport", {})
                return AISPosition(
                    mmsi=mmsi,
                    timestamp=meta.get("time_utc", datetime.now(timezone.utc).isoformat()),
                    latitude=meta.get("latitude", 0.0),
                    longitude=meta.get("longitude", 0.0),
                    course_over_ground=pos_data.get("Cog"),
                    speed_over_ground=pos_data.get("Sog"),
                    heading=pos_data.get("TrueHeading"),
                    nav_status=pos_data.get("NavigationalStatus"),
                    ship_name=meta.get("ShipName"),
                    ship_type=None,
                    imo_number=None,
                    call_sign=None,
                    destination=None,
                    eta=None,
                    draught=None,
                    dimension_a=None,
                    dimension_b=None,
                    dimension_c=None,
                    dimension_d=None,
                    message_type=pos_data.get("MessageID", 1),
                    raw_message=raw_msg
                )

            elif msg_type == "ShipStaticData":
                static_data = message.get("ShipStaticData", {})
                dimension = static_data.get("Dimension", {})
                return AISPosition(
                    mmsi=mmsi,
                    timestamp=meta.get("time_utc", datetime.now(timezone.utc).isoformat()),
                    latitude=meta.get("latitude", 0.0),
                    longitude=meta.get("longitude", 0.0),
                    course_over_ground=None,
                    speed_over_ground=None,
                    heading=None,
                    nav_status=None,
                    ship_name=static_data.get("Name") or meta.get("ShipName"),
                    ship_type=static_data.get("Type"),
                    imo_number=str(static_data.get("ImoNumber")) if static_data.get("ImoNumber") else None,
                    call_sign=static_data.get("CallSign"),
                    destination=static_data.get("Destination"),
                    eta=str(static_data.get("Eta")) if static_data.get("Eta") else None,
                    draught=static_data.get("MaximumStaticDraught"),
                    dimension_a=dimension.get("A"),
                    dimension_b=dimension.get("B"),
                    dimension_c=dimension.get("C"),
                    dimension_d=dimension.get("D"),
                    message_type=static_data.get("MessageID", 5),
                    raw_message=raw_msg
                )

            elif msg_type == "StandardClassBPositionReport":
                pos_data = message.get("StandardClassBPositionReport", {})
                return AISPosition(
                    mmsi=mmsi,
                    timestamp=meta.get("time_utc", datetime.now(timezone.utc).isoformat()),
                    latitude=meta.get("latitude", 0.0),
                    longitude=meta.get("longitude", 0.0),
                    course_over_ground=pos_data.get("Cog"),
                    speed_over_ground=pos_data.get("Sog"),
                    heading=pos_data.get("TrueHeading"),
                    nav_status=None,
                    ship_name=meta.get("ShipName"),
                    ship_type=None,
                    imo_number=None,
                    call_sign=None,
                    destination=None,
                    eta=None,
                    draught=None,
                    dimension_a=None,
                    dimension_b=None,
                    dimension_c=None,
                    dimension_d=None,
                    message_type=18,
                    raw_message=raw_msg
                )

            return None

        except Exception as e:
            logger.warning(f"Failed to normalize message: {e}")
            return None

    def _check_rate_limit(self) -> bool:
        """
        Check if we're within rate limits.
        Returns True if we should continue, False if we need to slow down.
        """
        now = datetime.now(timezone.utc)
        elapsed = (now - self.last_rate_check).total_seconds()

        if elapsed >= 1.0:
            rate_kbps = (self.bytes_produced / 1024) / elapsed
            if rate_kbps > self.rate_limit_kbps:
                logger.warning(f"Rate limit exceeded: {rate_kbps:.1f} kb/s > {self.rate_limit_kbps} kb/s")
                return False

            # Reset counters
            self.bytes_produced = 0
            self.last_rate_check = now

        return True

    async def _connect_and_stream(self):
        """Connect to AISStream and process messages."""
        # AISStream subscription format - only APIKey and BoundingBoxes are required
        subscription = {
            "APIKey": self.api_key,
            "BoundingBoxes": self.bounding_boxes
        }

        logger.info(f"Connecting to AISStream with bounding boxes: {self.bounding_boxes}")

        # Create SSL context with certifi certificates (fixes macOS SSL issues)
        ssl_context = ssl.create_default_context(cafile=certifi.where())

        async with websockets.connect(AISSTREAM_URL, ssl=ssl_context) as ws:
            logger.info(f"Sending subscription: {json.dumps(subscription)[:200]}...")
            await ws.send(json.dumps(subscription))
            logger.info("Connected to AISStream, subscribed to feed")

            async for message in ws:
                if not self.running:
                    break

                try:
                    raw_msg = json.loads(message)
                    self.messages_received += 1

                    # Normalize the message
                    normalized = self._normalize_message(raw_msg)
                    if not normalized:
                        continue

                    # Check rate limit
                    if not self._check_rate_limit():
                        await asyncio.sleep(0.1)  # Brief pause if over rate
                        continue

                    # Produce to Kafka
                    key = normalized.mmsi.encode('utf-8')
                    value = normalized.to_json().encode('utf-8')

                    self.producer.produce(
                        RAW_TOPIC,
                        key=key,
                        value=value,
                        callback=self._delivery_callback
                    )

                    # Poll aggressively for cloud Kafka (higher latency than local)
                    # This processes delivery callbacks without blocking asyncio
                    self.producer.poll(0)

                    # Periodic sync flush in executor to not block event loop
                    if self.messages_received % 100 == 0:
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(None, lambda: self.producer.flush(timeout=10))

                    # Log progress periodically
                    if self.messages_received % 100 == 0:
                        logger.info(
                            f"Progress: received={self.messages_received}, "
                            f"produced={self.messages_produced}"
                        )

                except json.JSONDecodeError as e:
                    logger.warning(f"Invalid JSON message: {e}")
                except Exception as e:
                    logger.error(f"Error processing message: {e}")

    async def run(self):
        """Main run loop with automatic reconnection."""
        self.running = True
        self.producer = self._create_producer()

        while self.running:
            try:
                await self._connect_and_stream()
            except websockets.ConnectionClosed as e:
                logger.warning(f"WebSocket connection closed: {e}. Reconnecting in 5s...")
                await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"Connection error: {e}. Reconnecting in 10s...")
                await asyncio.sleep(10)

        # Flush remaining messages
        logger.info("Flushing producer...")
        self.producer.flush(timeout=10)
        logger.info(f"Shutdown complete. Total produced: {self.messages_produced}")

    def stop(self):
        """Signal the connector to stop."""
        logger.info("Stopping AIS connector...")
        self.running = False


def get_bounding_boxes() -> list[list[list[float]]]:
    """
    Get bounding boxes to monitor.

    Format: [[[lat_min, lon_min], [lat_max, lon_max]], ...]
    """
    return [
        # Baltic Sea - undersea cable monitoring (C-Lion1, Balticconnector, Estlink)
        # Covers Finland-Estonia cables, southern Baltic, and Gulf of Finland to St. Petersburg
        [[54.0, 12.0], [61.0, 31.0]],
    ]


def main():
    """Main entry point."""
    # Validate required environment variables
    api_key = os.getenv("AISSTREAM_API_KEY")
    if not api_key:
        logger.error("AISSTREAM_API_KEY environment variable is required")
        sys.exit(1)

    bootstrap_servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

    kafka_config = {
        'bootstrap_servers': bootstrap_servers,
        'ssl_ca_cert': os.getenv("KAFKA_SSL_CA_CERT"),
        'ssl_cert': os.getenv("KAFKA_SSL_CERT"),
        'ssl_key': os.getenv("KAFKA_SSL_KEY"),
    }

    # Create connector
    connector = AISConnector(
        api_key=api_key,
        kafka_config=kafka_config,
        bounding_boxes=get_bounding_boxes(),
        rate_limit_kbps=100  # Conservative limit to avoid throttling
    )

    # Handle shutdown signals
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def shutdown_handler(sig, frame):
        connector.stop()

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    # Run the connector
    try:
        loop.run_until_complete(connector.run())
    finally:
        loop.close()


if __name__ == "__main__":
    main()
