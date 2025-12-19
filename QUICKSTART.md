# AIS Guardian - Quick Start Guide

Get the maritime surveillance system running in under 15 minutes.

## Prerequisites

Before starting, ensure you have installed:
- **Python 3.11+**
- **Java 11+** (for Flink jobs)
- **Node.js 18+**
- **Maven 3.8+** (for building Flink JAR)

## Step 1: Get API Keys and Accounts (5 minutes)

### Aiven Kafka (Required)
1. Go to [console.aiven.io](https://console.aiven.io)
2. Sign up for free account
3. Create a new Apache Kafka service (Free tier)
4. Wait for service to be "Running" (~2 minutes)
5. Download SSL certificates from Overview tab:
   - `ca.pem`
   - `service.cert`
   - `service.key`
6. Note your connection details (Service URI)

### AISStream.io (Required)
1. Go to [aisstream.io](https://aisstream.io)
2. Click "Sign Up" (free)
3. Verify your email
4. Copy your API key from the dashboard

### Mapbox (Required for map)
1. Go to [mapbox.com](https://mapbox.com)
2. Click "Sign up" (free)
3. Go to Account → Tokens
4. Copy your default public token (starts with `pk.`)

---

## Step 2: Configure Project (2 minutes)

```bash
cd AISguardian

# Copy environment template
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# AISStream.io API Key
AISSTREAM_API_KEY=your_aisstream_api_key_here

# Aiven Kafka (from Aiven console - Service URI)
KAFKA_BOOTSTRAP_SERVERS=kafka-xxx-project.aivencloud.com:12345

# SSL certificates (place these files in project root)
KAFKA_SSL_CA_CERT=./ca.pem
KAFKA_SSL_CERT=./service.cert
KAFKA_SSL_KEY=./service.key

# Mapbox token
VITE_MAPBOX_TOKEN=pk.your_mapbox_token_here
```

Copy the downloaded SSL certificates (`ca.pem`, `service.cert`, `service.key`) to the project root.

---

## Step 3: Create Kafka Topics (2 minutes)

In the Aiven Console, go to your Kafka service → Topics → Add Topic:

| Topic Name | Partitions | Cleanup Policy |
|------------|------------|----------------|
| `ais-raw` | 2 | delete |
| `alerts` | 2 | delete |
| `reference-data` | 2 | compact |

---

## Step 4: Set Up Python Environment (2 minutes)

```bash
cd AISguardian

# Create virtual environment
python3 -m venv ingestion/venv

# Activate it
source ingestion/venv/bin/activate    # Mac/Linux
# OR: ingestion\venv\Scripts\activate  # Windows

# Install dependencies
pip install -r ingestion/requirements.txt
pip install fastapi uvicorn
```

---

## Step 5: Convert SSL Certificates for Java (1 minute)

The Flink job needs Java KeyStores instead of PEM files:

```bash
./scripts/setup-ssl.sh
```

This creates `truststore.jks` and `keystore.p12` in the project root.

---

## Step 6: Build Flink Job (2 minutes)

```bash
cd flink-jobs
mvn clean package -DskipTests
cd ..
```

This creates `flink-jobs/target/ais-watchdog-flink-1.0.0.jar`.

---

## Step 7: Start Everything (1 minute)

The easiest way is to use the startup script:

```bash
./start.sh
```

This starts all four services:
1. AIS Ingestion (WebSocket → Kafka)
2. Backend API (Kafka → REST API)
3. Flink Job (Anomaly Detection)
4. Frontend (React Dashboard)

---

## Step 8: Open Dashboard

- **Dashboard**: http://localhost:5174
- **API Stats**: http://localhost:8000/api/stats

You should see:
- Dark map centered on Baltic Sea
- Vessels appearing as colored dots (within 1-2 minutes)
- Alert feed on the right sidebar
- Vessel count in header

---

## Manual Startup (Alternative)

If you prefer to start services individually, open four terminal windows:

**Terminal 1 - AIS Ingestion:**
```bash
cd AISguardian
source ingestion/venv/bin/activate
python ingestion/ais_connector.py
```

**Terminal 2 - Backend API:**
```bash
cd AISguardian
source ingestion/venv/bin/activate
python backend/api.py
```

**Terminal 3 - Flink Job:**
```bash
cd AISguardian
export JAVA_HOME=/opt/homebrew/opt/openjdk@11  # macOS with Homebrew
export KAFKA_BOOTSTRAP_SERVERS=your-kafka.aivencloud.com:12345
export KAFKA_SSL_TRUSTSTORE_LOCATION=$PWD/truststore.jks
export KAFKA_SSL_TRUSTSTORE_PASSWORD=changeit
export KAFKA_SSL_KEYSTORE_LOCATION=$PWD/keystore.p12
export KAFKA_SSL_KEYSTORE_PASSWORD=changeit
java -jar flink-jobs/target/ais-watchdog-flink-1.0.0.jar
```

**Terminal 4 - Frontend:**
```bash
cd AISguardian/frontend
npm install  # First time only
npm run dev
```

---

## Checking Status

```bash
./start.sh status
```

Shows which services are running and basic stats.

---

## Stopping Everything

```bash
./start.sh stop
```

Or manually: Press `Ctrl+C` in each terminal.

---

## Troubleshooting

### "No vessels appearing on map"
- Wait 1-2 minutes for data to flow through the system
- Check ingestion terminal for "Progress" messages
- Verify `./start.sh status` shows all services running

### "Connection refused" to Kafka
- Verify SSL certificates are in project root
- Check bootstrap servers URL in `.env`
- Ensure Aiven Kafka service is "Running"

### "Map not loading"
- Check your Mapbox token in `.env`
- Token must start with `pk.`
- Check browser console for errors

### "AISSTREAM_API_KEY environment variable is required"
- Make sure `.env` file exists in project root
- Check the API key is correct and not expired

### Flink job fails to start
- Run `./scripts/setup-ssl.sh` to create keystores
- Verify Java 11+ is installed: `java -version`
- Check Kafka SSL configuration in environment variables

### Backend API not connecting
- Check SSL certificate paths are correct
- Verify Kafka service is running in Aiven console
- Check `/tmp/aisguardian/api.log` for errors

---

## Ports Used

| Port | Service |
|------|---------|
| 5174 | Frontend (React/Vite) |
| 8000 | Backend API (FastAPI) |

---

## Logs

All service logs are written to `/tmp/aisguardian/`:

```bash
# View all logs
tail -f /tmp/aisguardian/*.log

# View specific service
tail -f /tmp/aisguardian/ingestion.log
tail -f /tmp/aisguardian/api.log
tail -f /tmp/aisguardian/flink.log
tail -f /tmp/aisguardian/frontend.log
```

---

## Next Steps

- **Production Flink**: Deploy to [Ververica Cloud](docs/deployment.md#ververica-cloud) for managed Flink
- **Add Detectors**: Implement additional anomaly detection in `flink-jobs/src/main/java/com/aiswatchdog/detectors/`
- **Customize Geofences**: Edit `reference-data/geofences/` to monitor different areas
