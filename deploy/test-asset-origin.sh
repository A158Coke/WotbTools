#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose="$ROOT/deploy/assets/compose.yaml"
caddyfile="$ROOT/deploy/assets/Caddyfile"
resource="$ROOT/infra/komodo/resources/asset-origin.toml"

[[ -f "$compose" ]] || { echo "missing $compose" >&2; exit 1; }
[[ -f "$caddyfile" ]] || { echo "missing $caddyfile" >&2; exit 1; }
[[ -f "$resource" ]] || { echo "missing $resource" >&2; exit 1; }

compose_json="$(mktemp)"
trap 'rm -f "$compose_json"' EXIT

docker compose --project-directory "$ROOT/deploy/assets" -f "$compose" config --format json > "$compose_json"

python3 - "$compose_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    compose = json.load(handle)

assert compose["name"] == "wotbtools-asset-origin", compose.get("name")
services = compose.get("services", {})
assert set(services) == {"caddy"}, sorted(services)
caddy = services["caddy"]
assert caddy["image"] == "caddy:2.10.2-alpine", caddy.get("image")
assert caddy.get("restart") == "unless-stopped", caddy.get("restart")

ports = {(int(p["target"]), str(p["published"]), p.get("protocol", "tcp")) for p in caddy.get("ports", [])}
assert (80, "80", "tcp") in ports, ports
assert (443, "443", "tcp") in ports, ports
assert all(p[0] in {80, 443} for p in ports), ports

volumes = caddy.get("volumes", [])
by_target = {volume["target"]: volume for volume in volumes}
assert by_target["/etc/caddy/Caddyfile"].get("read_only") is True, by_target
assert by_target["/srv/wotb-assets"].get("read_only") is True, by_target
assert by_target["/srv/wotb-assets"].get("type") == "bind", by_target
assert "/data" in by_target and "/config" in by_target, by_target
print("asset-origin Compose contract: PASS")
PY

docker run --rm \
  -v "$caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

grep -Fq 'assets.wotbtools.com {' "$caddyfile"
grep -Fq 'root * /srv/wotb-assets/current' "$caddyfile"
grep -Fq 'file_server' "$caddyfile"
grep -Fq 'max-age=300' "$caddyfile"
grep -Fq 'https://(www\.)?wotbtools\.com' "$caddyfile"
if grep -Fq 'Access-Control-Allow-Origin "*"' "$caddyfile"; then
  echo "asset origin must not use wildcard CORS" >&2
  exit 1
fi
if grep -Eq '^[[:space:]]*reverse_proxy[[:space:]]' "$caddyfile"; then
  echo "asset origin must remain a static file server" >&2
  exit 1
fi

echo "asset-origin Caddy contract: PASS"
