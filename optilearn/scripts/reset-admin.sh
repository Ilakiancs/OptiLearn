#!/usr/bin/env bash
# scripts/reset-admin.sh — reset a forgotten admin password or add a new admin teacher.
#
# Usage:
#   ./scripts/reset-admin.sh            — interactive: choose reset or create
#   ./scripts/reset-admin.sh --nuke-db  — DELETE the entire database (full factory reset)
#
# Run from the optilearn/ directory.
set -euo pipefail

if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

DB_PATH="${DB_PATH:-./data/optilearn.db}"

# shellcheck disable=SC1091
source .venv/bin/activate

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OptiLearn — Admin Recovery"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Full factory reset ────────────────────────────────────────────────────────
if [ "${1:-}" = "--nuke-db" ]; then
    echo "  WARNING: This will permanently delete ALL data including"
    echo "  students, sessions, materials, quiz results, and teachers."
    echo ""
    read -rp "  Type DELETE to confirm: " _confirm
    if [ "$_confirm" != "DELETE" ]; then
        echo "  Cancelled."
        exit 0
    fi
    rm -f "$DB_PATH" "${DB_PATH}-shm" "${DB_PATH}-wal"
    echo ""
    echo "  Database deleted. Run ./scripts/start.sh to set up fresh."
    exit 0
fi

# ── Check DB exists ───────────────────────────────────────────────────────────
if [ ! -f "$DB_PATH" ]; then
    echo "  No database found at $DB_PATH"
    echo "  Run ./scripts/start.sh to create one."
    exit 1
fi

# ── List current admin teachers ───────────────────────────────────────────────
echo "  Current admin teachers:"
python3 - "$DB_PATH" <<'PYEOF'
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
rows = conn.execute(
    "SELECT username, display_name, email, last_login FROM teachers WHERE is_active=1 AND is_admin=1 ORDER BY created_at"
).fetchall()
if not rows:
    print("    (none — database may be empty)")
else:
    for r in rows:
        email = f" <{r[2]}>" if r[2] else ""
        login = f"  last login: {r[3]}" if r[3] else "  never logged in"
        print(f"    @{r[0]} — {r[1]}{email}{login}")
conn.close()
PYEOF

echo ""
echo "  What would you like to do?"
echo "  1) Reset password for an existing admin"
echo "  2) Create a new admin teacher"
echo "  3) Cancel"
echo ""
read -rp "  Choice [1/2/3]: " _choice

case "$_choice" in
1)
    # ── Reset password ────────────────────────────────────────────────────────
    read -rp "  Username to reset: " _username
    while true; do
        read -rsp "  New password (min 6 chars): " _password
        echo ""
        if [ ${#_password} -lt 6 ]; then
            echo "  Password must be at least 6 characters."
            continue
        fi
        read -rsp "  Confirm new password: " _password2
        echo ""
        if [ "$_password" != "$_password2" ]; then
            echo "  Passwords do not match, try again."
            continue
        fi
        break
    done

    python3 - "$DB_PATH" "$_username" "$_password" <<'PYEOF'
import sqlite3, sys, bcrypt
db_path, username, password = sys.argv[1], sys.argv[2], sys.argv[3]
conn = sqlite3.connect(db_path)
row = conn.execute(
    "SELECT id, display_name FROM teachers WHERE lower(username)=lower(?) AND is_active=1",
    (username,)
).fetchone()
if not row:
    print(f"  Error: no active teacher with username '{username}'")
    sys.exit(1)
pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
conn.execute(
    "UPDATE teachers SET password_hash=?, original_password_hash=?, initial_password=? WHERE id=?",
    (pw_hash, pw_hash, password, row[0])
)
conn.commit()
conn.close()
print(f"  Password reset for {row[1]} (@{username})")
PYEOF
    ;;

2)
    # ── Create new admin ──────────────────────────────────────────────────────
    read -rp "  Display name (e.g. Ms. Fatima): " _display_name
    while [ -z "$_display_name" ]; do
        read -rp "  Display name cannot be empty: " _display_name
    done

    read -rp "  Username (letters/numbers/dots, min 3): " _username
    while [ -z "$_username" ]; do
        read -rp "  Username cannot be empty: " _username
    done

    read -rp "  Email (optional, press Enter to skip): " _email

    while true; do
        read -rsp "  Password (min 6 chars): " _password
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

    python3 - "$DB_PATH" "$_username" "$_password" "$_display_name" "${_email:-}" <<'PYEOF'
import sqlite3, sys, bcrypt, uuid
from datetime import datetime
db_path, username, password, display_name, email = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
conn = sqlite3.connect(db_path)
existing = conn.execute(
    "SELECT id FROM teachers WHERE lower(username)=lower(?)", (username,)
).fetchone()
if existing:
    print(f"  Error: username '{username}' is already taken.")
    sys.exit(1)
pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
teacher_id = str(uuid.uuid4())
conn.execute(
    """INSERT INTO teachers (id, username, password_hash, display_name, email, is_admin,
       original_password_hash, initial_password, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 1)""",
    (teacher_id, username.strip().lower(), pw_hash,
     display_name.strip(), email.strip().lower() or None,
     pw_hash, password, datetime.utcnow().isoformat())
)
conn.commit()
conn.close()
print(f"  Admin account created: {display_name} (@{username})")
PYEOF
    ;;

3|*)
    echo "  Cancelled."
    exit 0
    ;;
esac

echo ""
echo "  Done. You can now log in at http://localhost:8000"
echo ""
