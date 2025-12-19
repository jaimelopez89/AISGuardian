# AIS Guardian Architecture

## Overview

AIS Guardian is a real-time maritime anomaly detection system built on Aiven Kafka and Apache Flink. It monitors AIS vessel data in the Baltic Sea to detect potential threats to critical undersea infrastructure.

## System Architecture

```
                                                    ┌──────────────────────────────────────────┐
                                                    │           DETECTION LAYER                │
                                                    │         (Apache Flink)                   │
┌─────────────┐    ┌───────────────┐                │  ┌────────────────────────────────────┐  │    ┌───────────────┐
│ AISStream   │───▶│               │                │  │  Cable Proximity Detector          │  │    │               │
│ WebSocket   │    │   ais-raw     │───────────────▶│  │  Geofence Violation Detector       │──┼───▶│    alerts     │
│   Feed      │    │   topic       │                │  │  Dark Event Detector               │  │    │    topic      │
└─────────────┘    │               │                │  │  Rendezvous Detector               │  │    │               │
                   └───────────────┘                │  │  Fishing Pattern Detector          │  │    └───────┬───────┘
                                                    │  └────────────────────────────────────┘  │            │
                                                    └──────────────────────────────────────────┘            │
                                                                                                            │
                   ┌───────────────┐    ┌────────────────────────────────────────┐                          │
                   │  reference    │───▶│        BROADCAST STATE                 │                          │
                   │    -data      │    │  (Geofences, Cables, Ports)            │                          │
                   │   topic       │    └────────────────────────────────────────┘                          │
                   └───────────────┘                                                                        │
                                                                                                            │
                                                                                                            │
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────┐
│                                                                                                           │       │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐ │       │
│   │                                    FastAPI Backend                                                  │ │       │
│   │                                                                                                     │◀┘       │
│   │   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │         │
│   │   │  Vessel State   │    │  Alert Buffer   │    │  Trail History  │    │  REST Endpoints │         │         │
│   │   │  (In-Memory)    │    │  (Last 500)     │    │  (Per Vessel)   │    │  /api/*         │         │         │
│   │   └─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘         │         │
│   │                                                                                                     │         │
│   └─────────────────────────────────────────────────────────────────────────────────────────────────────┘         │
│                                                              │                                                     │
│                                                              │                                                     │
│                                                              ▼                                                     │
│                                                    ┌─────────────────┐                                             │
│                                                    │  React Frontend │                                             │
│                                                    │  (Mapbox/Deck)  │                                             │
│                                                    └─────────────────┘                                             │
│                                                                                                                    │
│   LOCAL SERVICES                                                                              AIVEN KAFKA (CLOUD)  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. AIS Ingestion Layer (Python)

**`ingestion/ais_connector.py`**
- Connects to AISStream.io WebSocket API
- Subscribes to Baltic Sea region (54°N-61°N, 12°E-31°E)
- Normalizes different AIS message types (Position Reports, Static Data, Class B)
- Produces to `ais-raw` Kafka topic on Aiven
- Rate limiting to stay under Aiven free tier (100 kb/s conservative limit)
- GZIP compression for all messages
- Automatic reconnection on connection loss

### 2. Stream Processing Layer (Java/Flink)

**`flink-jobs/src/main/java/com/aiswatchdog/AISWatchdogJob.java`**
- Main Flink job entry point
- Consumes from `ais-raw` topic via SSL connection to Aiven Kafka
- Broadcasts reference data (geofences, cables) to all parallel instances
- Routes to multiple detectors in parallel
- Unions all alerts and produces to `alerts` topic

**Detectors (11 total):**

| Detector | Pattern | State Type |
|----------|---------|------------|
| GeofenceViolationDetector | Point-in-polygon | Broadcast |
| DarkEventDetector | Time gap analysis | Keyed (per vessel) |
| RendezvousDetector | Spatial proximity | Keyed (grid cells) |
| FishingPatternDetector | Movement analysis | Keyed (per vessel) + Broadcast |
| CableProximityDetector | Distance to cable routes | Keyed (per vessel) + Broadcast |
| LoiteringDetector | Stationary analysis | Keyed (per vessel) |
| AISSpoofingDetector | Data integrity check | Keyed (per vessel) |
| ConvoyDetector | Formation detection | Keyed (grid cells) |
| AnchorDraggingDetector | Movement while anchored | Keyed (per vessel) + Broadcast |
| ShadowFleetDetector | Sanctions matching | Keyed (per vessel) + Broadcast (sanctions) |
| VesselRiskScorer | Behavioral scoring | Keyed (per vessel) |

See [DETECTORS.md](../flink-jobs/DETECTORS.md) for detailed documentation.

### 3. Backend API Layer (Python/FastAPI)

**`backend/api.py`**
- FastAPI server consuming from Aiven Kafka topics
- Background threads for Kafka consumers (vessels and alerts)
- Maintains in-memory state:
  - `vessel_state`: Latest position per MMSI
  - `vessel_trails`: Last 50 positions per vessel for trail visualization
  - `alerts_list`: Last 500 alerts
- REST endpoints for frontend consumption
- CORS enabled for local development

### 4. Presentation Layer (React/Vite)

**`frontend/`**
- Real-time map with Mapbox GL + Deck.gl
- Vessel markers with flag state identification (100+ countries)
- Vessel trails for movement history
- Cable protection zone overlays
- Live alert feed with severity indicators
- Vessel detail tooltips

## Data Flow

### AIS Message Flow

```
1. AISStream WebSocket → ingestion/ais_connector.py
2. Normalize message → AISPosition JSON
3. Produce to ais-raw topic on Aiven Kafka (SSL)
4. Flink consumes from Aiven Kafka (SSL via KeyStores)
5. Position routed to all detectors
6. Each detector evaluates → Optional<Alert>
7. Alerts produced to alerts topic
8. Backend API consumes alerts topic
9. Frontend polls /api/alerts endpoint
```

### Reference Data Flow

```
1. Geofence/cable GeoJSON files loaded at startup
2. Broadcast to Flink detectors
3. Used for point-in-polygon and distance calculations
```

## Kafka Topics (Aiven)

| Topic | Key | Cleanup | Purpose |
|-------|-----|---------|---------|
| `ais-raw` | MMSI | Delete (3 days) | Raw AIS positions from ingestion |
| `alerts` | MMSI | Delete (3 days) | Generated alerts from Flink |
| `reference-data` | entity_id | Compact | Geofences, cables, ports (optional) |

## State Management

### Flink State Types

**Broadcast State** (GeofenceViolationDetector, CableProximityDetector)
- Geofences and cable routes broadcast to all parallel instances
- Each instance maintains full copy of all zones
- Updates propagate automatically on new reference messages

**Keyed State** (DarkEventDetector, RendezvousDetector)
- State partitioned by key (MMSI or grid cell)
- Each key has isolated state (VesselState, EncounterState)
- Enables parallel processing with correct semantics

### Processing Time Timers

- DarkEventDetector uses timers to check for transmission gaps
- Timers fire periodically per vessel
- Re-register timer on each position update

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vessels` | GET | All current vessel positions |
| `/api/alerts` | GET | Recent alerts (limit param) |
| `/api/trails` | GET | Vessel movement trails |
| `/api/stats` | GET | System statistics |
| `/api/vessel/{mmsi}` | GET | Single vessel details |
| `/api/stream/vessels` | GET | SSE stream of vessel updates |
| `/api/stream/alerts` | GET | SSE stream of new alerts |

## Security

### Aiven Kafka SSL

All connections to Aiven Kafka require SSL:

**Python (confluent-kafka)**:
```python
config = {
    'bootstrap.servers': 'kafka-xxx.aivencloud.com:12345',
    'security.protocol': 'SSL',
    'ssl.ca.location': './ca.pem',
    'ssl.certificate.location': './service.cert',
    'ssl.key.location': './service.key',
}
```

**Java (Flink)**:
```java
props.setProperty("security.protocol", "SSL");
props.setProperty("ssl.truststore.location", "/path/to/truststore.jks");
props.setProperty("ssl.truststore.password", "changeit");
props.setProperty("ssl.keystore.location", "/path/to/keystore.p12");
props.setProperty("ssl.keystore.password", "changeit");
```

### SSL Certificate Conversion

Aiven provides PEM certificates. Java requires JKS/PKCS12 keystores:

```bash
./scripts/setup-ssl.sh
```

This creates:
- `truststore.jks` - CA certificate for server verification
- `keystore.p12` - Client certificate for authentication

## Scalability Considerations

### Aiven Free Tier Constraints
- 250 kb/s throughput (IN + OUT combined)
- 5 topics, 2 partitions each
- 3-day retention
- No consumer groups limit

### Optimizations Applied
- Geographic filtering at ingestion (Baltic Sea only)
- Rate limiting (100 kb/s conservative buffer)
- GZIP compression for Kafka messages
- Spatial partitioning for rendezvous detection
- Caching parsed geometries in Flink

### Deployment Scaling Options

**Local Development:**
- All services on single machine
- Flink runs as embedded job

**Production (Ververica Cloud):**
- Flink deployed to managed cluster
- Multiple task managers for parallelism
- RocksDB state backend for large state
- Automatic checkpointing and recovery
