# AIS Watchdog

Real-time maritime anomaly detection system that monitors AIS vessel data to detect illegal fishing, sanctions evasion, and "going dark" events.

Built for the [Aiven Free Kafka Competition](https://aiven.io) using **Aiven Kafka** + **Apache Flink** (Ververica).

## Quick Start

**[See QUICKSTART.md for step-by-step instructions](QUICKSTART.md)**

### TL;DR

```bash
# 1. Start Kafka
cd infra && docker-compose up -d

# 2. Start ingestion (new terminal)
cd ingestion
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
echo "AISSTREAM_API_KEY=your_key" > .env
python reference_loader.py --all
python ais_connector.py

# 3. Start frontend (new terminal)
cd frontend
npm install
echo "VITE_MAPBOX_TOKEN=your_token" > .env
npm run dev

# 4. Open http://localhost:5173
```

## What It Detects

| Detection | Description |
|-----------|-------------|
| **Geofence Violations** | Vessels entering MPAs, sanctioned waters |
| **Going Dark** | AIS transmission gaps (potential hiding) |
| **Rendezvous** | Ship-to-ship meetings at sea |
| **Illegal Fishing** | Fishing patterns in protected areas |

## Architecture

```
AISStream.io → Kafka → Flink Detectors → Alerts → React Dashboard
                         ↓
              Geofence │ Dark Event │ Rendezvous │ Fishing
```

## Project Structure

```
AISguardian/
├── ingestion/           # Python: AIS data ingestion
├── flink-jobs/          # Java: Flink detection jobs
├── frontend/            # React + Mapbox dashboard
├── reference-data/      # Geofences, sanctions, ports
├── infra/               # Docker Compose
└── docs/                # Architecture, deployment guides
```

## Documentation

- [QUICKSTART.md](QUICKSTART.md) - Get running in 10 minutes
- [docs/architecture.md](docs/architecture.md) - System design
- [docs/deployment.md](docs/deployment.md) - Production deployment
- [docs/data-formats.md](docs/data-formats.md) - Kafka message schemas

## URLs (Local Development)

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Kafka UI | http://localhost:8080 |
| REST Proxy | http://localhost:8082 |

## License

MIT
