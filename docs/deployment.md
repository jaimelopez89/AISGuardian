# AIS Guardian Deployment Guide

## Prerequisites

- Python 3.11+
- Java 11+ (for Flink)
- Maven 3.8+
- Node.js 18+

## Local Development (Recommended for Getting Started)

Local development runs all services on your machine while connecting to Aiven Kafka in the cloud.

### 1. Aiven Kafka Setup

1. **Create Account**
   - Sign up at [console.aiven.io](https://console.aiven.io)
   - Free tier is sufficient for this project

2. **Create Kafka Service**
   - Click "Create Service"
   - Select "Apache Kafka"
   - Choose "Free" plan
   - Select nearest region
   - Name: `ais-guardian-kafka`
   - Click "Create Service"
   - Wait for service to show "Running" (~2 minutes)

3. **Download SSL Certificates**
   - Go to service Overview tab
   - Download these files to project root:
     - `ca.pem` (CA certificate)
     - `service.cert` (Client certificate)
     - `service.key` (Client key)

4. **Create Topics**

   In Aiven Console → Topics → Add Topic:

   | Topic | Partitions | Cleanup Policy |
   |-------|------------|----------------|
   | `ais-raw` | 2 | delete |
   | `alerts` | 2 | delete |
   | `reference-data` | 2 | compact |

5. **Note Connection Details**

   From the Overview tab, copy the Service URI (e.g., `kafka-xxx-yyy.aivencloud.com:12345`)

### 2. Configure Environment

```bash
cd AISguardian

# Copy template
cp .env.example .env

# Edit with your values
nano .env
```

Required variables:

```bash
AISSTREAM_API_KEY=your_aisstream_key
KAFKA_BOOTSTRAP_SERVERS=kafka-xxx-yyy.aivencloud.com:12345
KAFKA_SSL_CA_CERT=./ca.pem
KAFKA_SSL_CERT=./service.cert
KAFKA_SSL_KEY=./service.key
VITE_MAPBOX_TOKEN=pk.xxx
```

### 3. Convert SSL Certificates for Java

```bash
./scripts/setup-ssl.sh
```

This creates `truststore.jks` and `keystore.p12` from the PEM files.

### 4. Build Flink Job

```bash
cd flink-jobs
mvn clean package -DskipTests
cd ..
```

### 5. Start All Services

```bash
./start.sh
```

Or individually:

```bash
# Terminal 1: AIS Ingestion
source ingestion/venv/bin/activate
python ingestion/ais_connector.py

# Terminal 2: Backend API
source ingestion/venv/bin/activate
python backend/api.py

# Terminal 3: Flink Job
export JAVA_HOME=/opt/homebrew/opt/openjdk@11
export KAFKA_BOOTSTRAP_SERVERS=kafka-xxx.aivencloud.com:12345
export KAFKA_SSL_TRUSTSTORE_LOCATION=$PWD/truststore.jks
export KAFKA_SSL_TRUSTSTORE_PASSWORD=changeit
export KAFKA_SSL_KEYSTORE_LOCATION=$PWD/keystore.p12
export KAFKA_SSL_KEYSTORE_PASSWORD=changeit
java -jar flink-jobs/target/ais-watchdog-flink-1.0.0.jar

# Terminal 4: Frontend
cd frontend && npm run dev
```

### 6. Access the Application

- **Dashboard**: http://localhost:5174
- **API**: http://localhost:8000/api/stats

---

## Ververica Cloud

For production Flink deployment, use Ververica Cloud (managed Apache Flink).

### 1. Create Ververica Account

1. Sign up at [ververica.com](https://www.ververica.com/getting-started)
2. Create a new workspace

### 2. Configure Deployment Target

1. Go to Administration → Deployment Targets
2. Create new deployment target
3. Configure resources:
   - Task Managers: 1 (start small)
   - Task Slots: 2
   - Memory: 1GB per TM

### 3. Upload JAR Artifact

1. Build production JAR:
   ```bash
   cd flink-jobs
   mvn clean package -DskipTests
   ```

2. In Ververica Console:
   - Go to Artifacts
   - Upload `target/ais-watchdog-flink-1.0.0.jar`

### 4. Create Deployment

1. Go to Deployments → Create Deployment
2. Select your artifact
3. Configure:
   - **Main Class**: `com.aiswatchdog.AISWatchdogJob`
   - **Program Arguments**:
     ```
     --bootstrap-servers kafka-xxx.aivencloud.com:12345
     ```

4. Add environment variables (Deployment → Configuration → Environment):
   ```
   KAFKA_BOOTSTRAP_SERVERS=kafka-xxx.aivencloud.com:12345
   ```

### 5. Configure SSL for Ververica

For Aiven Kafka SSL, you need to provide certificates as secrets:

**Option A: Environment Variables with Base64 Encoded Certs**

```bash
# Encode certificates
TRUSTSTORE_BASE64=$(base64 -w0 truststore.jks)
KEYSTORE_BASE64=$(base64 -w0 keystore.p12)

# Add to Ververica deployment config
KAFKA_SSL_TRUSTSTORE_BASE64=$TRUSTSTORE_BASE64
KAFKA_SSL_KEYSTORE_BASE64=$KEYSTORE_BASE64
KAFKA_SSL_TRUSTSTORE_PASSWORD=changeit
KAFKA_SSL_KEYSTORE_PASSWORD=changeit
```

**Option B: Ververica Secrets**

1. Go to Administration → Secrets
2. Create secrets for truststore and keystore files
3. Mount as files in deployment configuration
4. Update Flink job to read from mounted paths

### 6. Start Deployment

1. Click "Start"
2. Monitor in Ververica dashboard:
   - Job status
   - Records processed per second
   - Checkpoints
   - Backpressure indicators

### 7. Monitoring

Ververica provides:
- Real-time job metrics
- Checkpoint history
- Savepoint management
- Log aggregation
- Alerting (on paid tiers)

---

## Frontend Deployment

### Option 1: Vercel (Recommended)

```bash
cd frontend
npm install -g vercel
vercel

# Set environment variables in Vercel dashboard:
# VITE_MAPBOX_TOKEN=pk.xxx
# VITE_API_URL=https://your-backend-api.com
```

### Option 2: Static Hosting

```bash
cd frontend
npm run build

# Deploy dist/ folder to any static host:
# - Netlify
# - GitHub Pages
# - AWS S3 + CloudFront
```

### Option 3: Docker

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

```bash
docker build -t ais-guardian-frontend .
docker run -p 80:80 ais-guardian-frontend
```

---

## Backend API Deployment

### Option 1: Cloud Run / Railway

```bash
cd backend

# Create Dockerfile
cat > Dockerfile << 'EOF'
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
EOF

# Deploy to Railway
railway up

# Or Google Cloud Run
gcloud run deploy ais-guardian-api --source .
```

### Option 2: Docker Compose (Self-Hosted)

```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - KAFKA_BOOTSTRAP_SERVERS=kafka-xxx.aivencloud.com:12345
      - KAFKA_SSL_CA_CERT=/certs/ca.pem
      - KAFKA_SSL_CERT=/certs/service.cert
      - KAFKA_SSL_KEY=/certs/service.key
    volumes:
      - ./certs:/certs:ro
```

---

## Ingestion Service Deployment

The ingestion service needs to run continuously. Options:

### Option 1: Systemd Service (Linux)

```ini
# /etc/systemd/system/ais-ingestion.service
[Unit]
Description=AIS Guardian Ingestion
After=network.target

[Service]
Type=simple
User=ais
WorkingDirectory=/opt/ais-guardian
Environment="AISSTREAM_API_KEY=xxx"
Environment="KAFKA_BOOTSTRAP_SERVERS=xxx"
Environment="KAFKA_SSL_CA_CERT=/opt/ais-guardian/ca.pem"
Environment="KAFKA_SSL_CERT=/opt/ais-guardian/service.cert"
Environment="KAFKA_SSL_KEY=/opt/ais-guardian/service.key"
ExecStart=/opt/ais-guardian/ingestion/venv/bin/python ingestion/ais_connector.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable ais-ingestion
sudo systemctl start ais-ingestion
```

### Option 2: Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY ingestion/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ingestion/ ./ingestion/
COPY .env .
COPY ca.pem service.cert service.key ./
CMD ["python", "ingestion/ais_connector.py"]
```

### Option 3: Cloud Functions (Scheduled)

Not recommended - the ingestion needs persistent WebSocket connection.

---

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `AISSTREAM_API_KEY` | AISStream.io API key | Yes |
| `KAFKA_BOOTSTRAP_SERVERS` | Aiven Kafka connection string | Yes |
| `KAFKA_SSL_CA_CERT` | Path to CA certificate | Yes |
| `KAFKA_SSL_CERT` | Path to client certificate | Yes |
| `KAFKA_SSL_KEY` | Path to client key | Yes |
| `KAFKA_SSL_TRUSTSTORE_LOCATION` | Path to Java truststore (Flink) | For Flink |
| `KAFKA_SSL_TRUSTSTORE_PASSWORD` | Truststore password | For Flink |
| `KAFKA_SSL_KEYSTORE_LOCATION` | Path to Java keystore (Flink) | For Flink |
| `KAFKA_SSL_KEYSTORE_PASSWORD` | Keystore password | For Flink |
| `VITE_MAPBOX_TOKEN` | Mapbox access token | Yes |

---

## Monitoring

### Aiven Console
- Messages in/out per second
- Consumer lag
- Topic size
- Connection metrics

### Ververica Dashboard
- Records processed per second
- Checkpoint duration and size
- Backpressure indicators
- Task manager metrics

### Application Logs

Local:
```bash
tail -f /tmp/aisguardian/*.log
```

Docker:
```bash
docker logs -f ais-ingestion
docker logs -f ais-backend
```

---

## Troubleshooting

### Connection refused to Kafka
- Check Aiven service is "Running"
- Verify SSL certificates are correct
- Check bootstrap servers URL

### Flink job fails to start
- Run `./scripts/setup-ssl.sh` to create keystores
- Verify Java 11+ is installed
- Check environment variables are set

### No vessels appearing
- Check ingestion logs for "Progress" messages
- Verify AISStream API key is valid
- Check Kafka topics have messages (Aiven Console → Topics)

### Backend API errors
- Check SSL certificate paths
- Verify Kafka topics exist
- Review `/tmp/aisguardian/api.log`
