#!/usr/bin/env bash
# Static contract for the Yecao -> TX WireGuard boundary.
#
# The Yecao application runtime (business backend, frontend, Keycloak and its PostgreSQL) is retired:
# that host now runs the parser execution plane plus the shared observability stack. The only
# Yecao-owned WireGuard endpoints are the standalone MinIO deployment and the two observability
# listeners the TX control plane dials (Grafana for the public monitor route, Loki for the TX log
# shipper). WireGuard itself is unchanged; this contract pins what still crosses it.
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

# No service on the Yecao runtime Compose may publish to a public or wildcard
# interface: that would silently reintroduce a second public surface next to TX.
# WireGuard-only binds (10.20.0.2) are the sanctioned cross-host mechanism and
# are enumerated explicitly below.
port_blocks = re.findall(r"(?ms)^\s+ports:\n((?:\s+(?:#.*|-.*\n))*\s+-.*\n)", runtime)
assert port_blocks, "the observability WireGuard binds are missing from the runtime compose"
for block in port_blocks:
    for binding in re.findall(r"-\s+\"([^\"]+)\"", block):
        host_ip = binding.split(":")[0]
        assert host_ip in ("10.20.0.2", "127.0.0.1"), \
            f"Yecao runtime compose publishes a non-WireGuard, non-loopback port: {binding}"

# The two observability listeners TX dials must keep their exact WireGuard binds.
assert '"10.20.0.2:3000:3000"' in runtime, "Grafana must keep its WireGuard bind for the TX monitor route"
assert '"10.20.0.2:3100:3100"' in runtime, "Loki must keep its WireGuard bind for the TX log shipper"

for retired in ("postgres", "keycloak", "wotb-backend", "wotb-frontend"):
    assert not re.search(rf"(?m)^  {retired}:\s*$", runtime), \
        f"retired Yecao application service is still declared: {retired}"

# MinIO keeps its WireGuard endpoint the TX control plane dials; its console stays on loopback.
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

print("Yecao WireGuard boundary contract OK (WireGuard/loopback binds only, Grafana+Loki enumerated, worker on Docker DNS)")
PY
