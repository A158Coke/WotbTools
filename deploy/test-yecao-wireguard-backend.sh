#!/usr/bin/env bash
# Static contract for the Yecao -> TX WireGuard backend boundary.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/deploy/docker-compose.prod.yml"
CONTRACT="$ROOT/deploy/tx/yecao-backend-contract.json"

python3 - "$COMPOSE" "$CONTRACT" <<'PY'
import json
import re
import sys
from pathlib import Path

compose_path, contract_path = sys.argv[1:]
text = Path(compose_path).read_text(encoding="utf-8")
match = re.search(r"(?ms)^  wotb-backend:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", text)
if not match:
    raise SystemExit("wotb-backend service is missing")
block = match.group(1)
ports = re.findall(r'^\s*-\s*"([^"]+)"\s*$', block, flags=re.MULTILINE)
assert ports == ["10.20.0.2:8087:8087"], \
    f"backend must publish exactly the WireGuard bind, got {ports!r}"
contract = json.loads(Path(contract_path).read_text(encoding="utf-8"))
assert contract == {
    "service": "wotb-backend",
    "ports": ["10.20.0.2:8087:8087"],
}, f"deployed backend contract drifted: {contract!r}"
print("Yecao backend WireGuard-only bind contract OK")
PY
