"""
Tests for AIS Connector module.
"""

import json
import pytest
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime, timezone

import sys
sys.path.insert(0, '..')

from ais_connector import AISPosition, AISConnector, get_bounding_boxes


class TestAISPosition:
    """Tests for AISPosition dataclass."""

    def test_create_position(self):
        """Test creating an AIS position."""
        pos = AISPosition(
            mmsi="123456789",
            timestamp="2024-01-15T12:00:00Z",
            latitude=38.5,
            longitude=15.2,
            course_over_ground=180.5,
            speed_over_ground=12.3,
            heading=179,
            nav_status=0,
            ship_name="TEST VESSEL",
            ship_type=70,
            imo_number="1234567",
            call_sign="ABCD",
            destination="GENOA",
            eta="01-20 14:00",
            draught=8.5,
            dimension_a=100,
            dimension_b=50,
            dimension_c=15,
            dimension_d=15,
            message_type=1,
            raw_message={}
        )

        assert pos.mmsi == "123456789"
        assert pos.latitude == 38.5
        assert pos.longitude == 15.2
        assert pos.ship_name == "TEST VESSEL"

    def test_to_json(self):
        """Test JSON serialization."""
        pos = AISPosition(
            mmsi="123456789",
            timestamp="2024-01-15T12:00:00Z",
            latitude=38.5,
            longitude=15.2,
            course_over_ground=None,
            speed_over_ground=None,
            heading=None,
            nav_status=None,
            ship_name=None,
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
            message_type=1,
            raw_message={}
        )

        json_str = pos.to_json()
        data = json.loads(json_str)

        assert data["mmsi"] == "123456789"
        assert data["latitude"] == 38.5
        assert data["longitude"] == 15.2
        assert data["message_type"] == 1


class TestAISConnector:
    """Tests for AISConnector class."""

    @pytest.fixture
    def connector(self):
        """Create a test connector instance."""
        kafka_config = {
            'bootstrap_servers': 'localhost:9092',
            'ssl_ca_cert': None,
            'ssl_cert': None,
            'ssl_key': None,
        }
        return AISConnector(
            api_key="test_api_key",
            kafka_config=kafka_config,
            bounding_boxes=[[[30.0, -6.0], [46.0, 36.0]]],
            rate_limit_kbps=200
        )

    def test_normalize_position_report(self, connector):
        """Test normalizing a position report message."""
        raw_msg = {
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

        result = connector._normalize_message(raw_msg)

        assert result is not None
        assert result.mmsi == "123456789"
        assert result.ship_name == "TEST VESSEL"
        assert result.latitude == 38.5
        assert result.longitude == 15.2
        assert result.course_over_ground == 180.5
        assert result.speed_over_ground == 12.3
        assert result.message_type == 1

    def test_normalize_ship_static_data(self, connector):
        """Test normalizing a ship static data message."""
        raw_msg = {
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

        result = connector._normalize_message(raw_msg)

        assert result is not None
        assert result.mmsi == "987654321"
        assert result.ship_type == 70
        assert result.imo_number == "7654321"
        assert result.call_sign == "WXYZ"
        assert result.destination == "MARSEILLE"
        assert result.dimension_a == 150
        assert result.dimension_b == 50

    def test_normalize_class_b_position(self, connector):
        """Test normalizing a Class B position report."""
        raw_msg = {
            "MessageType": "StandardClassBPositionReport",
            "MetaData": {
                "MMSI": 111222333,
                "ShipName": "PLEASURE CRAFT",
                "latitude": 35.0,
                "longitude": 20.0,
                "time_utc": "2024-01-15T12:00:00Z"
            },
            "Message": {
                "StandardClassBPositionReport": {
                    "Cog": 90.0,
                    "Sog": 5.5,
                    "TrueHeading": 88
                }
            }
        }

        result = connector._normalize_message(raw_msg)

        assert result is not None
        assert result.mmsi == "111222333"
        assert result.message_type == 18
        assert result.speed_over_ground == 5.5

    def test_normalize_invalid_message(self, connector):
        """Test handling of invalid messages."""
        # Missing MMSI
        raw_msg = {
            "MessageType": "PositionReport",
            "MetaData": {
                "latitude": 38.5,
                "longitude": 15.2
            },
            "Message": {}
        }

        result = connector._normalize_message(raw_msg)
        assert result is None

    def test_normalize_unknown_message_type(self, connector):
        """Test handling of unknown message types."""
        raw_msg = {
            "MessageType": "UnknownType",
            "MetaData": {
                "MMSI": 123456789,
                "latitude": 38.5,
                "longitude": 15.2
            },
            "Message": {}
        }

        result = connector._normalize_message(raw_msg)
        assert result is None

    def test_rate_limit_check(self, connector):
        """Test rate limiting logic."""
        # Initially should be under limit
        assert connector._check_rate_limit() is True

        # Simulate some bytes produced
        connector.bytes_produced = 300 * 1024  # 300 KB in 1 second would exceed 200 kb/s
        connector.last_rate_check = datetime.now(timezone.utc)

        # Wait and check again - should reset
        import time
        time.sleep(1.1)
        result = connector._check_rate_limit()
        # After reset, bytes_produced should be 0
        assert connector.bytes_produced == 0


class TestBoundingBoxes:
    """Tests for geographic bounding box configuration."""

    def test_get_bounding_boxes(self):
        """Test that bounding boxes are valid."""
        boxes = get_bounding_boxes()

        assert len(boxes) > 0

        for box in boxes:
            assert len(box) == 2  # [[min], [max]]
            min_point, max_point = box

            assert len(min_point) == 2  # [lat, lon]
            assert len(max_point) == 2

            # Min should be less than max
            assert min_point[0] < max_point[0]  # lat
            assert min_point[1] < max_point[1]  # lon

            # Valid coordinate ranges
            assert -90 <= min_point[0] <= 90
            assert -90 <= max_point[0] <= 90
            assert -180 <= min_point[1] <= 180
            assert -180 <= max_point[1] <= 180

    def test_mediterranean_coverage(self):
        """Test that Mediterranean Sea is covered."""
        boxes = get_bounding_boxes()

        # Mediterranean center point
        med_lat, med_lon = 38.0, 15.0

        covered = False
        for box in boxes:
            min_lat, min_lon = box[0]
            max_lat, max_lon = box[1]

            if min_lat <= med_lat <= max_lat and min_lon <= med_lon <= max_lon:
                covered = True
                break

        assert covered, "Mediterranean Sea should be covered by bounding boxes"


class TestIntegration:
    """Integration tests (require mocking external services)."""

    @pytest.mark.asyncio
    async def test_websocket_connection(self):
        """Test WebSocket connection handling."""
        # This would test the actual connection logic
        # Skipped in unit tests - run in integration tests
        pass

    @pytest.mark.asyncio
    async def test_kafka_producer(self):
        """Test Kafka producer functionality."""
        # This would test actual Kafka production
        # Skipped in unit tests - run in integration tests
        pass
