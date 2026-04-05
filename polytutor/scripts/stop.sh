#!/usr/bin/env bash
# scripts/stop.sh — stop the PolyTutor server
pkill -f "uvicorn app.main:app" || true
echo "PolyTutor server stopped."
