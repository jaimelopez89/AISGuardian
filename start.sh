#!/bin/bash
#
# AIS Guardian - Startup Script
# Starts all services for the maritime surveillance system
#
# Prerequisites:
#   - Aiven Kafka SSL certificates (ca.pem, service.cert, service.key)
#   - .env file with configuration
#   - Python venv at ingestion/venv
#   - Java 11 installed
#   - Node.js installed
#
# Usage:
#   ./start.sh          # Start all services
#   ./start.sh stop     # Stop all services
#   ./start.sh status   # Check service status
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Log files
LOG_DIR="/tmp/aisguardian"
mkdir -p "$LOG_DIR"

# Java configuration
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@11}"
export PATH="$JAVA_HOME/bin:$PATH"

# Kafka SSL configuration
export KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS:-$(grep KAFKA_BOOTSTRAP_SERVERS .env 2>/dev/null | cut -d= -f2)}"
export KAFKA_SSL_TRUSTSTORE_LOCATION="$SCRIPT_DIR/truststore.jks"
export KAFKA_SSL_TRUSTSTORE_PASSWORD="changeit"
export KAFKA_SSL_KEYSTORE_LOCATION="$SCRIPT_DIR/keystore.p12"
export KAFKA_SSL_KEYSTORE_PASSWORD="changeit"

print_header() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║           AIS Guardian - Maritime Surveillance            ║"
    echo "║              Baltic Sea Infrastructure Monitor            ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    # Check for .env
    if [[ ! -f ".env" ]]; then
        echo -e "${RED}Error: .env file not found. Copy .env.example and configure.${NC}"
        exit 1
    fi

    # Check for SSL certificates
    if [[ ! -f "ca.pem" ]] || [[ ! -f "service.cert" ]] || [[ ! -f "service.key" ]]; then
        echo -e "${RED}Error: SSL certificates not found. Download from Aiven console.${NC}"
        exit 1
    fi

    # Check for keystores (create if needed)
    if [[ ! -f "truststore.jks" ]] || [[ ! -f "keystore.p12" ]]; then
        echo -e "${YELLOW}Creating Java keystores from PEM certificates...${NC}"
        bash scripts/setup-ssl.sh
    fi

    # Check for Python venv
    if [[ ! -f "ingestion/venv/bin/python" ]]; then
        echo -e "${YELLOW}Creating Python virtual environment...${NC}"
        python3 -m venv ingestion/venv
        ingestion/venv/bin/pip install -r ingestion/requirements.txt
        ingestion/venv/bin/pip install fastapi uvicorn
    fi

    # Check for Node modules
    if [[ ! -d "frontend/node_modules" ]]; then
        echo -e "${YELLOW}Installing frontend dependencies...${NC}"
        cd frontend && npm install && cd ..
    fi

    # Check for Flink JAR
    if [[ ! -f "flink-jobs/target/ais-watchdog-flink-1.0-SNAPSHOT.jar" ]]; then
        echo -e "${YELLOW}Building Flink job...${NC}"
        cd flink-jobs && mvn clean package -q && cd ..
    fi

    echo -e "${GREEN}All prerequisites satisfied.${NC}"
}

start_services() {
    print_header
    check_prerequisites

    echo ""
    echo -e "${YELLOW}Starting services...${NC}"
    echo ""

    # 1. Start AIS Ingestion
    echo -n "  Starting AIS Ingestion... "
    if pgrep -f "ais_connector.py" > /dev/null; then
        echo -e "${YELLOW}already running${NC}"
    else
        ingestion/venv/bin/python ingestion/ais_connector.py > "$LOG_DIR/ingestion.log" 2>&1 &
        sleep 2
        if pgrep -f "ais_connector.py" > /dev/null; then
            echo -e "${GREEN}started${NC}"
        else
            echo -e "${RED}failed${NC}"
        fi
    fi

    # 2. Start Backend API
    echo -n "  Starting Backend API... "
    if pgrep -f "backend/api.py" > /dev/null; then
        echo -e "${YELLOW}already running${NC}"
    else
        ingestion/venv/bin/python backend/api.py > "$LOG_DIR/api.log" 2>&1 &
        sleep 2
        if curl -s "http://localhost:8000/api/stats" > /dev/null 2>&1; then
            echo -e "${GREEN}started${NC}"
        else
            echo -e "${RED}failed${NC}"
        fi
    fi

    # 3. Start Flink Job
    echo -n "  Starting Flink Anomaly Detection... "
    if pgrep -f "ais-watchdog-flink" > /dev/null; then
        echo -e "${YELLOW}already running${NC}"
    else
        java -jar flink-jobs/target/ais-watchdog-flink-1.0-SNAPSHOT.jar > "$LOG_DIR/flink.log" 2>&1 &
        sleep 5
        if pgrep -f "ais-watchdog-flink" > /dev/null; then
            echo -e "${GREEN}started${NC}"
        else
            echo -e "${RED}failed${NC}"
        fi
    fi

    # 4. Start Frontend
    echo -n "  Starting Frontend... "
    if pgrep -f "vite.*frontend" > /dev/null; then
        echo -e "${YELLOW}already running${NC}"
    else
        cd frontend && npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
        cd ..
        sleep 3
        if pgrep -f "vite" > /dev/null; then
            echo -e "${GREEN}started${NC}"
        else
            echo -e "${RED}failed${NC}"
        fi
    fi

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}AIS Guardian is running!${NC}"
    echo ""
    echo -e "  Dashboard:  ${BLUE}http://localhost:5174${NC}"
    echo -e "  API:        ${BLUE}http://localhost:8000/api/stats${NC}"
    echo ""
    echo -e "  Logs:       ${LOG_DIR}/"
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
}

stop_services() {
    echo -e "${YELLOW}Stopping services...${NC}"

    pkill -f "ais_connector.py" 2>/dev/null && echo "  Stopped AIS Ingestion" || true
    pkill -f "backend/api.py" 2>/dev/null && echo "  Stopped Backend API" || true
    pkill -f "ais-watchdog-flink" 2>/dev/null && echo "  Stopped Flink Job" || true
    pkill -f "vite" 2>/dev/null && echo "  Stopped Frontend" || true

    echo -e "${GREEN}All services stopped.${NC}"
}

show_status() {
    print_header
    echo -e "${YELLOW}Service Status:${NC}"
    echo ""

    # AIS Ingestion
    if pgrep -f "ais_connector.py" > /dev/null; then
        echo -e "  AIS Ingestion:    ${GREEN}Running${NC}"
    else
        echo -e "  AIS Ingestion:    ${RED}Stopped${NC}"
    fi

    # Backend API
    if curl -s "http://localhost:8000/api/stats" > /dev/null 2>&1; then
        STATS=$(curl -s "http://localhost:8000/api/stats")
        VESSELS=$(echo "$STATS" | python3 -c "import json,sys; print(json.load(sys.stdin)['total_vessels'])" 2>/dev/null || echo "?")
        ALERTS=$(echo "$STATS" | python3 -c "import json,sys; print(json.load(sys.stdin)['total_alerts'])" 2>/dev/null || echo "?")
        echo -e "  Backend API:      ${GREEN}Running${NC} (${VESSELS} vessels, ${ALERTS} alerts)"
    else
        echo -e "  Backend API:      ${RED}Stopped${NC}"
    fi

    # Flink Job
    if pgrep -f "ais-watchdog-flink" > /dev/null; then
        echo -e "  Flink Detection:  ${GREEN}Running${NC}"
    else
        echo -e "  Flink Detection:  ${RED}Stopped${NC}"
    fi

    # Frontend
    if pgrep -f "vite" > /dev/null; then
        echo -e "  Frontend:         ${GREEN}Running${NC} (http://localhost:5174)"
    else
        echo -e "  Frontend:         ${RED}Stopped${NC}"
    fi

    echo ""
}

# Main command handling
case "${1:-start}" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        sleep 2
        start_services
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
