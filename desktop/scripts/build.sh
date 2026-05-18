#!/usr/bin/env bash
# desktop/scripts/build.sh — build OptiLearn desktop app for Windows and/or Mac
#
# Usage (run from desktop/ directory):
#   ./scripts/build.sh          — build for current platform
#   ./scripts/build.sh --win    — build Windows installer only
#   ./scripts/build.sh --mac    — build Mac DMG only
#   ./scripts/build.sh --all    — build both (requires Mac with Wine or CI)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPTILEARN_DIR="$(cd "$DESKTOP_DIR/../optilearn" && pwd)"

cd "$DESKTOP_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OptiLearn Desktop Builder"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: Build the React frontend ─────────────────────────────────────────
echo "▶ Building frontend..."
cd "$OPTILEARN_DIR/frontend"
if [ ! -d node_modules ]; then
    npm install
fi
npm run build
echo "  ✓ Frontend built → optilearn/frontend/dist/"
cd "$DESKTOP_DIR"

# ── Step 2: Bundle portable Python ────────────────────────────────────────────
echo ""
echo "▶ Bundling Python runtime..."
python3 "$DESKTOP_DIR/scripts/bundle_python.py" "$OPTILEARN_DIR" "$DESKTOP_DIR/python-runtime"
echo "  ✓ Python runtime bundled → desktop/python-runtime/"

# ── Step 3: Install Electron deps ─────────────────────────────────────────────
echo ""
echo "▶ Installing Electron dependencies..."
npm install
echo "  ✓ node_modules ready"

# ── Step 4: Copy and generate icon assets ─────────────────────────────────────
echo ""
echo "▶ Copying icons..."
if [ -f "$OPTILEARN_DIR/optilearn.ico" ]; then
    cp "$OPTILEARN_DIR/optilearn.ico" "$DESKTOP_DIR/assets/icon.ico"
fi

# Generate PNG using Pillow (already in the venv — no extra dep needed)
_VENV_PY="$OPTILEARN_DIR/.venv/bin/python3"
_ICO="$DESKTOP_DIR/assets/icon.ico"
_PNG="$DESKTOP_DIR/assets/icon.png"
_TRAY="$DESKTOP_DIR/assets/icon-tray.png"
if [ -f "$_ICO" ] && [ ! -f "$_PNG" ]; then
    "$_VENV_PY" -c "
from PIL import Image
img = Image.open('$_ICO')
img.save('$_PNG')
img.resize((22,22), Image.LANCZOS).save('$_TRAY')
print('  Icons generated via Pillow')
" 2>/dev/null || true
fi

# Try imagemagick as a fallback/supplement
if command -v convert &>/dev/null && [ -f "$DESKTOP_DIR/assets/icon.ico" ]; then
    [ ! -f "$DESKTOP_DIR/assets/icon.png" ] && \
        convert "$DESKTOP_DIR/assets/icon.ico[0]" -resize 512x512 "$DESKTOP_DIR/assets/icon.png" 2>/dev/null || true
    [ ! -f "$DESKTOP_DIR/assets/icon-tray.png" ] && \
        convert "$DESKTOP_DIR/assets/icon.ico[0]" -resize 22x22 "$DESKTOP_DIR/assets/icon-tray.png" 2>/dev/null || true
    # macOS icns via iconutil
    if command -v iconutil &>/dev/null && [ ! -f "$DESKTOP_DIR/assets/icon.icns" ]; then
        ICONSET="$DESKTOP_DIR/assets/icon.iconset"
        mkdir -p "$ICONSET"
        for SIZE in 16 32 64 128 256 512; do
            convert "$DESKTOP_DIR/assets/icon.ico[0]" -resize "${SIZE}x${SIZE}" \
                "$ICONSET/icon_${SIZE}x${SIZE}.png" 2>/dev/null || true
            convert "$DESKTOP_DIR/assets/icon.ico[0]" -resize "$((SIZE*2))x$((SIZE*2))" \
                "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" 2>/dev/null || true
        done
        iconutil -c icns "$ICONSET" -o "$DESKTOP_DIR/assets/icon.icns" 2>/dev/null || true
        rm -rf "$ICONSET"
    fi
fi
echo "  ✓ Icons ready"

# ── Step 5: Ensure 'python' on PATH points to a compatible version ────────────
# electron-builder's dmg-builder vendor scripts use 'python' to build the DMG.
# Homebrew Python (all versions) is linked against Homebrew libexpat which lacks
# the _XML_SetAllocTrackerActivationThreshold symbol expected by macOS system
# libexpat.1.dylib — causing an ImportError in dmg-builder's plistlib usage.
# macOS system Python (/usr/bin/python3) is linked against the correct system
# libexpat so it must be preferred for the DMG build step.
_TMP_BIN="$DESKTOP_DIR/.tmp-bin"
mkdir -p "$_TMP_BIN"

# Prefer system Python (correct libexpat linkage) over Homebrew Python
_COMPAT_PYTHON=""
for _P in /usr/bin/python3 /usr/bin/python; do
    [ -x "$_P" ] && _COMPAT_PYTHON="$_P" && break
done
# Fall back to Homebrew only if system Python is genuinely absent
if [ -z "$_COMPAT_PYTHON" ]; then
    for _V in python3.11 python3.12 python3.13 python3; do
        if command -v "$_V" &>/dev/null; then
            _COMPAT_PYTHON="$(command -v "$_V")"
            break
        fi
    done
fi
_COMPAT_PYTHON="${_COMPAT_PYTHON:-python3}"

ln -sf "$_COMPAT_PYTHON" "$_TMP_BIN/python"
ln -sf "$_COMPAT_PYTHON" "$_TMP_BIN/python3"
export PATH="$_TMP_BIN:$PATH"
export PYTHON_PATH="$_COMPAT_PYTHON"
echo "  Using Python for build: $("$_COMPAT_PYTHON" --version 2>&1 || echo "$_COMPAT_PYTHON")"

# Cleanup trap — remove temp bin regardless of success/failure
trap 'rm -rf "$_TMP_BIN"' EXIT

# ── Step 6: Run electron-builder ──────────────────────────────────────────────
echo ""
TARGET="${1:---mac}"
case "$TARGET" in
    --win) echo "▶ Building Windows installer..."; npm run build:win ;;
    --mac) echo "▶ Building macOS DMG...";         npm run build:mac ;;
    --all) echo "▶ Building all platforms...";     npm run build:all ;;
    *)     echo "▶ Building for current platform..."; npm run build:mac ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Build complete → desktop/dist-electron/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
