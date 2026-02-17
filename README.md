# AIS Guardian

**Real-time Maritime Surveillance for Baltic Sea Infrastructure Protection**

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://lopez.fi/aisguardian)
[![Aiven Kafka](https://img.shields.io/badge/Aiven-Kafka-ff6600)](https://aiven.io)
[![Apache Flink](https://img.shields.io/badge/Apache-Flink%201.18-e6526f)](https://flink.apache.org)
[![Ververica Cloud](https://img.shields.io/badge/Ververica-Cloud-blue)](https://www.ververica.com)

Built for the [Aiven Free Kafka Competition](https://aiven.io/blog/free-tier-apache-kafkar-competition)

---

## Why I Built This

I have a strange combination of experience that finally makes sense.

Almost a decade in the maritime and energy industries. Years working with open-source data infrastructure. Now Head of Marketing at [**Ververica**](https://ververica.com), the original creators of Apache Flink.

Last Christmas, I watched the news as the *Eagle S* tanker "unintentionally" severed undersea cables in the Gulf of Finland. A year before that, the *Yi Peng 3* dragged its anchor for over 100 nautical miles across the C-Lion1 cable. The Balticconnector pipeline. Nord Stream. And now, almost Christmas again, I couldn't shake the thought: will we get another dragging anchor under the tree this year?

Suddenly, everything clicked.

- I know what suspicious vessel behavior looks like.
- I know how to build streaming pipelines that handle high-volume data.
- I know how powerful Flink is for stateful event processing.

When Aiven announced their free Kafka tier competition, I saw the perfect opportunity. Not to solve national security (that's above my pay grade), but to build something that could make sense of what's moving in our waters.

**AIS Guardian** is the result. A real-time monitoring system for the Baltic Sea that detects vessels anchoring over cable routes, loitering near critical infrastructure, going dark in sensitive zones, and making unusual maneuvers near undersea cables.

Sometimes your career path only makes sense in retrospect.

---

## The Threat Landscape

The Baltic Sea carries:
- **95% of Northern Europe's internet traffic** via submarine cables
- **Critical energy supplies** through gas pipelines and power interconnectors
- **2,500+ commercial vessels** at any given moment

Russia's shadow fleet—over 130 sanctioned vessels operating with falsified documents, disabled transponders, and flags of convenience—poses a constant threat. These vessels regularly transit cable zones, sometimes with AIS conveniently "malfunctioning."

---

## Live Demo

**[https://lopez.fi/aisguardian](https://lopez.fi/aisguardian)**

Watch real vessels moving across the Baltic Sea with live anomaly detection. The demo includes:
- **Real-time vessel positions** with ship-shaped icons showing heading
- **Historical investigation mode** reconstructing the FITBURG incident
- **Live alerts** for cable proximity, shadow fleet detection, and AIS anomalies
- **Interactive filtering** by vessel type, speed, and flag state

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────────────┐
│  AISStream.io   │     │   AIVEN KAFKA    │     │    VERVERICA / FLINK       │
│   WebSocket     │────▶│    Free Tier     │────▶│    Stream Processing       │
│                 │     │                  │     │                            │
│  ~5000 msg/s    │     │  Topics:         │     │  12 Detection Algorithms:  │
│  Baltic region  │     │  • ais-raw       │     │  • Cable Proximity         │
└─────────────────┘     │  • alerts        │     │  • Shadow Fleet            │
                        │  • reference-data│     │  • Dark AIS (gone/appeared)│
┌─────────────────┐     │  • sanctions     │     │  • Trajectory Prediction   │
│   SANCTIONS     │────▶│                  │     │  • Rendezvous              │
│   DATABASE      │     └────────┬─────────┘     │  • Convoy                  │
│                 │              │               │  • AIS Spoofing            │
│  • EU Council   │              │               │  • Anchor Dragging         │
│  • OFAC SDN     │              ▼               │  • + 4 more                │
│  • Ukraine GUR  │     ┌──────────────────┐     └─────────────┬──────────────┘
│  • 130+ vessels │     │  FASTAPI BACKEND │                   │
└─────────────────┘     │                  │◀──────────────────┘
                        │  • REST API      │
┌─────────────────┐     │  • Kafka Consumer│     ┌──────────────────┐
│  REACT FRONTEND │◀────│  • Incidents     │◀───▶│  AIVEN VALKEY    │
│                 │     │  • SSE Streaming │     │  (Redis)         │
│  • Mapbox GL JS │     └──────────────────┘     │  Trail Storage   │
│  • Ship icons   │                              └──────────────────┘
│  • Real-time    │
└─────────────────┘
```

---

## Detection Algorithms

AIS Guardian runs **12 parallel detectors** in Apache Flink:

### Critical Infrastructure Protection

| Detector | What It Detects | Severity |
|----------|-----------------|----------|
| **Cable Proximity** | Vessels stopped/slow (<2 kts) in cable protection zones | CRITICAL |
| **Anchor Dragging** | Anchored vessels drifting across protected areas | CRITICAL |
| **Trajectory Prediction** | Vessels on course to enter cable zones (15-45 min warning) | HIGH |

### Shadow Fleet & Sanctions

| Detector | What It Detects | Severity |
|----------|-----------------|----------|
| **Shadow Fleet** | Exact IMO/MMSI match against 130+ sanctioned vessels | CRITICAL |
| **High-Risk Flags** | Vessels flying flags of convenience (Cameroon, Gabon, Palau) | HIGH |

### AIS Anomalies

| Detector | What It Detects | Severity |
|----------|-----------------|----------|
| **Dark AIS - Gone Dark** | Vessels that stop transmitting AIS (30+ min gap) | HIGH |
| **Dark AIS - Appeared** | Vessels appearing >5nm from shore (had AIS off) | HIGH |
| **AIS Spoofing** | Impossible positions, identity theft, invalid MMSIs | HIGH |

### Behavioral Patterns

| Detector | What It Detects | Severity |
|----------|-----------------|----------|
| **Rendezvous** | Ship-to-ship meetings in open water (potential STS transfer) | MEDIUM |
| **Convoy** | Coordinated vessel groups traveling together | MEDIUM |
| **Fishing Pattern** | Fishing behavior in marine protected areas | MEDIUM |
| **Vessel Risk Score** | Cumulative behavioral scoring from multiple factors | Variable |

---

## Key Features

### Predictive Alerts

Not just reactive—AIS Guardian predicts threats **before** they happen:

```
┌────────────────────────────────────────────────────────────────┐
│  PREDICTIVE ALERT                                    HIGH      │
├────────────────────────────────────────────────────────────────┤
│  Vessel "EAGLE CARRIER" approaching C-Lion1 zone              │
│  ETA: ~32 minutes                                              │
│                                                                │
│  Current: 59.8°N, 24.2°E  │  Speed: 12.3 kts  │  Course: 245° │
│  Predicted Entry: 59.6°N, 23.1°E at 14:47 UTC                 │
└────────────────────────────────────────────────────────────────┘
```

### Persistent Shadow Fleet Tracking

Confirmed sanctioned vessels are tracked continuously with alerts that **follow the vessel's position** on the map—they don't disappear.

### Dark AIS Detection

Two types of detection:
1. **Gone Dark**: Vessel was transmitting, then stopped (sanctions evasion tactic)
2. **Appeared Dark**: Vessel suddenly appears in open water (was operating with AIS off)

### Incident Correlation

Groups multiple alerts from the same vessel into unified incidents with risk scoring:

```json
{
  "incident_id": "inc-a1b2c3",
  "severity": "CRITICAL",
  "risk_score": 87,
  "title": "Suspicious Activity: NEWNEW POLAR BEAR",
  "alert_types": ["DARK_EVENT", "CABLE_PROXIMITY"],
  "alert_count": 4,
  "timeline": [
    {"time": "12:34", "event": "Entered C-Lion1 zone at 8.2 kts"},
    {"time": "12:41", "event": "Speed reduced to 2.1 kts"},
    {"time": "12:48", "event": "AIS transmission stopped"},
    {"time": "13:02", "event": "AIS resumed, vessel stationary"}
  ]
}
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- Java 11+ (for Flink)
- Node.js 18+
- [Aiven account](https://console.aiven.io) (free tier)
- [AISStream.io](https://aisstream.io) API key
- [Mapbox](https://mapbox.com) token

### 1. Clone & Configure

```bash
git clone https://github.com/jaimelopez89/AISGuardian.git
cd AISGuardian
cp .env.example .env
# Edit .env with your credentials
```

### 2. Setup Aiven Services

**Kafka (Free Tier)**
1. Create Apache Kafka service at [console.aiven.io](https://console.aiven.io)
2. Download SSL certs: `ca.pem`, `service.cert`, `service.key`
3. Create topics: `ais-raw`, `alerts`, `reference-data`, `sanctions`

**Valkey (Optional, for trail persistence)**
1. Create Valkey service
2. Note connection URI for `.env`

### 3. Build the Flink JAR

```bash
cd flink-jobs
mvn clean package -DskipTests
# Creates: target/ais-watchdog-flink-1.0.0.jar (78 MB)
```

### 4. Start Services

```bash
# One-command startup (all services)
./start.sh

# Or run individually:
python ingestion/ais_connector.py     # AIS data ingestion
python backend/api.py                 # REST API (port 8000)
cd frontend && npm install && npm run dev  # Dashboard (port 5173)

# Flink can run locally or on Ververica Cloud
java -jar flink-jobs/target/ais-watchdog-flink-1.0.0.jar
```

### 5. Access

| Service | URL |
|---------|-----|
| **Dashboard** | http://localhost:5173 |
| **API Docs** | http://localhost:8000/docs |
| **Health** | http://localhost:8000/health |

---

## Deployment

### Ververica Cloud (Recommended for Flink)

1. Create account at [ververica.com](https://www.ververica.com)
2. Upload the JAR: `flink-jobs/target/ais-watchdog-flink-1.0.0.jar`
3. Upload Kafka certs as Additional Dependencies:
   - Convert to JKS/PKCS12: `truststore.jks`, `keystore.p12`
4. Configure environment variables or program arguments
5. Deploy with parallelism 2

### Railway (Backend + Frontend)

The live demo runs on Railway with automatic deployments from GitHub.

---

## API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /api/vessels` | Current positions for all tracked vessels |
| `GET /api/vessel/{mmsi}` | Single vessel details |
| `GET /api/alerts` | Recent alerts (last 1,000) |
| `GET /api/incidents` | Correlated incidents with timelines |
| `GET /api/incidents/{id}` | Single incident with full history |
| `GET /api/vessel/{mmsi}/incidents` | All incidents for a vessel |
| `GET /api/trails` | Vessel movement trails (24h lookback) |
| `GET /api/stats` | System statistics |
| `GET /health` | Health check |

---

## Documentation

| Document | Description |
|----------|-------------|
| **[README.md](README.md)** | This file - project overview and quick start |
| **[CHANGELOG.md](CHANGELOG.md)** | Version history and recent changes |
| **[BANDWIDTH_OPTIMIZATIONS.md](BANDWIDTH_OPTIMIZATIONS.md)** | Deep dive on 97% bandwidth reduction (10 GB → 0.3 GB/day) |
| **[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)** | Detailed architecture and design decisions |
| **[QUICKSTART.md](QUICKSTART.md)** | Fast setup guide for local development |
| **[SERVICE_MANAGEMENT.md](SERVICE_MANAGEMENT.md)** | Service control and monitoring |
| **[INVESTIGATION-2025-12-31.md](INVESTIGATION-2025-12-31.md)** | FITBURG cable sabotage case study |

---

## Project Structure

```
AISguardian/
├── ingestion/                    # AIS data ingestion
│   ├── ais_connector.py          # WebSocket → Kafka producer
│   └── reference_loader.py       # Load geofences & sanctions
│
├── backend/                      # REST API + Incident Engine
│   ├── api.py                    # FastAPI, Kafka consumers
│   └── zone_investigator.py      # Incident correlation
│
├── flink-jobs/                   # Apache Flink stream processing
│   └── src/main/java/com/aiswatchdog/
│       ├── AISWatchdogJob.java   # Main job orchestrator
│       ├── detectors/            # 12 detection algorithms
│       │   ├── CableProximityDetector.java
│       │   ├── ShadowFleetDetector.java
│       │   ├── DarkEventDetector.java
│       │   ├── TrajectoryPredictionDetector.java
│       │   ├── RendezvousDetector.java
│       │   ├── ConvoyDetector.java
│       │   └── ...
│       └── models/               # Data models
│
├── frontend/                     # React dashboard
│   └── src/
│       ├── App.jsx               # Main application
│       └── components/
│           ├── Map.jsx           # Mapbox GL visualization
│           ├── AlertFeed.jsx     # Real-time alert stream
│           └── VesselCard.jsx    # Vessel details panel
│
├── reference-data/               # Static reference data
│   ├── geofences/                # Cable zone GeoJSON
│   ├── sanctions/                # Sanctions lists
│   └── shadow_fleet.json         # 130+ sanctioned vessels
│
├── docs/                         # Additional documentation
│   ├── architecture.md           # System architecture
│   ├── data-formats.md           # Data structure specs
│   └── deployment.md             # Deployment guides
│
├── .env.example                  # Environment template
├── start.sh                      # Service orchestration
├── CHANGELOG.md                  # Version history
└── BANDWIDTH_OPTIMIZATIONS.md    # Performance optimization guide
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Message Broker** | Aiven Kafka (Free) | Real-time event streaming |
| **Stream Processing** | Apache Flink 1.18 | 12 parallel detection algorithms |
| **Flink Platform** | Ververica Cloud | Managed Flink deployment |
| **Cache** | Aiven Valkey (Redis) | Trail persistence, state storage |
| **Backend** | FastAPI (Python) | REST API, incident correlation |
| **Frontend** | React 18 + Vite | Interactive dashboard |
| **Visualization** | Mapbox GL JS | Real-time vessel display with heading |
| **Data Source** | AISStream.io | Live AIS position feeds |
| **Geospatial** | JTS (Java) | Polygon operations, trajectory math |

---

## Configuration

### Environment Variables

```bash
# Kafka (Aiven)
KAFKA_BOOTSTRAP_SERVERS=your-kafka.aivencloud.com:12345
KAFKA_SSL_CA=./certs/ca.pem
KAFKA_SSL_CERT=./certs/service.cert
KAFKA_SSL_KEY=./certs/service.key

# Valkey (Aiven) - Optional
VALKEY_URL=rediss://user:pass@your-valkey.aivencloud.com:12345

# AIS Data Source
AISSTREAM_API_KEY=your-aisstream-key

# Frontend
VITE_MAPBOX_TOKEN=your-mapbox-token
VITE_API_URL=http://localhost:8000

# Detection Thresholds (optional overrides)
DARK_THRESHOLD_MINUTES=30
RENDEZVOUS_DISTANCE_METERS=1500
RENDEZVOUS_DURATION_MINUTES=3
```

---

## Real-World Impact

AIS Guardian addresses documented threats to Baltic Sea infrastructure:

| Incident | Date | What Happened |
|----------|------|---------------|
| **C-Lion1 Cable** | Nov 2024 | Severed by anchor dragging, disrupted Finland-Germany communications |
| **Estlink 2 Cable** | Dec 2024 | Damaged, under investigation |
| **Balticconnector** | Oct 2023 | Gas pipeline damaged by vessel Yi Peng 3 |
| **Nord Stream** | Sep 2022 | Pipelines sabotaged by underwater explosions |

By combining real-time AIS monitoring with predictive analytics and sanctions databases, AIS Guardian provides **early warning** for maritime threats.

---

## What Makes It Special

1. **Real-world problem** with immediate geopolitical relevance
2. **Predictive detection** warns before damage occurs (not just reactive)
3. **Exact-match sanctions** tracking with persistent vessel markers
4. **Dark AIS detection** catches both vessels going dark AND appearing
5. **Incident correlation** groups alerts into unified threat assessments
6. **130+ sanctioned vessels** from multiple authoritative sources
7. **Live demo** with real Baltic Sea traffic
8. **Optimized for free tier** with GZIP compression and smart polling

---

## License

MIT

---

## About the Author

I'm Jaime, Head of Marketing at [**Ververica**](https://ververica.com), the original creators of Apache Flink. Before that, I spent years in the maritime and energy sectors, which is probably why I get unreasonably annoyed when tankers drag their anchors across critical infrastructure.

This project combines everything I've learned along the way: understanding vessel behavior, building data pipelines, and leveraging Flink's stateful stream processing for real-time detection. It's a hobby project born from frustration and curiosity.

---

## Acknowledgments

- [**Aiven**](https://aiven.io) for the free Kafka tier and hosting this competition
- [**Ververica**](https://ververica.com) for managed Flink and being an incredible place to work
- [**AISStream.io**](https://aisstream.io) for real-time AIS data access
- Open-source sanctions data from Ukraine GUR, EU Council, and OFAC

---

*Protecting critical infrastructure, one vessel at a time.*
