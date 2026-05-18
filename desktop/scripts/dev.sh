#!/usr/bin/env bash
# desktop/scripts/dev.sh — run the desktop app in dev mode (uses optilearn/.venv directly)
#
# Usage (from desktop/ directory):
#   ./scripts/dev.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPTILEARN_DIR="$(cd "$DESKTOP_DIR/../optilearn" && pwd)"

cd "$DESKTOP_DIR"

if [ ! -d node_modules ]; then
    echo "Installing Electron dependencies..."
    npm install
fi

echo "Starting OptiLearn desktop (dev mode)..."
echo "  optilearn dir: $OPTILEARN_DIR"
echo "  Uses .venv from optilearn/ directly"
echo ""

npx electron .
