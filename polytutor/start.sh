#!/usr/bin/env bash
# start.sh — start the PolyTutor server
set -euo pipefail

# Load .env to read HOST and PORT
if [ -f .env ]; then
    # Export non-comment, non-empty lines
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
else
    echo "WARNING: .env not found — using defaults (HOST=0.0.0.0 PORT=8000)"
    HOST="0.0.0.0"
    PORT="8000"
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

# Activate virtual environment
# shellcheck disable=SC1091
source .venv/bin/activate

echo "Starting PolyTutor on http://$HOST:$PORT ..."
uvicorn backend.main:app --host "$HOST" --port "$PORT" --reload
