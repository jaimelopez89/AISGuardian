# Deploying AIS Guardian on Ververica Cloud

This guide explains how to deploy the AIS Guardian Flink job on [Ververica Cloud](https://www.ververica.com/deployment/managed-service) with Aiven Kafka.

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

Convert Aiven's PEM certificates to Java KeyStores:

```bash
# From the project root
./scripts/setup-ssl.sh
```

This creates:
- `truststore.jks` - Contains Aiven CA certificate
- `keystore.p12` - Contains your client certificate and key

## Step 3: Set Up Ververica Cloud

### 3.1 Create a Workspace

1. Log into [Ververica Cloud Console](https://cloud.ververica.com/)
2. Create a new workspace (e.g., `ais-guardian`)

### 3.2 Upload Artifacts

Upload three files to the **Artifacts** section:

1. **ais-guardian-ververica.jar** - Your Flink application
2. **truststore.jks** - Aiven CA certificate (from setup-ssl.sh)
3. **keystore.p12** - Client certificate and key (from setup-ssl.sh)

To upload:
1. Go to **Artifacts** in your workspace
2. Click **Upload Artifact**
3. Select each file and upload

> **Note**: Artifacts have a 50MB limit. The Ververica JAR is ~15MB which is well under this limit.

## Step 4: Create the Deployment

### 4.1 Create New Deployment

1. Go to **Deployments** → **Create Deployment**
2. Select **JAR** as the deployment type

### 4.2 Configure the Deployment

| Setting | Value |
|---------|-------|
| **Name** | `ais-guardian` |
| **JAR URI** | Select `ais-guardian-ververica.jar` from artifacts |
| **Entry Class** | `com.aiswatchdog.AISWatchdogJob` |
| **Parallelism** | `2` |

### 4.3 Add SSL Certificates as Additional Dependencies

In the **Additional Dependencies** field, select:
- `truststore.jks`
- `keystore.p12`

These files will be available at `/flink/usrlib/` in the Flink containers. The AIS Guardian code automatically detects certificates at these paths.

### 4.4 Configure Program Arguments (Main Args)

In the **Program Arguments** field (sometimes called "Main Args" or "Arguments"), enter:

```
--bootstrap-servers kafka-xxx.aivencloud.com:28739
```

Replace `kafka-xxx.aivencloud.com:28739` with your actual Aiven Kafka bootstrap server.

**All available arguments:**

| Argument | Default | Description |
|----------|---------|-------------|
| `--bootstrap-servers` | localhost:9092 | Aiven Kafka bootstrap servers |
| `--group-id` | ais-watchdog-flink | Kafka consumer group ID |
| `--dark-threshold-minutes` | 10 | Minutes before AIS gap triggers alert |
| `--rendezvous-distance-meters` | 1000 | Distance for ship meeting detection |
| `--rendezvous-duration-minutes` | 5 | Duration for rendezvous alert |

## Step 5: Start the Job

1. Click **Deploy** to create the deployment
2. Click **Start** to run the job
3. Monitor in the Flink Dashboard

## Step 6: Connect Your Local Components

Your local ingestion and backend still run locally, connecting to the same Aiven Kafka:

```bash
# Start ingestion and backend (Flink now runs on Ververica)
./start.sh start

# Stop any local Flink process (no longer needed)
pkill -f "ais-watchdog-flink"
```

The data flow:
1. **Local Ingestion** → writes to `ais-raw` topic on Aiven Kafka
2. **Ververica Flink** → reads from `ais-raw`, writes alerts to `ais-alerts`
3. **Local Backend** → reads from both topics, serves to Frontend
4. **Local Frontend** → displays vessels and alerts

## Managing Services

### Local Services (start.sh)

```bash
# Start all local services
./start.sh start

# Stop all local services
./start.sh stop

# Restart all local services
./start.sh restart

# Check service status
./start.sh status
```

**Note**: When using Ververica Cloud, the local Flink job is not needed. After `./start.sh start`, stop just the local Flink:

```bash
pkill -f "ais-watchdog-flink"
```

### Ververica Cloud Job

**Stop the job:**
1. Go to **Deployments** in Ververica Cloud
2. Find `ais-guardian` deployment
3. Click **Suspend** (pauses job, keeps state) or **Cancel** (stops completely)

**Start/Restart the job:**
1. Go to **Deployments** → `ais-guardian`
2. Click **Start** or **Resume**
3. Choose startup options:
   - **Resume from latest checkpoint** - continues where it left off
   - **Start fresh** - starts from latest Kafka offset

**Tip**: Use **Suspend/Resume** for temporary stops to preserve state. Use **Cancel/Start** for a fresh start.

## Monitoring

### Ververica Dashboard
- Job status and uptime
- Throughput metrics
- Checkpoint history
- Exception logs

### Key Metrics to Watch
- `numRecordsInPerSecond` - Input rate from Kafka
- `numRecordsOutPerSecond` - Alerts generated
- `currentInputWatermark` - Event time progress

## Troubleshooting

### Job fails to start with SSL errors

```
SSL handshake failed
PKIX path building failed
```

**Solutions:**
1. Verify certificates were uploaded correctly as Additional Dependencies
2. Check that `truststore.jks` and `keystore.p12` are valid:
   ```bash
   keytool -list -keystore truststore.jks -storepass changeit
   openssl pkcs12 -info -in keystore.p12 -passin pass:changeit
   ```
3. Regenerate certificates with `./scripts/setup-ssl.sh`

### Job starts but no data flowing

1. Check the `ais-raw` topic has data in Aiven Console
2. Verify the ingestion is running locally: `curl http://localhost:8000/api/stats`
3. Check Kafka bootstrap servers are correct
4. Verify network connectivity (Ververica needs to reach Aiven's public endpoint)

### ClassNotFoundException

The JAR is missing dependencies. Rebuild with:
```bash
mvn clean package -Pververica -DskipTests
```

Ensure you're uploading `ais-guardian-ververica.jar` (not the regular JAR).

## Cost Optimization

Ververica Cloud charges based on compute hours:

1. **Right-size parallelism**: Start with 2, increase only if needed
2. **Use appropriate resources**: Default TaskManager sizing is usually sufficient
3. **Stop when not in use**: Pause the deployment during development

## Local vs Ververica Comparison

| Aspect | Local | Ververica Cloud |
|--------|-------|-----------------|
| Setup | One command | Upload artifacts + configure |
| Cost | Free (your machine) | Pay per compute hour |
| Scaling | Limited by machine | Configurable parallelism |
| Monitoring | Basic logs | Full Flink dashboard |
| Reliability | Depends on machine | HA, automatic restarts |
| Checkpoints | Local filesystem | Managed storage |

## References

- [Ververica Cloud Getting Started](https://docs.ververica.com/managed-service/getting-started/)
- [Apache Kafka Connector](https://docs.ververica.com/connectors-and-formats/built-in-connectors/kafka)
- [Artifact Management](https://docs.ververica.com/vvp/user-guide/application-operations/artifact-management/)
- [Aiven Kafka SSL Setup](https://docs.aiven.io/docs/products/kafka/howto/keystore-truststore)
