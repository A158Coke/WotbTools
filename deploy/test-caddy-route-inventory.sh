#!/usr/bin/env bash
# Fixtures for the TX Caddy public-site inventory guard.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

real_docker="$(command -v docker || true)"
[ -n "$real_docker" ] || {
  echo 'docker is required: the adapted-config assertions are verified against the real Caddy image.' >&2
  exit 1
}
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

staged() {
  local dir="$work/$1"
  mkdir -p "$dir/assets/auth/.well-known"
  cp "$ROOT/deploy/tx/common.compose.yml" "$ROOT/deploy/tx/caddy.compose.yml" "$dir/"
  cp "$ROOT/deploy/tx/assets/auth/.well-known/assetlinks.json" "$dir/assets/auth/.well-known/"
  printf '%s\n' "$dir"
}

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
    CADDY_FRONTEND_PEER="${CADDY_FRONTEND_PEER:-wotb-frontend:80}" \
    CADDY_KEYCLOAK_UPSTREAM="${CADDY_KEYCLOAK_UPSTREAM:-keycloak:8080}" \
    bash "$ROOT/deploy/tx/validate-caddy-config.sh" "$dir" >"$work/out.log" 2>&1 || rc=$?
  release_compose_network "$dir"
  return "$rc"
}

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

accepts 'repository Caddyfile' "$(caddyfile repository)"

repository_caddyfile="$ROOT/deploy/tx/Caddyfile"
grep -Fq 'reverse_proxy {$CADDY_FRONTEND_UPSTREAM}' "$repository_caddyfile" \
  || { echo 'the Caddyfile must substitute {$CADDY_FRONTEND_UPSTREAM} instead of a literal frontend upstream' >&2; exit 1; }
grep -Fq 'reverse_proxy {$CADDY_KEYCLOAK_UPSTREAM}' "$repository_caddyfile" \
  || { echo 'the Caddyfile must substitute {$CADDY_KEYCLOAK_UPSTREAM} instead of a literal Keycloak upstream' >&2; exit 1; }
if grep -Eq 'reverse_proxy +(wotb-frontend|keycloak)(:|$)|reverse_proxy +10\.20\.0\.[0-9]+:(8080|8081)( |$)' "$repository_caddyfile"; then
  echo 'the Caddyfile must not hardcode a frontend/Keycloak upstream' >&2
  exit 1
fi

wg_upstreams="$(caddyfile wg-upstreams)"
CADDY_FRONTEND_UPSTREAM=10.20.0.1:8081 CADDY_FRONTEND_PEER=10.20.0.3:8081 CADDY_KEYCLOAK_UPSTREAM=10.20.0.1:8080 \
  accepts 'reviewed TX1/TX2 WireGuard upstreams' "$wg_upstreams"

unsafe_upstream="$(caddyfile unsafe-upstream)"
if CADDY_FRONTEND_UPSTREAM=frontend.example.invalid:8081 guard "$unsafe_upstream"; then
  echo 'invalid Caddy logical endpoint was accepted: public frontend upstream' >&2
  exit 1
fi
[ ! -s "$stub_log" ] || { echo 'runtime validation ran despite an unsafe Caddy endpoint' >&2; exit 1; }
grep -q 'CADDY_FRONTEND_UPSTREAM must be' "$work/out.log"

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

monitor_drift="$(caddyfile monitor-drift)"
sed -i 's|reverse_proxy 10\.20\.0\.2:3000|reverse_proxy 10.20.0.2:3001|' "$monitor_drift/Caddyfile"
rejects 'monitor upstream drift' "$monitor_drift" 'monitor.wotbtools.com must reverse_proxy 10.20.0.2:3000'

www_drift="$(caddyfile www-drift)"
sed -i 's| permanent| temporary|' "$www_drift/Caddyfile"
rejects 'www canonical redirect drift' "$www_drift" 'www.wotbtools.com must permanently redirect'

readiness_missing="$(caddyfile readiness-missing)"
sed -i 's|handle /_wotb/ready|handle /_wotb/health|' "$readiness_missing/Caddyfile"
rejects 'TX-local readiness surface removed' "$readiness_missing" '/_wotb/ready readiness surface is missing'

callback_missing="$(caddyfile android-callback-missing)"
awk '/^\thandle \/android\/oauth\/callback \{/ { skip = 1 }
     skip && /^\t\}/ { skip = 0; next }
     skip { next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_missing/Caddyfile"
rejects 'android callback route removed' "$callback_missing" \
  'auth.wotbtools.com must declare handle /android/oauth/callback'

callback_proxied="$(caddyfile android-callback-proxied)"
awk '/^\thandle \/android\/oauth\/callback \{/ { print; print "\t\treverse_proxy {$CADDY_KEYCLOAK_UPSTREAM}"; next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_proxied/Caddyfile"
rejects 'android callback handed back to Keycloak' "$callback_proxied" \
  'must answer from Caddy, never reverse_proxy an upstream'

callback_removed_entirely="$(caddyfile android-callback-gone)"
awk '/^\thandle \/android\/oauth\/callback \{/ { skip = 1 }
     skip && /^\t\}$/ { skip = 0; next }
     skip { next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_removed_entirely/Caddyfile"
rejects 'android callback absent from the inventory' "$callback_removed_entirely" \
  'auth.wotbtools.com must declare handle /android/oauth/callback'

# 合规安全访问日志的守卫必须是真守卫：删掉覆盖面收窄、删掉字段删除、或把 query string
# 重新 append 回来，都必须在 live gateway 之前被拦下。前三个变体在文本层就被拒绝（docker
# 还没被调用），最后一个只在适配后的 JSON 里才看得出来，所以用 CORS 变体同样的手法断言。
log_skip_gone="$(caddyfile compliance-log-skip-gone)"
sed -i '/^\tlog_skip @notApi$/d' "$log_skip_gone/Caddyfile"
rejects 'compliance access log covers more than /api/*' "$log_skip_gone" \
  'must log_skip @notApi'

log_headers_kept="$(caddyfile compliance-headers-kept)"
sed -i '/^\t\t\t\trequest>headers delete$/d' "$log_headers_kept/Caddyfile"
rejects 'compliance access log keeps request headers' "$log_headers_kept" \
  "must delete 'request>headers'"

log_query_reappended="$(caddyfile compliance-query-reappended)"
sed -i 's|^\tlog_append ua {http.request.header.User-Agent}$|\tlog_append ua {http.request.header.User-Agent}\n\tlog_append q {http.request.uri.query}|' \
  "$log_query_reappended/Caddyfile"
rejects 'compliance access log re-appends the query string' "$log_query_reappended" \
  'must not re-append the query string'

log_duplicated="$(caddyfile compliance-log-unnamed)"
sed -i 's|^\tlog security_api {$|\tlog {|' "$log_duplicated/Caddyfile"
if guard "$log_duplicated"; then
  echo 'an unnamed compliance access log was accepted' >&2
  exit 1
fi
grep -q 'named compliance access log' "$work/out.log" || { cat "$work/out.log" >&2; exit 1; }

unreviewed="$(caddyfile unreviewed-upstream)"
printf '\n%sunreviewed.example.com {\n%sreverse_proxy example.invalid:1234\n%s}\n' \
  '' "$(printf '\t')" '' >> "$unreviewed/Caddyfile"
rejects 'unreviewed upstream added' "$unreviewed" 'unreviewed Caddy upstream'

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
catch_end = source.index("\n\t}\n", end) + len("\n\t}\n")
source = source[:start] + source[end:catch_end] + gateway + source[catch_end:]
path.write_text(source)
PY_REVERSE
  fi
  if guard "$cors_dir"; then echo "invalid Android CORS accepted: $mutation" >&2; exit 1; fi
  grep -q 'adapted Android CORS' "$work/out.log" || { cat "$work/out.log" >&2; exit 1; }
done

python3 - "$ROOT" "$work" <<'PY_HTTP'
import http.client, json, os, pathlib, subprocess, sys, time
root, work = map(pathlib.Path, sys.argv[1:])
image = "caddy:2.10.2-alpine"
env_args = []
for name, default in (
    ("CADDY_FRONTEND_UPSTREAM", "wotb-frontend:80"),
    ("CADDY_FRONTEND_PEER", "wotb-frontend:80"),
    ("CADDY_KEYCLOAK_UPSTREAM", "keycloak:8080"),
):
    env_args += ["-e", f"{name}={os.environ.get(name) or default}"]
config = json.loads(subprocess.check_output(["docker", "run", "--rm", "-e", "CADDY_ACME_EMAIL=ci@example.invalid", *env_args, "-v", f"{root}/deploy/tx/Caddyfile:/etc/caddy/Caddyfile:ro", image, "caddy", "adapt", "--config", "/etc/caddy/Caddyfile"], stderr=subprocess.DEVNULL))
server = config["apps"]["http"]["servers"]["srv0"]
logging_config = config["logging"]
server["routes"] = [route for route in server["routes"] if route.get("match") == [{"host": ["wotbtools.com"]}]]
server["listen"] = [":8080"]
server["automatic_https"] = {"disable": True}
server.pop("tls_connection_policies", None)
def isolate(node):
    if isinstance(node, dict):
        if node.get("handler") == "reverse_proxy":
            asset = node["upstreams"] == [{"dial": "wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com:443"}]
            node["upstreams"] = [{"dial": "127.0.0.1:8081" if asset else "127.0.0.1:8082"}]
            node.pop("transport", None)
            node.pop("selection_policy", None)
            # This fixture validates HTTP/CORS routing, not production active-health
            # semantics. Rewriting the upstreams to in-process fixture listeners
            # while retaining the production health checker can transiently mark
            # the fixture upstream unavailable and return 503 before the local
            # fixture listener is considered healthy.
            node.pop("health_checks", None)
        for value in node.values(): isolate(value)
    elif isinstance(node, list):
        for value in node: isolate(value)
isolate(server)
asset = {"listen": [":8081"], "routes": [{"handle": [{"handler": "static_response", "status_code": 200, "body": "asset:{http.request.uri}", "headers": {"X-Map-Meta": ["fixture-map-metadata"]}}]}]}
web = {"listen": [":8082"], "routes": [
    {"match": [{"path": ["/version.json"]}], "handle": [{"handler": "static_response", "status_code": 200, "body": "{\"fixture\":true}"}]},
    {"match": [{"path": ["/index.json"]}], "handle": [{"handler": "static_response", "status_code": 200, "body": "web:{http.request.uri}"}]},
    {"handle": [{"handler": "static_response", "status_code": 502}]}
]}
# The adapted `logging` block travels with the server: the compliance access
# logger is what this fixture proves, and without it Caddy would fall back to
# the default logger and log every request unfiltered.
config = {"admin": {"disabled": True}, "logging": logging_config,
          "apps": {"http": {"servers": {"cors": server, "asset-fixture": asset, "web-fixture": web}}}}
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
    assert "HEAD" in headers["access-control-allow-methods"].split(", "), headers
    assert "x-tournament-default-rules" in headers["access-control-expose-headers"].lower(), headers
    assert "access-control-allow-credentials" not in headers
    _, untrusted, _ = request("https://untrusted.example")
    assert "access-control-allow-origin" not in untrusted, untrusted
    status, actual, _ = request(origin, "GET")
    assert status == 502 and actual["access-control-allow-origin"] == origin, (status, actual)
    for allowed_origin in (origin, "http://127.0.0.1:21653"):
        status, head_headers, body = request(allowed_origin, "HEAD", "/api/admin/tournaments")
        assert status == 502 and body == "", (status, body)
        assert head_headers["access-control-allow-origin"] == allowed_origin, head_headers
        assert "x-tournament-default-rules" in head_headers["access-control-expose-headers"].lower(), head_headers
    status, asset_headers, body = request(origin, "GET", "/agent-assets/index.json")
    assert status == 200 and body == "asset:/index.json", (status, body)
    assert asset_headers["x-map-meta"] == "fixture-map-metadata", asset_headers
    assert {"content-disposition", "x-request-id", "x-map-meta"}.issubset({value.strip().lower() for value in asset_headers["access-control-expose-headers"].split(",")}), asset_headers
    assert asset_headers["access-control-allow-origin"] == origin
    status, _, body = request(origin, "GET", "/index.json")
    assert status == 200 and body == "web:/index.json", (status, body)

    # --- the 190-day compliance access log, proven against real stdout -------
    # Fixture secrets are deliberately recognisable: the whole point is that none
    # of them may survive into a log that is retained for 190 days. The query
    # value, the Authorization credential and the Cookie value all travel on the
    # one request that IS logged, so finding any of them in the output means the
    # field filter is not doing its job.
    query_secret, bearer_secret, cookie_secret = "QUERY-SECRET-FIXTURE", "AUTH-SECRET-FIXTURE", "COOKIE-SECRET-FIXTURE"
    user_agent = "WotBTools-compliance-fixture/1.0"
    access_marker = '"logger":"http.log.access.'
    def access_lines():
        output = subprocess.check_output(["docker", "logs", container], stderr=subprocess.STDOUT, text=True, errors="replace")
        return [line for line in output.splitlines() if access_marker in line]
    # The CORS assertions above already drove several /api/* requests through this
    # same gateway, so only the lines this block adds are its own evidence.
    baseline = len(access_lines())
    def logged_request(path, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        connection.request("GET", path, headers={"Host": "wotbtools.com", "User-Agent": user_agent, **(headers or {})})
        response = connection.getresponse(); response.read()
        return response.status
    api_status = logged_request(
        f"/api/hof/leaderboard?token={query_secret}&page=2",
        {"Authorization": f"Bearer {bearer_secret}", "Cookie": f"KEYCLOAK_SESSION={cookie_secret}"},
    )
    assert api_status == 502, api_status
    # Everything else the public site serves: the SPA shell, a hashed asset, the
    # APK redirect (which answers from Caddy, so it would be logged if log_skip
    # ran after it) and the asset gateway.
    for skipped_path in ("/", "/assets/index-fixture.js", "/download/android/fixture.apk", "/agent-assets/index.json"):
        logged_request(skipped_path)
    for attempt in range(50):
        added = access_lines()[baseline:]
        if added: break
        time.sleep(.1)
    assert len(added) == 1, f"only the /api/* request may be logged, got: {added}"
    entry = json.loads(added[0])
    assert entry["logger"] == "http.log.access.security_api", entry["logger"]
    assert entry["path"] == "/api/hof/leaderboard", entry
    assert entry["compliance"] == "security" and entry["security_kind"] == "api_access", entry
    assert entry["ua"] == user_agent, entry
    assert entry["status"] == 502, entry
    assert entry["request"]["method"] == "GET" and entry["request"]["host"] == "wotbtools.com", entry
    # The retained field set: enough to answer "who reached which service, from
    # where, when, and with what result" and nothing beyond it.
    for required in ("remote_ip", "remote_port"):
        assert entry["request"][required], (required, entry)
    assert "uri" not in entry["request"] and "headers" not in entry["request"], entry
    assert "resp_headers" not in entry, entry
    for secret in (query_secret, bearer_secret, cookie_secret, "token="):
        assert secret not in added[0], f"{secret} leaked into the compliance access log: {added[0]}"
    print("Caddy compliance access log: /api/* retained with the reviewed field set, "
          "SPA/assets/APK/asset-gateway skipped, query + Authorization + Cookie absent: PASS")
finally:
    subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, check=True)
print("Caddy HTTP preflight / rejected origin / upstream failure / asset gateway path and exposed metadata: PASS")
PY_HTTP

echo 'Caddy public-site inventory fixtures: PASS'
