#!/usr/bin/env python3
"""
Sanctions Auto-Updater Service

Periodically checks for new sanctions from various sources and pushes updates to Kafka.
This ensures the shadow fleet detection system has the latest sanctions data.

Sources:
- EU Council Sanctions List (via API)
- OFAC Specially Designated Nationals (SDN) List
- Ukraine Government Shadow Fleet Database

Run as a background service:
    nohup python3 sanctions_updater.py > /tmp/sanctions_updater.log 2>&1 &
"""

import json
import os
import sys
import time
import hashlib
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set
import requests

from confluent_kafka import Producer
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
LOG = logging.getLogger('sanctions_updater')

# Update interval (default: 6 hours)
UPDATE_INTERVAL_HOURS = int(os.getenv('SANCTIONS_UPDATE_INTERVAL_HOURS', '6'))

# State file to track known sanctions
STATE_FILE = Path(__file__).parent / '.sanctions_state.json'

# Kafka topic
SANCTIONS_TOPIC = 'sanctions'


def get_kafka_config():
    """Get Kafka producer configuration for Aiven."""
    return {
        'bootstrap.servers': os.getenv('KAFKA_BOOTSTRAP_SERVERS'),
        'security.protocol': 'SSL',
        'ssl.ca.location': os.getenv('KAFKA_SSL_CA_CERT', str(Path(__file__).parent.parent / 'ca.pem')),
        'ssl.certificate.location': os.getenv('KAFKA_SSL_CERT', str(Path(__file__).parent.parent / 'service.cert')),
        'ssl.key.location': os.getenv('KAFKA_SSL_KEY', str(Path(__file__).parent.parent / 'service.key')),
    }


def delivery_callback(err, msg):
    """Callback for message delivery."""
    if err:
        LOG.error(f'Message delivery failed: {err}')
    else:
        LOG.debug(f'Delivered to {msg.topic()} [{msg.partition()}]')


def load_state() -> Dict:
    """Load the state of known sanctions."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            LOG.warning(f"Could not load state file: {e}")
    return {
        'known_imo_hashes': [],
        'last_update': None,
        'total_sanctions': 0
    }


def save_state(state: Dict):
    """Save the state of known sanctions."""
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        LOG.error(f"Could not save state file: {e}")


def fetch_eu_sanctions() -> List[Dict]:
    """
    Fetch EU sanctions from the EU Consolidated Financial Sanctions List.

    Note: The actual EU API requires registration. This is a placeholder
    that could be replaced with actual API integration when credentials
    are available.
    """
    LOG.info("Checking EU sanctions list...")

    # EU Council provides sanctions via their API
    # In production, this would use the actual EU API
    # For now, we'll check for updates to the manual list

    try:
        # Check EU Council press releases for new sanctions
        # This is a simplified approach - real implementation would use official API
        eu_sanctions_url = "https://data.europa.eu/api/hub/search/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions"

        response = requests.get(eu_sanctions_url, timeout=30)
        if response.status_code == 200:
            LOG.info("EU sanctions endpoint accessible")
            # Parse and extract vessel-specific sanctions
            # This would require processing the actual EU dataset
            return []
        else:
            LOG.warning(f"EU sanctions endpoint returned {response.status_code}")
            return []

    except requests.exceptions.RequestException as e:
        LOG.warning(f"Could not fetch EU sanctions: {e}")
        return []


def fetch_ofac_sanctions() -> List[Dict]:
    """
    Fetch OFAC Specially Designated Nationals (SDN) list.

    OFAC provides an API and downloadable lists of sanctioned entities.
    """
    LOG.info("Checking OFAC sanctions list...")

    try:
        # OFAC SDN list in JSON format
        ofac_url = "https://www.treasury.gov/ofac/downloads/sdn.json"

        response = requests.get(ofac_url, timeout=60)
        if response.status_code == 200:
            data = response.json()

            # Extract vessel-specific entries
            vessels = []
            for entry in data.get('sdnList', []):
                # Check if entry is a vessel
                sdn_type = entry.get('sdnType', '')
                if sdn_type.lower() == 'vessel':
                    vessel = {
                        'imo': extract_imo_from_ofac(entry),
                        'name': entry.get('lastName', ''),
                        'sanctions': ['OFAC'],
                        'risk_level': 'critical',
                        'notes': f"OFAC SDN ID: {entry.get('uid', 'N/A')}",
                        'source': 'OFAC_SDN'
                    }
                    if vessel['imo']:
                        vessels.append(vessel)

            LOG.info(f"Found {len(vessels)} vessels in OFAC SDN list")
            return vessels
        else:
            LOG.warning(f"OFAC endpoint returned {response.status_code}")
            return []

    except requests.exceptions.RequestException as e:
        LOG.warning(f"Could not fetch OFAC sanctions: {e}")
        return []
    except json.JSONDecodeError as e:
        LOG.warning(f"Could not parse OFAC response: {e}")
        return []


def extract_imo_from_ofac(entry: Dict) -> Optional[str]:
    """Extract IMO number from OFAC entry."""
    # OFAC includes vessel identifiers in various fields
    for id_entry in entry.get('idList', []):
        id_type = id_entry.get('idType', '').upper()
        if 'IMO' in id_type:
            return id_entry.get('idNumber', '')

    # Also check remarks/notes
    remarks = entry.get('remarks', '')
    if 'IMO' in remarks.upper():
        # Try to extract IMO number (7 digits)
        import re
        match = re.search(r'IMO[:\s]*(\d{7})', remarks, re.IGNORECASE)
        if match:
            return match.group(1)

    return None


def fetch_ukraine_database() -> List[Dict]:
    """
    Check for updates to the Ukraine shadow fleet database.

    The Ukraine Ministry of Defense maintains a database of shadow fleet vessels.
    """
    LOG.info("Checking Ukraine shadow fleet database...")

    try:
        # Ukraine's war sanctions portal
        # This would need to be adapted based on their actual API/data format
        ukraine_url = "https://war-sanctions.gur.gov.ua/api/shadow-fleet"

        # Note: This endpoint may not exist - placeholder for actual integration
        response = requests.get(ukraine_url, timeout=30)
        if response.status_code == 200:
            data = response.json()
            vessels = []
            for entry in data.get('vessels', []):
                vessel = {
                    'imo': entry.get('imo'),
                    'name': entry.get('name'),
                    'sanctions': ['UA_GUR'],
                    'risk_level': 'critical',
                    'notes': entry.get('notes', ''),
                    'source': 'Ukraine_GUR'
                }
                if vessel['imo']:
                    vessels.append(vessel)
            LOG.info(f"Found {len(vessels)} vessels in Ukraine database")
            return vessels
        else:
            LOG.debug(f"Ukraine endpoint returned {response.status_code}")
            return []

    except requests.exceptions.RequestException as e:
        LOG.debug(f"Could not fetch Ukraine database: {e}")
        return []


def fetch_local_updates() -> List[Dict]:
    """
    Check for updates to the local shadow_fleet.json file.
    This allows manual additions to be picked up automatically.
    """
    LOG.info("Checking local shadow fleet file...")

    data_file = Path(__file__).parent / 'shadow_fleet.json'
    if not data_file.exists():
        return []

    try:
        with open(data_file, 'r') as f:
            data = json.load(f)

        vessels = []
        for vessel in data.get('vessels', []):
            vessels.append({
                'imo': vessel.get('imo'),
                'name': vessel.get('name'),
                'type': vessel.get('type', 'unknown'),
                'sanctions': vessel.get('sanctions', []),
                'risk_level': vessel.get('risk_level', 'high'),
                'notes': vessel.get('notes', ''),
                'source': 'local_database'
            })

        LOG.info(f"Found {len(vessels)} vessels in local database")
        return vessels

    except Exception as e:
        LOG.error(f"Error reading local database: {e}")
        return []


def compute_vessel_hash(vessel: Dict) -> str:
    """Compute a hash of vessel data to detect changes."""
    data_str = f"{vessel.get('imo', '')}:{vessel.get('name', '')}:{','.join(sorted(vessel.get('sanctions', [])))}"
    return hashlib.sha256(data_str.encode()).hexdigest()[:16]


def publish_sanctions_update(producer: Producer, vessels: List[Dict], state: Dict) -> int:
    """
    Publish new/updated sanctions to Kafka.
    Returns the number of new sanctions published.
    """
    known_hashes = set(state.get('known_imo_hashes', []))
    new_count = 0

    for vessel in vessels:
        imo = vessel.get('imo')
        if not imo:
            continue

        vessel_hash = compute_vessel_hash(vessel)

        # Check if this is new or updated
        if vessel_hash not in known_hashes:
            # Prepare Kafka record
            record = {
                'record_type': 'SANCTIONED_VESSEL',
                'imo_number': imo,
                'vessel_name': vessel.get('name', 'Unknown'),
                'vessel_type': vessel.get('type', 'unknown'),
                'sanctions_authorities': vessel.get('sanctions', []),
                'risk_level': vessel.get('risk_level', 'high'),
                'notes': vessel.get('notes', ''),
                'source': vessel.get('source', 'api_update'),
                'loaded_at': datetime.utcnow().isoformat() + 'Z'
            }

            key = f"IMO:{imo}"

            try:
                producer.produce(
                    SANCTIONS_TOPIC,
                    key=key.encode('utf-8'),
                    value=json.dumps(record).encode('utf-8'),
                    callback=delivery_callback
                )
                known_hashes.add(vessel_hash)
                new_count += 1
                LOG.info(f"Published new sanction: {vessel.get('name')} (IMO: {imo})")
            except Exception as e:
                LOG.error(f"Failed to publish sanction for {imo}: {e}")

    producer.flush()

    # Update state
    state['known_imo_hashes'] = list(known_hashes)
    state['total_sanctions'] = len(known_hashes)
    state['last_update'] = datetime.utcnow().isoformat()

    return new_count


def run_update_cycle(producer: Producer, state: Dict) -> int:
    """Run a single update cycle, checking all sources."""
    LOG.info("=" * 60)
    LOG.info("Starting sanctions update cycle")
    LOG.info("=" * 60)

    all_vessels = []

    # Fetch from all sources
    all_vessels.extend(fetch_local_updates())
    all_vessels.extend(fetch_ofac_sanctions())
    all_vessels.extend(fetch_eu_sanctions())
    all_vessels.extend(fetch_ukraine_database())

    # Deduplicate by IMO
    seen_imos = set()
    unique_vessels = []
    for vessel in all_vessels:
        imo = vessel.get('imo')
        if imo and imo not in seen_imos:
            seen_imos.add(imo)
            unique_vessels.append(vessel)

    LOG.info(f"Total unique vessels from all sources: {len(unique_vessels)}")

    # Publish updates
    new_count = publish_sanctions_update(producer, unique_vessels, state)

    if new_count > 0:
        LOG.info(f"Published {new_count} new/updated sanctions")
    else:
        LOG.info("No new sanctions to publish")

    save_state(state)
    return new_count


def main():
    """Main entry point for the sanctions updater service."""
    LOG.info("=" * 60)
    LOG.info("Sanctions Auto-Updater Service Starting")
    LOG.info(f"Update interval: {UPDATE_INTERVAL_HOURS} hours")
    LOG.info("=" * 60)

    # Initialize Kafka producer
    try:
        config = get_kafka_config()
        LOG.info(f"Connecting to Kafka: {config['bootstrap.servers']}")
        producer = Producer(config)
    except Exception as e:
        LOG.error(f"Failed to connect to Kafka: {e}")
        sys.exit(1)

    # Load state
    state = load_state()
    LOG.info(f"Loaded state: {state.get('total_sanctions', 0)} known sanctions")

    # Check for --once flag (run once and exit)
    if '--once' in sys.argv:
        LOG.info("Running single update cycle (--once flag)")
        new_count = run_update_cycle(producer, state)
        LOG.info(f"Update complete. {new_count} new sanctions published.")
        return

    # Run continuous update loop
    while True:
        try:
            run_update_cycle(producer, state)
        except Exception as e:
            LOG.error(f"Error in update cycle: {e}")

        # Wait for next update
        next_update = datetime.now() + timedelta(hours=UPDATE_INTERVAL_HOURS)
        LOG.info(f"Next update at: {next_update.strftime('%Y-%m-%d %H:%M:%S')}")
        LOG.info("-" * 60)

        time.sleep(UPDATE_INTERVAL_HOURS * 60 * 60)


if __name__ == '__main__':
    main()
