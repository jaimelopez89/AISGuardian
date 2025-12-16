#!/bin/bash
# Convert Aiven PEM certificates to Java KeyStores for Flink/Kafka

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Certificate files
CA_CERT="$PROJECT_DIR/ca.pem"
CLIENT_CERT="$PROJECT_DIR/service.cert"
CLIENT_KEY="$PROJECT_DIR/service.key"

# Output keystores
TRUSTSTORE="$PROJECT_DIR/truststore.jks"
KEYSTORE="$PROJECT_DIR/keystore.p12"

# Passwords (can be changed, but must match in Flink config)
TRUSTSTORE_PASSWORD="changeit"
KEYSTORE_PASSWORD="changeit"

echo "Converting Aiven certificates to Java KeyStores..."
echo "Project directory: $PROJECT_DIR"

# Check if source files exist
if [[ ! -f "$CA_CERT" ]]; then
    echo "Error: CA certificate not found at $CA_CERT"
    exit 1
fi

if [[ ! -f "$CLIENT_CERT" ]]; then
    echo "Error: Client certificate not found at $CLIENT_CERT"
    exit 1
fi

if [[ ! -f "$CLIENT_KEY" ]]; then
    echo "Error: Client key not found at $CLIENT_KEY"
    exit 1
fi

# Remove old keystores if they exist
rm -f "$TRUSTSTORE" "$KEYSTORE"

# Create truststore from CA certificate
echo "Creating truststore from CA certificate..."
keytool -importcert \
    -file "$CA_CERT" \
    -alias aiven-ca \
    -keystore "$TRUSTSTORE" \
    -storepass "$TRUSTSTORE_PASSWORD" \
    -storetype JKS \
    -noprompt

echo "Truststore created: $TRUSTSTORE"

# Create PKCS12 keystore from client cert and key
echo "Creating keystore from client certificate and key..."
openssl pkcs12 -export \
    -in "$CLIENT_CERT" \
    -inkey "$CLIENT_KEY" \
    -out "$KEYSTORE" \
    -name aiven-client \
    -password "pass:$KEYSTORE_PASSWORD"

echo "Keystore created: $KEYSTORE"

# Verify keystores
echo ""
echo "Verifying keystores..."
echo "Truststore contents:"
keytool -list -keystore "$TRUSTSTORE" -storepass "$TRUSTSTORE_PASSWORD" | head -5

echo ""
echo "Keystore contents:"
keytool -list -keystore "$KEYSTORE" -storepass "$KEYSTORE_PASSWORD" -storetype PKCS12 | head -5

echo ""
echo "SSL setup complete!"
echo ""
echo "Set these environment variables before running Flink:"
echo "  export KAFKA_SSL_TRUSTSTORE_LOCATION=$TRUSTSTORE"
echo "  export KAFKA_SSL_TRUSTSTORE_PASSWORD=$TRUSTSTORE_PASSWORD"
echo "  export KAFKA_SSL_KEYSTORE_LOCATION=$KEYSTORE"
echo "  export KAFKA_SSL_KEYSTORE_PASSWORD=$KEYSTORE_PASSWORD"
