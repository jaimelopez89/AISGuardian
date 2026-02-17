# Changelog

All notable changes to AIS Guardian will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Comprehensive bandwidth optimization documentation (`BANDWIDTH_OPTIMIZATIONS.md`)

---

## [2.0.0] - 2026-02-17

### 🚀 Major Performance Improvements

**97% Bandwidth Reduction** - Reduced daily egress from 10 GB to 0.3 GB through systematic optimizations.

### Added

#### Round 2 Optimizations (Commit: 5d5f499)
- **Viewport filtering** - Only fetch vessels visible in current map view (80-90% reduction)
  - Map emits bounds on pan/zoom via `onBoundsChange` callback
  - API filters vessels by lat/lon boundaries
  - Reduces payload from 500 vessels to 50-100 on average
- **Visibility-based pausing** - Detect hidden tabs and slow down updates (50-60% reduction)
  - Uses Page Visibility API to detect tab state
  - Hidden: 60s polling interval (6× slower)
  - Visible: 10s polling + immediate refresh on return
  - SSE stays connected for real-time alerts
- **Trail on-demand loading** - Disabled continuous trail polling (90% reduction)
  - Trails now `enabled: false` by default
  - Only loads when user explicitly requests
- **Alert limit optimization** - Reduced from 100 to 20 alerts (80% reduction)
  - Smaller initial payload (35 KB → 7 KB)
  - Faster page loads
- **Removed redundant alert polling** - SSE already sends new alerts (95% reduction)
  - No polling when SSE connected
  - Only polls if SSE fails

#### Round 1 Optimizations (Commit: 11b21f9)
- **Server-Sent Events (SSE)** - Real-time updates with automatic fallback (70-80% reduction)
  - `/api/stream/vessels` - sends only changed vessels
  - `/api/stream/alerts` - sends only new alerts
  - Automatic fallback to polling after 3 failed attempts
- **Minimal payload mode** - Strip unnecessary fields from vessel data (40% reduction)
  - Added `?minimal=true` query parameter
  - Removes destination, ETA, draught, call sign, etc.
  - Reduces per-vessel payload from 288 to 180 bytes
- **Increased polling intervals** - Slower fallback polling (80% reduction)
  - Vessels: 2s → 10s
  - Alerts: 2s → 10s
  - Trails: 5s → 30s

### Changed
- Default polling intervals are now more conservative (10s vs 2s)
- Trails disabled by default (must be explicitly enabled)
- Alert fetch limit reduced to 20 (was 100)
- Map now emits viewport bounds for filtering

### Performance
- **Daily bandwidth:** 10 GB → 0.3 GB (97% reduction)
- **Monthly cost:** $30 → $0.90 (~$29 saved)
- **Page load:** 224 KB → 40 KB (82% faster)
- **Time to first vessel:** 2s → 0.5s (75% faster)

---

## [1.5.0] - 2026-01-22

### Added
- Ship-shaped vessel icons with heading rotation (Commit: a3c129c)
  - Triangular ship icons pointing in vessel's actual heading
  - Different colors for vessel types (tanker, cargo, fishing, etc.)
  - Selected and flagged states with distinct colors

### Fixed
- FITBURG investigation mode completely fixed (Commit: f2dd1dc)
- Investigation track and 102.3 knot false positives (Commit: db0c28a)
- Ship icon image size mismatch error (Commit: 8692b9f)
- Map reloading and vessels not displaying (Commit: f223236)

---

## [1.4.0] - 2026-01-21

### Changed
- Removed deck.gl entirely - switched to pure Mapbox GL native layers (Commit: bf43f00)
  - Better performance
  - Simpler codebase
  - Fewer dependencies

### Fixed
- Hook count mismatch error (#310) (Commit: 33ad8a9)
- Removed react-map-gl and @deck.gl/react dependencies (Commit: 5edf8b3)
- Fixed React #311 error by disabling StrictMode (Commit: 5503005)

---

## [1.3.0] - 2026-01-08

### Added
- FITBURG investigation mode with loading indicator (Commit: c278e27)
  - Historical track playback
  - Reconstructed vessel movement data
  - Cable zone analysis

---

## [1.2.0] - 2026-01-02

### Added
- Comprehensive project documentation
  - `PROJECT_CONTEXT.md` - Project overview and architecture
  - `QUICKSTART.md` - Quick start guide
  - `SERVICE_MANAGEMENT.md` - Service control documentation
  - `INVESTIGATION-2025-12-31.md` - Elisa FEC cable sabotage investigation

### Changed
- Updated README with authentic personal narrative (Commit: 8e0a5d6)
  - Added "Why I Built This" section
  - Mentioned Ververica employment context
  - Improved overall narrative flow

---

## [1.1.0] - 2025-12-31

### Added
- FITBURG investigation case study
  - Detailed incident documentation
  - Vessel track reconstruction
  - Cable zone analysis
  - Suspect vessel profiles

---

## [1.0.0] - 2025-12-16

### Initial Release

#### Core Features
- **Real-time AIS monitoring** for Baltic Sea vessels
- **12 detection algorithms:**
  - Cable Proximity Detection
  - Shadow Fleet Detection
  - Dark AIS Detection (Gone Dark & Appeared)
  - Trajectory Prediction
  - Rendezvous Detection
  - Convoy Detection
  - AIS Spoofing Detection
  - Anchor Dragging Detection
  - Loitering Detection
  - Fishing Pattern Detection
  - Geofence Violation Detection
  - Vessel Risk Scoring

#### Technology Stack
- **Message Broker:** Aiven Kafka (Free Tier)
- **Stream Processing:** Apache Flink 1.18
- **Flink Platform:** Ververica Cloud
- **Backend:** FastAPI (Python)
- **Frontend:** React 18 + Vite + Mapbox GL JS
- **Cache:** Aiven Valkey (Redis)
- **Data Source:** AISStream.io

#### Infrastructure
- **Live Demo:** https://lopez.fi/aisguardian
- **Backend Hosting:** Railway
- **Frontend Hosting:** Vercel
- **Data Pipeline:** Aiven Kafka → Apache Flink → FastAPI → React

#### Documentation
- README with project overview
- Architecture documentation
- Data format specifications
- Deployment guides

---

## Links

- **Live Demo:** https://lopez.fi/aisguardian
- **Repository:** https://github.com/jaimelopez89/AISGuardian
- **Author:** Jaime Lopez (Head of Marketing @ Ververica)

---

## Notes

### Version Numbering
- **Major (X.0.0):** Breaking changes or major new features
- **Minor (1.X.0):** New features, optimizations, significant improvements
- **Patch (1.0.X):** Bug fixes, minor improvements

### Commit References
All commit references link to the full commit hash for traceability.
