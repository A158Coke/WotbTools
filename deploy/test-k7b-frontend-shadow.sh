#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose="$ROOT/deploy/tx/frontend-shadow.compose.yml"
template="$ROOT/deploy/tx/nginx/frontend.conf.template"
resource="$ROOT/infra/komodo/resources/frontend-shadow.toml"

[ -f "$compose" ] || { echo "missing K7B/K7C shadow compose" >&2; exit 1; }
[ -f "$template" ] || { echo "missing frontend nginx template" >&2; exit 1; }
[ -f "$resource" ] || { echo "missing K7B shadow Komodo resource" >&2; exit 1; }

# The K7C production replica deliberately requires the workflow to supply the
# exact immutable TX1 image reference. Keep the fixture aligned with that runtime
# contract instead of relying on the retired source-controlled shadow image pin.
test_image_ref="ccr.ccs.tencentyun.com/wotbtools/wotbtools-frontend@sha256:1111111111111111111111111111111111111111111111111111111111111111"
if env -u TX_FRONTEND_IMAGE_REF docker compose -f "$compose" config --format json >/dev/null 2>&1; then
  echo "frontend shadow compose accepted a missing TX_FRONTEND_IMAGE_REF" >&2
  exit 1
fi
json="$(TX_FRONTEND_IMAGE_REF="$test_image_ref" docker compose -f "$compose" config --format json)"
COMPOSE_JSON="$json" TEST_IMAGE_REF="$test_image_ref" python3 - "$template" <<'PY'
import json, os, pathlib, sys

data = json.loads(os.environ["COMPOSE_JSON"])
assert data.get("name") == "wotbtools-frontend-shadow", data.get("name")
assert set(data.get("services", {})) == {"frontend"}, sorted(data.get("services", {}))
service = data["services"]["frontend"]
assert service["image"] == os.environ["TEST_IMAGE_REF"], service["image"]
assert service["environment"]["BACKEND_UPSTREAM"] == "http://10.20.0.1:8087"
assert service["environment"]["AI_UPSTREAM"] == "http://10.20.0.2:8089"
assert service["environment"]["NGINX_ENVSUBST_FILTER"] == "^(BACKEND_UPSTREAM|AI_UPSTREAM)$$", service["environment"]

extra_hosts = service.get("extra_hosts", [])
if isinstance(extra_hosts, dict):
    assert extra_hosts.get("caddy") == "10.20.0.1", extra_hosts
else:
    rendered_hosts = " ".join(map(str, extra_hosts))
    assert "caddy" in rendered_hosts and "10.20.0.1" in rendered_hosts, extra_hosts

ports = service.get("ports", [])
assert len(ports) == 1, f"expected one published port, found: {ports!r}"
port = ports[0]
assert port.get("host_ip") == "10.20.0.3", f"unexpected host_ip: {port!r}"
assert str(port.get("published")) == "8081", f"unexpected published port: {port!r}"
assert int(port.get("target")) == 80, f"unexpected target port: {port!r}"

volumes = service.get("volumes", [])
assert len(volumes) == 2, f"expected template + 1 K7C runtime mount, found: {volumes!r}"
by_target = {m.get("target"): m for m in volumes}
expected = {
    "/etc/nginx/templates/default.conf.template": pathlib.Path(sys.argv[1]).resolve(),
    "/usr/share/nginx/html/download/android": pathlib.Path("/opt/wotb-tx2/runtime-content/android-release"),
}
for target, source in expected.items():
    mount = by_target[target]
    assert mount.get("type") == "bind", mount
    assert pathlib.Path(mount.get("source", "")).resolve() == source.resolve(), mount
    assert mount.get("read_only") is True, mount

# TX2 must never bind TX1 host paths; it owns a local replicated runtime-content root.
rendered = json.dumps(data, sort_keys=True)
assert "/opt/wotb-tx/" not in rendered, rendered
assert "/opt/wotb-tx2/runtime-content" in rendered, rendered
assert "10.20.0.1:8081" not in rendered, rendered
assert "CADDY_FRONTEND_UPSTREAM" not in rendered, rendered
PY

grep -Fq 'git_provider = "gitee.com"' "$resource"
grep -Fq 'repo = "A158Coke/Wotbtools"' "$resource"
! grep -Fq 'git_provider = "github.com"' "$resource"

grep -Fq 'NGINX_ENVSUBST_FILTER: ^(BACKEND_UPSTREAM|AI_UPSTREAM)$$' "$compose"
grep -Fq 'NGINX_ENVSUBST_FILTER: ^(BACKEND_UPSTREAM|AI_UPSTREAM)$$' "$ROOT/deploy/tx/frontend.compose.yml"
grep -Fq 'proxy_pass ${AI_UPSTREAM};' "$template"
grep -Fq 'proxy_pass ${BACKEND_UPSTREAM}/api/;' "$template"

echo "K7B/K7C frontend shadow Compose contract: PASS"
