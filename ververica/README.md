# Deploying AIS Guardian on Ververica Cloud

This guide explains how to deploy the AIS Guardian Flink job on Ververica Cloud with Aiven Kafka.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  AIS Ingestion  │────▶│   Aiven Kafka    │────▶│ Ververica Cloud │
│   (Python)      │     │   (Managed)      │     │  (Flink 1.18)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                │                         │
                                │ alerts topic            │
                                ▼                         │
                        ┌──────────────────┐              │
                        │  Backend API     │◀─────────────┘
                        │  (FastAPI)       │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │    Frontend      │
                        │    (React)       │
                        └──────────────────┘
```

## Prerequisites

1. **Ververica Cloud Account**: Sign up at [ververica.cloud](https://www.ververica.cloud/)
2. **Aiven Kafka**: Your existing Aiven Kafka cluster with SSL certificates
3. **Java 11** and **Maven 3.6+** for building

## Step 1: Build the Ververica JAR

Build a smaller JAR without embedded Flink dependencies:

```bash
cd flink-jobs
mvn clean package -Pververica -DskipTests
```

This creates: `target/ais-guardian-ververica.jar` (~15MB instead of ~80MB)

## Step 2: Prepare SSL Certificates

If you haven't already, convert Aiven's PEM certificates to Java KeyStores:

```bash
# From the project root
./scripts/setup-ssl.sh
```

This creates:
- `truststore.jks` - Contains Aiven CA certificate
- `keystore.p12` - Contains your client certificate and key

## Step 3: Set Up Ververica Cloud

### 3.1 Create a Namespace

1. Log into [Ververica Cloud Console](https://cloud.ververica.com/)
2. Create a new namespace (e.g., `ais-guardian`)

### 3.2 Create Secrets

Create two secrets in your namespace:

**Secret 1: `aiven-kafka-credentials`** (Key-Value type)

| Key | Value |
|-----|-------|
| `bootstrap-servers` | `kafka-xxx.aivencloud.com:28739` |
| `truststore-password` | `changeit` |
| `keystore-password` | `changeit` |

**Secret 2: `aiven-kafka-ssl-certs`** (Files type)

Upload these files:
- `truststore.jks`
- `keystore.p12`

### 3.3 Upload the JAR

1. Go to **Artifacts** in your namespace
2. Click **Upload Artifact**
3. Upload `ais-guardian-ververica.jar`
4. Name it `ais-guardian-ververica.jar` with version `1`

## Step 4: Create the Deployment

### Option A: Using the UI

1. Go to **Deployments** → **Create Deployment**
2. Configure:
   - **Name**: `ais-guardian`
   - **Artifact**: Select your uploaded JAR
   - **Entry Class**: `com.aiswatchdog.AISWatchdogJob`
   - **Parallelism**: `2`
   - **Flink Version**: `1.18`

3. Add environment variables:
   ```
   KAFKA_BOOTSTRAP_SERVERS = ${secret:aiven-kafka-credentials:bootstrap-servers}
   KAFKA_SSL_TRUSTSTORE_LOCATION = /opt/flink/secrets/truststore.jks
   KAFKA_SSL_TRUSTSTORE_PASSWORD = ${secret:aiven-kafka-credentials:truststore-password}
   KAFKA_SSL_KEYSTORE_LOCATION = /opt/flink/secrets/keystore.p12
   KAFKA_SSL_KEYSTORE_PASSWORD = ${secret:aiven-kafka-credentials:keystore-password}
   ```

4. Mount the SSL certificate secret:
   - Volume: `aiven-kafka-ssl-certs`
   - Mount path: `/opt/flink/secrets`

5. Configure Flink settings:
   ```
   execution.checkpointing.interval: 60s
   state.backend: rocksdb
   ```

### Option B: Using the API/CLI

Apply the deployment configuration:

```bash
# Edit ververica/deployment.yaml with your namespace and settings
vvp deployment create -f ververica/deployment.yaml
```

## Step 5: Start the Job

1. In the Ververica UI, go to your deployment
2. Click **Start**
3. Monitor the job in the Flink Dashboard

## Step 6: Update Your Local Setup

Your local ingestion and backend still run locally, but now Flink runs on Ververica:

```bash
# Start only ingestion and backend locally
./start.sh start

# Stop the local Flink job (it's now on Ververica)
pkill -f "ais-watchdog-flink"
```

## Monitoring

### Ververica Dashboard
- Job status, throughput, backpressure
- Checkpoint history
- Exception logs

### Flink Metrics
Key metrics to watch:
- `numRecordsInPerSecond` - Input rate from Kafka
- `numRecordsOutPerSecond` - Alerts generated
- `checkpointDuration` - Checkpoint latency

## Troubleshooting

### Job fails to start
1. Check Ververica logs for SSL errors
2. Verify secrets are correctly mounted
3. Ensure Kafka bootstrap servers are reachable

### No data flowing
1. Verify the `ais-raw` topic has data in Aiven Console
2. Check consumer group offsets
3. Verify Kafka security settings

### SSL Certificate Errors
```
SSL handshake failed
```
- Regenerate certificates with `./scripts/setup-ssl.sh`
- Re-upload to Ververica secrets

## Cost Optimization

Ververica Cloud pricing is based on compute hours. To minimize costs:

1. **Use appropriate parallelism**: Start with 2, increase if needed
2. **Right-size resources**: 1 CPU / 2GB memory per TaskManager is usually enough
3. **Stop when not in use**: Use the UI or API to stop/start the job

## Comparison: Local vs Ververica

| Aspect | Local | Ververica Cloud |
|--------|-------|-----------------|
| Setup | Simple, one command | Requires secret/artifact setup |
| Cost | Free (your machine) | Pay per compute hour |
| Scaling | Limited by machine | Auto-scaling available |
| Monitoring | Basic logs | Full Flink dashboard |
| Reliability | Depends on machine | HA, automatic restarts |
| Checkpoints | Local filesystem | S3/GCS (durable) |

## Next Steps

- Set up **alerting** in Ververica for job failures
- Configure **auto-scaling** based on Kafka lag
- Add **savepoints** for zero-downtime upgrades
