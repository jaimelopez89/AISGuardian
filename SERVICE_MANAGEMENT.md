# AIS Guardian - Service Management

## Quick Reference

```bash
# Start all services
./start.sh

# Stop all services
./start.sh stop

# Restart all services
./start.sh restart

# Check status of all services
./start.sh status
```

## Services Managed

| Service | Description | Log File |
|---------|-------------|----------|
| AIS Ingestion | WebSocket client consuming AISStream data | `/tmp/aisguardian/ingestion.log` |
| Backend API | FastAPI server (port 8000) | `/tmp/aisguardian/api.log` |
| Flink Job | Anomaly detection processing | `/tmp/aisguardian/flink.log` |
| Frontend | React/Vite dev server (port 5174) | `/tmp/aisguardian/frontend.log` |

## URLs

- **Dashboard**: http://localhost:5174
- **API Stats**: http://localhost:8000/api/stats

## Manual Service Control

If you need to control individual services:

```bash
# Stop individual services
pkill -f "ais_connector.py"      # Stop AIS Ingestion
pkill -f "backend/api.py"        # Stop Backend API
pkill -f "ais-watchdog-flink"    # Stop Flink Job
pkill -f "vite"                  # Stop Frontend

# Start individual services (from project root)
ingestion/venv/bin/python ingestion/ais_connector.py &
ingestion/venv/bin/python backend/api.py &
java -jar flink-jobs/target/ais-watchdog-flink-1.0.0.jar &
cd frontend && npm run dev &
```

## Prerequisites

The start script automatically checks for:
- `.env` file with configuration
- SSL certificates (`ca.pem`, `service.cert`, `service.key`)
- Java keystores (created from PEM if missing)
- Python venv at `ingestion/venv`
- Frontend `node_modules`
- Compiled Flink JAR

## Viewing Logs

```bash
# Tail all logs
tail -f /tmp/aisguardian/*.log

# Tail specific service
tail -f /tmp/aisguardian/ingestion.log
tail -f /tmp/aisguardian/api.log
tail -f /tmp/aisguardian/flink.log
tail -f /tmp/aisguardian/frontend.log
```
