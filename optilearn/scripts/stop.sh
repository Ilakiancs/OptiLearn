#!/usr/bin/env bash
# scripts/stop.sh — stop the OptiLearn server
pkill -f "uvicorn app.main:app" || true
echo "OptiLearn server stopped."
