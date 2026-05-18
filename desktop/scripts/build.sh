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

# ── Step 4: Copy icon assets ──────────────────────────────────────────────────
echo ""
echo "▶ Copying icons..."
if [ -f "$OPTILEARN_DIR/optilearn.ico" ]; then
    cp "$OPTILEARN_DIR/optilearn.ico" "$DESKTOP_DIR/assets/icon.ico"
fi
# Generate PNG from ico for Mac/Linux tray (requires imagemagick if available)
if command -v convert &>/dev/null && [ -f "$DESKTOP_DIR/assets/icon.ico" ]; then
    convert "$DESKTOP_DIR/assets/icon.ico[0]" -resize 512x512 "$DESKTOP_DIR/assets/icon.png" 2>/dev/null || true
    convert "$DESKTOP_DIR/assets/icon.ico[0]" -resize 22x22 "$DESKTOP_DIR/assets/icon-tray.png" 2>/dev/null || true
    # macOS icns (requires iconutil — macOS only)
    if command -v iconutil &>/dev/null; then
        ICONSET="$DESKTOP_DIR/assets/icon.iconset"
        mkdir -p "$ICONSET"
        for SIZE in 16 32 64 128 256 512; do
            convert "$DESKTOP_DIR/assets/icon.ico[0]" -resize "${SIZE}x${SIZE}" "$ICONSET/icon_${SIZE}x${SIZE}.png" 2>/dev/null || true
            convert "$DESKTOP_DIR/assets/icon.ico[0]" -resize "$((SIZE*2))x$((SIZE*2))" "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" 2>/dev/null || true
        done
        iconutil -c icns "$ICONSET" -o "$DESKTOP_DIR/assets/icon.icns" 2>/dev/null || true
        rm -rf "$ICONSET"
    fi
fi
echo "  ✓ Icons ready"

# ── Step 5: Run electron-builder ──────────────────────────────────────────────
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
