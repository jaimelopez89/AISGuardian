"""
Pytest configuration and fixtures for ingestion tests.
"""

import pytest
import json
from pathlib import Path


@pytest.fixture
def sample_position_report():
    """Sample AIS position report message."""
    return {
        "MessageType": "PositionReport",
        "MetaData": {
            "MMSI": 123456789,
            "ShipName": "TEST VESSEL",
            "latitude": 38.5,
            "longitude": 15.2,
            "time_utc": "2024-01-15T12:00:00Z"
        },
        "Message": {
            "PositionReport": {
                "MessageID": 1,
                "Cog": 180.5,
                "Sog": 12.3,
                "TrueHeading": 179,
                "NavigationalStatus": 0
            }
        }
    }


@pytest.fixture
def sample_static_data():
    """Sample AIS ship static data message."""
    return {
        "MessageType": "ShipStaticData",
        "MetaData": {
            "MMSI": 987654321,
            "ShipName": "CARGO SHIP",
            "latitude": 40.0,
            "longitude": 10.0,
            "time_utc": "2024-01-15T12:00:00Z"
        },
        "Message": {
            "ShipStaticData": {
                "MessageID": 5,
                "Name": "CARGO SHIP",
                "Type": 70,
                "ImoNumber": 7654321,
                "CallSign": "WXYZ",
                "Destination": "MARSEILLE",
                "Eta": "01-18 08:00",
                "MaximumStaticDraught": 10.5,
                "Dimension": {
                    "A": 150,
                    "B": 50,
                    "C": 20,
                    "D": 20
                }
            }
        }
    }


@pytest.fixture
def sample_sanction_entry():
    """Sample sanctions list entry."""
    return {
        "id": "TEST-001",
        "type": "vessel",
        "name": "SANCTIONED VESSEL",
        "aliases": ["SV", "SANC V"],
        "mmsi": "123456789",
        "imo_number": "1234567",
        "flag_state": "KP",
        "source": "OFAC",
        "date_listed": "2023-01-15",
        "reason": "North Korean sanctions evasion",
        "additional_info": {
            "program": "DPRK"
        }
    }


@pytest.fixture
def sample_geofence():
    """Sample GeoJSON geofence feature."""
    return {
        "type": "Feature",
        "properties": {
            "id": "MPA-001",
            "name": "Test Marine Protected Area",
            "zone_type": "MPA",
            "jurisdiction": "International"
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [15.0, 38.0],
                    [16.0, 38.0],
                    [16.0, 39.0],
                    [15.0, 39.0],
                    [15.0, 38.0]
                ]
            ]
        }
    }


@pytest.fixture
def sample_port():
    """Sample port entry."""
    return {
        "id": "ITGOA",
        "name": "Genoa",
        "country": "Italy",
        "latitude": 44.4072,
        "longitude": 8.9342,
        "type": "major",
        "locode": "ITGOA"
    }


@pytest.fixture
def kafka_config():
    """Test Kafka configuration."""
    return {
        'bootstrap_servers': 'localhost:9092',
        'ssl_ca_cert': None,
        'ssl_cert': None,
        'ssl_key': None,
    }
