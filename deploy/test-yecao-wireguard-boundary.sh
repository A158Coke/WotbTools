#!/usr/bin/env bash
# Static contract for the Yecao -> TX WireGuard boundary.
#
# The Yecao application runtime (business backend, frontend, Keycloak and its PostgreSQL) is retired:
# that host now runs the parser execution plane plus the shared observability stack, and it publishes
# no port at all. The only Yecao-owned WireGuard endpoint left belongs to the standalone MinIO
# deployment. WireGuard itself is unchanged; this contract pins what still crosses it.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_COMPOSE="$ROOT/deploy/docker-compose.prod.yml"
MINIO_COMPOSE="$ROOT/deploy/docker-compose.minio.yml"

python3 - "$RUNTIME_COMPOSE" "$MINIO_COMPOSE" <<'PY'
import re
import sys
from pathlib import Path

runtime_path, minio_path = sys.argv[1:]
runtime = Path(runtime_path).read_text(encoding="utf-8")
minio = Path(minio_path).read_text(encoding="utf-8")

# The retired Yecao application services owned the host's public WireGuard binds. A new published
# port on that Compose would silently reintroduce a second public surface next to TX.
assert not re.search(r"(?m)^\s+ports:\s*$", runtime), \
    "the Yecao runtime compose must not publish any port"
for retired in ("postgres", "keycloak", "wotb-backend", "wotb-frontend"):
    assert not re.search(rf"(?m)^  {retired}:\s*$", runtime), \
        f"retired Yecao application service is still declared: {retired}"

# MinIO keeps the single WireGuard endpoint the TX control plane dials; its console stays on loopback.
assert '"10.20.0.2:9000:9000"' in minio, "MinIO must keep its WireGuard API bind"
assert '"127.0.0.1:9001:9001"' in minio, "MinIO console must stay loopback-only"

# Endpoint ownership is per consumer and must not collapse into one shared value: the worker reaches
# the TX broker over WireGuard, but resolves MinIO through Docker service discovery, because the
# container -> host -> published-port hairpin to 10.20.0.2:9000 is not reachable.
match = re.search(r"(?ms)^  parser-worker:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", runtime)
assert match, "parser-worker service is missing"
worker = "\n".join(
    line for line in match.group(0).splitlines() if not line.strip().startswith("#")
)
assert 'RABBITMQ_HOST: "${PARSER_WORKER_RABBITMQ_HOST:-10.20.0.1}"' in worker, \
    "parser-worker must reach the TX broker over WireGuard"
assert 'MINIO_ENDPOINT: "${PARSER_WORKER_MINIO_ENDPOINT:-minio:9000}"' in worker, \
    "parser-worker must resolve MinIO through Docker service discovery"
assert "10.20.0.2" not in worker, \
    "parser-worker must not be handed the control plane's WireGuard MinIO endpoint"

print("Yecao WireGuard boundary contract OK (no published port, MinIO 10.20.0.2:9000, worker on Docker DNS)")
PY
