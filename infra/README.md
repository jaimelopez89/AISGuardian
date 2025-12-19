# Local Infrastructure (Alternative)

This folder contains Docker Compose configuration for running Kafka locally.

## When to Use This

**You probably don't need this.** The default setup uses **Aiven Kafka** (cloud), which is:
- Easier to set up (no Docker required)
- More realistic for the competition
- Always available

Use this local setup only if:
- You want to work completely offline
- You want to test without using Aiven quota
- You're debugging Kafka-specific issues

## Quick Start (Local Kafka)

```bash
cd infra
docker-compose up -d

# Wait for services to be healthy (~30 seconds)
docker-compose ps

# View Kafka UI
open http://localhost:8080
```

## Services Provided

| Service | Port | Purpose |
|---------|------|---------|
| Kafka | 9092 | Message broker |
| Zookeeper | 2181 | Kafka coordination |
| Schema Registry | 8081 | Schema management |
| Kafka REST | 8082 | REST API for Kafka |
| Kafka UI | 8080 | Web interface |

## Using Local Kafka

Update your `.env` file:

```bash
# For local Kafka (no SSL required)
KAFKA_BOOTSTRAP_SERVERS=localhost:9092

# Comment out or remove SSL settings
# KAFKA_SSL_CA_CERT=./ca.pem
# KAFKA_SSL_CERT=./service.cert
# KAFKA_SSL_KEY=./service.key
```

## Stopping

```bash
docker-compose down

# To also remove volumes (data)
docker-compose down -v
```

## Note

The Flink job and ingestion code support both local and Aiven Kafka. SSL is only used when SSL certificate paths are configured in the environment.
