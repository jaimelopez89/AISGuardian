#!/usr/bin/env python3
"""
Reference Data Loader - Bootstraps sanctions lists, geofences, and port data
into Kafka reference-data topic.

Usage:
    python reference_loader.py [--sanctions] [--geofences] [--ports] [--all]

Environment variables required:
    - KAFKA_BOOTSTRAP_SERVERS: Kafka broker address
    - KAFKA_SSL_CA_CERT: Path to CA certificate (for Aiven)
    - KAFKA_SSL_CERT: Path to client certificate (for Aiven)
    - KAFKA_SSL_KEY: Path to client key (for Aiven)
"""

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from confluent_kafka import Producer
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Kafka topic for reference data
REFERENCE_TOPIC = "reference-data"

# Base path for reference data files
REFERENCE_DATA_PATH = Path(__file__).parent.parent / "reference-data"


@dataclass
class SanctionedEntity:
    """A sanctioned vessel or entity."""
    entity_id: str
    entity_type: str  # "vessel", "company", "person"
    name: str
    aliases: list[str]
    mmsi: Optional[str]
    imo_number: Optional[str]
    flag_state: Optional[str]
    sanctions_source: str  # "OFAC", "EU", "UN"
    date_listed: str
    reason: str
    additional_info: dict

    def to_json(self) -> str:
        return json.dumps(asdict(self), default=str)


@dataclass
class Geofence:
    """A geographic zone to monitor."""
    zone_id: str
    zone_name: str
    zone_type: str  # "MPA", "EEZ", "sanctioned_waters", "restricted"
    jurisdiction: Optional[str]
    geometry: dict  # GeoJSON geometry object
    rules: dict  # What triggers alerts in this zone
    metadata: dict

    def to_json(self) -> str:
        return json.dumps(asdict(self), default=str)


@dataclass
class Port:
    """A port for detecting "in port" vs "at sea" status."""
    port_id: str
    port_name: str
    country: str
    latitude: float
    longitude: float
    port_type: str  # "major", "minor", "anchorage"
    locode: Optional[str]  # UN/LOCODE

    def to_json(self) -> str:
        return json.dumps(asdict(self), default=str)


class ReferenceDataLoader:
    """Loads reference data into Kafka for enrichment jobs."""

    def __init__(self, kafka_config: dict):
        self.kafka_config = kafka_config
        self.producer: Optional[Producer] = None
        self.messages_produced = 0

    def _create_producer(self) -> Producer:
        """Create Kafka producer with SSL configuration for Aiven."""
        config = {
            'bootstrap.servers': self.kafka_config['bootstrap_servers'],
            'client.id': 'reference-loader',
            'acks': 'all',
        }

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

    def _produce_message(self, key: str, value: str, record_type: str):
        """Produce a reference data message to Kafka."""
        # Add metadata wrapper
        wrapped = {
            "record_type": record_type,
            "loaded_at": datetime.now(timezone.utc).isoformat(),
            "data": json.loads(value)
        }

        self.producer.produce(
            REFERENCE_TOPIC,
            key=key.encode('utf-8'),
            value=json.dumps(wrapped).encode('utf-8'),
            callback=self._delivery_callback
        )

    def load_sanctions(self):
        """Load sanctions data from JSON files."""
        sanctions_path = REFERENCE_DATA_PATH / "sanctions"

        for sanctions_file in sanctions_path.glob("*.json"):
            logger.info(f"Loading sanctions from {sanctions_file}")

            with open(sanctions_file) as f:
                data = json.load(f)

            entities = data if isinstance(data, list) else data.get("entities", [])

            for entity in entities:
                sanctioned = SanctionedEntity(
                    entity_id=entity.get("id", f"sanction-{hash(entity.get('name', ''))}"),
                    entity_type=entity.get("type", "vessel"),
                    name=entity.get("name", "Unknown"),
                    aliases=entity.get("aliases", []),
                    mmsi=entity.get("mmsi"),
                    imo_number=entity.get("imo_number"),
                    flag_state=entity.get("flag_state"),
                    sanctions_source=entity.get("source", sanctions_file.stem.upper()),
                    date_listed=entity.get("date_listed", ""),
                    reason=entity.get("reason", ""),
                    additional_info=entity.get("additional_info", {})
                )

                key = f"sanction:{sanctioned.entity_id}"
                self._produce_message(key, sanctioned.to_json(), "sanction")

        self.producer.flush()
        logger.info(f"Loaded sanctions data: {self.messages_produced} records")

    def load_geofences(self):
        """Load geofence data from GeoJSON files."""
        geofences_path = REFERENCE_DATA_PATH / "geofences"
        initial_count = self.messages_produced

        for geofence_file in geofences_path.glob("*.geojson"):
            logger.info(f"Loading geofences from {geofence_file}")

            with open(geofence_file) as f:
                data = json.load(f)

            # Handle both FeatureCollection and direct Feature list
            features = data.get("features", [data] if data.get("type") == "Feature" else [])

            zone_type = self._infer_zone_type(geofence_file.stem)

            for i, feature in enumerate(features):
                props = feature.get("properties", {})
                geometry = feature.get("geometry", {})

                zone_id = props.get("id") or props.get("MRGID") or f"{geofence_file.stem}-{i}"

                geofence = Geofence(
                    zone_id=str(zone_id),
                    zone_name=props.get("name") or props.get("GEONAME") or f"Zone {zone_id}",
                    zone_type=zone_type,
                    jurisdiction=props.get("jurisdiction") or props.get("SOVEREIGN1"),
                    geometry=geometry,
                    rules=self._get_zone_rules(zone_type),
                    metadata=props
                )

                key = f"geofence:{geofence.zone_id}"
                self._produce_message(key, geofence.to_json(), "geofence")

        self.producer.flush()
        loaded = self.messages_produced - initial_count
        logger.info(f"Loaded geofence data: {loaded} records")

    def _infer_zone_type(self, filename: str) -> str:
        """Infer zone type from filename."""
        filename_lower = filename.lower()
        if "mpa" in filename_lower or "protected" in filename_lower:
            return "MPA"
        elif "eez" in filename_lower:
            return "EEZ"
        elif "sanction" in filename_lower:
            return "sanctioned_waters"
        elif "restrict" in filename_lower:
            return "restricted"
        return "unknown"

    def _get_zone_rules(self, zone_type: str) -> dict:
        """Get alerting rules based on zone type."""
        rules = {
            "MPA": {
                "alert_vessel_types": [30, 31, 32, 33, 34, 35, 36, 37],  # Fishing vessels
                "alert_on_fishing_behavior": True,
                "alert_all_vessels": False,
                "severity": "HIGH"
            },
            "EEZ": {
                "alert_vessel_types": [],
                "alert_on_fishing_behavior": True,
                "alert_all_vessels": False,
                "check_flag_state": True,
                "severity": "MEDIUM"
            },
            "sanctioned_waters": {
                "alert_vessel_types": [],
                "alert_on_fishing_behavior": False,
                "alert_all_vessels": True,
                "severity": "CRITICAL"
            },
            "restricted": {
                "alert_vessel_types": [],
                "alert_on_fishing_behavior": False,
                "alert_all_vessels": True,
                "severity": "HIGH"
            }
        }
        return rules.get(zone_type, {"alert_all_vessels": False, "severity": "LOW"})

    def load_ports(self):
        """Load port data from JSON files."""
        ports_path = REFERENCE_DATA_PATH / "ports"
        initial_count = self.messages_produced

        for ports_file in ports_path.glob("*.json"):
            logger.info(f"Loading ports from {ports_file}")

            with open(ports_file) as f:
                data = json.load(f)

            ports = data if isinstance(data, list) else data.get("ports", [])

            for port_data in ports:
                port = Port(
                    port_id=port_data.get("id") or port_data.get("locode", f"port-{hash(port_data.get('name', ''))}"),
                    port_name=port_data.get("name", "Unknown"),
                    country=port_data.get("country", ""),
                    latitude=port_data.get("latitude", 0.0),
                    longitude=port_data.get("longitude", 0.0),
                    port_type=port_data.get("type", "minor"),
                    locode=port_data.get("locode")
                )

                key = f"port:{port.port_id}"
                self._produce_message(key, port.to_json(), "port")

        self.producer.flush()
        loaded = self.messages_produced - initial_count
        logger.info(f"Loaded port data: {loaded} records")

    def load_all(self):
        """Load all reference data."""
        self.producer = self._create_producer()
        self.messages_produced = 0

        try:
            logger.info("Loading all reference data...")
            self.load_sanctions()
            self.load_geofences()
            self.load_ports()
            logger.info(f"Total reference data loaded: {self.messages_produced} records")
        finally:
            self.producer.flush()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Load reference data into Kafka")
    parser.add_argument("--sanctions", action="store_true", help="Load sanctions data")
    parser.add_argument("--geofences", action="store_true", help="Load geofence data")
    parser.add_argument("--ports", action="store_true", help="Load port data")
    parser.add_argument("--all", action="store_true", help="Load all reference data")
    args = parser.parse_args()

    # If no args, default to --all
    if not any([args.sanctions, args.geofences, args.ports, args.all]):
        args.all = True

    bootstrap_servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

    kafka_config = {
        'bootstrap_servers': bootstrap_servers,
        'ssl_ca_cert': os.getenv("KAFKA_SSL_CA_CERT"),
        'ssl_cert': os.getenv("KAFKA_SSL_CERT"),
        'ssl_key': os.getenv("KAFKA_SSL_KEY"),
    }

    loader = ReferenceDataLoader(kafka_config)
    loader.producer = loader._create_producer()

    try:
        if args.all:
            loader.load_all()
        else:
            if args.sanctions:
                loader.load_sanctions()
            if args.geofences:
                loader.load_geofences()
            if args.ports:
                loader.load_ports()

        logger.info(f"Reference data loading complete: {loader.messages_produced} total records")
    finally:
        loader.producer.flush()


if __name__ == "__main__":
    main()
