#!/usr/bin/env bash
# stop.sh — stop the PolyTutor server
pkill -f "uvicorn backend.main:app" || true
echo "PolyTutor server stopped."
