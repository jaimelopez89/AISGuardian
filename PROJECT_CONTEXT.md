# AIS Watchdog: Real-Time Maritime Anomaly Detection

## Project Overview

AIS Watchdog is a real-time streaming application that monitors Automatic Identification System (AIS) data from vessels worldwide to detect potentially illegal activities including:

- **Illegal fishing** in protected waters
- **Sanctions evasion** through ship-to-ship transfers or AIS manipulation
- **"Going dark"** events where vessels intentionally disable transponders

This project is being built for the Aiven Free Kafka Competition ($5,000 prize, deadline Jan 31, 2026). It demonstrates the power of combining **Aiven's free Kafka tier** with **Apache Flink** (via Ververica) for critical infrastructure monitoring.

### The Story Angle

The project creator (Jaime) is Head of Marketing at Ververica (the creators of Apache Flink) and previously worked at Aiven. This project demonstrates how Kafka and Flink are complementary technologies—not competitors—in the streaming ecosystem.

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AIS Source    │────▶│  Kafka (Aiven)  │────▶│ Flink (Ververica)│
│  (AISStream)    │     │   Free Tier     │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                        ┌───────────────────────────────┼───────────────────────────────┐
                        │                               │                               │
                        ▼                               ▼                               ▼
               ┌─────────────────┐             ┌─────────────────┐             ┌─────────────────┐
               │  Dark Event     │             │   Geofence      │             │   Rendezvous    │
               │  Detector       │             │   Violations    │             │   Detector      │
               └────────┬────────┘             └────────┬────────┘             └────────┬────────┘
                        │                               │                               │
                        └───────────────────────────────┼───────────────────────────────┘
                                                        ▼
                                               ┌─────────────────┐
                                               │  alerts topic   │
                                               │    (Kafka)      │
                                               └────────┬────────┘
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   ┌─────────────┐             ┌─────────────┐
                                   │  Live Map   │             │  Alert Feed │
                                   │   (React)   │             │  (Webhook)  │
                                   └─────────────┘             └─────────────┘
```

---

## Tech Stack

### Infrastructure
- **Kafka**: Aiven Free Tier (250 kb/s throughput, 5 topics, 3-day retention)
- **Stream Processing**: Apache Flink on Ververica Cloud (or local for dev)
- **Frontend**: React + Mapbox GL JS + Deck.gl
- **Ingestion**: Python with websocket client

### Constraints (Aiven Free Tier)
- Max 250 kb/s throughput (IN+OUT combined)
- Max 5 topics with 2 partitions each
- 3-day retention
- Free Schema Registry and REST proxy included

---

## Kafka Topics

We have exactly 5 topics to work with:

| Topic | Purpose | Key | Notes |
|-------|---------|-----|-------|
| `ais-raw` | Raw AIS messages from feed | `mmsi` | High volume, filtered by region |
| `ais-enriched` | Positions + vessel metadata + flag state | `mmsi` | Output of enrichment job |
| `alerts` | Detected anomalies | `mmsi` | All alert types combined |
| `vessel-state` | Compacted topic for latest known state per vessel | `mmsi` | Used for gap detection |
| `reference-data` | Sanctions lists, vessel registry | `entity_id` | Bootstrap on startup |

---

## Data Sources

### Primary: AIS Stream
**AISStream.io** (recommended - free WebSocket API)
- URL: wss://stream.aisstream.io/v0/stream
- Requires free API key (sign up at aisstream.io)
- Delivers decoded JSON messages
- Can filter by geographic bounding box and message type

Alternative: **AISHub** (requires membership approval)

### Reference Data (Static, bootstrapped)

#### Sanctions Lists
- **OFAC SDN List** (US Treasury): https://sanctionslist.ofac.treas.gov/Home/SdnList
- **EU Consolidated List**: https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions

#### Geofences (GeoJSON)
- **EEZ Boundaries**: https://marineregions.org/downloads.php
- **Marine Protected Areas**: Global Fishing Watch
- **Sanctioned nation EEZs**: North Korea, Russia, Iran (extract from EEZ dataset)

#### Vessel Registry
- **ITU MARS**: Maritime mobile Access and Retrieval System
- **Equasis**: Manual lookup for vessel ownership chains

---

## Detection Logic

### 1. "Going Dark" Detection

A vessel "goes dark" when it stops transmitting AIS, potentially to hide illegal activity.

```
ALERT CONDITIONS:
- Previous transmission rate: >1 message per 5 minutes (was actively transmitting)
- Current gap: >2 hours with no messages
- Last known position: not in port (speed >0.5 knots OR >5nm from nearest port)
- Vessel type: cargo, tanker, or fishing (exclude pleasure craft)

SEVERITY LEVELS:
- LOW: 2-6 hour gap (possible equipment failure)
- MEDIUM: 6-24 hour gap (suspicious)
- HIGH: >24 hour gap (likely intentional)
- CRITICAL: Any gap near sensitive zone (sanctioned waters, MPA)
```

### 2. Geofence Violations

Detect when vessels enter prohibited or sensitive zones.

```
ZONES TO MONITOR:
- Marine Protected Areas (fishing vessels)
- Sanctioned nation EEZs (all vessels)
- Restricted military zones
- IUU fishing hotspots

ALERT INCLUDES:
- Zone name and type
- Time of entry
- Time spent in zone
- Vessel flag state vs zone jurisdiction
```

### 3. Rendezvous Detection

Ship-to-ship transfers in open ocean are a common sanctions evasion tactic.

```
ALERT CONDITIONS:
- Two vessels within 500 meters
- Duration: >30 minutes
- Location: >50 nautical miles from any port
- At least one vessel is flagged (sanctions list, dark history, or flag of convenience)

ADDITIONAL SIGNALS:
- Both vessels stopped or drifting (<2 knots)
- AIS gaps before or after meeting
- Mismatched vessel types (e.g., tanker + fishing boat)
```

### 4. Fishing Behavior Classification

Identify fishing activity based on movement patterns, flag when in protected areas.

```
FISHING PATTERN FEATURES:
- Average speed: <5 knots
- Speed variance: high (start/stop pattern)
- Course changes: >10 significant changes per hour (>30° deviation)
- Area covered: <100 sq nautical miles (working a specific zone)

ALERT IF:
- Fishing pattern detected in Marine Protected Area
- Non-fishing vessel type exhibiting fishing behavior
- Fishing in foreign EEZ without likely permit
```

### 5. Sanctions Match

Direct matching against sanctions databases.

```
MATCH CRITERIA:
- MMSI (exact match)
- IMO number (exact match)
- Vessel name (fuzzy match, Levenshtein distance ≤3)
- Flag state: North Korea, Iran = automatic flag
- Historical flag changes: >2 changes in 12 months = suspicious

ENRICH WITH:
- Sanctions list source (OFAC, EU, UN)
- Date added to list
- Reason for listing
```

---

## Project Structure

```
ais-watchdog/
├── PROJECT_CONTEXT.md          # This file
├── README.md                   # Public-facing documentation
│
├── infra/
│   ├── terraform/              # Aiven Kafka provisioning
│   │   └── main.tf
│   ├── docker-compose.yml      # Local development stack
│   └── .env.example            # Environment variables template
│
├── ingestion/
│   ├── ais_connector.py        # WebSocket client → Kafka producer
│   ├── reference_loader.py     # Bootstrap sanctions/geofence data
│   └── requirements.txt
│
├── flink-jobs/
│   ├── pom.xml                 # Maven project for Flink jobs
│   ├── src/main/java/
│   │   ├── enrichment/         # Enrich raw AIS with reference data
│   │   ├── detectors/
│   │   │   ├── DarkEventDetector.java
│   │   │   ├── GeofenceViolationDetector.java
│   │   │   ├── RendezvousDetector.java
│   │   │   └── FishingPatternDetector.java
│   │   ├── models/             # POJOs for AIS messages, alerts, etc.
│   │   └── utils/              # Geo calculations, time windows
│   └── src/main/resources/
│       └── application.properties
│
├── reference-data/
│   ├── sanctions/
│   │   ├── ofac_sdn.json       # Processed OFAC list
│   │   └── eu_sanctions.json   # Processed EU list
│   ├── geofences/
│   │   ├── eez_boundaries.geojson
│   │   ├── mpa_zones.geojson
│   │   └── sanctioned_eez.geojson
│   └── ports/
│       └── world_ports.json    # For "in port" detection
│
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── Map.jsx         # Mapbox GL + Deck.gl vessel layer
│   │   │   ├── AlertFeed.jsx   # Real-time alert stream
│   │   │   ├── VesselCard.jsx  # Detail view on click
│   │   │   └── Heatmap.jsx     # Anomaly density visualization
│   │   ├── hooks/
│   │   │   └── useKafkaStream.js  # WebSocket to Kafka REST proxy
│   │   └── utils/
│   │       └── geo.js          # Frontend geo utilities
│   └── public/
│
└── docs/
    ├── architecture.md
    ├── detection-logic.md
    └── social-content-plan.md  # For the competition story
```

---

## Implementation Order

Build in this sequence to have working demos at each stage:

### Phase 1: Data Pipeline (Week 1)
1. Set up Aiven Kafka (Terraform or console)
2. Build `ais_connector.py` - connect to AISStream, produce to Kafka
3. Verify data flowing with console consumer
4. Build `reference_loader.py` - bootstrap sanctions and geofence data

### Phase 2: Basic Detection (Week 2)
5. Create Flink project skeleton with Kafka connectors
6. Implement enrichment job (join AIS with reference data)
7. Implement simplest detector: Geofence violations (stateless, just point-in-polygon)
8. Verify alerts appearing in alerts topic

### Phase 3: Stateful Detection (Week 3)
9. Implement vessel state tracking (keyed state in Flink)
10. Implement "going dark" detector (requires tracking last seen time)
11. Implement rendezvous detector (windowed, multi-vessel)

### Phase 4: Frontend (Week 4)
12. Basic React app with Mapbox
13. Connect to Kafka REST proxy for live vessel positions
14. Add alert feed component
15. Polish: heatmaps, vessel detail cards, filters

### Phase 5: Polish & Content (Final Week)
16. Deploy to cloud (Ververica Cloud for Flink)
17. Create demo video
18. Write blog post / social content
19. Document everything in README

---

## Environment Variables

```bash
# Aiven Kafka
KAFKA_BOOTSTRAP_SERVERS=your-kafka.aivencloud.com:12345
KAFKA_SSL_CA_CERT=/path/to/ca.pem
KAFKA_SSL_CERT=/path/to/service.cert
KAFKA_SSL_KEY=/path/to/service.key

# AISStream
AISSTREAM_API_KEY=your_api_key_here

# Mapbox (Frontend)
MAPBOX_ACCESS_TOKEN=your_token_here

# Optional: Ververica Cloud
VERVERICA_API_TOKEN=your_token_here
VERVERICA_NAMESPACE=default
```

---

## Key Technical Decisions

### Why AISStream over AISHub?
- WebSocket API (real-time, no polling)
- Free tier with reasonable limits
- Can filter server-side by bounding box (reduces throughput)
- JSON output (no NMEA parsing needed)

### Why Flink over Kafka Streams?
- Better suited for complex event processing (CEP)
- Native windowing for rendezvous detection
- Ververica Cloud provides managed deployment
- Demonstrates Kafka + Flink complementary story

### Why Mapbox over alternatives?
- Free tier: 50k map loads/month (plenty for demo)
- Deck.gl integration for high-performance vessel rendering
- Good documentation, React bindings

### Geographic Filtering Strategy
To stay under 250 kb/s:
- Filter AIS feed to specific regions (e.g., Mediterranean, or Baltic Sea)
- Focus on high-interest areas (near sanctioned nations, known fishing grounds)
- Sample global data if needed (1 in N messages)

---

## Success Metrics (for Competition)

1. **Working Demo**: Live map showing vessels and real-time alerts
2. **At Least 3 Detection Types**: Dark events, geofence violations, plus one more
3. **Compelling Visuals**: Screenshots/video of actual detections
4. **Good Story**: Blog post explaining the build, the "Aiven + Ververica" angle
5. **Social Engagement**: Twitter/LinkedIn posts documenting the journey

---

## Resources & References

### AIS Data
- AISStream docs: https://aisstream.io/documentation
- AIS message types explained: https://gpsd.gitlab.io/gpsd/AIVDM.html
- MMSI number format: https://en.wikipedia.org/wiki/Maritime_Mobile_Service_Identity

### Maritime Domain
- Global Fishing Watch research: https://globalfishingwatch.org/research/
- Sanctions evasion tactics: https://www.treasury.gov/ofac (advisories section)
- IUU fishing overview: https://www.fao.org/iuu-fishing/en/

### Tech Stack Docs
- Aiven Kafka: https://docs.aiven.io/docs/products/kafka
- Apache Flink: https://nightlies.apache.org/flink/flink-docs-stable/
- Ververica Cloud: https://docs.ververica.com/
- Mapbox GL JS: https://docs.mapbox.com/mapbox-gl-js/
- Deck.gl: https://deck.gl/docs

---

## Notes for Claude Code

When implementing this project:

1. **Start simple**: Get data flowing through Kafka before adding Flink complexity
2. **Use Python for ingestion**: Faster iteration than Java for the connector piece
3. **Flink jobs in Java**: Better tooling and Ververica Cloud support
4. **Test with recorded data**: AISStream allows replay; save some data for offline testing
5. **Geographic scope**: Start with a small bounding box (e.g., one sea) to manage throughput
6. **Mock reference data first**: Start with a handful of test sanctions entries and simple geofences before loading full datasets

### Code Style Preferences
- Python: Use `asyncio` for the WebSocket client, type hints throughout
- Java/Flink: Standard Maven project, use Flink's `StreamExecutionEnvironment`
- React: Functional components, hooks, minimal dependencies
- All: Comprehensive error handling, structured logging

### Priority Order for MVP
1. `ais_connector.py` (must have data first)
2. Simple Flink enrichment job
3. Geofence detector (simplest detection logic)
4. Basic frontend with map
5. Everything else is bonus
