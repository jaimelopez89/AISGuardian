# AIS Guardian

**Real-time Maritime Anomaly Detection for Baltic Sea Infrastructure Protection**

Built for the [Aiven Free Kafka Competition](https://aiven.io/blog/free-tier-apache-kafkar-competition) | [Live Demo](https://aisguardian-production.up.railway.app)

---

## The Problem: Critical Infrastructure Under Threat

In November 2024, the **C-Lion1 submarine cable** connecting Finland and Germany was severed, disrupting communications for millions. Just months earlier, the **Balticconnector gas pipeline** was damaged in a suspected act of sabotage. These incidents highlight the vulnerability of undersea infrastructure that carries 95% of the world's data and critical energy supplies.

**AIS Guardian** is a real-time maritime surveillance system that monitors vessel behavior in the Baltic Sea to detect potential threats before they cause damage.

```
                     ╔══════════════════════════════════════════════════════════════╗
                     ║           BALTIC SEA INFRASTRUCTURE PROTECTION               ║
                     ╚══════════════════════════════════════════════════════════════╝

     Finland ─────────────────────────────────────────────────────────────────── Russia
        │                              Gulf of Finland                              │
        │    ┌─────────┐                                                           │
        │    │ C-Lion1 │ ══════════════════════════════════════╗                   │
        │    └─────────┘   (1,172 km fiber optic cable)        ║                   │
        │                                                       ║                   │
        │    ┌───────────────┐                                 ║                   │
        │    │Balticconnector│ ═══════════════╗                ║                   │
        │    └───────────────┘  (gas pipeline) ║               ║                   │
        │                                       ║               ║                   │
        │    ┌───────────────┐                 ║               ║                   │
        │    │ Estlink 1 & 2 │ ════════════════╬═══════════════╬═══════ Estonia   │
        │    └───────────────┘ (power cables)  ║               ║                   │
        │                                       ║               ║                   │
     Sweden ═══════════════════════════════════╬═══════════════╬═══════ Lithuania │
        │         NordBalt (power)             ║               ║                   │
        │                                       ║               ║                   │
        └═══════════════════════════════════════╩═══════════════╩═════════── Poland
                          SwePol (power)

                         🚨 AIS Guardian monitors these zones 24/7
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              SYSTEM ARCHITECTURE                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐         ┌──────────────────────┐         ┌──────────────────────┐
    │ AISStream.io │         │     AIVEN KAFKA      │         │    APACHE FLINK      │
    │  WebSocket   │────────▶│      Free Tier       │────────▶│   Stream Processing  │
    │              │         │                      │         │                      │
    │  ~5000 msg/s │         │  ais-raw ──────────────────────▶  12 Parallel         │
    │  Baltic Sea  │         │  reference-data ────────────────▶  Detectors          │
    └──────────────┘         │  sanctions ─────────────────────▶                     │
                             └──────────────────────┘         └──────────┬───────────┘
                                                                         │
    ┌──────────────┐         ┌──────────────────────┐                   │
    │   SANCTIONS  │────────▶│     sanctions        │                   │
    │   DATABASE   │         │     topic            │                   ▼
    │              │         └──────────────────────┘         ┌──────────────────────┐
    │  EU, OFAC    │                                          │      alerts          │
    │  Ukraine GUR │         ┌──────────────────────┐         │      topic           │
    │  130+ ships  │         │                      │◀────────┴──────────────────────┤
    └──────────────┘         │   FASTAPI BACKEND    │                                │
                             │                      │         ┌──────────────────────┐
    ┌──────────────┐         │  • REST API          │         │   AIVEN VALKEY       │
    │  REACT       │◀────────│  • Kafka Consumers   │◀───────▶│   (Redis)            │
    │  FRONTEND    │         │  • Incident Engine   │         │                      │
    │              │         │  • SSE Streaming     │         │  • Trail Persistence │
    │  Mapbox GL   │         └──────────────────────┘         │  • State Storage     │
    │  Deck.gl     │                                          └──────────────────────┘
    └──────────────┘
```

### Data Flow

1. **Ingest**: Real-time AIS position reports from 2,500+ vessels in the Baltic Sea
2. **Process**: 12 parallel Flink detectors analyze vessel behavior patterns
3. **Correlate**: Backend groups related alerts into unified incidents
4. **Visualize**: Interactive map with vessel trails, alert feed, and incident dashboard

---

## Key Features

### 1. Predictive Threat Detection (New!)

**TRAJECTORY_PREDICTION** alerts warn you when a vessel is **on course to enter** a cable zone, typically 15-45 minutes before arrival.

```
┌─────────────────────────────────────────────────────────────────┐
│  PREDICTIVE ALERT                                                │
├─────────────────────────────────────────────────────────────────┤
│  Vessel "EAGLE CARRIER" approaching C-Lion1 zone in ~32 min    │
│                                                                  │
│  Current: 59.8°N, 24.2°E  │  Speed: 12.3 kts  │  Course: 245°  │
│  Predicted Entry: 59.6°N, 23.1°E at 14:47 UTC                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Incident Correlation Engine (New!)

Groups multiple alerts from the same vessel into **unified incidents** with risk scoring.

```json
GET /api/incidents

{
  "incidents": [{
    "id": "a1b2c3d4",
    "severity": "CRITICAL",
    "title": "Suspicious Activity: NEWNEW POLAR BEAR went dark near cable zone",
    "alert_types": ["DARK_EVENT", "CABLE_PROXIMITY"],
    "alert_count": 4,
    "risk_score": 87,
    "timeline": [
      {"time": "12:34", "event": "Entered C-Lion1 zone at 8.2 kts"},
      {"time": "12:41", "event": "Speed reduced to 2.1 kts"},
      {"time": "12:48", "event": "AIS transmission stopped"},
      {"time": "13:02", "event": "AIS resumed, vessel stationary"}
    ]
  }]
}
```

### 3. Shadow Fleet Detection

Cross-references vessels against **130+ sanctioned ships** from:
- Ukraine Government Intelligence (GUR)
- EU Council Sanctions
- OFAC SDN List
- Community-tracked tanker lists

### 4. 12 Detection Algorithms

| Detector | What It Detects | Severity |
|----------|-----------------|----------|
| **Cable Proximity** | Vessels stopped/slow in cable zones | CRITICAL |
| **Anchor Dragging** | Anchors that may damage infrastructure | CRITICAL |
| **Trajectory Prediction** | Vessels heading toward cable zones | HIGH |
| **Shadow Fleet** | Sanctioned vessels from 130+ database | CRITICAL |
| **Dark Event** | AIS transmission gaps (going dark) | HIGH |
| **AIS Spoofing** | Identity theft, impossible positions | HIGH |
| **Rendezvous** | Ship-to-ship meetings in open water | MEDIUM |
| **Geofence Violation** | Entry into restricted zones | MEDIUM |
| **Convoy** | Coordinated vessel groups | MEDIUM |
| **Fishing Pattern** | Illegal fishing in protected areas | MEDIUM |
| **Vessel Risk Score** | Cumulative behavioral scoring | Variable |

---

## Quick Start

### Prerequisites

- Python 3.11+
- Java 11+ (for Flink)
- Node.js 18+
- [Aiven Kafka](https://console.aiven.io) (free tier)
- [AISStream.io](https://aisstream.io) API key
- [Mapbox](https://mapbox.com) token

### 1. Clone and Configure

```bash
git clone https://github.com/yourusername/AISGuardian.git
cd AISGuardian
cp .env.example .env
# Edit .env with your credentials
```

### 2. Setup Aiven Kafka

1. Create free account at [console.aiven.io](https://console.aiven.io)
2. Create Apache Kafka service (Free tier)
3. Download SSL certs: `ca.pem`, `service.cert`, `service.key`
4. Create topics: `ais-raw`, `alerts`, `reference-data`, `sanctions`

### 3. Start Services

```bash
# One-command startup
./start.sh

# Or individually:
python ingestion/ais_connector.py     # AIS ingestion
python backend/api.py                 # REST API
java -jar flink-jobs/target/*.jar     # Flink processing
cd frontend && npm run dev            # Dashboard
```

### 4. Open Dashboard

- **Dashboard**: http://localhost:5173
- **API Docs**: http://localhost:8000/docs
- **Incidents**: http://localhost:8000/api/incidents

---

## API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /api/vessels` | Current vessel positions (2,500+) |
| `GET /api/alerts` | Recent alerts (last 1,000) |
| `GET /api/incidents` | Correlated incidents with timeline |
| `GET /api/incidents/{id}` | Single incident with full alert history |
| `GET /api/trails` | Vessel movement trails (24h) |
| `GET /api/stats` | System statistics |
| `GET /api/vessel/{mmsi}` | Single vessel details |
| `GET /api/vessel/{mmsi}/incidents` | All incidents for a vessel |

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Streaming** | Aiven Kafka | Message broker (free tier) |
| **Processing** | Apache Flink 1.18 | Real-time stream processing |
| **Cache** | Aiven Valkey | Persistent trail storage |
| **Backend** | FastAPI + Python | REST API, incident correlation |
| **Frontend** | React + Vite | Interactive dashboard |
| **Maps** | Mapbox GL + Deck.gl | Vessel visualization |
| **Data Source** | AISStream.io | Live AIS feeds |

---

## Project Structure

```
AISguardian/
├── ingestion/                 # AIS data ingestion
│   └── ais_connector.py       # WebSocket → Kafka producer
├── backend/                   # REST API + Incident Engine
│   └── api.py                 # Kafka consumers, REST endpoints
├── flink-jobs/                # Stream processing
│   └── src/main/java/
│       ├── AISWatchdogJob.java
│       └── detectors/         # 12 detection algorithms
│           ├── CableProximityDetector.java
│           ├── TrajectoryPredictionDetector.java  # NEW
│           ├── ShadowFleetDetector.java
│           └── ...
├── frontend/                  # React dashboard
├── reference-data/            # Geofences, sanctions database
└── scripts/                   # Utility scripts
```

---

## Real-World Impact

AIS Guardian addresses a critical security gap in Baltic Sea monitoring:

- **C-Lion1 Cable** (Nov 2024): Severed by anchor dragging, disrupting Finland-Germany communications
- **Balticconnector Pipeline** (Oct 2023): Damaged by Chinese vessel Hong Kong-registered Yi Peng 3
- **Nord Stream Pipelines** (Sep 2022): Sabotaged explosions in Swedish/Danish EEZ

By combining real-time AIS data with predictive analytics, AIS Guardian provides **early warning** for maritime threats to critical infrastructure.

---

## Competition Entry

This project was built for the [Aiven Free Kafka Competition](https://aiven.io/blog/free-tier-apache-kafkar-competition).

**What makes it special:**
- Real-world problem with current geopolitical relevance
- 12 parallel detection algorithms in Apache Flink
- Predictive alerting (not just reactive)
- Incident correlation for unified threat assessment
- Comprehensive shadow fleet database (130+ vessels)
- Live demo with real Baltic Sea traffic

---

## License

MIT

---

*Built with Aiven Kafka, Apache Flink, and a commitment to protecting critical infrastructure.*
