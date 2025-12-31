#!/bin/bash
# Encode SSL certificates as base64 for Railway environment variables
# Usage: ./scripts/encode-certs.sh

echo "=== Base64 Encoded Certificates for Railway ==="
echo ""
echo "Copy these values to Railway environment variables:"
echo ""

if [ -f "ca.pem" ]; then
    echo "KAFKA_SSL_CA_CERT_BASE64:"
    base64 -i ca.pem | tr -d '\n'
    echo ""
    echo ""
else
    echo "ERROR: ca.pem not found"
fi

if [ -f "service.cert" ]; then
    echo "KAFKA_SSL_CERT_BASE64:"
    base64 -i service.cert | tr -d '\n'
    echo ""
    echo ""
else
    echo "ERROR: service.cert not found"
fi

if [ -f "service.key" ]; then
    echo "KAFKA_SSL_KEY_BASE64:"
    base64 -i service.key | tr -d '\n'
    echo ""
    echo ""
else
    echo "ERROR: service.key not found"
fi

echo "=== Done ==="
