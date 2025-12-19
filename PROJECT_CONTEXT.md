# AIS Guardian: Real-Time Maritime Anomaly Detection

## Project Overview

AIS Guardian is a real-time streaming application that monitors Automatic Identification System (AIS) data from vessels in the Baltic Sea to detect potential threats to critical undersea infrastructure, including:

- **Cable proximity violations**: Vessels loitering near undersea cables/pipelines
- **AIS "going dark"**: Vessels that stop transmitting (potential tampering)
- **Geofence violations**: Unauthorized entry into restricted zones
- **Rendezvous detection**: Ship-to-ship meetings in open water
- **Illegal fishing**: Fishing patterns in marine protected areas

This project is built for the Aiven Free Kafka Competition ($5,000 prize, deadline Jan 31, 2026). It demonstrates the power of combining **Aiven's free Kafka tier** with **Apache Flink** for critical infrastructure monitoring.

### The Story Angle

The project demonstrates how Kafka and Flink are complementary technologies in the streaming ecosystem - Kafka for reliable message delivery, Flink for stateful stream processing and complex event detection.

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AISStream.io  │────▶│  Aiven Kafka    │────▶│  Apache Flink   │
│   WebSocket     │     │  (Cloud)        │     │  (Local/Cloud)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │               ┌───────┴───────┐               │
        │               │  FastAPI      │◀──────────────┤
        │               │  Backend      │               │
        │               └───────┬───────┘               │
        │                       │                       │
        │                       ▼                       │
        │               ┌─────────────────┐             │
        │               │  React Frontend │             │
        │               │  (Mapbox/Deck)  │             │
        │               └─────────────────┘             │
        │                                               │
        ▼                                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │                    KAFKA TOPICS                         │
   │  ais-raw │ alerts │ reference-data                      │
   └─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **AIS Ingestion** (`ingestion/ais_connector.py`):
   - Connects to AISStream.io WebSocket
   - Filters to Baltic Sea region (54°N-61°N, 12°E-31°E)
   - Normalizes messages and produces to `ais-raw` topic on Aiven Kafka

2. **Stream Processing** (`flink-jobs/`):
   - Consumes from `ais-raw` topic
   - Runs multiple parallel detectors:
     - Cable Proximity Detector
     - Geofence Violation Detector
     - Dark Event Detector
     - Rendezvous Detector
     - Fishing Pattern Detector
   - Produces alerts to `alerts` topic

3. **Backend API** (`backend/api.py`):
   - FastAPI server consuming from Kafka topics
   - Maintains in-memory vessel state
   - Serves REST endpoints for frontend

4. **Frontend** (`frontend/`):
   - React + Vite application
   - Mapbox GL for map rendering
   - Deck.gl for vessel visualization
   - Polls backend API for updates

---

## Tech Stack

### Infrastructure (Cloud Services)
- **Kafka**: Aiven Free Tier (250 kb/s throughput, 5 topics, 3-day retention)
- **Stream Processing**: Apache Flink (local or Ververica Cloud)

### Local Services
- **Ingestion**: Python 3.11+, asyncio, websockets, confluent-kafka
- **Backend**: Python FastAPI, uvicorn
- **Frontend**: React 18, Vite, Tailwind CSS, Mapbox GL, Deck.gl

### Aiven Free Tier Constraints
- Max 250 kb/s throughput (IN+OUT combined)
- Max 5 topics with 2 partitions each
- 3-day retention
- SSL required for all connections

---

## Kafka Topics

| Topic | Purpose | Key | Cleanup |
|-------|---------|-----|---------|
| `ais-raw` | Raw AIS positions from AISStream | `mmsi` | delete |
| `alerts` | Detected anomalies from Flink | `mmsi` | delete |
| `reference-data` | Geofences, ports, cables | `entity_id` | compact |

---

## Detection Logic

### 1. Cable Proximity Detection

Monitors vessels near critical undersea infrastructure:

```
PROTECTED CABLES:
- C-Lion1: Finland-Germany submarine cable
- Balticconnector: Finland-Estonia gas pipeline
- Estlink 1 & 2: Finland-Estonia power cables
- NordBalt: Sweden-Lithuania power cable
- SwePol: Sweden-Poland power cable

ALERT CONDITIONS:
- Vessel within 2km of cable route
- Speed < 2 knots (stopped/drifting)
- Duration > 30 minutes

SEVERITY LEVELS:
- MEDIUM: Any vessel loitering near cables
- HIGH: Flagged states (RU, CN, HK, IR, KP) near cables
- CRITICAL: AIS gap while in cable zone
```

### 2. "Going Dark" Detection

Detects when vessels stop transmitting AIS:

```
ALERT CONDITIONS:
- Previous transmission rate: >1 message per 5 minutes
- Current gap: >2 hours with no messages
- Last known position: not in port (speed >0.5 knots)

SEVERITY LEVELS:
- LOW: 2-6 hour gap (possible equipment failure)
- MEDIUM: 6-24 hour gap (suspicious)
- HIGH: >24 hour gap (likely intentional)
- CRITICAL: Gap while in sensitive zone
```

### 3. Geofence Violations

Detects entry into restricted zones:

```
ZONES MONITORED:
- Marine Protected Areas (fishing vessels)
- Cable protection zones
- Restricted military zones

ALERT INCLUDES:
- Zone name and type
- Time of entry
- Vessel flag state vs zone jurisdiction
```

### 4. Rendezvous Detection

Detects ship-to-ship meetings:

```
ALERT CONDITIONS:
- Two vessels within 500 meters
- Duration: >30 minutes
- Location: >20 nautical miles from any port
- Both vessels slow or stopped (<3 knots)
```

### 5. Fishing Pattern Detection

Identifies fishing behavior in protected areas:

```
FISHING INDICATORS:
- Average speed: <5 knots
- Speed variance: high (start/stop pattern)
- Course changes: >10 significant changes per hour
- Area covered: concentrated (<100 sq NM)

ALERT IF:
- Fishing pattern in Marine Protected Area
- Non-fishing vessel type exhibiting fishing behavior
```

---

## Project Structure

```
AISguardian/
├── .env.example             # Environment template
├── start.sh                 # Service management script
├── SERVICE_MANAGEMENT.md    # Service control docs
│
├── ingestion/
│   ├── ais_connector.py     # WebSocket → Kafka producer
│   └── requirements.txt
│
├── backend/
│   └── api.py               # FastAPI server (Kafka → REST)
│
├── flink-jobs/
│   ├── pom.xml
│   └── src/main/java/
│       ├── AISWatchdogJob.java
│       ├── detectors/
│       │   ├── CableProximityDetector.java
│       │   ├── DarkEventDetector.java
│       │   ├── GeofenceViolationDetector.java
│       │   ├── RendezvousDetector.java
│       │   └── FishingPatternDetector.java
│       ├── models/
│       └── utils/
│
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── Map.jsx
│       │   └── AlertFeed.jsx
│       └── hooks/
│
├── reference-data/
│   ├── geofences/
│   │   └── cables.geojson   # Cable protection zones
│   └── ports/
│       └── baltic_ports.json
│
├── scripts/
│   └── setup-ssl.sh         # PEM → JKS conversion
│
└── docs/
    ├── architecture.md
    ├── deployment.md
    └── data-formats.md
```

---

## Environment Variables

```bash
# AISStream.io
AISSTREAM_API_KEY=your_api_key_here

# Aiven Kafka
KAFKA_BOOTSTRAP_SERVERS=kafka-xxx.aivencloud.com:12345
KAFKA_SSL_CA_CERT=./ca.pem
KAFKA_SSL_CERT=./service.cert
KAFKA_SSL_KEY=./service.key

# Java KeyStores (for Flink)
KAFKA_SSL_TRUSTSTORE_LOCATION=./truststore.jks
KAFKA_SSL_TRUSTSTORE_PASSWORD=changeit
KAFKA_SSL_KEYSTORE_LOCATION=./keystore.p12
KAFKA_SSL_KEYSTORE_PASSWORD=changeit

# Mapbox (Frontend)
VITE_MAPBOX_TOKEN=pk.xxx
```

---

## Key Technical Decisions

### Why Aiven Kafka?
- Managed service with SSL security
- Free tier sufficient for demo (250 kb/s)
- No infrastructure management needed
- Built-in monitoring

### Why Apache Flink?
- Native windowing for time-based detection
- Stateful processing for vessel tracking
- Broadcast state for geofence matching
- Can run locally or on Ververica Cloud

### Why FastAPI Backend?
- Bridges Kafka to REST API (simpler than Kafka REST Proxy with auth)
- In-memory state for fast vessel lookups
- SSE support for real-time updates
- Lightweight Python deployment

### Why Baltic Sea Focus?
- Critical undersea infrastructure (cables, pipelines)
- Recent incidents (Nord Stream, Balticconnector)
- Manageable geographic scope for free tier limits
- High relevance for European security

### Geographic Filtering Strategy
To stay under 250 kb/s:
- Filter to Baltic Sea bounding box (54°N-61°N, 12°E-31°E)
- Rate limit at 100 kb/s (conservative buffer)
- GZIP compression on all Kafka messages

---

## Deployment Options

### Local Development
All services run locally, connecting to Aiven Kafka in the cloud:
```bash
./start.sh
```

### Production (Ververica Cloud)
For managed Flink deployment:
1. Build production JAR: `mvn clean package`
2. Upload to Ververica Cloud
3. Configure Kafka SSL via environment variables
4. Deploy and monitor via dashboard

See [docs/deployment.md](docs/deployment.md) for detailed instructions.

---

## Service Management

```bash
./start.sh          # Start all services
./start.sh stop     # Stop all services
./start.sh restart  # Restart all services
./start.sh status   # Check service status
```

Logs are written to `/tmp/aisguardian/`.

---

## Success Metrics (for Competition)

1. **Working Demo**: Live map showing vessels and real-time alerts
2. **At Least 3 Detection Types**: Cable proximity, dark events, geofence violations
3. **Compelling Visuals**: Screenshots/video of actual detections
4. **Good Story**: Blog post explaining the Baltic infrastructure angle
5. **Cloud-Native**: Fully deployable with Aiven Kafka + Ververica Flink

---

## Resources & References

### AIS Data
- AISStream docs: https://aisstream.io/documentation
- MMSI number format: https://en.wikipedia.org/wiki/Maritime_Mobile_Service_Identity

### Maritime Infrastructure
- Baltic undersea cables: https://www.submarinecablemap.com/
- Nord Stream incidents: https://en.wikipedia.org/wiki/Nord_Stream_pipeline_sabotage

### Tech Stack Docs
- Aiven Kafka: https://docs.aiven.io/docs/products/kafka
- Apache Flink: https://nightlies.apache.org/flink/flink-docs-stable/
- Ververica Cloud: https://docs.ververica.com/
- Mapbox GL JS: https://docs.mapbox.com/mapbox-gl-js/
- Deck.gl: https://deck.gl/docs
