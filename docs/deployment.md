# AIS Watchdog Deployment Guide

## Prerequisites

- Python 3.11+
- Java 11+ (for Flink)
- Maven 3.8+
- Node.js 18+
- Docker & Docker Compose

## Quick Start (Local Development)

### 1. Clone and Setup

```bash
cd AISguardian

# Copy environment template
cp infra/.env.example .env
```

### 2. Get API Keys

**AISStream.io** (required)
1. Sign up at https://aisstream.io
2. Verify email
3. Copy API key from dashboard
4. Add to `.env`: `AISSTREAM_API_KEY=your_key`

**Mapbox** (required for frontend)
1. Sign up at https://mapbox.com
2. Create access token
3. Add to `frontend/.env`: `VITE_MAPBOX_TOKEN=your_token`

### 3. Start Local Kafka

```bash
cd infra
docker-compose up -d

# Wait for services to be healthy
docker-compose ps

# View Kafka UI at http://localhost:8080
```

### 4. Load Reference Data

```bash
cd ingestion
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Load geofences and sanctions
python reference_loader.py --all
```

### 5. Start AIS Ingestion

```bash
# In ingestion directory with venv activated
python ais_connector.py

# You should see messages like:
# INFO - Connected to AISStream, subscribed to feed
# INFO - Progress: received=1000, produced=998
```

### 6. Start Flink Job (Local)

```bash
cd flink-jobs

# Build the JAR
mvn clean package -DskipTests -Plocal

# Run locally
java -jar target/ais-watchdog-flink-1.0-SNAPSHOT.jar
```

### 7. Start Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env with your VITE_MAPBOX_TOKEN

npm run dev
# Open http://localhost:3000
```

---

## Production Deployment

### Aiven Kafka Setup

1. **Create Account**
   - Sign up at https://console.aiven.io

2. **Create Kafka Service**
   - Click "Create Service"
   - Select "Apache Kafka"
   - Choose "Free" plan
   - Select region
   - Name: `ais-watchdog-kafka`
   - Click "Create Service"

3. **Download Certificates**
   ```bash
   mkdir -p certs
   # Download from Aiven console:
   # - ca.pem
   # - service.cert
   # - service.key
   # Save to certs/ directory
   ```

4. **Create Topics**

   In Aiven Console → Topics → Add Topic:

   | Topic | Partitions | Cleanup Policy |
   |-------|------------|----------------|
   | ais-raw | 2 | delete |
   | ais-enriched | 2 | delete |
   | alerts | 2 | delete |
   | vessel-state | 2 | compact |
   | reference-data | 2 | compact |

5. **Update Environment**
   ```bash
   export KAFKA_BOOTSTRAP_SERVERS=kafka-xxx.aivencloud.com:12345
   export KAFKA_SSL_CA_CERT=./certs/ca.pem
   export KAFKA_SSL_CERT=./certs/service.cert
   export KAFKA_SSL_KEY=./certs/service.key
   ```

### Ververica Cloud (Flink) Setup

1. **Create Account**
   - Sign up at https://www.ververica.com/getting-started

2. **Create Namespace**
   - Name: `ais-watchdog`

3. **Create Deployment Target**
   - Go to Administration → Deployment Targets
   - Configure resources (start small: 1 TM, 1 slot)

4. **Upload JAR**
   ```bash
   # Build production JAR
   mvn clean package -DskipTests

   # Upload target/ais-watchdog-flink-1.0-SNAPSHOT.jar
   # via Ververica UI
   ```

5. **Create Deployment**
   - Select uploaded JAR
   - Main class: `com.aiswatchdog.AISWatchdogJob`
   - Add environment variables for Kafka SSL

6. **Start Deployment**
   - Click "Start"
   - Monitor in Ververica dashboard

### Frontend Deployment

**Option 1: Vercel (Recommended)**
```bash
cd frontend
npm install -g vercel
vercel

# Set environment variables in Vercel dashboard:
# VITE_MAPBOX_TOKEN=your_token
# VITE_KAFKA_REST_URL=https://your-kafka-rest-proxy.com
```

**Option 2: Docker**
```dockerfile
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

### Ingestion Service Deployment

**Docker**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "ais_connector.py"]
```

**Systemd Service**
```ini
[Unit]
Description=AIS Watchdog Ingestion
After=network.target

[Service]
Type=simple
User=ais
WorkingDirectory=/opt/ais-watchdog/ingestion
Environment="AISSTREAM_API_KEY=xxx"
Environment="KAFKA_BOOTSTRAP_SERVERS=xxx"
ExecStart=/opt/ais-watchdog/venv/bin/python ais_connector.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

---

## Running Tests

### Python Tests
```bash
cd ingestion
source venv/bin/activate
pytest tests/ -v
pytest tests/ --cov=. --cov-report=html
```

### Java Tests
```bash
cd flink-jobs
mvn test
mvn test -Dtest=GeoUtilsTest  # Single test class
```

### Frontend Tests
```bash
cd frontend
npm test
npm run test:coverage
```

---

## Monitoring

### Kafka Metrics (Aiven Console)
- Messages in/out per second
- Consumer lag
- Topic size

### Flink Metrics (Ververica / Flink UI)
- Records processed per second
- Checkpoint duration
- Backpressure indicators

### Application Logs
```bash
# Ingestion logs
docker logs ais-ingestion -f

# Flink logs (local)
tail -f flink-jobs/logs/*.log
```

---

## Troubleshooting

### "Connection refused" to Kafka
- Ensure Kafka is running: `docker-compose ps`
- Check bootstrap servers in .env
- For Aiven: verify SSL certificates are correct

### No AIS messages appearing
- Check AISStream API key is valid
- Verify bounding boxes include active shipping areas
- Check rate limit isn't exceeded

### Flink job fails to start
- Verify Kafka SSL configuration
- Check topics exist
- Ensure sufficient memory for JVM

### Frontend shows "Disconnected"
- Verify Kafka REST Proxy is running (port 8082)
- Check CORS settings if using external proxy
- Verify consumer group isn't blocked

---

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `AISSTREAM_API_KEY` | AISStream.io API key | (required) |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address | localhost:9092 |
| `KAFKA_SSL_CA_CERT` | Path to CA certificate | (optional) |
| `KAFKA_SSL_CERT` | Path to client certificate | (optional) |
| `KAFKA_SSL_KEY` | Path to client key | (optional) |
| `VITE_MAPBOX_TOKEN` | Mapbox access token | (required) |
| `DARK_THRESHOLD_MINUTES` | Dark event threshold | 120 |
| `RENDEZVOUS_DISTANCE_METERS` | Rendezvous proximity | 500 |
| `RENDEZVOUS_DURATION_MINUTES` | Rendezvous duration | 30 |
