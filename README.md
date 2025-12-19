# AIS Guardian

Real-time maritime anomaly detection system for monitoring Baltic Sea undersea infrastructure.

Built for the [Aiven Free Kafka Competition](https://aiven.io/developer/free-kafka-challenge) using **Aiven Kafka** and **Apache Flink**.

## What It Does

AIS Guardian monitors vessel traffic in the Baltic Sea to detect potential threats to critical undersea infrastructure (cables and pipelines):

### Infrastructure Protection
- **Cable Proximity Alerts**: Vessels stopped or moving slowly near undersea cables
- **Anchor Dragging Detection**: Vessels with anchors that may damage cables
- **Geofence Violations**: Unauthorized entry into restricted zones

### Sanctions & Shadow Fleet Detection
- **Shadow Fleet Detection**: Cross-references vessels against 130+ sanctioned ships from EU, OFAC, and Ukraine databases
- **High-Risk Flag Monitoring**: Alerts on vessels from Russia, Iran, North Korea, and flags of convenience
- **Vessel Risk Scoring**: Cumulative risk scores based on Russian port visits, dark events, and suspicious behavior

### Behavioral Analysis
- **Dark Events**: Vessels that stop transmitting AIS (potential sanctions evasion)
- **Rendezvous Detection**: Ship-to-ship meetings in open water (cargo transfers)
- **AIS Spoofing Detection**: Identity theft, impossible positions, name changes
- **Fishing Pattern Detection**: Illegal fishing behavior in protected areas
- **Convoy Detection**: Groups of vessels traveling in formation
- **Loitering Detection**: Vessels remaining stationary in sensitive areas

### Protected Infrastructure

- C-Lion1 (Finland-Germany submarine cable)
- Balticconnector (Finland-Estonia gas pipeline)
- Estlink 1 & 2 (Finland-Estonia power cables)
- NordBalt (Sweden-Lithuania power cable)
- SwePol (Sweden-Poland power cable)

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AISStream.io  │────▶│  Aiven Kafka    │────▶│  Apache Flink   │
│   WebSocket     │     │  ais-raw topic  │     │  11 Detectors   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │                       │
┌─────────────────┐             │                       │
│   Sanctions     │────▶ sanctions topic ───────────────┤
│   Database      │                                     │
└─────────────────┘                                     ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  FastAPI        │◀────│    alerts       │
                        │  Backend        │     │    topic        │
                        └───────┬─────────┘     └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │  React Frontend │
                        │  (Mapbox/Deck)  │
                        └─────────────────┘
```

## Quick Start

### Prerequisites

- Python 3.11+
- Java 11+ (for Flink)
- Node.js 18+
- Aiven Kafka account (free tier)
- AISStream.io API key (free)
- Mapbox token (free tier)

### 1. Clone and Configure

```bash
git clone <repo-url>
cd AISguardian

# Copy environment template
cp .env.example .env
```

### 2. Set Up Aiven Kafka

1. Create account at [console.aiven.io](https://console.aiven.io)
2. Create Apache Kafka service (Free tier)
3. Download SSL certificates from the Overview tab:
   - `ca.pem`
   - `service.cert`
   - `service.key`
4. Save certificates to project root
5. Create Kafka topics (via Aiven Console → Topics):
   - `ais-raw` (2 partitions, delete cleanup)
   - `alerts` (2 partitions, delete cleanup)
   - `reference-data` (2 partitions, compact cleanup)
   - `sanctions` (2 partitions, compact cleanup)

### 3. Configure Environment

Edit `.env` with your credentials:

```bash
# AISStream.io API Key (get from https://aisstream.io)
AISSTREAM_API_KEY=your_key_here

# Aiven Kafka (from console overview)
KAFKA_BOOTSTRAP_SERVERS=kafka-xxx-yyy.aivencloud.com:12345

# SSL certificates (downloaded from Aiven)
KAFKA_SSL_CA_CERT=./ca.pem
KAFKA_SSL_CERT=./service.cert
KAFKA_SSL_KEY=./service.key

# Mapbox (get from https://mapbox.com)
VITE_MAPBOX_TOKEN=pk.xxx
```

### 4. Convert SSL Certificates (for Flink)

```bash
./scripts/setup-ssl.sh
```

This creates Java KeyStores (`truststore.jks`, `keystore.p12`) from PEM certificates.

### 5. Load Reference Data

```bash
# Load geofences (cable protection zones, ports)
source reference-data/venv/bin/activate
python reference-data/load_geofences.py

# Load sanctions data (shadow fleet vessels, high-risk flags)
python reference-data/load_sanctions.py
```

### 6. Start All Services

```bash
./start.sh
```

Or start services individually:

```bash
# 1. Start AIS data ingestion
source ingestion/venv/bin/activate
python ingestion/ais_connector.py

# 2. Start Backend API
python backend/api.py

# 3. Start Flink anomaly detection
export JAVA_HOME=/opt/homebrew/opt/openjdk@11  # macOS
java -jar flink-jobs/target/ais-watchdog-flink-1.0.0.jar

# 4. Start Frontend
cd frontend && npm run dev
```

### 7. Open Dashboard

- **Dashboard**: http://localhost:5173
- **API Stats**: http://localhost:8000/api/stats

## Service Management

```bash
./start.sh          # Start all services
./start.sh stop     # Stop all services
./start.sh restart  # Restart all services
./start.sh status   # Check service status
```

See [SERVICE_MANAGEMENT.md](SERVICE_MANAGEMENT.md) for details.

## Project Structure

```
AISguardian/
├── ingestion/              # AIS data ingestion (Python)
│   └── ais_connector.py    # WebSocket client → Kafka producer
├── backend/                # REST API server (Python/FastAPI)
│   └── api.py              # Kafka consumer → REST endpoints
├── flink-jobs/             # Stream processing (Java/Flink)
│   ├── DETECTORS.md        # Documentation for all 11 detectors
│   └── src/main/java/
│       ├── AISWatchdogJob.java
│       ├── detectors/      # Anomaly detection algorithms
│       │   ├── ShadowFleetDetector.java
│       │   ├── VesselRiskScorer.java
│       │   └── ... (11 detectors total)
│       └── models/
│           └── SanctionedVessel.java
├── frontend/               # Web dashboard (React/Vite)
│   └── src/
│       ├── App.jsx
│       └── components/
├── reference-data/         # Reference data and loaders
│   ├── shadow_fleet.json   # 130+ sanctioned vessels database
│   ├── load_sanctions.py   # Load sanctions to Kafka
│   ├── sanctions_updater.py # Auto-update sanctions from APIs
│   └── load_geofences.py   # Load geofences to Kafka
├── scripts/                # Utility scripts
└── docs/                   # Documentation
```

## Deployment Options

### Local Development (Default)

All services run locally, connecting to Aiven Kafka in the cloud.

### Ververica Cloud (Production Flink)

For production Flink deployment, see [docs/deployment.md](docs/deployment.md#ververica-cloud).

1. Create account at [ververica.com](https://www.ververica.com)
2. Upload JAR: `flink-jobs/target/ais-watchdog-flink-1.0.0.jar`
3. Configure Kafka SSL via environment variables
4. Deploy and monitor via Ververica dashboard

## Tech Stack

| Component | Technology |
|-----------|------------|
| Message Streaming | Aiven Kafka (Free Tier) |
| Stream Processing | Apache Flink 1.18 |
| AIS Data Source | AISStream.io WebSocket |
| Backend API | Python FastAPI |
| Frontend | React, Vite, Tailwind CSS |
| Map Visualization | Mapbox GL, Deck.gl |
| Flink Hosting (Optional) | Ververica Cloud |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/vessels` | Current vessel positions |
| `GET /api/alerts` | Recent alerts |
| `GET /api/trails` | Vessel movement trails |
| `GET /api/stats` | System statistics |
| `GET /api/vessel/{mmsi}` | Single vessel details |

## Shadow Fleet Detection

AIS Guardian includes comprehensive shadow fleet detection capabilities targeting Russia's sanctions evasion fleet:

### Data Sources
- **Ukraine Government Database**: 1,240+ vessels tracked by Ukrainian intelligence
- **EU Council Sanctions**: Vessels sanctioned under EU regulations
- **OFAC SDN List**: US Treasury sanctioned entities
- **TankerTrackers.com**: Community-tracked shadow fleet

### Detection Methods
| Method | Description |
|--------|-------------|
| IMO Match | Direct match against 130+ known sanctioned vessels |
| High-Risk Flag | Monitoring vessels from RU, IR, KP, CN, and flags of convenience |
| Name Match | Fuzzy matching for renamed vessels |
| Risk Scoring | Cumulative scores based on behavior patterns |
| Spoofing Detection | IMO changes, name changes, impossible positions |

### Automated Updates
The `sanctions_updater.py` service can run as a background process to automatically check for new sanctions every 6 hours:

```bash
# Run once
python reference-data/sanctions_updater.py --once

# Run as background service
nohup python reference-data/sanctions_updater.py > /tmp/sanctions_updater.log 2>&1 &
```

## Documentation

- [Architecture](docs/architecture.md) - System design and data flow
- [Deployment](docs/deployment.md) - Cloud deployment guide
- [Data Formats](docs/data-formats.md) - Kafka message schemas
- [Detectors](flink-jobs/DETECTORS.md) - All 11 anomaly detection algorithms
- [Service Management](SERVICE_MANAGEMENT.md) - Start/stop commands

## License

MIT
