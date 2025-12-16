# AIS Watchdog Architecture

## Overview

AIS Watchdog is a real-time maritime anomaly detection system built on Apache Kafka and Apache Flink. It monitors Automatic Identification System (AIS) vessel data to detect potentially illegal activities.

## System Architecture

```
                                    ┌──────────────────────────────────────────┐
                                    │           DETECTION LAYER                │
                                    │         (Apache Flink)                   │
┌─────────────┐    ┌───────────┐    │  ┌────────────────────────────────────┐  │    ┌───────────┐
│ AISStream   │───▶│           │    │  │  Geofence Violation Detector      │  │    │           │
│ WebSocket   │    │  ais-raw  │───▶│  │  Dark Event Detector              │──┼───▶│  alerts   │
│   Feed      │    │   topic   │    │  │  Rendezvous Detector              │  │    │   topic   │
└─────────────┘    │           │    │  │  Fishing Pattern Detector         │  │    │           │
                   └───────────┘    │  └────────────────────────────────────┘  │    └─────┬─────┘
                        │           └──────────────────────────────────────────┘          │
                        │                              │                                   │
┌─────────────┐    ┌────┴──────┐    ┌─────────────────┴───────────────────┐          ┌────┴──────┐
│  Reference  │───▶│ reference │───▶│        BROADCAST STATE              │          │  React    │
│    Data     │    │   -data   │    │  (Geofences, Sanctions Lists)       │          │ Frontend  │
│  Loader     │    │   topic   │    └─────────────────────────────────────┘          │ + Mapbox  │
└─────────────┘    └───────────┘                                                      └───────────┘

                   ┌───────────┐
                   │  vessel   │◀── Compacted topic for latest vessel state
                   │  -state   │
                   └───────────┘
```

## Components

### 1. Ingestion Layer (Python)

**ais_connector.py**
- Connects to AISStream.io WebSocket API
- Normalizes different AIS message types (Position Reports, Static Data, Class B)
- Produces to `ais-raw` Kafka topic
- Rate limiting to stay under Aiven free tier (250 kb/s)
- Geographic filtering via configurable bounding boxes

**reference_loader.py**
- Bootstraps reference data into Kafka
- Loads sanctions lists (OFAC, EU)
- Loads geofences (MPAs, EEZs, sanctioned waters)
- Loads port positions for "in port" detection

### 2. Stream Processing Layer (Java/Flink)

**AISWatchdogJob.java**
- Main Flink job entry point
- Consumes from `ais-raw` and `reference-data` topics
- Broadcasts geofences to all parallel instances
- Routes to multiple detectors in parallel
- Unions all alerts and produces to `alerts` topic

**Detectors:**

| Detector | Pattern | State Type |
|----------|---------|------------|
| GeofenceViolationDetector | Point-in-polygon | Broadcast |
| DarkEventDetector | Time gap analysis | Keyed (per vessel) |
| RendezvousDetector | Spatial proximity | Keyed (grid cells) |
| FishingPatternDetector | Movement analysis | Keyed (per vessel) + Broadcast |

### 3. Presentation Layer (React)

- Real-time map with Mapbox GL + Deck.gl
- Live alert feed with severity indicators
- Vessel detail cards
- Kafka REST Proxy integration for consuming topics

## Data Flow

### AIS Message Flow

```
1. AISStream WebSocket → ais_connector.py
2. Normalize message → AISPosition JSON
3. Produce to ais-raw topic (keyed by MMSI)
4. Flink consumes, parses, filters valid positions
5. Position broadcast to all detectors
6. Each detector evaluates → Optional<Alert>
7. Alerts produced to alerts topic
8. Frontend polls alerts topic via REST Proxy
```

### Reference Data Flow

```
1. reference_loader.py reads JSON/GeoJSON files
2. Wraps with metadata (record_type, loaded_at)
3. Produces to reference-data topic (compacted)
4. Flink consumes from earliest offset
5. Filters by record_type (geofence, sanction, port)
6. Broadcasts to relevant detectors
```

## Kafka Topics

| Topic | Key | Cleanup | Purpose |
|-------|-----|---------|---------|
| `ais-raw` | MMSI | Delete (3 days) | Raw AIS positions |
| `ais-enriched` | MMSI | Delete (3 days) | Processed positions for frontend |
| `alerts` | MMSI | Delete (3 days) | Generated alerts |
| `vessel-state` | MMSI | Compact | Latest state per vessel |
| `reference-data` | entity_id | Compact | Geofences, sanctions, ports |

## State Management

### Flink State Types

**Broadcast State** (GeofenceViolationDetector, FishingPatternDetector)
- Geofences broadcast to all parallel instances
- Each instance maintains full copy of all zones
- Updates propagate automatically on new geofence messages

**Keyed State** (DarkEventDetector, RendezvousDetector)
- State partitioned by key (MMSI or grid cell)
- Each key has isolated state (VesselState, EncounterState)
- Enables parallel processing with correct semantics

### Processing Time Timers

- DarkEventDetector uses timers to check for transmission gaps
- Timers fire every 60 seconds per vessel
- Re-register timer on each position update

## Detection Algorithms

### Geofence Violation
```
FOR each position:
  FOR each geofence in broadcast state:
    IF point-in-polygon(position, geofence):
      IF should_alert(vessel_type, zone_type):
        EMIT alert
```

### Dark Event (Going Dark)
```
ON position update:
  Update vessel state (last_seen, avg_interval)
  Register timer for gap check

ON timer fire:
  gap = now - last_seen
  IF gap > threshold AND vessel was active:
    EMIT alert
```

### Rendezvous Detection
```
Grid-based spatial partitioning:
  key = floor(lat / 0.1) : floor(lon / 0.1)

ON position update:
  IF in_open_sea AND speed < 5 knots:
    FOR each other vessel in same/adjacent grid cells:
      IF distance < 500m:
        Update encounter duration
        IF duration > 30 min:
          EMIT alert
```

### Fishing Pattern Detection
```
Maintain rolling window of recent positions per vessel

Analyze:
  - Average speed (< 5 knots typical for fishing)
  - Speed variance (high = start/stop pattern)
  - Course changes per hour (> 10 = working an area)
  - Area covered (< 100 sq NM = concentrated)

IF fishing_pattern AND in_protected_zone:
  EMIT alert
```

## Scalability Considerations

### Aiven Free Tier Constraints
- 250 kb/s throughput (IN + OUT combined)
- 5 topics, 2 partitions each
- 3-day retention

### Optimizations Applied
- Geographic filtering at ingestion (bounding boxes)
- Rate limiting (200 kb/s buffer)
- GZIP compression for Kafka messages
- Spatial partitioning for rendezvous detection
- Caching parsed geometries

### Future Scaling Path
1. Increase Kafka partitions for higher parallelism
2. Add more Flink task slots
3. Shard reference data by region
4. Use Flink's RocksDB state backend for large state
