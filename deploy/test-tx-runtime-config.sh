#!/usr/bin/env bash
# Exercise one TX owner deploy without a release registry or unrelated images.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/host" "$WORK/incoming/deploy" "$WORK/bin"
cp -a "$ROOT/deploy/tx" "$WORK/incoming/deploy/"
cp "$ROOT/deploy/validate-alloy-config.sh" "$WORK/incoming/deploy/"
find "$WORK/incoming/deploy/tx" -type f \( -name '*.sh' -o -name '*.yml' \) -exec sed -i 's/\r$//' {} +
cat > "$WORK/bin/ip" <<'IP'
#!/usr/bin/env bash
if [ "${1:-}" = -4 ]; then echo 'inet 10.20.0.1/24'; fi
IP
# `validate-caddy-config.sh` asserts against the JSON Caddy **adapts** the staged file to
# (the adapted routes, their order, their handlers and the response they answer with), so
# a fake `adapt` reply would either hide a real shape regression or reject a valid
# configuration. This fixture delegates config rendering and that adapt invocation to the
# real Docker CLI - the same pinned caddy image the Caddy validation step already pulls - and
# keeps the fake behaviour for everything else (including the deliberate
# FAKE_CADDY_VALIDATE_FAIL knob on `validate`, and the canned readiness/log responses).
REAL_DOCKER="$(command -v docker || true)"
# Validate native Compose output before installing the deployment fixture CLI.
# No container starts here; fixtures use dummy credentials and immutable refs.
export TX_RUNTIME_ROOT="$WORK/runtime"
export TX_FRONTEND_IMAGE_REF=ccr.ccs.tencentyun.com/wotbtools/wotbtools-frontend@sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd
export TX_BUSINESS_API_IMAGE_REF=ccr.ccs.tencentyun.com/wotbtools/wotbtools-business-api@sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd
export KC_POSTGRES_ADMIN_USER=ci KC_POSTGRES_ADMIN_PASSWORD=ci
export KC_BOOTSTRAP_ADMIN_PASSWORD=ci KC_DB_USERNAME=ci KC_DB_PASSWORD=ci
export WG_APPLICATION_ID=ci CADDY_ACME_EMAIL=ci@example.invalid
export TX_BUSINESS_POSTGRES_ADMIN_USER=ci TX_BUSINESS_POSTGRES_ADMIN_PASSWORD=ci
export TX_BUSINESS_DB_NAME=wotb TX_BUSINESS_DB_USERNAME=ci TX_BUSINESS_DB_PASSWORD=ci
export KEYCLOAK_ADMIN_CLIENT_SECRET=ci
docker compose -p deploy -f "$ROOT/deploy/tx/docker-compose.yml" config --format json > "$WORK/tx-compose.json"
source "$ROOT/deploy/tx/runtime-check-lib.sh"
assert_tx_service_ports < "$WORK/tx-compose.json"
for owner in frontend business-api keycloak keycloak-postgres business-postgres; do
  service="$owner"
  [ "$owner" != frontend ] || service=wotb-frontend
  docker compose -p deploy -f "$ROOT/deploy/tx/$owner.compose.yml" config --format json \
    | assert_tx_service_ports "$service"
done
# Exercise the shared production validator against mutations of real rendered
# JSON: missing endpoints, unreviewed interfaces/ports/protocols, duplicates and
# app/management target swaps must all fail. Port declaration order is irrelevant.
python3 - "$WORK/tx-compose.json" "$ROOT/deploy/tx/runtime-check-lib.sh" <<'PY'
import copy, json, subprocess, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    baseline = json.load(handle)
lib = sys.argv[2]
names = ["wotb-frontend", "business-api", "keycloak", "keycloak-postgres", "business-postgres"]
def check(data):
    return subprocess.run(
        ["bash", "-c", 'source "$1"; assert_tx_service_ports', "bash", lib],
        input=json.dumps(data), text=True, capture_output=True,
    )
positive = copy.deepcopy(baseline)
for name in names:
    positive["services"][name]["ports"].reverse()
assert check(positive).returncode == 0, "equivalent binding order rejected"
count = 0
for name in names:
    ports = baseline["services"][name]["ports"]
    for index, port in enumerate(ports):
        mutations = [
            ("host_ip", "0.0.0.0"), ("host_ip", "::"), ("host_ip", "203.0.113.10"),
            ("host_ip", ""), ("published", "5432"), ("target", 1), ("protocol", "udp"),
            ("remove", None), ("duplicate", None),
        ]
        if name == "business-api":
            mutations.append(("target", 8088 if port["target"] == 8087 else 8087))
        for field, value in mutations:
            data = copy.deepcopy(baseline)
            changed = data["services"][name]["ports"]
            if field == "remove":
                changed.pop(index)
            elif field == "duplicate":
                changed.append(copy.deepcopy(port))
            else:
                changed[index][field] = value
            assert check(data).returncode != 0, (name, index, field, value)
            count += 1
print(f"TX rendered Compose service-plane contract: PASS ({count} rejected mutations)")
PY

# K6B logical endpoint validators are pure fail-closed guards. Exercise them
# directly so every owner gets both a reviewed-WG positive and unsafe negative
# without creating another standalone test entrypoint.
validate_endpoint() {
  bash -c '
    set -euo pipefail
    export TX_DEPLOY_LIBRARY_ONLY=1
    source "$1"
    shift
    "$@"
  ' bash "$ROOT/deploy/tx/deploy.sh" "$@"
}
validate_endpoint validate_http_endpoint TX_BACKEND_UPSTREAM http://business-api:8087 http://business-api:8087 8087
validate_endpoint validate_http_endpoint TX_BACKEND_UPSTREAM http://10.20.0.1:8087 http://business-api:8087 8087
# A bare `! command` cannot assert anything under `set -e` (bash exempts inverted
# commands from errexit), so every rejection below is an explicit guard: it fails the
# fixture when the canonical validator accepts a value it must refuse.
reject_endpoint() {
  if validate_endpoint "$@"; then
    echo "the canonical validator accepted a placement it must refuse: $*" >&2
    exit 1
  fi
}
reject_endpoint validate_http_endpoint TX_BACKEND_UPSTREAM https://api.example.invalid http://business-api:8087 8087
reject_endpoint validate_http_endpoint TX_BACKEND_UPSTREAM http://10.20.0.1:9999 http://business-api:8087 8087
# Yecao is not a reviewed TX placement host: the retired business runtime address and
# the management port must both stay rejected, otherwise a cutover could silently send
# public API traffic to the wrong host or the wrong surface. The runtime gate asserts
# the same fence with its own `frontend-upstream-yecao` fixture.
reject_endpoint validate_http_endpoint TX_BACKEND_UPSTREAM http://10.20.0.2:8087 http://business-api:8087 8087
reject_endpoint validate_http_endpoint TX_BACKEND_UPSTREAM http://10.20.0.1:8088 http://business-api:8087 8087
# K6B-2C moves the Business API -> Keycloak Admin consumer onto the reviewed TX1
# WireGuard endpoint, guarded by the same canonical HTTP validator. The reviewed
# values (Docker-local, TX1 WG, TX2 WG) are accepted; a public host, the retired Yecao
# address, the business app/management port, a non-http scheme, URL credentials, and a
# path/query/fragment are refused before any Admin request or client secret can leave
# the host.
validate_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL http://keycloak:8080 http://keycloak:8080 8080
validate_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL http://10.20.0.1:8080 http://keycloak:8080 8080
validate_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL http://10.20.0.3:8080 http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL https://auth.wotbtools.com http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL http://keycloak.example.com:8080 http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL http://10.20.0.2:8080 http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL http://10.20.0.1:8088 http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL https://10.20.0.1:8080 http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL http://user:secret@10.20.0.1:8080 http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL http://10.20.0.1:8080/realms/wotbtools http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL 'http://10.20.0.1:8080?x=1' http://keycloak:8080 8080
reject_endpoint validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL 'http://10.20.0.1:8080#frag' http://keycloak:8080 8080
validate_endpoint validate_database_endpoint TX_BUSINESS_DB 10.20.0.1 25432 business-postgres 5432 25432
validate_endpoint validate_database_endpoint TX_KEYCLOAK_DB 10.20.0.3 15432 keycloak-postgres 5432 15432
# K6B-2D moves the Keycloak -> Keycloak PostgreSQL consumer onto the reviewed TX1
# WireGuard endpoint, guarded by the same canonical database validator. The reviewed
# values (Docker-local, TX1 WG, TX2 WG) are accepted; the retired Yecao address, the
# wrong WireGuard host port, and - importantly - the OTHER PostgreSQL placement's port
# are refused, so the two database consumers can never be swapped by accident.
validate_endpoint validate_database_endpoint TX_KEYCLOAK_DB keycloak-postgres 5432 keycloak-postgres 5432 15432
validate_endpoint validate_database_endpoint TX_KEYCLOAK_DB 10.20.0.1 15432 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB 10.20.0.2 15432 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB 10.20.0.1 5432 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB 10.20.0.1 25432 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB 10.20.0.1 15433 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB 10.20.0.3 25432 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB db.example.com 15432 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB auth.wotbtools.com 15432 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB '' 15432 keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB keycloak-postgres '' keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_KEYCLOAK_DB keycloak-postgres abc keycloak-postgres 5432 15432
reject_endpoint validate_database_endpoint TX_BUSINESS_DB 10.20.0.2 25432 business-postgres 5432 25432
validate_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 10.20.0.1:8081 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM frontend.example.invalid:8081 wotb-frontend:80 8081
# K6B-2E moves the Caddy -> Frontend consumer onto the reviewed TX1 WireGuard endpoint,
# guarded by the same canonical Caddy upstream validator. The reviewed values
# (Docker-local, TX1 WG, TX2 WG) are accepted; the retired Yecao address, public hosts,
# a URL-shaped value, and - importantly - every other service-plane port are refused, so
# 8081 (Frontend), 8080 (Keycloak) and 8087 (Business API) can never be swapped.
validate_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM wotb-frontend:80 wotb-frontend:80 8081
validate_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 10.20.0.3:8081 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 10.20.0.2:8081 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 10.20.0.1:80 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 10.20.0.1:8080 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 10.20.0.1:8087 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 10.20.0.1:8082 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM wotbtools.com:443 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM frontend.example.com:8081 wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 'http://10.20.0.1:8081' wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM '10.20.0.1:8081/path' wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM 'user:pass@10.20.0.1:8081' wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM ':8081' wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM '10.20.0.1:' wotb-frontend:80 8081
reject_endpoint validate_caddy_upstream CADDY_FRONTEND_UPSTREAM '10.20.0.1:abc' wotb-frontend:80 8081
# Caddy -> Keycloak (K6B-2F) is guarded by the same canonical Caddy upstream validator.
# The reviewed values (Docker-local, TX1 WG, TX2 WG) are accepted; the retired Yecao
# address, every other service-plane port, public hosts, and URL-shaped values are
# refused, so 8080 (Keycloak), 8081 (Frontend) and 8087 (Business API) can never be
# swapped. `keycloak:8080` stays legal in the allowlist because it is the rollback value
# for this consumer; after K6B-2F it is no longer the reviewed production placement, and
# that is asserted by the desired-state contracts (CURRENT_K6B_CUTOVERS in
# scripts/ci/test-workflow-contract.sh plus the `k6b2f-*` fixtures in
# deploy/test-tx-runtime-check.sh).
validate_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM keycloak:8080 keycloak:8080 8080
validate_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 10.20.0.1:8080 keycloak:8080 8080
validate_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 10.20.0.3:8080 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 10.20.0.2:8080 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 10.20.0.1:80 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 10.20.0.1:8081 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 10.20.0.1:8087 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 10.20.0.1:8088 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM auth.wotbtools.com:443 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM wotbtools.com:443 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM arbitrary.example:8080 keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 'http://10.20.0.1:8080' keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 'https://10.20.0.1:8080' keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM '10.20.0.1:8080/path' keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM '10.20.0.1:8080?x=y' keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM 'user:pass@10.20.0.1:8080' keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM ':8080' keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM '10.20.0.1:' keycloak:8080 8080
reject_endpoint validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM '10.20.0.1:abc' keycloak:8080 8080

# K6B-2A moves the Frontend -> Business API consumer onto a WireGuard placement, so the
# frontend owner's own deploy must fail when that placement is unreachable instead of
# leaving a half-broken consumer for the manual runtime gate. The probe has to traverse
# the frontend (nginx -> BACKEND_UPSTREAM): probing the Business API directly would stay
# green while the running container dials something else, which is the false green this
# step exists to prevent. A failing probe must also be attributed to wotb-frontend so
# stop_failed_service actually acts on the affected service.
frontend_health_block="$(sed -n '/if is_selected wotb-frontend; then/,/^  fi$/p' "$ROOT/deploy/tx/deploy.sh")"
grep -Fq 'wait_for_probe frontend-api http://wotb-frontend/api/health' <<< "$frontend_health_block" \
  || { echo 'the frontend deploy must probe /api/health through the frontend' >&2; exit 1; }
grep -Fq 'wait_for_probe frontend-static http://wotb-frontend/' <<< "$frontend_health_block" \
  || { echo 'the frontend static probe was removed' >&2; exit 1; }
if grep -Fq 'http://business-api:8087/api/health' <<< "$frontend_health_block"; then
  echo 'the frontend deploy must prove the rendered placement through the frontend, not by probing the Business API directly' >&2
  exit 1
fi
stop_failed_block="$(sed -n '/^stop_failed_service()/,/^}/p' "$ROOT/deploy/tx/deploy.sh")"
grep -Fq 'frontend-api' <<< "$stop_failed_block" \
  || { echo 'a failed frontend api probe must be attributed to wotb-frontend' >&2; exit 1; }

cat > "$WORK/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
REAL_DOCKER='@REAL_DOCKER@'
original=("$@")
[ "${1:-}" = compose ] || exit 0
shift
while :; do
  case "${1:-}" in -p|-f) shift 2 ;; *) break ;; esac
done
verb="${1:-}"; shift || true
printf '%s %s\n' "$verb" "$*" >> "$FAKE_DOCKER_LOG"
case "$verb" in
  config)
    exec "$REAL_DOCKER" "${original[@]}"
    ;;
  run)
    if [[ "${FAKE_CADDY_VALIDATE_FAIL:-0}" = 1 && "$*" == *"--entrypoint caddy caddy validate"* ]]; then
      exit 1
    fi
    if [[ "$*" == *"--entrypoint caddy caddy adapt"* ]]; then
      [ -n "$REAL_DOCKER" ] || {
        echo 'the caddy adapt invocation must run against the real image; install docker or run this fixture where the pinned caddy image is available.' >&2
        exit 1
      }
      exec "$REAL_DOCKER" "${original[@]}"
    fi
    if [[ "$*" == *":3100/ready"* ]]; then
      printf 'ready'
    elif [[ "$*" == *loki/api/v1/query_range* ]]; then
      marker="$(printf '%s' "$*" | grep -oE 'observability-canary-[^" ]+\.apk' | head -n1 || true)"
      printf '{"status":"success","values":[["%s"]],"event":"event=android_apk_download","statusCode":"status=404","request":"apk=%s"}' "$*" "$marker"
    else
      printf '200'
    fi
    ;;
  ps)
    if [[ "$*" == *alloy-tx* ]]; then printf 'Up\n'; else printf 'container-id\n'; fi
    ;;
esac
DOCKER
sed -i "s|@REAL_DOCKER@|$REAL_DOCKER|" "$WORK/bin/docker"
chmod 700 "$WORK/bin/ip" "$WORK/bin/docker"
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
FRONTEND_IMAGE_REF=ccr.ccs.tencentyun.com/wotbtools/wotbtools-frontend@sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd
run_frontend() {
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
    TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=frontend WOTB_DEPLOY_CONFIG_SHA="$SHA" \
    TX_FRONTEND_IMAGE_REF="$FRONTEND_IMAGE_REF" \
    WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 "$@" \
    bash "$WORK/incoming/deploy/tx/deploy.sh"
}
run_frontend FAKE_DOCKER_LOG="$WORK/docker.log" >/dev/null
run_frontend TX_BACKEND_UPSTREAM=http://10.20.0.1:8087 FAKE_DOCKER_LOG="$WORK/frontend-wg.log" >/dev/null
if run_frontend TX_BACKEND_UPSTREAM=https://api.example.invalid FAKE_DOCKER_LOG="$WORK/frontend-public-upstream.log" >/dev/null 2>&1; then
  echo 'TX deployment accepted a public Business API upstream' >&2
  exit 1
fi
grep -q '^up ' "$WORK/frontend-public-upstream.log" 2>/dev/null \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:202' >&2; exit 1; }
if run_frontend TX_BACKEND_UPSTREAM=http://10.20.0.1:9999 FAKE_DOCKER_LOG="$WORK/frontend-wrong-port.log" >/dev/null 2>&1; then
  echo 'TX deployment accepted a Business API WireGuard endpoint on the wrong port' >&2
  exit 1
fi
grep -q '^up ' "$WORK/frontend-wrong-port.log" 2>/dev/null \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:208' >&2; exit 1; }
grep -q '^pull wotb-frontend$' "$WORK/docker.log"
grep -q '^up -d --no-deps --force-recreate wotb-frontend$' "$WORK/docker.log"
grep -Eq '^up .*business-api|^up .*keycloak' "$WORK/docker.log" \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:212' >&2; exit 1; }
grep -Fq 'image: ${TX_FRONTEND_IMAGE_REF:?TX_FRONTEND_IMAGE_REF is required}' "$WORK/host/deploy/frontend.compose.yml"
[ ! -e "$WORK/host/production-release.json" ]

# The selected owner must reject unsafe rendered binds before any live recreate.
cp "$WORK/incoming/deploy/tx/frontend.compose.yml" "$WORK/frontend.compose.yml.bak"
sed -i 's/10.20.0.1:8081:80/0.0.0.0:8081:80/' "$WORK/incoming/deploy/tx/frontend.compose.yml"
if run_frontend FAKE_DOCKER_LOG="$WORK/frontend-wildcard.log" >/dev/null 2>&1; then
  echo 'TX deployment accepted a wildcard frontend binding' >&2
  exit 1
fi
grep -q '^up ' "$WORK/frontend-wildcard.log" 2>/dev/null \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:224' >&2; exit 1; }
cp "$WORK/frontend.compose.yml.bak" "$WORK/incoming/deploy/tx/frontend.compose.yml"

if run_frontend TX_FRONTEND_IMAGE_REF=ccr.ccs.tencentyun.com/wotbtools/wotbtools-frontend:latest \
  FAKE_DOCKER_LOG="$WORK/frontend-tag-ref.log" >/dev/null 2>&1; then
  echo 'TX deployment accepted a mutable frontend image tag' >&2
  exit 1
fi
grep -q '^up ' "$WORK/frontend-tag-ref.log" 2>/dev/null \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:233' >&2; exit 1; }

# The live TX edge is this promoted template: Caddy terminates TLS and proxies the
# whole wotbtools.com site to wotb-frontend:80, where the nginx template entrypoint
# renders it to /etc/nginx/conf.d/default.conf. /api/ai/** must therefore be a
# more-specific ^~ prefix (ahead of the generic /api/ location) that proxies to the
# Yecao ai-service without rewriting the path and keeps the SSE contract intact.
TEMPLATE="$WORK/host/deploy/nginx/frontend.conf.template"
AI_ROUTE="$WORK/ai-route.conf"
awk '/^    location \^~ \/api\/ai\/ \{/{inside=1} inside{print} inside&&/^    \}$/{exit}' \
  "$TEMPLATE" > "$AI_ROUTE"
grep -Fq 'location ^~ /api/ai/ {' "$AI_ROUTE" \
  || { echo 'FAIL: the staged TX template has no /api/ai/ route' >&2; exit 1; }
if grep -Fq 'rewrite ' "$AI_ROUTE"; then
  echo 'FAIL: the AI route must not rewrite the /api/ai/ path' >&2
  exit 1
fi
# No path rewrite: the public path and the ai-service controller path are both /api/ai/...
grep -Fq 'proxy_pass ${AI_UPSTREAM};' "$AI_ROUTE" \
  || { echo 'FAIL: the AI route must proxy ${AI_UPSTREAM} with no URI suffix' >&2; exit 1; }
for setting in \
  'proxy_http_version 1.1;' \
  'proxy_set_header Connection "";' \
  'proxy_buffering off;' \
  'add_header X-Accel-Buffering no always;' \
  'proxy_read_timeout 1120s;' \
  'proxy_send_timeout 1120s;' \
  'proxy_set_header Host $host;' \
  'proxy_set_header X-Real-IP $remote_addr;' \
  'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
  'proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;' \
  'proxy_set_header X-Request-ID $http_x_request_id;' \
  'proxy_set_header Authorization $http_authorization;'; do
  grep -Fq "$setting" "$AI_ROUTE" \
    || { echo "FAIL: the AI route is missing: $setting" >&2; exit 1; }
done
# ^~ already outranks a plain prefix, but the route must also be declared first so the
# boundary stays obvious to a reader.
ai_line="$(grep -n 'location ^~ /api/ai/ {' "$TEMPLATE" | head -n1 | cut -d: -f1)"
api_line="$(grep -n '^    location /api/ {' "$TEMPLATE" | head -n1 | cut -d: -f1)"
[ "$ai_line" -lt "$api_line" ] \
  || { echo 'FAIL: the AI route must precede the generic /api/ route' >&2; exit 1; }
# The generic route keeps its TX business runtime target and is never repointed.
grep -Fq 'proxy_pass ${BACKEND_UPSTREAM}/api/;' "$TEMPLATE" \
  || { echo 'FAIL: the generic /api/ route must stay on the TX business runtime' >&2; exit 1; }

# Agent WASM is served from a commit-addressed directory (/wasm/<40-hex commit>/);
# the directory name IS the content identity, so immutable long caching is correct
# (a new Agent gets a new URL and a plain refresh picks it up). The regex must stay
# pinned to the 40-hex commit segment: a bare `/wasm/` location would freeze
# whatever else lands in that directory. The regex contains `{}` and must stay quoted,
# otherwise nginx ends the location header at `{` (emerg: unknown directive "40}/").
WASM_ROUTE="$WORK/wasm-route.conf"
awk '/^    location ~ "\^\/wasm\/\[0-9a-f\]\{40\}\/" \{/{inside=1} inside{print} inside&&/^    \}$/{exit}' \
  "$TEMPLATE" > "$WASM_ROUTE"
grep -Fq 'location ~ "^/wasm/[0-9a-f]{40}/" {' "$WASM_ROUTE" \
  || { echo 'FAIL: the staged TX template has no commit-addressed (quoted) /wasm/<40-hex>/ route' >&2; exit 1; }
grep -Fq 'add_header Cache-Control "public, max-age=31536000, immutable" always;' "$WASM_ROUTE" \
  || { echo 'FAIL: the /wasm/<commit>/ route must be immutable-cacheable' >&2; exit 1; }
grep -Fq 'try_files $uri =404;' "$WASM_ROUTE" \
  || { echo 'FAIL: the /wasm/<commit>/ route must not fall back to the SPA index' >&2; exit 1; }
if grep -Eq '^    location /wasm/ \{' "$TEMPLATE"; then
  echo 'FAIL: a bare /wasm/ location would freeze non-versioned files; keep it commit-addressed' >&2
  exit 1
fi

# Fail closed: a wrong AI upstream (the TX business runtime, a public host, another
# port) or a staged template that drops / rewrites the AI route must stop the deploy
# before the live frontend is recreated.
if run_frontend TX_AI_UPSTREAM=http://business-api:8087 FAKE_DOCKER_LOG="$WORK/frontend-ai-upstream.log" \
  >/dev/null 2>&1; then
  echo 'TX deployment accepted a non-ai-service AI upstream' >&2
  exit 1
fi
grep -q '^up ' "$WORK/frontend-ai-upstream.log" 2>/dev/null \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:308' >&2; exit 1; }
STAGED_TEMPLATE="$WORK/incoming/deploy/tx/nginx/frontend.conf.template"
cp "$STAGED_TEMPLATE" "$WORK/frontend.conf.template.bak"
sed -i '\#^    location ^~ /api/ai/ {#d' "$STAGED_TEMPLATE"
if run_frontend FAKE_DOCKER_LOG="$WORK/frontend-ai-route-missing.log" >/dev/null 2>&1; then
  echo 'TX deployment accepted a template without the AI route' >&2
  exit 1
fi
grep -q '^up ' "$WORK/frontend-ai-route-missing.log" 2>/dev/null \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:317' >&2; exit 1; }
cp "$WORK/frontend.conf.template.bak" "$STAGED_TEMPLATE"
sed -i 's#proxy_pass \${AI_UPSTREAM};#proxy_pass \${AI_UPSTREAM}/api/ai/;#' "$STAGED_TEMPLATE"
if run_frontend FAKE_DOCKER_LOG="$WORK/frontend-ai-rewrite.log" >/dev/null 2>&1; then
  echo 'TX deployment accepted an AI route that rewrites /api/ai/' >&2
  exit 1
fi
grep -q '^up ' "$WORK/frontend-ai-rewrite.log" 2>/dev/null \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:325' >&2; exit 1; }
cp "$WORK/frontend.conf.template.bak" "$STAGED_TEMPLATE"

# Frontend owns the live lock wrapper. A later deployment from another owner may
# stage older wrapper bytes, but it must preserve the already-promoted live copy.
printf '%s\n' '# live-wrapper-sentinel' > "$WORK/host/deploy/with-deploy-lock.sh"
printf '%s\n' '# stale-staged-wrapper' > "$WORK/incoming/deploy/tx/with-deploy-lock.sh"

env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
  TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=caddy WOTB_DEPLOY_CONFIG_SHA="$SHA" \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 CADDY_ACME_EMAIL=ci@example.invalid \
  FAKE_DOCKER_LOG="$WORK/caddy.log" bash "$WORK/incoming/deploy/tx/deploy.sh" >/dev/null
grep -q '^up -d --no-deps --force-recreate caddy$' "$WORK/caddy.log"
grep -Fxq '# live-wrapper-sentinel' "$WORK/host/deploy/with-deploy-lock.sh" \
  || { echo 'non-frontend deployment replaced the frontend-owned TX lock wrapper' >&2; exit 1; }
# The staged gateway config must be validated by the real Caddy executable before
# the gateway is recreated: the published image has no ENTRYPOINT, so the
# validation has to pin `--entrypoint caddy` explicitly.
grep -q '^run .*--entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile$' "$WORK/caddy.log"
grep -Eq '^up .*business-api|^up .*keycloak' "$WORK/caddy.log" \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:346' >&2; exit 1; }
if env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
  TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=caddy WOTB_DEPLOY_CONFIG_SHA="$SHA" \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 CADDY_ACME_EMAIL=ci@example.invalid \
  FAKE_CADDY_VALIDATE_FAIL=1 FAKE_DOCKER_LOG="$WORK/caddy-fail.log" \
  bash "$WORK/incoming/deploy/tx/deploy.sh" >/dev/null 2>&1; then
  echo 'Caddy deployment accepted invalid staged configuration' >&2
  exit 1
fi
grep -q '^up ' "$WORK/caddy-fail.log" \
  && { echo 'forbidden construction still present at deploy/test-tx-runtime-config.sh:357' >&2; exit 1; }

# The delegated `caddy adapt` runs the real Compose project (`-p deploy`), which allocates a Docker
# network from the daemon's default address pool. Release it here so later fixtures in the same job
# keep the full pool (the nginx/Grafana fixture needs an explicit 172.29.0.0/16 subnet).
if [ -n "$REAL_DOCKER" ]; then
  "$REAL_DOCKER" network rm deploy_default >/dev/null 2>&1 || true
fi
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
  TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=keycloak WOTB_DEPLOY_CONFIG_SHA="$SHA" \
  WOTB_TX_BOOTSTRAP_KEYCLOAK=1 WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  KC_POSTGRES_ADMIN_USER=ci KC_POSTGRES_ADMIN_PASSWORD=ci KC_BOOTSTRAP_ADMIN_PASSWORD=ci \
  KC_DB_USERNAME=ci KC_DB_PASSWORD=ci WG_APPLICATION_ID=ci \
  FAKE_DOCKER_LOG="$WORK/keycloak.log" bash "$WORK/incoming/deploy/tx/deploy.sh" >/dev/null
grep -q '^up -d --no-deps --force-recreate keycloak$' "$WORK/keycloak.log"
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
  TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=alloy-tx WOTB_DEPLOY_CONFIG_SHA="$SHA" \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$WORK/alloy.log" bash "$WORK/incoming/deploy/tx/deploy.sh" >"$WORK/alloy.out"
grep -q '^up -d --no-deps --force-recreate alloy-tx$' "$WORK/alloy.log"
grep -Fq 'alloy-tx: PASS' "$WORK/alloy.out"
cmp -s "$ROOT/deploy/tx/alloy/config.alloy" "$WORK/host/deploy/alloy/config.alloy"
echo 'TX owner deployment contracts and frontend immutable image pin: PASS'
