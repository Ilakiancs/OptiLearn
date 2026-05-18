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
DB_PATH="${DB_PATH:-./data/optilearn.db}"

# shellcheck disable=SC1091
source .venv/bin/activate

# ── First-install: pre-create admin teacher account ───────────────────────────
# If the database doesn't exist yet (or has no teachers), prompt the system
# admin to set up the first teacher account before the server starts.
# This avoids having to visit /setup in a browser on a headless/kiosk install.
_needs_setup=false
if [ ! -f "$DB_PATH" ]; then
    _needs_setup=true
else
    _count=$(python3 - <<'PYEOF'
import sqlite3, sys
try:
    conn = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else "./data/optilearn.db")
    n = conn.execute("SELECT COUNT(*) FROM teachers WHERE is_active=1").fetchone()[0]
    print(n)
except Exception:
    print(0)
PYEOF
    )
    [ "${_count:-0}" -eq 0 ] && _needs_setup=true
fi

if [ "$_needs_setup" = "true" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  OptiLearn — First-time setup"
    echo "  Create the admin teacher account"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    read -rp "  Display name  (e.g. Ms. Fatima): " _display_name
    while [ -z "$_display_name" ]; do
        echo "  Display name cannot be empty."
        read -rp "  Display name: " _display_name
    done

    read -rp "  Username      (letters/numbers/dots, min 3): " _username
    while [ -z "$_username" ]; do
        echo "  Username cannot be empty."
        read -rp "  Username: " _username
    done

    read -rp "  Email         (optional, press Enter to skip): " _email

    while true; do
        read -rsp "  Password      (min 6 chars): " _password
        echo ""
        if [ ${#_password} -lt 6 ]; then
            echo "  Password must be at least 6 characters."
            continue
        fi
        read -rsp "  Confirm password: " _password2
        echo ""
        if [ "$_password" != "$_password2" ]; then
            echo "  Passwords do not match, try again."
            continue
        fi
        break
    done

    echo ""
    echo "  Creating admin account..."
    python3 - <<PYEOF
import sys, asyncio, os
sys.path.insert(0, '.')
os.chdir(os.path.dirname(os.path.abspath('$0')) + '/..')

async def main():
    from app.services import db as database
    from app.core.config import settings
    import bcrypt

    await database.init_db()

    # Check again in case of race
    count = await database.count_teachers()
    if count > 0:
        print("  Account already exists — skipping.")
        return

    pw_hash = bcrypt.hashpw("${_password}".encode(), bcrypt.gensalt()).decode()
    teacher = await database.create_teacher(
        username="${_username}",
        password_hash=pw_hash,
        display_name="${_display_name}",
        is_admin=True,
        initial_password="${_password}",
        email="${_email}" or None,
    )
    print(f"  Admin account created: {teacher['display_name']} (@{teacher['username']})")

asyncio.run(main())
PYEOF

    echo ""
    echo "  Setup complete. Starting server..."
    echo ""
fi
# ──────────────────────────────────────────────────────────────────────────────

echo "Starting OptiLearn on http://$HOST:$PORT ..."
uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
