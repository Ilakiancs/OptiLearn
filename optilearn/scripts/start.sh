#!/usr/bin/env bash
# scripts/start.sh — start the OptiLearn server
set -euo pipefail

if [ -f .env ]; then
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

# shellcheck disable=SC1091
source .venv/bin/activate

echo "Starting OptiLearn on http://$HOST:$PORT ..."
uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
