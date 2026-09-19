#!/usr/bin/env bash
# Deterministic contracts for the TX edge runtime. No public endpoint, DNS, or
# live host is touched by this test.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TX_DIR="$ROOT/deploy/tx"
COMPOSE="$TX_DIR/docker-compose.yml"
TEMPLATE="$TX_DIR/nginx/frontend.conf.template"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
readonly NGINX_TEST_IMAGE="nginx@sha256:62ff2089abf5a9ed33bd232895bef5e22f7bb4b200675cec49a5ebc48e3d4ac8"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_fixture() {
  local label="$1" output_file="$2" error_file="$3"
  shift 3
  if "$@" > "$output_file" 2> "$error_file"; then
    return 0
  fi
  local diagnostics
  diagnostics="$(tr '\r\n' ' ' < "$error_file" | sed -E 's/[[:space:]]+/ /g')"
  fail "$label failed (stderr: ${diagnostics:-no stderr output})"
}

! grep -Fq 'TX_RUNTIME_ENV_FILE' "$TX_DIR/deploy.sh" \
  || fail "TX deploy must not depend on a local runtime env file"
! grep -Fq 'load_runtime_environment' "$TX_DIR/deploy.sh" \
  || fail "TX deploy must read runtime variables from the process environment"
! grep -Fq 'TX sponsor config is missing' "$TX_DIR/deploy.sh" \
  || fail "TX sponsor content must remain optional"
! grep -Fq 'TX sponsor asset directory is missing' "$TX_DIR/deploy.sh" \
  || fail "TX sponsor assets must remain optional"
! grep -Fq 'TX Android release directory is missing' "$TX_DIR/deploy.sh" \
  || fail "TX Android release content must not become a sponsor hard requirement"
grep -Fq 'deploy.incoming/deploy/tx' "$TX_DIR/deploy.sh" \
  || fail "TX deploy default incoming path must preserve the SCP source directory prefix"
preflight_host_block="$(sed -n '/^preflight_host()/,/^}/p' "$TX_DIR/deploy.sh")"
! grep -Fq '10.20.0.2:8087' <<< "$preflight_host_block" \
  || fail "host prerequisite must not probe the unpublished backend port"

grep -Fq '127.0.0.1:15432:5432' "$COMPOSE" \
  || fail "Keycloak PostgreSQL must bind its administration port to TX loopback"
grep -Fq '10.20.0.1:5672:5672' "$COMPOSE" \
  || fail "RabbitMQ AMQP must bind only to the TX WireGuard address"
grep -Fq '127.0.0.1:15672:15672' "$COMPOSE" \
  || fail "RabbitMQ management must remain TX-loopback only"
grep -Fq 'rabbitmq:4.3.6-management-alpine' "$COMPOSE" \
  || fail "RabbitMQ runtime image must stay explicitly pinned"
! grep -Eq '(^|[^0-9])5432:5432' "$COMPOSE" \
  || fail "Keycloak PostgreSQL must not publish 5432 on all interfaces"
grep -Fq 'BACKEND_UPSTREAM: ${TX_BACKEND_UPSTREAM:-http://10.20.0.2:8087}' "$COMPOSE" \
  || fail "frontend must default its API upstream to the Yecao WireGuard address"
grep -Fq 'NGINX_ENVSUBST_FILTER: ^BACKEND_UPSTREAM$$' "$COMPOSE" \
  || fail "nginx must substitute only the configured backend upstream"
grep -Fq 'ipv4_address: 172.29.0.2' "$COMPOSE" \
  || fail "Caddy must have a fixed trusted ingress address"
[ "$(grep -Fc 'name: wotb_tx_internal' "$COMPOSE")" = 1 ] \
  || fail "TX Compose must define one internal network, not duplicate aliases"
grep -Fq '${CADDY_HTTP_BIND:-127.0.0.1}:80:80' "$COMPOSE" \
  || fail "Stage I Caddy HTTP must remain loopback-only by default"
grep -Fq '${CADDY_HTTPS_BIND:-127.0.0.1}:443:443' "$COMPOSE" \
  || fail "Stage I Caddy HTTPS must remain loopback-only by default"
! grep -Eq '\b(nsupdate|route53|cloudflare|gcloud dns|az network dns)\b' "$TX_DIR/deploy.sh" \
  || fail "TX deploy script must not contain DNS control commands"
! grep -Fq "wait_for_probe caddy http://caddy/" "$TX_DIR/deploy.sh" \
  || fail "Caddy readiness must not use the formal HTTP-to-HTTPS site"

for route in \
  'proxy_pass ${BACKEND_UPSTREAM};' \
  'proxy_pass ${BACKEND_UPSTREAM}/api/;' \
  'proxy_read_timeout 1120s;' \
  'location = /download/android/version.json {'; do
  grep -Fq "$route" "$TEMPLATE" || fail "TX frontend nginx lost required route contract: $route"
done
grep -Fq 'set_real_ip_from 172.29.0.2;' "$TEMPLATE" \
  || fail "TX frontend must trust only the fixed Caddy peer for client IPs"
! grep -Fq 'keycloak:8080' "$TEMPLATE" \
  || fail "frontend nginx must not own the Keycloak public route"
grep -Fq 'handle /.well-known/assetlinks.json' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy must serve the Android App Link association before Keycloak"
grep -Fq 'http://172.29.0.2 {' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy must expose readiness only on its fixed internal address"
grep -Fq 'handle /_wotb/ready' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy must expose an explicit internal readiness endpoint"
grep -Fq 'handle_path /_wotb/frontend/*' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy readiness must exercise the frontend routing contract"
grep -Fq 'handle_path /_wotb/keycloak/*' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy readiness must exercise the Keycloak routing contract"
grep -Fq 'wait_for_probe wireguard-backend http://10.20.0.2:8087/api/health' "$TX_DIR/deploy.sh" \
  || fail "TX deploy must directly probe the WireGuard backend path"
for probe in \
  'http://172.29.0.2/_wotb/ready' \
  'http://172.29.0.2/_wotb/frontend/api/health' \
  'http://172.29.0.2/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration'; do
  grep -Fq "$probe" "$TX_DIR/deploy.sh" \
    || fail "TX deploy must probe the Caddy internal readiness route: $probe"
done
grep -Fq './assets/auth/.well-known/assetlinks.json:/srv/.well-known/assetlinks.json:ro' "$COMPOSE" \
  || fail "TX Caddy must mount the Android App Link association payload"

export TAG=sha-0123456789ab
export KC_POSTGRES_ADMIN_USER=kc_admin
export KC_POSTGRES_ADMIN_PASSWORD=not-real
export KC_BOOTSTRAP_ADMIN_PASSWORD=not-real
export KC_DB_USERNAME=keycloak
export KC_DB_PASSWORD=not-real
export WG_APPLICATION_ID=not-real
export CADDY_ACME_EMAIL=ops@example.test
export TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin
export TX_RABBITMQ_ADMIN_PASSWORD=not-real
export TX_RABBITMQ_CONTROL_API_PASSWORD=not-real-control-api
export TX_RABBITMQ_PARSER_WORKER_PASSWORD=not-real-parser-worker
export TX_RUNTIME_ROOT="$WORK/runtime"
mkdir -p "$TX_RUNTIME_ROOT/config/sponsor" "$TX_RUNTIME_ROOT/android-release"

docker compose -f "$COMPOSE" config > "$WORK/compose.yml"
grep -Fq 'host_ip: 127.0.0.1' "$WORK/compose.yml" \
  || fail "resolved Keycloak PostgreSQL publication must stay on loopback"
grep -Fq 'published: "80"' "$WORK/compose.yml" \
  || fail "resolved Caddy HTTP publication must exist for an approved cutover"
[ "$(grep -Fc 'host_ip: 127.0.0.1' "$WORK/compose.yml")" -ge 4 ] \
  || fail "Stage I Caddy and PostgreSQL publications must all resolve to loopback"
grep -Fq 'BACKEND_UPSTREAM: http://10.20.0.2:8087' "$WORK/compose.yml" \
  || fail "resolved frontend upstream must remain on WireGuard"
grep -Fq 'target: /etc/nginx/templates/default.conf.template' "$WORK/compose.yml" \
  || fail "frontend must mount its target-scoped nginx template"

run_fixture "Caddy adapt fixture" "$WORK/caddy.json" "$WORK/caddy.stderr" \
  docker run --rm -e CADDY_ACME_EMAIL \
  -v "$TX_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile
grep -Fq 'wotb-frontend:80' "$WORK/caddy.json" \
  || fail "Caddy must forward the public application host to the frontend"
grep -Fq 'keycloak:8080' "$WORK/caddy.json" \
  || fail "Caddy must forward auth traffic to Keycloak"
grep -Fq 'assetlinks.json' "$WORK/caddy.json" \
  || fail "Caddy must retain the Android App Link association route"
grep -Fq '_wotb/ready' "$WORK/caddy.json" \
  || fail "Caddy adapt output must retain the internal readiness route"
echo "OK: Caddy fixture contract"

# Invoke envsubst explicitly: overriding the nginx image entrypoint with
# `nginx -T` would inspect the stock config and never render this template.
run_fixture "nginx template fixture" "$WORK/nginx.conf" "$WORK/nginx.stderr" \
  docker run --rm \
  -e BACKEND_UPSTREAM=http://10.20.0.2:8087 \
  -v "$TEMPLATE:/etc/nginx/templates/default.conf.template:ro" \
  "$NGINX_TEST_IMAGE" sh -ec "envsubst '\${BACKEND_UPSTREAM}' < /etc/nginx/templates/default.conf.template"
grep -Fq 'proxy_pass http://10.20.0.2:8087/api/;' "$WORK/nginx.conf" \
  || fail "nginx template did not render the configured WireGuard API upstream"
! grep -Fq '${BACKEND_UPSTREAM}' "$WORK/nginx.conf" \
  || fail "nginx left an unresolved backend template expression"
echo "OK: nginx fixture contract"

# Exercise staging/promotion with a fake local Docker CLI: this proves the TX
# script uses only its staged tree and performs internal probes, without any
# network/DNS action in CI.
mkdir -p "$WORK/incoming" "$WORK/bin" "$WORK/live/config/sponsor" "$WORK/live/android-release"
cp -a "$TX_DIR/." "$WORK/incoming/"
cat > "$WORK/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:?}"
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
if [ "${1:-}" = version ]; then
  [ "${FAKE_COMPOSE_FAIL:-0}" != 1 ]
  exit
fi
case "${1:-}" in
  config|pull|up|stop|ps|logs) exit 0 ;;
  exec) exit 0 ;;
  run) printf '200\n'; exit 0 ;;
  *) exit 0 ;;
esac
FAKE_DOCKER
chmod 700 "$WORK/bin/docker"
cat > "$WORK/bin/ip" <<'FAKE_IP'
#!/usr/bin/env bash
set -Eeuo pipefail
case "${1:-}" in
  link) [ "${FAKE_WG_MISSING:-0}" != 1 ] ;;
  -4)
    [ "${FAKE_WG_MISSING:-0}" != 1 ] || exit 1
    if [ "${FAKE_WG_ADDRESS_INVALID:-0}" = 1 ]; then
      printf '    inet 10.20.0.9/24\n'
    else
      printf '    inet 10.20.0.1/24\n'
    fi
    ;;
  route) [ "${FAKE_ROUTE_MISSING:-0}" != 1 ] ;;
  *) exit 1 ;;
esac
FAKE_IP
chmod 700 "$WORK/bin/ip"

set +e
rabbit_only_output="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  TX_DEPLOY_LIBRARY_ONLY=1 WOTB_TX_DIR="$WORK/rabbit-only" WOTB_TX_INCOMING_DIR="$WORK/incoming" \
  TX_RUNTIME_ROOT="$WORK/rabbit-only" TAG=sha-0123456789ab \
  RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=rabbitmq WOTB_DEPLOY_IMAGE_SERVICES='' \
  TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
  TX_RABBITMQ_CONTROL_API_PASSWORD=not-real-control-api \
  TX_RABBITMQ_PARSER_WORKER_PASSWORD=not-real-parser-worker \
  bash -c 'source "$1"; validate_inputs; set_nonselected_compose_placeholders; test "$(current_or_target_tag keycloak)" = sha-0123456789ab; test "$KC_DB_PASSWORD" = not-configured; echo rabbitmq-only-inputs-pass' _ "$WORK/incoming/deploy.sh")"
rabbit_only_rc=$?
set -e
[ "$rabbit_only_rc" -eq 0 ] \
  || fail "RabbitMQ-only input contract failed (rc=$rabbit_only_rc; output: $(tr '\r\n' ' ' <<< "$rabbit_only_output" | sed -E 's/[[:space:]]+/ /g'))"
grep -Fq 'rabbitmq-only-inputs-pass' <<< "$rabbit_only_output" \
  || fail "RabbitMQ-only deployment must not require Keycloak/PostgreSQL/Caddy inputs or image metadata"

run_prerequisite_failure() {
  local label="$1" expected="$2" path output rc
  shift 2
  path="$1"
  shift
  set +e
  output="$(env -i PATH="$path" HOME="$WORK" \
    WOTB_TX_DIR="$WORK/prereq-$label" WOTB_TX_INCOMING_DIR="$WORK/incoming" TX_RUNTIME_ROOT="$WORK/prereq-$label" \
    KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
    KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
    WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
    TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
    WOTB_DEPLOY_SERVICES=keycloak-postgres FAKE_DOCKER_LOG="$WORK/prereq-$label.log" \
    "$@" /bin/bash "$WORK/incoming/deploy.sh" 2>&1)"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "$label prerequisite must fail"
  grep -Fq "$expected" <<< "$output" || fail "$label prerequisite must report $expected"
}

run_prerequisite_failure docker-missing "docker is required" "$WORK/empty-path"
run_prerequisite_failure compose-missing "docker compose is required" "$WORK/bin:$PATH" env FAKE_COMPOSE_FAIL=1
run_prerequisite_failure wg-missing "wg0 is required" "$WORK/bin:$PATH" env FAKE_WG_MISSING=1
run_prerequisite_failure wg-address-invalid "wg0 must have 10.20.0.1/24" "$WORK/bin:$PATH" env FAKE_WG_ADDRESS_INVALID=1
run_prerequisite_failure route-missing "a route to 10.20.0.2 is required" "$WORK/bin:$PATH" env FAKE_ROUTE_MISSING=1

mkdir -p "$WORK/bootstrap" "$WORK/bootstrap-incoming"
cp -a "$TX_DIR/." "$WORK/bootstrap-incoming/"
printf 'tx-local-opentofu-keycloak\n' > "$WORK/bootstrap/keycloak.tofu-provisioned"
set +e
bootstrap_output="$(env -i \
  PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/bootstrap" WOTB_TX_INCOMING_DIR="$WORK/bootstrap-incoming" TX_RUNTIME_ROOT="$WORK/bootstrap" \
  KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
  KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
  WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=keycloak-postgres WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$WORK/bootstrap-docker.log" \
  bash "$WORK/bootstrap-incoming/deploy.sh" 2>&1)"
bootstrap_rc=$?
set -e
[ "$bootstrap_rc" -eq 0 ] \
  || fail "PostgreSQL-only bootstrap failed (rc=$bootstrap_rc; output: $bootstrap_output)"
grep -Fq 'keycloak-postgres: PASS' <<< "$bootstrap_output" \
  || fail "first TX bootstrap must permit PostgreSQL before Keycloak image metadata exists"
grep -Fq 'TX deployment completed:' <<< "$bootstrap_output" \
  || fail "PostgreSQL-only bootstrap must complete after its health check"
[ ! -e "$WORK/bootstrap/keycloak.tofu-provisioned" ] \
  || fail "PostgreSQL-only bootstrap must invalidate stale marker at $WORK/bootstrap/keycloak.tofu-provisioned (output: $bootstrap_output)"
grep -Fq 'pull keycloak-postgres' "$WORK/bootstrap-docker.log" \
  || fail "PostgreSQL bootstrap must pull only its selected runtime image"
! grep -Fq 'pull keycloak-postgres keycloak' "$WORK/bootstrap-docker.log" \
  || fail "PostgreSQL bootstrap must not pull unselected Keycloak/frontend images"

set +e
unprovisioned_output="$(env -i \
  PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/live" WOTB_TX_INCOMING_DIR="$WORK/incoming" TX_RUNTIME_ROOT="$WORK/live" \
  KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
  KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
  WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=keycloak-postgres,keycloak,wotb-frontend FAKE_DOCKER_LOG="$WORK/unprovisioned.log" \
  bash "$WORK/incoming/deploy.sh" 2>&1)"
unprovisioned_rc=$?
set -e
[ "$unprovisioned_rc" -ne 0 ] || fail "TX app deployment must refuse a missing local OpenTofu provision marker"
grep -Fq 'run TX-local OpenTofu' <<< "$unprovisioned_output" \
  || fail "TX app deployment must explain the required PostgreSQL-to-OpenTofu boundary"
[ ! -f "$WORK/unprovisioned.log" ] || fail "unprovisioned TX app deployment must not invoke Docker"
printf 'tx-local-opentofu-keycloak\n' > "$WORK/live/keycloak.tofu-provisioned"
chmod 600 "$WORK/live/keycloak.tofu-provisioned"
printf '%s\n' '{"schemaVersion":1,"services":{"keycloak":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"},"wotb-frontend":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"}}}' \
  > "$WORK/live/tx-production-release.json"

set +e
deploy_output="$(env -i \
  PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/live" WOTB_TX_INCOMING_DIR="$WORK/incoming" TX_RUNTIME_ROOT="$WORK/live" \
  KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
  KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
  WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=keycloak-postgres,keycloak,wotb-frontend WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$WORK/docker.log" \
  bash "$WORK/incoming/deploy.sh" 2>&1)"
deploy_rc=$?
set -e
[ "$deploy_rc" -eq 0 ] \
  || fail "TX app deployment failed (rc=$deploy_rc; output: $(tr '\r\n' ' ' <<< "$deploy_output" | sed -E 's/[[:space:]]+/ /g'))"
grep -Fq 'DNS cutover remains an explicit operator action' <<< "$deploy_output" \
  || fail "TX deploy must report that cutover remains manual"
grep -Fq 'wireguard-backend: PASS' <<< "$deploy_output" \
  || fail "TX deploy must report the direct WireGuard backend probe"
grep -Fq 'run --rm --no-deps health-probe --silent --show-error --connect-timeout' "$WORK/docker.log" \
  || fail "TX deploy must run backend probes from the deployment-owned health-probe"
grep -Fq 'http://10.20.0.2:8087/api/health' "$WORK/docker.log" \
  || fail "TX deploy must probe the WireGuard backend URL directly"
grep -Fq 'up -d --no-deps --force-recreate keycloak-postgres' "$WORK/docker.log" \
  || fail "TX deploy must start selected Keycloak PostgreSQL locally"
! grep -Fq 'rabbitmq' "$WORK/docker.log" \
  || fail "non-RabbitMQ TX deployment must not start or health-check RabbitMQ"
grep -Fq 'up -d --no-deps --force-recreate caddy' "$WORK/docker.log" \
  || fail "TX deploy must apply Caddy only through the staged TX runtime"
grep -Fq 'run --rm --no-deps health-probe' "$WORK/docker.log" \
  || fail "TX deploy must use an internal health-probe service"
grep -Fq 'imageTag' "$WORK/live/tx-production-release.json" \
  || fail "TX deploy must record immutable image identity after health succeeds"

run_live_service_deploy() {
  local services="$1" image_services="$2" log="$3"
  env -i \
    PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_TX_DIR="$WORK/live" WOTB_TX_INCOMING_DIR="$WORK/incoming" TX_RUNTIME_ROOT="$WORK/live" \
    KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
    KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
    WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
    TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
    WOTB_DEPLOY_SERVICES="$services" WOTB_DEPLOY_IMAGE_SERVICES="$image_services" \
    WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
    FAKE_DOCKER_LOG="$log" \
    bash "$WORK/incoming/deploy.sh"
}

frontend_log="$WORK/frontend.log"
frontend_output="$(run_live_service_deploy wotb-frontend wotb-frontend "$frontend_log" 2>&1)"
grep -Fq 'TX deployment completed:' <<< "$frontend_output" \
  || fail "Normal frontend deployment must complete"
grep -Fq 'up -d --no-deps --force-recreate wotb-frontend' "$frontend_log" \
  || fail "Normal frontend deployment must start the frontend"
grep -Fq 'up -d --no-deps --force-recreate caddy' "$frontend_log" \
  || fail "Normal frontend deployment must preserve Caddy recreation"

caddy_log="$WORK/caddy.log"
caddy_output="$(run_live_service_deploy caddy '' "$caddy_log" 2>&1)"
grep -Fq 'TX deployment completed:' <<< "$caddy_output" \
  || fail "Explicit Caddy deployment must complete"
[ "$(grep -Fc 'up -d --no-deps --force-recreate caddy' "$caddy_log")" -ge 2 ] \
  || fail "Explicit Caddy deployment must preserve its selected start and recreate behavior"

mkdir -p "$WORK/keycloak-bootstrap" "$WORK/keycloak-bootstrap-incoming"
cp -a "$TX_DIR/." "$WORK/keycloak-bootstrap-incoming/"
printf '%s\n' '{"schemaVersion":1,"services":{"wotb-frontend":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"}}}' \
  > "$WORK/keycloak-bootstrap/tx-production-release.json"
bootstrap_keycloak_log="$WORK/keycloak-bootstrap.log"
bootstrap_keycloak_output="$(env -i \
  PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/keycloak-bootstrap" WOTB_TX_INCOMING_DIR="$WORK/keycloak-bootstrap-incoming" TX_RUNTIME_ROOT="$WORK/keycloak-bootstrap" \
  KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
  KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
  WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_TX_BOOTSTRAP_KEYCLOAK=1 WOTB_DEPLOY_SERVICES=keycloak WOTB_DEPLOY_IMAGE_SERVICES=keycloak \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$bootstrap_keycloak_log" \
  bash "$WORK/keycloak-bootstrap-incoming/deploy.sh" 2>&1)"
grep -Fq 'TX deployment completed:' <<< "$bootstrap_keycloak_output" \
  || fail "Keycloak bootstrap must complete after its master realm health check"
grep -Fq 'up -d --no-deps --force-recreate keycloak' "$bootstrap_keycloak_log" \
  || fail "Keycloak bootstrap must start Keycloak"
! grep -Fq 'caddy' "$bootstrap_keycloak_log" \
  || fail "Keycloak bootstrap must not pull, recreate, health-check, restart, or stop Caddy"

mkdir -p "$WORK/keycloak-normal" "$WORK/keycloak-normal-incoming"
cp -a "$TX_DIR/." "$WORK/keycloak-normal-incoming/"
printf 'tx-local-opentofu-keycloak\n' > "$WORK/keycloak-normal/keycloak.tofu-provisioned"
printf '%s\n' '{"schemaVersion":1,"services":{"wotb-frontend":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"}}}' \
  > "$WORK/keycloak-normal/tx-production-release.json"
normal_keycloak_log="$WORK/keycloak-normal.log"
normal_keycloak_output="$(env -i \
  PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/keycloak-normal" WOTB_TX_INCOMING_DIR="$WORK/keycloak-normal-incoming" TX_RUNTIME_ROOT="$WORK/keycloak-normal" \
  KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
  KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
  WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_TX_BOOTSTRAP_KEYCLOAK=0 WOTB_DEPLOY_SERVICES=keycloak WOTB_DEPLOY_IMAGE_SERVICES=keycloak \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$normal_keycloak_log" \
  bash "$WORK/keycloak-normal-incoming/deploy.sh" 2>&1)"
grep -Fq 'TX deployment completed:' <<< "$normal_keycloak_output" \
  || fail "Normal Keycloak deployment must complete"
grep -Fq 'up -d --no-deps --force-recreate keycloak' "$normal_keycloak_log" \
  || fail "Normal Keycloak deployment must start Keycloak"
grep -Fq 'up -d --no-deps --force-recreate caddy' "$normal_keycloak_log" \
  || fail "Normal Keycloak deployment must preserve Caddy recreation"

set +e
invalid_upstream_output="$(env -i \
  PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/invalid-upstream" WOTB_TX_INCOMING_DIR="$WORK/incoming" TX_RUNTIME_ROOT="$WORK/invalid-upstream" \
  KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
  KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
  WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test TX_BACKEND_UPSTREAM=https://example.test \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=keycloak-postgres FAKE_DOCKER_LOG="$WORK/invalid-upstream.log" \
  bash "$WORK/incoming/deploy.sh" 2>&1)"
invalid_upstream_rc=$?
set -e
[ "$invalid_upstream_rc" -ne 0 ] || fail "TX deploy must reject a non-WireGuard API upstream"
grep -Fq 'WireGuard-only backend URL' <<< "$invalid_upstream_output" \
  || fail "TX deploy must explain a rejected non-WireGuard API upstream"

set +e
missing_secret_output="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/missing-secret" WOTB_TX_INCOMING_DIR="$WORK/incoming" TX_RUNTIME_ROOT="$WORK/missing-secret" \
  KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
  KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak \
  WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_RABBITMQ_ADMIN_USER=tx-rabbitmq-admin TX_RABBITMQ_ADMIN_PASSWORD=not-real \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=keycloak-postgres FAKE_DOCKER_LOG="$WORK/missing-secret.log" \
  bash "$WORK/incoming/deploy.sh" 2>&1)"
missing_secret_rc=$?
set -e
[ "$missing_secret_rc" -ne 0 ] || fail "TX deploy must fail closed when a required runtime secret is missing"
grep -Fq 'KC_DB_PASSWORD is required' <<< "$missing_secret_output" \
  || fail "missing runtime secret error must name the variable without exposing a value"
! grep -Fq 'not-real' <<< "$missing_secret_output" \
  || fail "missing runtime secret diagnostics must not print secret values"

echo "OK: TX Compose/Caddy/nginx/deploy contracts are deterministic and DNS-free"
