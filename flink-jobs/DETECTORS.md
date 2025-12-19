# AIS Guardian - Flink Anomaly Detectors

This document describes all anomaly detection algorithms implemented in the Apache Flink stream processing job.

## Architecture Overview

```
                                    ┌──────────────────────────┐
                                    │  1. Geofence Detector    │──┐
                                    └──────────────────────────┘  │
                                    ┌──────────────────────────┐  │
                                    │  2. Dark Event Detector  │──┤
                                    └──────────────────────────┘  │
                                    ┌──────────────────────────┐  │
   ┌─────────┐    ┌───────────┐     │  3. Rendezvous Detector  │──┤
   │ais-raw  │───▶│  Parse &  │────▶├──────────────────────────┤  │    ┌────────┐
   │  topic  │    │  Filter   │     │  4. Fishing Detector     │──┼───▶│ alerts │
   └─────────┘    └───────────┘     ├──────────────────────────┤  │    │ topic  │
                       │            │  5. Cable Proximity      │──┤    └────────┘
   ┌─────────┐         │            ├──────────────────────────┤  │
   │reference│─────────┴───────────▶│  6. Loitering Detector   │──┤
   │  data   │    (broadcast)       ├──────────────────────────┤  │
   └─────────┘                      │  7. Spoofing Detector    │──┤
                                    ├──────────────────────────┤  │
   ┌─────────┐                      │  8. Convoy Detector      │──┤
   │sanctions│─────────────────────▶├──────────────────────────┤  │
   │  topic  │    (broadcast)       │  9. Anchor Dragging      │──┤
   └─────────┘                      ├──────────────────────────┤  │
                                    │ 10. Shadow Fleet         │──┤
                                    ├──────────────────────────┤  │
                                    │ 11. Vessel Risk Scorer   │──┘
                                    └──────────────────────────┘
```

**Data Flow:**
1. Raw AIS positions consumed from `ais-raw` Kafka topic
2. Reference data (geofences, cable zones) broadcast to all detectors
3. Sanctions data (shadow fleet vessels, high-risk flags) broadcast to shadow fleet detector
4. Each detector runs in parallel, analyzing vessel behavior
5. Alerts emitted to `alerts` Kafka topic

---

## Detector 1: Geofence Violation Detector

**File:** `GeofenceViolationDetector.java`

**Purpose:** Detects when vessels enter restricted zones (MPAs, sanctioned waters, EEZs).

**Alert Conditions:**
- Vessel position falls within a geofence polygon
- Zone type determines who triggers alerts:
  - **Sanctioned waters**: All vessels
  - **Marine Protected Areas (MPA)**: Fishing vessels
  - **EEZ**: Foreign fishing vessels
  - **Restricted zones**: All vessels

**Flink Pattern:** Broadcast State (geofences broadcast to all parallel instances)

**Alert Types:** `GEOFENCE_VIOLATION`

**Severity:**
- HIGH: MPA violations
- MEDIUM: EEZ violations
- Variable: Based on zone configuration

---

## Detector 2: Dark Event Detector

**File:** `DarkEventDetector.java`

**Purpose:** Detects vessels that stop transmitting AIS ("going dark"), a common tactic for sanctions evasion, illegal fishing, or illicit ship-to-ship transfers.

**Alert Conditions:**
- Vessel had established transmission pattern (>5 messages)
- Current gap exceeds threshold (default: 120 minutes)
- Last position showed movement (speed > 0.5 knots)
- Not a pleasure craft or passenger vessel

**Configuration:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `darkThresholdMinutes` | 120 | Minutes of silence before alerting |
| `checkIntervalMs` | 60000 | Timer check interval |

**Flink Pattern:** Keyed State (per MMSI) + Processing Time Timers

**Alert Type:** `DARK_EVENT`

**Severity:**
- LOW: 2-6 hour gap
- MEDIUM: 6-24 hour gap
- HIGH: >24 hour gap
- CRITICAL: Sanctioned vessel or in sensitive zone

---

## Detector 3: Rendezvous Detector

**File:** `RendezvousDetector.java`

**Purpose:** Detects ship-to-ship meetings in open ocean, a common sanctions evasion tactic for transferring cargo without port inspection.

**Alert Conditions:**
- Two vessels within proximity threshold (default: 500m)
- Duration exceeds threshold (default: 30 minutes)
- Location >50 NM from any known port (open sea)
- Both vessels moving slowly (<5 knots)
- At least one is a tanker or cargo ship

**Configuration:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `proximityThresholdMeters` | 500 | Distance for encounter |
| `durationThresholdMinutes` | 30 | Minimum meeting duration |
| `minPortDistanceNm` | 50 | Must be this far from ports |

**Flink Pattern:** Grid-based spatial partitioning (KeyedCoProcessFunction)

**Alert Type:** `RENDEZVOUS`

**Severity:**
- MEDIUM: Two cargo vessels
- HIGH: Tanker involved
- CRITICAL: Tanker-to-tanker meeting

---

## Detector 4: Fishing Pattern Detector

**File:** `FishingPatternDetector.java`

**Purpose:** Identifies fishing behavior patterns and alerts when detected in protected areas.

**Fishing Pattern Indicators:**
- Average speed < 5 knots
- High speed variance (start/stop patterns)
- Frequent course changes (>10 significant changes per hour)
- Small operating area (<100 sq NM)

**Alert Conditions:**
- Fishing pattern detected (3+ of 4 indicators)
- Vessel is in Marine Protected Area OR foreign EEZ
- Confidence score > 60%

**Flink Pattern:** Keyed Broadcast Process Function

**Alert Type:** `FISHING_IN_MPA`

**Severity:**
- MEDIUM: Fishing in EEZ
- HIGH: Fishing in MPA, or non-fishing vessel showing fishing behavior
- CRITICAL: High confidence (>80%) MPA violation

---

## Detector 5: Cable Proximity Detector

**File:** `CableProximityDetector.java`

**Purpose:** Monitors vessels near undersea cables and pipelines. Critical for Baltic Sea infrastructure protection following C-Lion1 and Balticconnector incidents.

**Monitored Behavior:**
- **STOPPED** (< 0.5 knots): Highest risk - possible anchoring
- **SLOW** (< 3 knots): Potential anchoring preparation
- **FLAGGED STATE TRANSIT**: Vessels from monitored countries (RU, CN, HK, IR)

**Smart Filtering:**
- Excludes vessels within 2.5 NM of known ports/anchorages
- 60+ Baltic Sea ports and anchorages in database
- Rate limiting: 15 minutes between alerts per vessel+zone

**Configuration:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| `STOPPED_THRESHOLD` | 0.5 kts | Considered stopped |
| `SLOW_SPEED_THRESHOLD` | 3.0 kts | Potential anchoring |
| `MIN_SHORE_DISTANCE_NM` | 2.5 NM | Port/anchorage exclusion radius |
| `ALERT_COOLDOWN_MS` | 15 min | Per vessel+zone |

**Flink Pattern:** Broadcast Process Function

**Alert Type:** `CABLE_PROXIMITY`

**Severity:**
- LOW: Large vessel transiting
- MEDIUM: Flagged state transiting
- HIGH: Slow vessel in zone
- CRITICAL: Stopped vessel, or flagged state moving slowly

---

## Detector 6: Loitering Detector

**File:** `LoiteringDetector.java`

**Purpose:** Detects vessels staying in a small area for extended periods, which may indicate surveillance, illegal activity, or preparation for transfers.

**Alert Conditions:**
- All positions within radius threshold (default: 0.5 NM)
- Duration exceeds threshold (default: 45 minutes)
- Sufficient position history (3+ points)

**Configuration:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `radiusNM` | 0.5 | Max distance from centroid |
| `minDurationMinutes` | 45 | Minimum loitering time |
| `maxHistoryMinutes` | 120 | Position history window |
| `checkIntervalMs` | 60000 | Check interval |

**Flink Pattern:** Keyed Process Function with List State

**Alert Type:** `LOITERING`

**Severity:**
- MEDIUM: 45-120 minutes
- HIGH: 2-6 hours
- CRITICAL: >6 hours

---

## Detector 7: AIS Spoofing Detector

**File:** `AISSpoofingDetector.java`

**Purpose:** Detects potentially spoofed or manipulated AIS signals, used in sanctions evasion and illegal activities.

**Detection Methods:**

| Check | Description | Score |
|-------|-------------|-------|
| Invalid MMSI | Wrong length, fake patterns (000000000, 123456789) | +30 |
| Invalid MID | Country code outside 200-799 range | +30 |
| Impossible Speed | Reported SOG > 50 knots | +20 |
| Teleportation | Position jump implies >60 knots travel | +50 |
| Heading/COG Mismatch | >45° difference while moving >3 knots | +10 |
| Invalid Coordinates | Outside valid lat/lon range | +40 |
| Null Island | Position at 0°, 0° | +40 |
| IMO Number Change | Same MMSI reports different IMO (identity theft) | +60 |
| Stateless MMSI | MID code from suspicious/uncommon range | +15 |
| Frequent Name Changes | 3+ different names detected (identity obfuscation) | +35 |

**Flink Pattern:** Keyed Process Function with cumulative scoring and historical state

**Alert Type:** `AIS_SPOOFING`

**Severity:**
- LOW: Minor inconsistencies (heading/COG, uncommon flag)
- MEDIUM: Invalid MMSI format, 3-4 name changes
- HIGH: 5+ name changes, suspicious patterns, teleportation <200 kts
- CRITICAL: IMO change detected, teleportation >200 kts, invalid coordinates

---

## Detector 8: Convoy Detector

**File:** `ConvoyDetector.java`

**Purpose:** Detects groups of vessels traveling together in coordinated fashion, which may indicate military operations, coordinated smuggling, or protection escorts.

**Convoy Criteria:**
- 3+ vessels within proximity (default: 2 NM)
- Similar speeds (within 3 knots)
- Similar courses (within 20°)
- Sustained formation (default: 5+ minutes)

**Configuration:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `proximityNm` | 2.0 | Max distance between vessels |
| `speedTolerance` | 3.0 | Max speed difference (knots) |
| `courseTolerance` | 20.0 | Max course difference (degrees) |
| `minVessels` | 3 | Minimum convoy size |
| `minDurationMinutes` | 5 | Minimum formation duration |

**Flink Pattern:** Grid-based KeyedCoProcessFunction

**Alert Type:** `CONVOY`

**Severity:**
- MEDIUM: 3-4 vessels, <1 hour
- HIGH: 5+ vessels, or >1 hour duration

---

## Detector 9: Anchor Dragging Detector

**File:** `AnchorDraggingDetector.java`

**Purpose:** Detects vessels whose anchors may be dragging - critical for undersea cable protection (C-Lion1, Balticconnector incidents were caused by anchor dragging).

**Detection Criteria:**
- Vessel reports nav_status = 1 (At anchor) or 5 (Moored)
- BUT shows movement:
  - Speed > 0.5 knots (dragging)
  - Speed > 1.5 knots (severe dragging)
  - Position drift > ~100 meters from anchor drop point

**Cable Zone Enhancement:**
- Alerts elevated to CRITICAL when near cable protection zones
- Tracks anchor drop position and maximum drift

**AIS Navigation Status Codes:**
| Code | Status |
|------|--------|
| 0 | Under way using engine |
| 1 | At anchor |
| 2 | Not under command |
| 5 | Moored |

**Flink Pattern:** Keyed Broadcast Process Function

**Alert Type:** `ANCHOR_DRAGGING`

**Severity:**
- MEDIUM: Slow drift, not near cables
- HIGH: Faster movement, or drift near cables
- CRITICAL: Fast movement near cable protection zone

---

## Detector 10: Shadow Fleet Detector

**File:** `ShadowFleetDetector.java`

**Purpose:** Detects vessels from Russia's shadow fleet based on sanctions lists. The shadow fleet consists of tankers and cargo ships used to evade Western sanctions on Russian oil exports.

**Data Source:** `sanctions` Kafka topic containing:
- Sanctioned vessel records (IMO numbers, vessel names)
- High-risk flag state definitions (MID codes)

**Detection Methods:**

| Method | Description | Severity |
|--------|-------------|----------|
| IMO Number Match | Direct match against sanctions database | CRITICAL/HIGH |
| High-Risk Flag | Vessel flying flag from monitored state | MEDIUM/HIGH |
| Name Match | Fuzzy matching against known shadow fleet names | MEDIUM |

**High-Risk Flags:**
| MID | Country | Risk Level |
|-----|---------|------------|
| 273 | Russia | Critical |
| 422 | Iran | Critical |
| 445 | North Korea | Critical |
| 412-414 | China | High |
| 477 | Hong Kong | High |
| 620 | Cameroon | High |
| 613 | Gabon | High |
| 572 | Palau | High |
| 667 | Sierra Leone | Medium |

**Flink Pattern:** Keyed Broadcast Process Function (sanctions broadcast to all instances)

**Alert Type:** `SANCTIONS_MATCH`

**Severity:**
- MEDIUM: Name match (requires verification)
- HIGH: High-risk flag tanker, sanctioned vessel
- CRITICAL: Critical-risk flag or confirmed sanctions match

**Rate Limiting:** 1 hour cooldown per vessel

---

## Detector 11: Vessel Risk Scorer

**File:** `VesselRiskScorer.java`

**Purpose:** Calculates cumulative risk scores based on historical behavior patterns. Tracks multiple risk factors to identify potentially suspicious vessels.

**Risk Factors:**

| Factor | Points | Cap | Description |
|--------|--------|-----|-------------|
| Dark Events | 15 | 4 events | Vessels that frequently go dark |
| Russian Port Visits | 25 | 3 visits | Visits to St. Petersburg, Ust-Luga, Primorsk, etc. |
| STS Transfers | 20 | 3 events | Ship-to-ship transfer participation |
| High-Risk Flag | 30 | 1 time | Registered in shadow fleet nation |
| Name Changes | 10 | 3 changes | Identity obfuscation |
| Erratic Behavior | 5 | 4 events | Suspicious movement patterns |

**Russian Ports Monitored:**
- St. Petersburg
- Ust-Luga
- Primorsk
- Vysotsk
- Kaliningrad
- Baltiysk

**Risk Score Tiers:**

| Score | Tier | Response |
|-------|------|----------|
| 0-25 | LOW | Normal monitoring |
| 26-50 | MEDIUM | Enhanced monitoring |
| 51-75 | HIGH | Active tracking |
| 76-100 | CRITICAL | Immediate attention |

**Flink Pattern:** Keyed Process Function with Map State

**Alert Type:** `SANCTIONS_MATCH` (with risk_tier detail)

**Alert Triggers:**
- Vessel crosses into new risk tier
- Risk score increases by 15+ points

**Rate Limiting:** 4 hours between alerts per vessel

---

## Alert Rate Limiting

All detectors implement rate limiting to prevent alert spam:

| Detector | Cooldown |
|----------|----------|
| Cable Proximity | 15 minutes per vessel+zone |
| Loitering | 1 hour per vessel |
| Spoofing | 30 minutes per vessel+alert type |
| Anchor Dragging | 15 minutes per vessel |
| Convoy | 1 hour per convoy group |
| Rendezvous | Once per encounter |
| Shadow Fleet | 1 hour per vessel |
| Vessel Risk Scorer | 4 hours per vessel |

---

## Configuration

All detectors can be configured via environment variables or program arguments:

```bash
# Environment variables
export KAFKA_BOOTSTRAP_SERVERS=your-kafka:9092
export DARK_THRESHOLD_MINUTES=120
export RENDEZVOUS_DISTANCE_METERS=500
export RENDEZVOUS_DURATION_MINUTES=30

# Or program arguments (Ververica Cloud)
--bootstrap-servers your-kafka:9092
--dark-threshold-minutes 120
--rendezvous-distance-meters 500
```

---

## Flagged States

Several detectors give special attention to vessels from monitored flag states:

| MID | Country | Reason |
|-----|---------|--------|
| 273 | Russia (RU) | Sanctions, Baltic Sea incidents |
| 412-414 | China (CN) | Yi Peng 3 incident |
| 477 | Hong Kong (HK) | Chinese-linked vessels |
| 422 | Iran (IR) | Sanctions |

---

## Building & Deployment

```bash
# Build the JAR
cd flink-jobs
mvn clean package -DskipTests

# Run locally
export KAFKA_BOOTSTRAP_SERVERS=localhost:9092
java -jar target/ais-watchdog-flink-1.0.0.jar

# Deploy to Ververica Cloud
# Upload JAR and keystores as Additional Dependencies
# Configure program arguments in deployment
```

See `docs/deployment.md` for full Ververica Cloud deployment instructions.
