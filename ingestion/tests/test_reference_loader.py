"""
Tests for Reference Data Loader module.
"""

import json
import pytest
from pathlib import Path
from unittest.mock import Mock, patch

import sys
sys.path.insert(0, '..')

from reference_loader import (
    SanctionedEntity,
    Geofence,
    Port,
    ReferenceDataLoader,
)


class TestSanctionedEntity:
    """Tests for SanctionedEntity dataclass."""

    def test_create_sanctioned_entity(self):
        """Test creating a sanctioned entity."""
        entity = SanctionedEntity(
            entity_id="TEST-001",
            entity_type="vessel",
            name="SANCTIONED VESSEL",
            aliases=["SV", "SANC VESSEL"],
            mmsi="123456789",
            imo_number="1234567",
            flag_state="KP",
            sanctions_source="OFAC",
            date_listed="2023-01-15",
            reason="Sanctions evasion",
            additional_info={"program": "DPRK"}
        )

        assert entity.entity_id == "TEST-001"
        assert entity.entity_type == "vessel"
        assert entity.name == "SANCTIONED VESSEL"
        assert len(entity.aliases) == 2
        assert entity.flag_state == "KP"

    def test_to_json(self):
        """Test JSON serialization."""
        entity = SanctionedEntity(
            entity_id="TEST-001",
            entity_type="vessel",
            name="TEST",
            aliases=[],
            mmsi=None,
            imo_number=None,
            flag_state=None,
            sanctions_source="OFAC",
            date_listed="2023-01-15",
            reason="Test",
            additional_info={}
        )

        json_str = entity.to_json()
        data = json.loads(json_str)

        assert data["entity_id"] == "TEST-001"
        assert data["sanctions_source"] == "OFAC"


class TestGeofence:
    """Tests for Geofence dataclass."""

    def test_create_geofence(self):
        """Test creating a geofence."""
        geofence = Geofence(
            zone_id="MPA-001",
            zone_name="Test Marine Protected Area",
            zone_type="MPA",
            jurisdiction="International",
            geometry={
                "type": "Polygon",
                "coordinates": [[[15.0, 38.0], [16.0, 38.0], [16.0, 39.0], [15.0, 39.0], [15.0, 38.0]]]
            },
            rules={"alert_all_vessels": False, "alert_on_fishing_behavior": True},
            metadata={"established": "2020-01-01"}
        )

        assert geofence.zone_id == "MPA-001"
        assert geofence.zone_type == "MPA"
        assert geofence.geometry["type"] == "Polygon"

    def test_to_json(self):
        """Test JSON serialization."""
        geofence = Geofence(
            zone_id="EEZ-001",
            zone_name="Test EEZ",
            zone_type="EEZ",
            jurisdiction="Test Country",
            geometry={"type": "Polygon", "coordinates": []},
            rules={},
            metadata={}
        )

        json_str = geofence.to_json()
        data = json.loads(json_str)

        assert data["zone_id"] == "EEZ-001"
        assert data["zone_type"] == "EEZ"


class TestPort:
    """Tests for Port dataclass."""

    def test_create_port(self):
        """Test creating a port."""
        port = Port(
            port_id="ITGOA",
            port_name="Genoa",
            country="Italy",
            latitude=44.4072,
            longitude=8.9342,
            port_type="major",
            locode="ITGOA"
        )

        assert port.port_id == "ITGOA"
        assert port.port_name == "Genoa"
        assert port.country == "Italy"
        assert port.latitude == pytest.approx(44.4072, rel=1e-4)

    def test_to_json(self):
        """Test JSON serialization."""
        port = Port(
            port_id="TEST",
            port_name="Test Port",
            country="Test",
            latitude=0.0,
            longitude=0.0,
            port_type="minor",
            locode=None
        )

        json_str = port.to_json()
        data = json.loads(json_str)

        assert data["port_id"] == "TEST"
        assert data["locode"] is None


class TestReferenceDataLoader:
    """Tests for ReferenceDataLoader class."""

    @pytest.fixture
    def loader(self):
        """Create a test loader instance."""
        kafka_config = {
            'bootstrap_servers': 'localhost:9092',
            'ssl_ca_cert': None,
            'ssl_cert': None,
            'ssl_key': None,
        }
        return ReferenceDataLoader(kafka_config)

    def test_infer_zone_type_mpa(self, loader):
        """Test zone type inference for MPA."""
        assert loader._infer_zone_type("sample_mpa") == "MPA"
        assert loader._infer_zone_type("marine_protected_area") == "MPA"
        assert loader._infer_zone_type("protected_zones") == "MPA"

    def test_infer_zone_type_eez(self, loader):
        """Test zone type inference for EEZ."""
        assert loader._infer_zone_type("eez_boundaries") == "EEZ"
        assert loader._infer_zone_type("world_eez") == "EEZ"

    def test_infer_zone_type_sanctioned(self, loader):
        """Test zone type inference for sanctioned waters."""
        assert loader._infer_zone_type("sanctioned_eez") == "sanctioned_waters"
        assert loader._infer_zone_type("sanction_zones") == "sanctioned_waters"

    def test_infer_zone_type_restricted(self, loader):
        """Test zone type inference for restricted zones."""
        assert loader._infer_zone_type("restricted_military") == "restricted"
        assert loader._infer_zone_type("military_restricted") == "restricted"

    def test_infer_zone_type_unknown(self, loader):
        """Test zone type inference for unknown types."""
        assert loader._infer_zone_type("random_file") == "unknown"

    def test_get_zone_rules_mpa(self, loader):
        """Test getting rules for MPA zones."""
        rules = loader._get_zone_rules("MPA")

        assert rules["alert_on_fishing_behavior"] is True
        assert rules["alert_all_vessels"] is False
        assert rules["severity"] == "HIGH"
        # Fishing vessel types should trigger alerts
        assert 30 in rules["alert_vessel_types"]

    def test_get_zone_rules_sanctioned(self, loader):
        """Test getting rules for sanctioned waters."""
        rules = loader._get_zone_rules("sanctioned_waters")

        assert rules["alert_all_vessels"] is True
        assert rules["severity"] == "CRITICAL"

    def test_get_zone_rules_eez(self, loader):
        """Test getting rules for EEZ zones."""
        rules = loader._get_zone_rules("EEZ")

        assert rules["alert_on_fishing_behavior"] is True
        assert rules["check_flag_state"] is True
        assert rules["severity"] == "MEDIUM"


class TestReferenceDataFiles:
    """Tests for reference data file format validation."""

    @pytest.fixture
    def reference_data_path(self):
        """Get path to reference data."""
        return Path(__file__).parent.parent.parent / "reference-data"

    def test_sanctions_file_format(self, reference_data_path):
        """Test that sanctions files have correct format."""
        sanctions_path = reference_data_path / "sanctions"

        if not sanctions_path.exists():
            pytest.skip("Sanctions directory not found")

        for sanctions_file in sanctions_path.glob("*.json"):
            with open(sanctions_file) as f:
                data = json.load(f)

            # Should have entities list
            entities = data if isinstance(data, list) else data.get("entities", [])
            assert isinstance(entities, list)

            for entity in entities:
                # Required fields
                assert "name" in entity or "id" in entity

    def test_geofence_file_format(self, reference_data_path):
        """Test that geofence files have correct GeoJSON format."""
        geofences_path = reference_data_path / "geofences"

        if not geofences_path.exists():
            pytest.skip("Geofences directory not found")

        for geofence_file in geofences_path.glob("*.geojson"):
            with open(geofence_file) as f:
                data = json.load(f)

            # Should be valid GeoJSON
            assert data.get("type") in ["FeatureCollection", "Feature"]

            if data["type"] == "FeatureCollection":
                assert "features" in data
                for feature in data["features"]:
                    assert feature.get("type") == "Feature"
                    assert "geometry" in feature
                    assert "properties" in feature

    def test_ports_file_format(self, reference_data_path):
        """Test that ports files have correct format."""
        ports_path = reference_data_path / "ports"

        if not ports_path.exists():
            pytest.skip("Ports directory not found")

        for ports_file in ports_path.glob("*.json"):
            with open(ports_file) as f:
                data = json.load(f)

            ports = data if isinstance(data, list) else data.get("ports", [])
            assert isinstance(ports, list)

            for port in ports:
                # Required fields
                assert "name" in port
                assert "latitude" in port
                assert "longitude" in port

                # Valid coordinates
                assert -90 <= port["latitude"] <= 90
                assert -180 <= port["longitude"] <= 180
