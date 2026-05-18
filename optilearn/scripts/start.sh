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
HTTPS_PORT="${HTTPS_PORT:-8443}"
SSL_CERT="${SSL_CERT_PATH:-./data/ssl/cert.pem}"
SSL_KEY="${SSL_KEY_PATH:-./data/ssl/key.pem}"

# shellcheck disable=SC1091
source .venv/bin/activate

# Generate the self-signed cert if missing (startup lifespan also does this,
# but we need it before uvicorn launches when using --ssl-* flags).
if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ]; then
    echo "Generating self-signed TLS cert for HTTPS..."
    python - <<'PYEOF'
import sys, pathlib, datetime, ipaddress, socket
try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
except ImportError:
    print("WARNING: cryptography not installed — skipping cert generation")
    sys.exit(0)

import os
cert_path = pathlib.Path(os.environ.get("SSL_CERT_PATH", "./data/ssl/cert.pem"))
key_path  = pathlib.Path(os.environ.get("SSL_KEY_PATH",  "./data/ssl/key.pem"))
if cert_path.exists() and key_path.exists():
    sys.exit(0)

san_ips = {ipaddress.IPv4Address("127.0.0.1")}
san_dns = {"localhost"}
try:
    hn = socket.gethostname()
    san_dns.add(hn)
    for info in socket.getaddrinfo(hn, None):
        try: san_ips.add(ipaddress.IPv4Address(info[4][0]))
        except Exception: pass
except Exception: pass
try:
    import psutil
    for addrs in psutil.net_if_addrs().values():
        for a in addrs:
            if a.family == socket.AF_INET:
                try: san_ips.add(ipaddress.IPv4Address(a.address))
                except Exception: pass
except Exception: pass

cert_path.parent.mkdir(parents=True, exist_ok=True)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "OptiLearn")])
cert = (
    x509.CertificateBuilder()
    .subject_name(subject).issuer_name(subject)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.datetime.utcnow())
    .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
    .add_extension(
        x509.SubjectAlternativeName(
            [x509.DNSName(d) for d in san_dns] + [x509.IPAddress(ip) for ip in san_ips]
        ), critical=False,
    )
    .sign(key, hashes.SHA256())
)
key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
print(f"Generated self-signed TLS cert -> {cert_path}")
PYEOF
fi

if [ -f "$SSL_CERT" ] && [ -f "$SSL_KEY" ]; then
    echo "Starting OptiLearn on https://$HOST:$HTTPS_PORT ..."
    uvicorn app.main:app \
        --host "$HOST" \
        --port "$HTTPS_PORT" \
        --ssl-certfile "$SSL_CERT" \
        --ssl-keyfile "$SSL_KEY" \
        --reload
else
    echo "Starting OptiLearn on http://$HOST:$PORT (no TLS cert) ..."
    uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
fi
