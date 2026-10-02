#!/usr/bin/env bash
# Static contract for the Yecao -> TX WireGuard boundary.
#
# The Yecao application runtime (business backend, frontend, Keycloak and its PostgreSQL) is retired:
# that host now runs the AI review service plus the shared observability stack. The only
# Yecao-owned WireGuard endpoints are the ai-service listener and the two observability listeners
# the TX control plane dials (Grafana for the public monitor route, Loki for the TX log shipper).
# WireGuard itself is unchanged; this contract pins what still crosses it.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_COMPOSE="$ROOT/deploy/docker-compose.prod.yml"

python3 - "$RUNTIME_COMPOSE" <<'PY'
import re
import sys
from pathlib import Path

runtime_path, = sys.argv[1:]
runtime = Path(runtime_path).read_text(encoding="utf-8")

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
assert '"10.20.0.2:8089:8080"' in runtime, "ai-service must keep its WireGuard bind for the TX /api/ai/ route"

for retired in ("postgres", "keycloak", "wotb-backend", "wotb-frontend", "parser-worker", "minio", "rabbitmq"):
    assert not re.search(rf"(?m)^  {retired}:\s*$", runtime), \
        f"retired Yecao application service is still declared: {retired}"

# Replay parsing runs in the browser: no broker or object-store endpoint may cross WireGuard.
assert not re.search(r"(?i)rabbitmq|minio", runtime), "retired replay infrastructure is still referenced"

print("Yecao WireGuard boundary contract OK (WireGuard/loopback binds only, Grafana+Loki+ai-service enumerated)")
PY
