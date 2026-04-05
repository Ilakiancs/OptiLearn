#!/usr/bin/env bash
# setup.sh — one-shot installer for PolyTutor
set -euo pipefail

echo "═══════════════════════════════════════"
echo "  PolyTutor Setup"
echo "═══════════════════════════════════════"

# ──────────────────────────────────────────
# 1. Check Python 3.11+
# ──────────────────────────────────────────
echo ""
echo "▶ Checking Python version..."
PYTHON="python3"

if ! command -v "$PYTHON" &>/dev/null; then
    echo "ERROR: 'python3' not found. Please install Python 3.11 or higher."
    exit 1
fi

PYTHON_VERSION=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MAJOR=$("$PYTHON" -c "import sys; print(sys.version_info.major)")
PYTHON_MINOR=$("$PYTHON" -c "import sys; print(sys.version_info.minor)")

if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 11 ]; }; then
    echo "ERROR: Python 3.11+ required. Found Python $PYTHON_VERSION."
    echo "       Download from https://www.python.org/downloads/"
    exit 1
fi

echo "  ✓ Python $PYTHON_VERSION"

# ──────────────────────────────────────────
# 2. Create and activate .venv
# ──────────────────────────────────────────
echo ""
echo "▶ Creating virtual environment..."
"$PYTHON" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
echo "  ✓ .venv created and activated"

# ──────────────────────────────────────────
# 3. Install dependencies
# ──────────────────────────────────────────
echo ""
echo "▶ Installing dependencies (this may take a few minutes)..."
pip install --upgrade pip --quiet
pip install -r requirements.txt
echo "  ✓ Dependencies installed"

# ──────────────────────────────────────────
# 4. Copy .env.example → .env if not present
# ──────────────────────────────────────────
echo ""
echo "▶ Setting up environment file..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  ✓ .env created from .env.example"
    echo "  ⚠ Remember to add your GEMMA_API_KEY to .env"
else
    echo "  ✓ .env already exists — skipping"
fi

# ──────────────────────────────────────────
# 5. Initialise SQLite schema
# ──────────────────────────────────────────
echo ""
echo "▶ Initialising database..."
"$PYTHON" -c "
import asyncio
import sys
sys.path.insert(0, '.')
from backend.db import init_db
asyncio.run(init_db())
print('  ✓ Database schema created')
"

# ──────────────────────────────────────────
# 6. Check curriculum directory
# ──────────────────────────────────────────
echo ""
echo "▶ Checking curriculum files..."
CURRICULUM_DIR="./data/curriculum"
TXT_COUNT=$(find "$CURRICULUM_DIR" -name "*.txt" 2>/dev/null | wc -l | tr -d ' ')

if [ "$TXT_COUNT" -eq 0 ]; then
    echo "  ⚠ WARNING: No .txt files found in $CURRICULUM_DIR"
    echo "    Add curriculum files before building the FAISS index."
    echo "    The server will start but topic retrieval will return empty results."
else
    echo "  ✓ Found $TXT_COUNT curriculum file(s)"
fi

# ──────────────────────────────────────────
# 7. Build FAISS index (skip if already exists)
# ──────────────────────────────────────────
echo ""
echo "▶ Building FAISS index..."
FAISS_INDEX="./data/curriculum.index"

if [ -f "$FAISS_INDEX" ]; then
    echo "  ✓ FAISS index already exists — skipping rebuild"
    echo "    (Delete $FAISS_INDEX and re-run setup.sh to rebuild)"
elif [ "$TXT_COUNT" -eq 0 ]; then
    echo "  ⚠ Skipping FAISS build — no curriculum files found"
else
    "$PYTHON" data/build_index.py
    echo "  ✓ FAISS index built"
fi

# ──────────────────────────────────────────
# Done
# ──────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Setup complete. Edit .env with your"
echo "  GEMMA_API_KEY, then run ./start.sh"
echo "═══════════════════════════════════════"
