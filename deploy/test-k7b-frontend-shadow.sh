#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose="$ROOT/deploy/tx/frontend-shadow.compose.yml"
template="$ROOT/deploy/tx/nginx/frontend.conf.template"

[ -f "$compose" ] || { echo "missing K7B shadow compose" >&2; exit 1; }
[ -f "$template" ] || { echo "missing frontend nginx template" >&2; exit 1; }

json="$(docker compose -f "$compose" config --format json)"
COMPOSE_JSON="$json" python3 - "$template" <<'PY'
import json, os, pathlib, sys

data = json.loads(os.environ["COMPOSE_JSON"])
assert data.get("name") == "wotbtools-frontend-shadow", data.get("name")
assert set(data.get("services", {})) == {"frontend"}, sorted(data.get("services", {}))
service = data["services"]["frontend"]
assert service["image"] == "ccr.ccs.tencentyun.com/wotbtools/wotbtools-frontend:sha-473495ec07e7"
assert service["environment"]["BACKEND_UPSTREAM"] == "http://10.20.0.1:8087"
assert service["environment"]["AI_UPSTREAM"] == "http://10.20.0.2:8089"
assert service["environment"]["NGINX_ENVSUBST_FILTER"] == "^(BACKEND_UPSTREAM|AI_UPSTREAM)$"

ports = service.get("ports", [])
assert len(ports) == 1, ports
port = ports[0]
assert port["host_ip"] == "10.20.0.3", port
assert int(port["published"]) == 8081 and int(port["target"]) == 80, port
assert port.get("protocol", "tcp") == "tcp", port

volumes = service.get("volumes", [])
assert len(volumes) == 1, volumes
mount = volumes[0]
assert mount["type"] == "bind" and mount["target"] == "/etc/nginx/templates/default.conf.template", mount
assert pathlib.Path(mount["source"]).resolve() == pathlib.Path(sys.argv[1]).resolve(), mount
assert mount.get("read_only") is True, mount

# K7B must not accidentally make TX1 host content a TX2 workload dependency.
rendered = json.dumps(data, sort_keys=True)
for forbidden in (
    "/opt/wotb-tx", "sponsor-config.json", "sponsor-assets",
    "android-release", "10.20.0.1:8081", "CADDY_FRONTEND_UPSTREAM",
):
    assert forbidden not in rendered, forbidden
PY

# The mounted template must preserve the routing split used by production.
grep -Fq 'proxy_pass ${AI_UPSTREAM};' "$template"
grep -Fq 'proxy_pass ${BACKEND_UPSTREAM}/api/;' "$template"

echo "K7B frontend shadow Compose contract: PASS"
