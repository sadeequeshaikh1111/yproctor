#!/usr/bin/env bash
# Generates one self-signed certificate covering localhost + a LAN IP,
# used by BOTH the backend (uvicorn --ssl-keyfile/--ssl-certfile) and the
# frontend (vite reads certs/cert.pem + certs/key.pem automatically).
#
# Usage:
#   ./generate-certs.sh 192.168.1.12
#
# If you omit the IP, the script tries to detect it automatically.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SCRIPT_DIR/certs"
mkdir -p "$CERT_DIR"

LAN_IP="${1:-}"
if [ -z "$LAN_IP" ]; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$LAN_IP" ]; then
  echo "Could not auto-detect a LAN IP. Pass it explicitly:"
  echo "  ./generate-certs.sh 192.168.1.12"
  exit 1
fi

echo "Generating self-signed certificate for: localhost, 127.0.0.1, $LAN_IP"

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -subj "/CN=yproctor-dev" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$LAN_IP"

echo ""
echo "Done. Certs written to $CERT_DIR/{cert.pem,key.pem}"
echo ""
echo "Next steps:"
echo "  1. Backend:  uvicorn app.main:app --host 0.0.0.0 --port 8000 \\"
echo "                 --ssl-keyfile ../certs/key.pem --ssl-certfile ../certs/cert.pem"
echo "  2. Frontend: npm run dev -- --host   (vite.config.ts auto-detects the certs)"
echo "  3. On your phone, first visit https://$LAN_IP:8000/ and accept the certificate"
echo "     warning, THEN open https://$LAN_IP:5173/login"
