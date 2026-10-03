#!/usr/bin/env bash
# Fixtures for the TX Caddy public-site inventory guard.
#
# The guard lives in `deploy/tx/validate-caddy-config.sh` and runs in two places:
# PR CI (`ci-caddy.yml`) and production staging (`deploy/tx/deploy.sh`, through
# `deploy/tx/validate-caddy-config.sh`). Every rejected case must fail *before*
# the runtime validation is reached - that ordering is asserted through the stub
# log below, not assumed.
#
# Docker is stubbed so that ordering is observable, but the stub **delegates** the
# invocation to the real docker binary: the guard's final assertions run against
# the JSON Caddy actually adapts the staged file to. A stub that answered with a
# canned or empty document would either hide a real adapted-shape regression or
# reject a valid configuration for the wrong reason (which is exactly what an
# empty adaptation did before). Docker is therefore required here, as it already
# is for the other TX runtime fixtures and for the production caller.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

real_docker="$(command -v docker || true)"
[ -n "$real_docker" ] || {
  echo 'docker is required: the adapted-config assertions are verified against the real Caddy image.' >&2
  exit 1
}
# The Caddyfile takes its ACME account address from the environment; production and
# the PR fixture both set it. Keep the same default so the adaptation under test is
# decided by the staged Caddyfile, not by a missing variable.
: "${CADDY_ACME_EMAIL:=ci@example.invalid}"
export CADDY_ACME_EMAIL

stub_log="$work/docker.log"
mkdir -p "$work/bin"
cat > "$work/bin/docker" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "\${STUB_DOCKER_LOG:?}"
exec "$real_docker" "\$@"
STUB
chmod +x "$work/bin/docker"

# staged <name> -> a disposable staged TX directory with the real compose files
# and the mounted domain-association asset, mirroring the production staging tree.
staged() {
  local dir="$work/$1"
  mkdir -p "$dir/assets/auth/.well-known"
  cp "$ROOT/deploy/tx/common.compose.yml" "$ROOT/deploy/tx/caddy.compose.yml" "$dir/"
  cp "$ROOT/deploy/tx/assets/auth/.well-known/assetlinks.json" "$dir/assets/auth/.well-known/"
  printf '%s\n' "$dir"
}

# caddyfile <name> -> staged dir with a copy of the repository Caddyfile
caddyfile() {
  local dir
  dir="$(staged "$1")"
  cp "$ROOT/deploy/tx/Caddyfile" "$dir/Caddyfile"
  printf '%s\n' "$dir"
}

guard() {
  local dir="$1" rc=0
  rm -f "$stub_log"
  PATH="$work/bin:$PATH" STUB_DOCKER_LOG="$stub_log" \
    CADDY_FRONTEND_UPSTREAM="${CADDY_FRONTEND_UPSTREAM:-wotb-frontend:80}" \
    CADDY_KEYCLOAK_UPSTREAM="${CADDY_KEYCLOAK_UPSTREAM:-keycloak:8080}" \
    bash "$ROOT/deploy/tx/validate-caddy-config.sh" "$dir" >"$work/out.log" 2>&1 || rc=$?
  release_compose_network "$dir"
  return "$rc"
}

# The guard runs the real Compose project (`-p deploy`) for its adapt/validate step, and Compose
# allocates a Docker network from the daemon's default address pool. Leaving those behind would
# slowly consume that pool inside one CI job - enough for a later fixture that needs an explicit
# subnet (`deploy/test-nginx-grafana-recreate.sh` creates 172.29.0.0/16) to fail with
# "Pool overlaps with other one on this address space". Every guard invocation therefore releases
# what it created. Cleanup uses the real CLI directly, so it never appears in the stub log that the
# rejected cases assert on.
release_compose_network() {
  local dir="$1"
  [ -n "$real_docker" ] || return 0
  CADDY_ACME_EMAIL="$CADDY_ACME_EMAIL" "$real_docker" compose -p deploy \
    -f "$dir/common.compose.yml" -f "$dir/caddy.compose.yml" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  "$real_docker" network rm deploy_default >/dev/null 2>&1 || true
}

accepts() {
  local label="$1" dir="$2"
  guard "$dir" || {
    echo "valid Caddy inventory was rejected: $label" >&2
    cat "$work/out.log" >&2
    exit 1
  }
  [ -s "$stub_log" ] || { echo "runtime validation was skipped for: $label" >&2; exit 1; }
}

rejects() {
  local label="$1" dir="$2" expected="$3"
  if guard "$dir"; then
    echo "invalid Caddy inventory was accepted: $label" >&2
    exit 1
  fi
  [ ! -s "$stub_log" ] || {
    echo "runtime validation ran despite an invalid inventory: $label" >&2
    exit 1
  }
  grep -q -- "$expected" "$work/out.log" || {
    echo "rejected for the wrong reason: $label (expected to see: $expected)" >&2
    cat "$work/out.log" >&2
    exit 1
  }
}

# The repository Caddyfile itself must satisfy the inventory, including the
# Komodo public ingress added for K2.
accepts 'repository Caddyfile' "$(caddyfile repository)"

wg_upstreams="$(caddyfile wg-upstreams)"
CADDY_FRONTEND_UPSTREAM=10.20.0.1:8081 CADDY_KEYCLOAK_UPSTREAM=10.20.0.1:8080 \
  accepts 'reviewed TX1 WireGuard upstreams' "$wg_upstreams"

unsafe_upstream="$(caddyfile unsafe-upstream)"
if CADDY_FRONTEND_UPSTREAM=frontend.example.invalid:8081 guard "$unsafe_upstream"; then
  echo 'invalid Caddy logical endpoint was accepted: public frontend upstream' >&2
  exit 1
fi
[ ! -s "$stub_log" ] || { echo 'runtime validation ran despite an unsafe Caddy endpoint' >&2; exit 1; }
grep -q 'CADDY_FRONTEND_UPSTREAM must be' "$work/out.log"

# --- komodo.wotbtools.com is mandatory and must target the WireGuard address ---
missing="$(caddyfile komodo-missing)"
awk '/^komodo\.wotbtools\.com \{/ { skip = 1 }
     skip && /^\}/ { skip = 0; next }
     skip { next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$missing/Caddyfile"
rejects 'komodo site removed' "$missing" 'komodo.wotbtools.com must reverse_proxy 10.20.0.2:9120'

wrong_port="$(caddyfile komodo-wrong-port)"
sed -i 's|reverse_proxy 10\.20\.0\.2:9120|reverse_proxy 10.20.0.2:9999|' "$wrong_port/Caddyfile"
rejects 'komodo upstream on the wrong port' "$wrong_port" 'komodo.wotbtools.com must reverse_proxy 10.20.0.2:9120'

public_yecao="$(caddyfile komodo-public-yecao)"
sed -i 's|^\(\t*\)reverse_proxy 10\.20\.0\.2:9120$|\1reverse_proxy 10.20.0.2:9120 {\n\1\theader_up Host 45.136.14.101\n\1}|' \
  "$public_yecao/Caddyfile"
rejects 'Yecao public address in the Caddyfile' "$public_yecao" 'Yecao public address'

# --- the pre-existing routes must survive ------------------------------------
monitor_drift="$(caddyfile monitor-drift)"
sed -i 's|reverse_proxy 10\.20\.0\.2:3000|reverse_proxy 10.20.0.2:3001|' "$monitor_drift/Caddyfile"
rejects 'monitor upstream drift' "$monitor_drift" 'monitor.wotbtools.com must reverse_proxy 10.20.0.2:3000'

www_drift="$(caddyfile www-drift)"
sed -i 's| permanent| temporary|' "$www_drift/Caddyfile"
rejects 'www canonical redirect drift' "$www_drift" 'www.wotbtools.com must permanently redirect'

readiness_missing="$(caddyfile readiness-missing)"
sed -i 's|handle /_wotb/ready|handle /_wotb/health|' "$readiness_missing/Caddyfile"
rejects 'TX-local readiness surface removed' "$readiness_missing" '/_wotb/ready readiness surface is missing'

# --- the Android App Link callback must exist, answer, and stay reachable -----
# A browser that returns to the HTTPS redirect URI without the app installed must
# land on the WotBTools-owned page instead of Keycloak's catch-all 404. Every case
# below is decided by the inventory guard, before the runtime validation runs.
callback_missing="$(caddyfile android-callback-missing)"
awk '/^\thandle \/android\/oauth\/callback \{/ { skip = 1 }
     skip && /^\t\}/ { skip = 0; next }
     skip { next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_missing/Caddyfile"
rejects 'android callback route removed' "$callback_missing" \
  'auth.wotbtools.com must declare handle /android/oauth/callback'

callback_proxied="$(caddyfile android-callback-proxied)"
# The route keeps a respond (so only the "answer from Caddy" rule can reject it)
# but also proxies the same path. The injected upstream uses the reviewed logical
# placeholder, not a hard-coded host: otherwise the fixture would be rejected by
# the auth.wotbtools.com catch-all rule first and stop testing the callback rule
# it exists for.
awk '/^\thandle \/android\/oauth\/callback \{/ { print; print "\t\treverse_proxy {$CADDY_KEYCLOAK_UPSTREAM}"; next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_proxied/Caddyfile"
rejects 'android callback handed back to Keycloak' "$callback_proxied" \
  'must answer from Caddy, never reverse_proxy an upstream'

# The route is only an answer while it is the most specific match: once it no
# longer exists on that host, the guard must fail on it.
callback_removed_entirely="$(caddyfile android-callback-gone)"
awk '/^\thandle \/android\/oauth\/callback \{/ { skip = 1 }
     skip && /^\t\}$/ { skip = 0; next }
     skip { next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_removed_entirely/Caddyfile"
rejects 'android callback absent from the inventory' "$callback_removed_entirely" \
  'auth.wotbtools.com must declare handle /android/oauth/callback'

unreviewed="$(caddyfile unreviewed-upstream)"
printf '\n%sunreviewed.example.com {\n%sreverse_proxy example.invalid:1234\n%s}\n' \
  '' "$(printf '\t')" '' >> "$unreviewed/Caddyfile"
rejects 'unreviewed upstream added' "$unreviewed" 'unreviewed Caddy upstream'

# Adapted invariants protect both real ordering and the exact-origin boundary.
for mutation in wildcard missing-preflight missing-exposed-header reversed-gateway; do
  cors_dir="$(caddyfile "android-cors-$mutation")"
  if [ "$mutation" = wildcard ]; then
    sed -i 's|Access-Control-Allow-Origin https://appassets.androidplatform.net|Access-Control-Allow-Origin *|' "$cors_dir/Caddyfile"
  elif [ "$mutation" = missing-preflight ]; then
    sed -i '/respond @androidPreflight/d' "$cors_dir/Caddyfile"
  elif [ "$mutation" = missing-exposed-header ]; then
    sed -i 's/, X-Map-Meta//' "$cors_dir/Caddyfile"
  else
    python3 - "$cors_dir/Caddyfile" <<'PY_REVERSE'
import pathlib, sys
path = pathlib.Path(sys.argv[1]); source = path.read_text()
start = source.index("\thandle_path /agent-assets/* {")
end = source.index("\thandle {", start)
gateway = source[start:end]
# Move the gateway after the following catch-all, retaining every directive.
catch_end = source.index("\n\t}\n", end) + len("\n\t}\n")
source = source[:start] + source[end:catch_end] + gateway + source[catch_end:]
path.write_text(source)
PY_REVERSE
  fi
  if guard "$cors_dir"; then echo "invalid Android CORS accepted: $mutation" >&2; exit 1; fi
  grep -q 'adapted Android CORS' "$work/out.log" || { cat "$work/out.log" >&2; exit 1; }
done

# Real Caddy HTTP routing: fixture upstreams return distinguishable responses,
# proving preflight, gateway selection, path stripping and exposed map metadata.
python3 - "$ROOT" "$work" <<'PY_HTTP'
import http.client, json, os, pathlib, subprocess, sys, time
root, work = map(pathlib.Path, sys.argv[1:])
image = "caddy:2.10.2-alpine"
# 逻辑上游必须与生产 compose 的默认值一致地传进来：Caddyfile 用 {$CADDY_*_UPSTREAM} 占位符，
# 空占位符会让 adapt 产出**没有 upstreams** 的 reverse_proxy 节点（isolate() 因此拿不到 dial）。
env_args = []
for name, default in (("CADDY_FRONTEND_UPSTREAM", "wotb-frontend:80"), ("CADDY_KEYCLOAK_UPSTREAM", "keycloak:8080")):
    env_args += ["-e", f"{name}={os.environ.get(name) or default}"]
config = json.loads(subprocess.check_output(["docker", "run", "--rm", "-e", "CADDY_ACME_EMAIL=ci@example.invalid", *env_args, "-v", f"{root}/deploy/tx/Caddyfile:/etc/caddy/Caddyfile:ro", image, "caddy", "adapt", "--config", "/etc/caddy/Caddyfile"], stderr=subprocess.DEVNULL))
server = config["apps"]["http"]["servers"]["srv0"]
server["routes"] = [route for route in server["routes"] if route.get("match") == [{"host": ["wotbtools.com"]}]]
server["listen"] = [":8080"]
server["automatic_https"] = {"disable": True}
server.pop("tls_connection_policies", None)
def isolate(node):
    if isinstance(node, dict):
        if node.get("handler") == "reverse_proxy":
            asset = node["upstreams"] == [{"dial": "wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com:443"}]
            node["upstreams"] = [{"dial": "127.0.0.1:8081" if asset else "127.0.0.1:8082"}]
            node.pop("transport", None)  # Fixture upstreams speak plain HTTP.
        for value in node.values(): isolate(value)
    elif isinstance(node, list):
        for value in node: isolate(value)
isolate(server)
asset = {"listen": [":8081"], "routes": [{"handle": [{"handler": "static_response", "status_code": 200, "body": "asset:{http.request.uri}", "headers": {"X-Map-Meta": ["fixture-map-metadata"]}}]}]}
web = {"listen": [":8082"], "routes": [{"match": [{"path": ["/index.json"]}], "handle": [{"handler": "static_response", "status_code": 200, "body": "web:{http.request.uri}"}]}, {"handle": [{"handler": "static_response", "status_code": 502}]}]}
config = {"admin": {"disabled": True}, "apps": {"http": {"servers": {"cors": server, "asset-fixture": asset, "web-fixture": web}}}}
path = work / "cors-runtime.json"; path.write_text(json.dumps(config))
container = subprocess.check_output(["docker", "run", "-d", "--rm", "-p", "127.0.0.1::8080", "-v", f"{path}:/config.json:ro", image, "caddy", "run", "--config", "/config.json"], text=True).strip()
try:
    for attempt in range(30):
        mapping = subprocess.check_output(["docker", "port", container, "8080/tcp"], text=True).strip()
        if mapping: break
        if subprocess.check_output(["docker", "inspect", "--format", "{{.State.Running}}", container], text=True).strip() != "true":
            raise RuntimeError(subprocess.check_output(["docker", "logs", container], stderr=subprocess.STDOUT, text=True))
        time.sleep(.1)
    assert mapping, "Caddy container did not publish 8080/tcp"
    port = int(mapping.splitlines()[0].rsplit(":", 1)[-1])
    def request(origin, method="OPTIONS", path="/api/users/profile"):
        for attempt in range(30):
            try:
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request(method, path, headers={"Host": "wotbtools.com", "Origin": origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,content-encoding"})
                response = connection.getresponse(); body = response.read().decode()
                return response.status, dict((key.lower(), value) for key, value in response.getheaders()), body
            except (OSError, http.client.HTTPException):
                if attempt == 29: raise
                time.sleep(.1)
    origin = "https://appassets.androidplatform.net"
    status, headers, _ = request(origin)
    assert status == 204, status
    assert headers["access-control-allow-origin"] == origin, headers
    assert "authorization" in headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in headers
    _, untrusted, _ = request("https://untrusted.example")
    assert "access-control-allow-origin" not in untrusted, untrusted
    status, actual, _ = request(origin, "GET")
    assert status == 502 and actual["access-control-allow-origin"] == origin, (status, actual)
    status, asset_headers, body = request(origin, "GET", "/agent-assets/index.json")
    assert status == 200 and body == "asset:/index.json", (status, body)
    assert asset_headers["x-map-meta"] == "fixture-map-metadata", asset_headers
    assert {"content-disposition", "x-request-id", "x-map-meta"}.issubset({value.strip().lower() for value in asset_headers["access-control-expose-headers"].split(",")}), asset_headers
    assert asset_headers["access-control-allow-origin"] == origin
    status, _, body = request(origin, "GET", "/index.json")
    assert status == 200 and body == "web:/index.json", (status, body)
finally:
    subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, check=True)
print("Caddy HTTP preflight / rejected origin / upstream failure / asset gateway path and exposed metadata: PASS")
PY_HTTP

echo 'Caddy public-site inventory fixtures: PASS'
