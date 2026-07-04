#!/bin/bash
# SourceIQ — Launch Script
# Usage: ANTHROPIC_API_KEY=sk-ant-... ./start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load BCG proxy certificate for SSL
CERT_FILE="$TMPDIR/all-certs.pem"
if [ ! -f "$CERT_FILE" ]; then
  echo "Exporting certificates..."
  security export -t certs -f pemseq -k /Library/Keychains/System.keychain 2>/dev/null > "$CERT_FILE" || true
  security export -t certs -f pemseq -k ~/Library/Keychains/login.keychain-db 2>/dev/null >> "$CERT_FILE" || true
fi

# Load .env.local if it exists
if [ -f "$SCRIPT_DIR/.env.local" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env.local" | xargs)
fi

# Check API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo ""
  echo "⚠️  ANTHROPIC_API_KEY is not set."
  echo "   Run: ANTHROPIC_API_KEY=sk-ant-api03-... ./start.sh"
  echo ""
  exit 1
fi

echo ""
echo "🚀 Starting SourceIQ on http://localhost:3000"
echo ""

export NODE_EXTRA_CA_CERTS="$CERT_FILE"
node node_modules/next/dist/bin/next dev
