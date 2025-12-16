#!/usr/bin/env python3
"""
Load geofence data from GeoJSON files into Kafka reference-data topic.
"""
import json
import os
import sys
from pathlib import Path
from confluent_kafka import Producer
from dotenv import load_dotenv

# Load from project root
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

KAFKA_TOPIC = "reference-data"

def create_producer():
    """Create Kafka producer."""
    config = {
        'bootstrap.servers': os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092'),
        'client.id': 'geofence-loader',
    }

    # Add SSL config if available
    ssl_ca = os.getenv('KAFKA_SSL_CA_CERT')
    if ssl_ca:
        config.update({
            'security.protocol': 'SSL',
            'ssl.ca.location': ssl_ca,
            'ssl.certificate.location': os.getenv('KAFKA_SSL_CERT'),
            'ssl.key.location': os.getenv('KAFKA_SSL_KEY'),
        })

    return Producer(config)

def convert_geojson_to_geofence(feature):
    """Convert a GeoJSON feature to the Geofence format expected by Flink."""
    props = feature.get('properties', {})
    geometry = feature.get('geometry', {})

    return {
        'record_type': 'geofence',
        'data': {
            'zone_id': props.get('id'),
            'zone_name': props.get('name'),
            'zone_type': props.get('zone_type'),
            'jurisdiction': props.get('jurisdiction', 'EU'),
            'geometry': geometry,
            'rules': {
                'alert_all_vessels': False,
                'severity': props.get('severity', 'HIGH'),
            },
            'metadata': {
                'infrastructure_type': props.get('infrastructure_type'),
                'owner': props.get('owner'),
                'buffer_nm': props.get('buffer_nm'),
                'description': props.get('description'),
            }
        }
    }

def load_geojson_file(producer, filepath):
    """Load a GeoJSON file and produce to Kafka."""
    print(f"Loading {filepath}...")

    with open(filepath, 'r') as f:
        data = json.load(f)

    features = data.get('features', [])

    for feature in features:
        geofence_record = convert_geojson_to_geofence(feature)
        key = geofence_record['data']['zone_id']
        value = json.dumps(geofence_record)

        producer.produce(
            KAFKA_TOPIC,
            key=key.encode('utf-8'),
            value=value.encode('utf-8')
        )
        print(f"  - Loaded: {key} ({geofence_record['data']['zone_name']})")

    producer.flush()
    print(f"  Loaded {len(features)} geofences from {filepath}")

def main():
    producer = create_producer()

    # Find all geojson files in the geofences directory
    geofence_dir = Path(__file__).parent / 'geofences'

    total = 0
    for geojson_file in geofence_dir.glob('*.geojson'):
        load_geojson_file(producer, geojson_file)
        total += 1

    print(f"\nDone! Loaded geofences from {total} files.")

if __name__ == '__main__':
    main()
