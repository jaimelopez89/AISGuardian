#!/usr/bin/env python3
"""
Load shadow fleet / sanctioned vessels data into Kafka for real-time detection.
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime

from confluent_kafka import Producer
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)


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
        print(f'ERROR: Message delivery failed: {err}')
    else:
        print(f'  -> Delivered to {msg.topic()} [{msg.partition()}]')


def load_shadow_fleet(producer, topic='sanctions'):
    """Load shadow fleet vessels into Kafka."""
    data_file = Path(__file__).parent / 'shadow_fleet.json'

    if not data_file.exists():
        print(f"ERROR: Shadow fleet data file not found: {data_file}")
        return 0

    with open(data_file, 'r') as f:
        data = json.load(f)

    vessels = data.get('vessels', [])
    print(f"\nLoading {len(vessels)} shadow fleet vessels to topic '{topic}'...")

    count = 0
    for vessel in vessels:
        # Create sanctions record
        record = {
            'record_type': 'SANCTIONED_VESSEL',
            'imo_number': vessel.get('imo'),
            'vessel_name': vessel.get('name'),
            'vessel_type': vessel.get('type', 'unknown'),
            'sanctions_authorities': vessel.get('sanctions', []),
            'risk_level': vessel.get('risk_level', 'high'),
            'notes': vessel.get('notes', ''),
            'source': 'shadow_fleet_database',
            'loaded_at': datetime.utcnow().isoformat() + 'Z'
        }

        # Use IMO as key for compaction
        key = f"IMO:{vessel.get('imo')}"

        producer.produce(
            topic,
            key=key.encode('utf-8'),
            value=json.dumps(record).encode('utf-8'),
            callback=delivery_callback
        )
        count += 1

        # Flush every 50 messages
        if count % 50 == 0:
            producer.flush()
            print(f"  Loaded {count}/{len(vessels)} vessels...")

    producer.flush()
    print(f"\nSuccessfully loaded {count} shadow fleet vessels")
    return count


def load_high_risk_flags(producer, topic='sanctions'):
    """Load high-risk flag states into Kafka."""
    # Flag states commonly used by shadow fleet
    high_risk_flags = [
        {'mid': '273', 'country': 'RU', 'name': 'Russia', 'risk': 'critical', 'reason': 'Primary sanctions target'},
        {'mid': '412', 'country': 'CN', 'name': 'China', 'risk': 'high', 'reason': 'Shadow fleet registration'},
        {'mid': '413', 'country': 'CN', 'name': 'China', 'risk': 'high', 'reason': 'Shadow fleet registration'},
        {'mid': '414', 'country': 'CN', 'name': 'China', 'risk': 'high', 'reason': 'Shadow fleet registration'},
        {'mid': '477', 'country': 'HK', 'name': 'Hong Kong', 'risk': 'high', 'reason': 'Chinese-linked vessels'},
        {'mid': '422', 'country': 'IR', 'name': 'Iran', 'risk': 'critical', 'reason': 'Sanctioned state'},
        {'mid': '445', 'country': 'KP', 'name': 'North Korea', 'risk': 'critical', 'reason': 'Sanctioned state'},
        {'mid': '667', 'country': 'SL', 'name': 'Sierra Leone', 'risk': 'medium', 'reason': 'Flag of convenience'},
        {'mid': '636', 'country': 'LR', 'name': 'Liberia', 'risk': 'medium', 'reason': 'Flag of convenience'},
        {'mid': '352', 'country': 'PA', 'name': 'Panama', 'risk': 'medium', 'reason': 'Flag of convenience'},
        {'mid': '538', 'country': 'MH', 'name': 'Marshall Islands', 'risk': 'medium', 'reason': 'Flag of convenience'},
        {'mid': '620', 'country': 'CM', 'name': 'Cameroon', 'risk': 'high', 'reason': 'Shadow fleet registration'},
        {'mid': '613', 'country': 'GA', 'name': 'Gabon', 'risk': 'high', 'reason': 'Shadow fleet registration'},
        {'mid': '610', 'country': 'GH', 'name': 'Gabon', 'risk': 'medium', 'reason': 'Emerging shadow fleet flag'},
        {'mid': '572', 'country': 'PW', 'name': 'Palau', 'risk': 'high', 'reason': 'Shadow fleet registration'},
        {'mid': '536', 'country': 'GY', 'name': 'Guyana', 'risk': 'medium', 'reason': 'Emerging shadow fleet flag'},
    ]

    print(f"\nLoading {len(high_risk_flags)} high-risk flag states...")

    for flag in high_risk_flags:
        record = {
            'record_type': 'HIGH_RISK_FLAG',
            'mid_code': flag['mid'],
            'country_code': flag['country'],
            'country_name': flag['name'],
            'risk_level': flag['risk'],
            'reason': flag['reason'],
            'loaded_at': datetime.utcnow().isoformat() + 'Z'
        }

        key = f"FLAG:{flag['mid']}"

        producer.produce(
            topic,
            key=key.encode('utf-8'),
            value=json.dumps(record).encode('utf-8'),
            callback=delivery_callback
        )

    producer.flush()
    print(f"Successfully loaded {len(high_risk_flags)} flag states")
    return len(high_risk_flags)


def main():
    print("=" * 60)
    print("Shadow Fleet & Sanctions Data Loader")
    print("=" * 60)

    # Initialize Kafka producer
    config = get_kafka_config()
    print(f"\nConnecting to Kafka: {config['bootstrap.servers']}")

    producer = Producer(config)

    topic = 'sanctions'

    # Load data
    vessel_count = load_shadow_fleet(producer, topic)
    flag_count = load_high_risk_flags(producer, topic)

    print("\n" + "=" * 60)
    print(f"SUMMARY")
    print(f"  Shadow fleet vessels: {vessel_count}")
    print(f"  High-risk flags: {flag_count}")
    print(f"  Topic: {topic}")
    print("=" * 60)


if __name__ == '__main__':
    main()
