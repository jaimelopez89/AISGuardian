# AIS Watchdog Data Formats

## Kafka Message Schemas

### 1. AIS Position (ais-raw, ais-enriched topics)

**Key:** MMSI (string)

**Value:**
```json
{
  "mmsi": "123456789",
  "timestamp": "2024-01-15T12:00:00Z",
  "latitude": 38.5,
  "longitude": 15.2,
  "course_over_ground": 180.5,
  "speed_over_ground": 12.3,
  "heading": 179,
  "nav_status": 0,
  "ship_name": "VESSEL NAME",
  "ship_type": 70,
  "imo_number": "1234567",
  "call_sign": "ABCD",
  "destination": "GENOA",
  "eta": "01-20 14:00",
  "draught": 8.5,
  "dimension_a": 100,
  "dimension_b": 50,
  "dimension_c": 15,
  "dimension_d": 15,
  "message_type": 1,
  "raw_message": {}
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| mmsi | string | Maritime Mobile Service Identity (9 digits) |
| timestamp | ISO 8601 | UTC timestamp of position report |
| latitude | float | Latitude in decimal degrees (-90 to 90) |
| longitude | float | Longitude in decimal degrees (-180 to 180) |
| course_over_ground | float | Course in degrees (0-360), null if unavailable |
| speed_over_ground | float | Speed in knots, null if unavailable |
| heading | float | True heading in degrees, null if unavailable |
| nav_status | int | Navigation status code (0-15) |
| ship_name | string | Vessel name, null if unknown |
| ship_type | int | Ship type code (0-99) |
| imo_number | string | IMO number (7 digits), null if unavailable |
| call_sign | string | Radio call sign |
| destination | string | Reported destination |
| eta | string | Estimated time of arrival |
| draught | float | Ship draught in meters |
| dimension_a/b/c/d | int | Ship dimensions in meters |
| message_type | int | AIS message type (1, 2, 3, 5, 18, 19, 24) |

**Navigation Status Codes:**
```
0 = Under way using engine
1 = At anchor
2 = Not under command
3 = Restricted maneuverability
4 = Constrained by draught
5 = Moored
6 = Aground
7 = Engaged in fishing
8 = Under way sailing
```

**Ship Type Codes (common):**
```
30-37 = Fishing
40-49 = High speed craft
50-59 = Special craft (tugs, pilots, etc.)
60-69 = Passenger
70-79 = Cargo
80-89 = Tanker
```

---

### 2. Alert (alerts topic)

**Key:** MMSI (string)

**Value:**
```json
{
  "alert_id": "550e8400-e29b-41d4-a716-446655440000",
  "alert_type": "GEOFENCE_VIOLATION",
  "severity": "HIGH",
  "mmsi": "123456789",
  "vessel_name": "VESSEL NAME",
  "imo_number": "1234567",
  "flag_state": "PA",
  "latitude": 38.5,
  "longitude": 15.2,
  "detected_at": "2024-01-15T12:00:00Z",
  "title": "Geofence Violation: Mediterranean MPA",
  "description": "Vessel VESSEL NAME entered Marine Protected Area",
  "details": {
    "zone_name": "Mediterranean MPA",
    "zone_type": "MPA",
    "vessel_speed": 12.3,
    "vessel_course": 180.5
  }
}
```

**Alert Types:**
| Type | Description |
|------|-------------|
| `GEOFENCE_VIOLATION` | Vessel entered restricted zone |
| `DARK_EVENT` | Vessel stopped transmitting AIS |
| `RENDEZVOUS` | Ship-to-ship meeting detected |
| `FISHING_IN_MPA` | Fishing activity in protected area |
| `SANCTIONS_MATCH` | Vessel matches sanctions list or shadow fleet |
| `AIS_SPOOFING` | Spoofed/manipulated AIS signal detected |
| `CABLE_PROXIMITY` | Vessel near undersea cable infrastructure |
| `LOITERING` | Vessel loitering in sensitive area |
| `CONVOY` | Coordinated vessel group detected |
| `ANCHOR_DRAGGING` | Vessel anchor may be dragging |

**Severity Levels:**
| Severity | Description |
|----------|-------------|
| `LOW` | Informational, may be normal activity |
| `MEDIUM` | Suspicious, warrants monitoring |
| `HIGH` | Likely violation, requires attention |
| `CRITICAL` | Confirmed violation or high-risk vessel |

**Alert-Specific Details:**

*GEOFENCE_VIOLATION:*
```json
{
  "zone_name": "Syria EEZ",
  "zone_type": "sanctioned_waters",
  "vessel_speed": 12.3,
  "vessel_course": 180.5
}
```

*DARK_EVENT:*
```json
{
  "gap_minutes": 180,
  "last_speed": 12.3,
  "last_seen": "2024-01-15T09:00:00Z"
}
```

*RENDEZVOUS:*
```json
{
  "vessel2_mmsi": "987654321",
  "vessel2_name": "OTHER VESSEL",
  "distance_meters": 450,
  "duration_minutes": 45,
  "vessel1_type": 70,
  "vessel2_type": 80
}
```

*FISHING_IN_MPA:*
```json
{
  "zone_id": "MPA-001",
  "zone_type": "MPA",
  "avg_speed_knots": 3.2,
  "speed_variance": 2.5,
  "course_changes": 12,
  "confidence": 85.5
}
```

*SANCTIONS_MATCH (Shadow Fleet):*
```json
{
  "sanctioned_imo": "9384854",
  "sanctioned_name": "EAGLE S",
  "sanctions_authorities": ["EU", "UA"],
  "risk_level": "critical",
  "vessel_type": "tanker",
  "match_type": "IMO_NUMBER",
  "notes": "Investigated for Estlink cable sabotage"
}
```

*SANCTIONS_MATCH (Risk Score):*
```json
{
  "risk_score": 85,
  "risk_tier": "CRITICAL",
  "dark_event_count": 3,
  "russian_port_visits": 2,
  "sts_transfer_count": 1,
  "high_risk_flag": true,
  "name_change_count": 2,
  "visited_russian_ports": ["St. Petersburg", "Ust-Luga"],
  "alert_reason": "crossed into CRITICAL risk tier"
}
```

*AIS_SPOOFING:*
```json
{
  "reason": "IMO number changed - possible identity theft or spoofing",
  "original_imo": "9299628",
  "current_imo": "9384854",
  "cumulative_spoofing_score": 60
}
```

---

### 3. Sanctions Data (sanctions topic)

**Key:** `IMO:{imo_number}` or `FLAG:{mid_code}` (string)
**Compaction:** Enabled

#### Sanctioned Vessel Record

```json
{
  "record_type": "SANCTIONED_VESSEL",
  "imo_number": "9384854",
  "vessel_name": "EAGLE S",
  "vessel_type": "tanker",
  "sanctions_authorities": ["EU", "UA", "OFAC"],
  "risk_level": "critical",
  "notes": "Investigated for Estlink cable sabotage Dec 2024",
  "source": "shadow_fleet_database",
  "loaded_at": "2025-01-15T12:00:00Z"
}
```

#### High-Risk Flag Record

```json
{
  "record_type": "HIGH_RISK_FLAG",
  "mid_code": "273",
  "country_code": "RU",
  "country_name": "Russia",
  "risk_level": "critical",
  "reason": "Primary sanctions target",
  "loaded_at": "2025-01-15T12:00:00Z"
}
```

**Risk Levels:**
| Level | Description |
|-------|-------------|
| `critical` | Sanctioned state (RU, IR, KP) or confirmed shadow fleet |
| `high` | High probability shadow fleet or flag of convenience |
| `medium` | Elevated risk, requires monitoring |

**High-Risk MID Codes:**
| MID | Country | Risk Level |
|-----|---------|------------|
| 273 | Russia | critical |
| 422 | Iran | critical |
| 445 | North Korea | critical |
| 412-414 | China | high |
| 477 | Hong Kong | high |
| 620 | Cameroon | high |
| 613 | Gabon | high |
| 572 | Palau | high |
| 667 | Sierra Leone | medium |

---

### 4. Reference Data (reference-data topic)

**Key:** `{record_type}:{entity_id}` (string)

**Wrapper Format:**
```json
{
  "record_type": "geofence",
  "loaded_at": "2024-01-15T12:00:00Z",
  "data": { ... }
}
```

#### Geofence Record

```json
{
  "record_type": "geofence",
  "loaded_at": "2024-01-15T12:00:00Z",
  "data": {
    "zone_id": "MPA-001",
    "zone_name": "Mediterranean Marine Protected Area",
    "zone_type": "MPA",
    "jurisdiction": "International",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[15.0, 38.0], [16.0, 38.0], [16.0, 39.0], [15.0, 39.0], [15.0, 38.0]]]
    },
    "rules": {
      "alert_vessel_types": [30, 31, 32, 33, 34, 35, 36, 37],
      "alert_on_fishing_behavior": true,
      "alert_all_vessels": false,
      "severity": "HIGH"
    },
    "metadata": {
      "established": "2020-01-01",
      "restrictions": "No fishing allowed"
    }
  }
}
```

**Zone Types:**
| Type | Description | Default Severity |
|------|-------------|------------------|
| `MPA` | Marine Protected Area | HIGH |
| `EEZ` | Exclusive Economic Zone | MEDIUM |
| `sanctioned_waters` | Sanctioned nation waters | CRITICAL |
| `restricted` | Military or other restricted zone | HIGH |

#### Sanction Record

```json
{
  "record_type": "sanction",
  "loaded_at": "2024-01-15T12:00:00Z",
  "data": {
    "entity_id": "OFAC-12345",
    "entity_type": "vessel",
    "name": "SANCTIONED VESSEL",
    "aliases": ["SV", "SANC V"],
    "mmsi": "123456789",
    "imo_number": "1234567",
    "flag_state": "KP",
    "sanctions_source": "OFAC",
    "date_listed": "2023-01-15",
    "reason": "North Korean sanctions evasion",
    "additional_info": {
      "program": "DPRK",
      "vessel_type": "Tanker"
    }
  }
}
```

#### Port Record

```json
{
  "record_type": "port",
  "loaded_at": "2024-01-15T12:00:00Z",
  "data": {
    "port_id": "ITGOA",
    "port_name": "Genoa",
    "country": "Italy",
    "latitude": 44.4072,
    "longitude": 8.9342,
    "port_type": "major",
    "locode": "ITGOA"
  }
}
```

---

### 5. Vessel State (vessel-state topic)

**Key:** MMSI (string)
**Compaction:** Enabled (keeps latest per key)

```json
{
  "mmsi": "123456789",
  "ship_name": "VESSEL NAME",
  "imo_number": "1234567",
  "ship_type": 70,
  "flag_state": "PA",
  "last_latitude": 38.5,
  "last_longitude": 15.2,
  "last_speed": 12.3,
  "last_course": 180.5,
  "last_seen": "2024-01-15T12:00:00Z",
  "first_seen": "2024-01-10T08:00:00Z",
  "message_count": 1500,
  "avg_interval_seconds": 180,
  "is_sanctioned": false,
  "sanction_info": null,
  "in_sensitive_zone": false,
  "current_zone": null
}
```

---

## AISStream Message Format (Input)

The ingestion layer receives messages from AISStream.io in this format:

```json
{
  "MessageType": "PositionReport",
  "MetaData": {
    "MMSI": 123456789,
    "ShipName": "VESSEL NAME",
    "latitude": 38.5,
    "longitude": 15.2,
    "time_utc": "2024-01-15 12:00:00.000000+00:00"
  },
  "Message": {
    "PositionReport": {
      "MessageID": 1,
      "RepeatIndicator": 0,
      "UserID": 123456789,
      "Valid": true,
      "NavigationalStatus": 0,
      "RateOfTurn": 0,
      "Sog": 12.3,
      "PositionAccuracy": true,
      "Longitude": 15.2,
      "Latitude": 38.5,
      "Cog": 180.5,
      "TrueHeading": 179,
      "Timestamp": 30,
      "SpecialManoeuvreIndicator": 0,
      "Spare": 0,
      "Raim": false,
      "CommunicationState": 0
    }
  }
}
```

**Supported Message Types:**
- `PositionReport` (Types 1, 2, 3)
- `ShipStaticData` (Type 5)
- `StandardClassBPositionReport` (Type 18)
- `ExtendedClassBPositionReport` (Type 19)
- `StaticDataReport` (Type 24)

---

## GeoJSON Format (Geofences)

Reference geofences are stored as GeoJSON FeatureCollections:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": "MPA-001",
        "name": "Sample MPA",
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
  ]
}
```

**Note:** GeoJSON coordinates are `[longitude, latitude]`, not `[latitude, longitude]`.
