# AIS Watchdog - Quick Start Guide

## Prerequisites

Before starting, ensure you have installed:
- **Docker Desktop** (for Kafka)
- **Python 3.11+**
- **Node.js 18+**
- **Java 11+** and **Maven 3.8+** (for Flink jobs)

## Step 1: Get API Keys (5 minutes)

### AISStream.io (Required)
1. Go to https://aisstream.io
2. Click "Sign Up" (free)
3. Verify your email
4. Copy your API key from the dashboard

### Mapbox (Required for map)
1. Go to https://mapbox.com
2. Click "Sign up" (free)
3. Go to Account → Tokens
4. Copy your default public token

---

## Step 2: Start Kafka (2 minutes)

Open a terminal and run:

```bash
cd AISguardian/infra
docker-compose up -d
```

Wait 30 seconds, then verify it's running:
```bash
docker-compose ps
```

You should see all services as "healthy" or "running".

**Kafka UI:** http://localhost:8080

---

## Step 3: Set Up Python Environment (2 minutes)

Open a **new terminal**:

```bash
cd AISguardian/ingestion

# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate    # Mac/Linux
# OR: venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt
```

---

## Step 4: Configure Environment (1 minute)

Still in the `ingestion` directory:

```bash
# Create .env file
cat > .env << 'EOF'
AISSTREAM_API_KEY=your_aisstream_key_here
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
EOF
```

**Replace `your_aisstream_key_here` with your actual AISStream API key.**

---

## Step 5: Load Reference Data (30 seconds)

```bash
# Still in ingestion/ with venv activated
python reference_loader.py --all
```

You should see:
```
INFO - Loading all reference data...
INFO - Loaded sanctions data: X records
INFO - Loaded geofence data: X records
INFO - Loaded port data: X records
```

---

## Step 6: Start AIS Ingestion (keep running)

```bash
# Still in ingestion/ with venv activated
python ais_connector.py
```

You should see:
```
INFO - Connecting to AISStream with bounding boxes: [...]
INFO - Connected to AISStream, subscribed to feed
INFO - Progress: received=100, produced=98
```

**Keep this terminal open and running.**

---

## Step 7: Set Up Frontend (2 minutes)

Open a **new terminal**:

```bash
cd AISguardian/frontend

# Install dependencies
npm install

# Create .env file with your Mapbox token
cat > .env << 'EOF'
VITE_MAPBOX_TOKEN=your_mapbox_token_here
EOF
```

**Replace `your_mapbox_token_here` with your actual Mapbox token.**

---

## Step 8: Start Frontend (keep running)

```bash
# Still in frontend/
npm run dev
```

You should see:
```
  VITE v5.x.x  ready in XXX ms

  ➜  Local:   http://localhost:5173/
```

**Open http://localhost:5173 in your browser.**

---

## Step 9: (Optional) Start Flink Jobs

For real-time anomaly detection, open a **new terminal**:

```bash
cd AISguardian/flink-jobs

# Build the JAR
mvn clean package -DskipTests -Plocal

# Run the Flink job
java -jar target/ais-watchdog-flink-1.0-SNAPSHOT.jar
```

---

## What You Should See

### Frontend (http://localhost:5173)
- Dark map centered on Mediterranean
- Vessels appearing as colored dots (may take 1-2 minutes)
- Alert feed on the right sidebar
- Vessel count in header

### Kafka UI (http://localhost:8080)
- Topics: ais-raw, alerts, reference-data, etc.
- Messages flowing into ais-raw topic

---

## Terminal Summary

You should have these terminals running:

| Terminal | Directory | Command | Purpose |
|----------|-----------|---------|---------|
| 1 | `infra/` | `docker-compose up -d` | Kafka (runs in background) |
| 2 | `ingestion/` | `python ais_connector.py` | AIS data ingestion |
| 3 | `frontend/` | `npm run dev` | Web dashboard |
| 4 | `flink-jobs/` | `java -jar ...` | Detection (optional) |

---

## Stopping Everything

```bash
# Stop frontend: Ctrl+C in terminal 3
# Stop ingestion: Ctrl+C in terminal 2
# Stop Flink: Ctrl+C in terminal 4

# Stop Kafka:
cd infra
docker-compose down
```

---

## Troubleshooting

### "No vessels appearing on map"
- Wait 1-2 minutes for data to flow
- Check ingestion terminal for "Progress" messages
- Verify Kafka is running: `docker-compose ps`

### "Connection refused" errors
- Make sure Docker is running
- Run `docker-compose up -d` again
- Check ports aren't in use: 9092, 8080, 8082

### "Map not loading"
- Check your Mapbox token in `frontend/.env`
- Make sure it starts with `pk.`

### "AISSTREAM_API_KEY environment variable is required"
- Make sure `.env` file exists in `ingestion/`
- Check the API key is correct

### Frontend shows "Disconnected"
- Kafka REST proxy must be running (port 8082)
- Check `docker-compose ps` shows kafka-rest as running

---

## Ports Used

| Port | Service |
|------|---------|
| 5173 | Frontend (React) |
| 8080 | Kafka UI |
| 8081 | Schema Registry |
| 8082 | Kafka REST Proxy |
| 9092 | Kafka Broker |
| 2181 | Zookeeper |
