#!/usr/bin/env bash
# Deterministic contracts for the TX edge runtime. No public endpoint, DNS, or
# live host is touched by this test.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TX_DIR="$ROOT/deploy/tx"
COMPOSE="$TX_DIR/docker-compose.yml"
TEMPLATE="$TX_DIR/nginx/frontend.conf.template"
WORK="$(mktemp -d)"
readonly MINIO_CONTAINER="wotb-tx-e2e-minio-$$"
readonly MINIO_IMAGE="quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z"
cleanup() {
  docker rm -f "$MINIO_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
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
grep -Fq 'image: postgres:18-alpine' "$COMPOSE" \
  || fail "PostgreSQL runtimes must stay on the pinned postgres:18-alpine image"
grep -Fq '127.0.0.1:25432:5432' "$COMPOSE" \
  || fail "Business PostgreSQL must bind its administration port to TX loopback only"
grep -Fq 'business_postgres_data:/var/lib/postgresql' "$COMPOSE" \
  || fail "Business PostgreSQL must persist to its own dedicated volume"
grep -Fq 'POSTGRES_DB: postgres' "$COMPOSE" \
  || fail "Business PostgreSQL must not let the image auto-create the OpenTofu-owned business database"
grep -Fq 'TX_BUSINESS_POSTGRES_ADMIN_USER:?TX_BUSINESS_POSTGRES_ADMIN_USER is required' "$COMPOSE" \
  || fail "Business PostgreSQL must require a dedicated bootstrap administrator separate from the application role"
business_postgres_block="$(sed -n '/^  business-postgres:/,/^  [A-Za-z0-9_-]*:$/p' "$COMPOSE")"
! grep -Fq 'TX_BUSINESS_DB_PASSWORD' <<< "$business_postgres_block" \
  || fail "the Business PostgreSQL runtime must not receive the application credential"
grep -Fq '10.20.0.1:5672:5672' "$COMPOSE" \
  || fail "RabbitMQ AMQP must bind only to the TX WireGuard address"
grep -Fq '127.0.0.1:15672:15672' "$COMPOSE" \
  || fail "RabbitMQ management must remain TX-loopback only"
grep -Fq 'rabbitmq:4.3.6-management-alpine' "$COMPOSE" \
  || fail "RabbitMQ runtime image must stay explicitly pinned"
! grep -Eq '(^|[^0-9])5432:5432' "$COMPOSE" \
  || fail "Keycloak PostgreSQL must not publish 5432 on all interfaces"
! grep -Eq '(^|[^0-9:.])25432:5432' "$COMPOSE" \
  || fail "Business PostgreSQL must not publish 25432 on all interfaces"
grep -Fq 'BACKEND_UPSTREAM: ${TX_BACKEND_UPSTREAM:-http://business-api:8087}' "$COMPOSE" \
  || fail "frontend must default its API upstream to the TX-internal business runtime"
! grep -Fq '10.20.0.2:8087' "$COMPOSE" \
  || fail "the TX Compose document must not reference the retired Yecao backend route"
grep -Fq 'NGINX_ENVSUBST_FILTER: ^BACKEND_UPSTREAM$$' "$COMPOSE" \
  || fail "nginx must substitute only the configured backend upstream"
for caddy_config in "$COMPOSE" "$TX_DIR/Caddyfile" "$TEMPLATE" "$TX_DIR/deploy.sh"; do
  ! grep -Fq '172.29.0.2' "$caddy_config" \
    || fail "TX runtime/config must not hardcode a Caddy container address: $caddy_config"
done
frontend_block="$(sed -n '/^  wotb-frontend:/,/^  [A-Za-z0-9_-]*:$/p' "$COMPOSE")"
caddy_block="$(sed -n '/^  caddy:/,/^volumes:/p' "$COMPOSE")"
grep -Fq '      - caddy' <<< "$frontend_block" \
  || fail "frontend must start after the trusted Caddy service DNS name exists"
! grep -Fq '      - wotb-frontend' <<< "$caddy_block" \
  || fail "Caddy must not wait for nginx before its trusted DNS name is available"
# The TX business runtime replaces the retired Yecao `wotb-backend` service: one
# in-process control plane plus business API, no published port, and a
# distributed-only replay execution plane.
business_api_block="$(sed -n '/^  business-api:/,/^  [A-Za-z0-9_-]*:$/p' "$COMPOSE")"
[ -n "$business_api_block" ] || fail "TX Compose must define the business-api runtime"
grep -Fq 'ghcr.io/a158coke/wotbtools-backend:${TAG:?TAG is required}' <<< "$business_api_block" \
  || fail "business-api must run the immutable backend image"
! grep -Eq '^    ports:' <<< "$business_api_block" \
  || fail "business-api must never publish a port; only TX-internal peers may reach it"
for contract in \
  'POSTGRES_HOST: business-postgres' \
  'WOTB_REPLAY_EXECUTION_MODE: distributed' \
  'WOTB_REPLAY_PROCESSING_JOB_REPOSITORY: jdbc' \
  'KEYCLOAK_ADMIN_SERVER_URL: http://keycloak:8080' \
  'TX_RABBITMQ_HOST: rabbitmq' \
  'YECAO_MINIO_CONTROL_API_ACCESS_KEY: ${YECAO_MINIO_CONTROL_API_ACCESS_KEY:?YECAO_MINIO_CONTROL_API_ACCESS_KEY is required}' \
  'replay_data:/data/replays'; do
  grep -Fq "$contract" <<< "$business_api_block" \
    || fail "business-api lost required runtime contract: $contract"
done
grep -Fq 'replay_data:' <<< "$(sed -n '/^volumes:/,$p' "$COMPOSE")" \
  || fail "TX Compose must own the migrated HoF replay volume"
grep -Fq 'TX_BUSINESS_DB_PASSWORD:?TX_BUSINESS_DB_PASSWORD is required' <<< "$business_api_block" \
  || fail "business-api must fail closed on a missing application database credential"
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
grep -Fq 'set_real_ip_from caddy;' "$TEMPLATE" \
  || fail "TX frontend must trust only the Caddy Docker service for client IPs"
! grep -Fq 'keycloak:8080' "$TEMPLATE" \
  || fail "frontend nginx must not own the Keycloak public route"
grep -Fq 'handle /.well-known/assetlinks.json' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy must serve the Android App Link association before Keycloak"
grep -Fq 'http://caddy {' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy must expose readiness through its Docker service name"
grep -Fq 'handle /_wotb/ready' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy must expose an explicit internal readiness endpoint"
grep -Fq 'handle_path /_wotb/frontend/*' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy readiness must exercise the frontend routing contract"
grep -Fq 'handle_path /_wotb/keycloak/*' "$TX_DIR/Caddyfile" \
  || fail "TX Caddy readiness must exercise the Keycloak routing contract"
! grep -Fq 'wireguard-backend' "$TX_DIR/deploy.sh" \
  || fail "TX deploy must not depend on or probe the retired Yecao backend route"
for probe in \
  'http://caddy/_wotb/ready' \
  'http://caddy/_wotb/frontend/api/health' \
  'http://caddy/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration'; do
  grep -Fq "$probe" "$TX_DIR/deploy.sh" \
    || fail "TX deploy must probe the Caddy internal readiness route: $probe"
done
grep -Fq 'assert_routing_boundary "$EFFECTIVE_COMPOSE"' "$TX_DIR/deploy.sh" \
  || fail "TX deploy must fail closed on the routing and execution-plane boundary before staging"
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
export TX_BUSINESS_POSTGRES_ADMIN_USER=tx-business-admin
export TX_BUSINESS_POSTGRES_ADMIN_PASSWORD=not-real-business-admin
export TX_BUSINESS_DB_NAME=wotb
export TX_BUSINESS_DB_USERNAME=control_api
export TX_BUSINESS_DB_PASSWORD=not-real-control-api
export TX_BUSINESS_DB_PASSWORD_VERSION=1
export YECAO_MINIO_CONTROL_API_ACCESS_KEY=not-real-minio-control-api
export YECAO_MINIO_CONTROL_API_SECRET_KEY=not-real-minio-control-api
export KEYCLOAK_ADMIN_CLIENT_SECRET=not-real-admin-secret
export AI_API_KEY=not-real-ai-key
export TX_RUNTIME_ROOT="$WORK/runtime"
mkdir -p "$TX_RUNTIME_ROOT/config/sponsor" "$TX_RUNTIME_ROOT/android-release"

docker compose -f "$COMPOSE" config > "$WORK/compose.yml"
grep -Fq 'host_ip: 127.0.0.1' "$WORK/compose.yml" \
  || fail "resolved Keycloak PostgreSQL publication must stay on loopback"
grep -Fq 'published: "80"' "$WORK/compose.yml" \
  || fail "resolved Caddy HTTP publication must exist for an approved cutover"
[ "$(grep -Fc 'host_ip: 127.0.0.1' "$WORK/compose.yml")" -ge 5 ] \
  || fail "Stage I Caddy and both PostgreSQL publications must all resolve to loopback"
grep -Fq 'BACKEND_UPSTREAM: http://business-api:8087' "$WORK/compose.yml" \
  || fail "resolved frontend upstream must be the TX-internal business runtime"
! grep -Fq '10.20.0.2:8087' "$WORK/compose.yml" \
  || fail "resolved TX runtime must not contain the retired Yecao backend route"
grep -Fq 'target: /etc/nginx/templates/default.conf.template' "$WORK/compose.yml" \
  || fail "frontend must mount its target-scoped nginx template"
grep -Fq 'WOTB_REPLAY_EXECUTION_MODE: distributed' "$WORK/compose.yml" \
  || fail "resolved business-api must run in distributed replay execution mode"
grep -Fq 'WOTB_REPLAY_PROCESSING_JOB_REPOSITORY: jdbc' "$WORK/compose.yml" \
  || fail "resolved business-api must use the PostgreSQL job authority"
grep -Fq 'http://keycloak:8080' "$WORK/compose.yml" \
  || fail "resolved business-api must use the TX-internal Keycloak Admin API"
for contract in \
  'wait_for_probe tx-business-api http://business-api:8088/actuator/health' \
  'wait_for_probe business-api-app http://business-api:8087/api/health' \
  'current_or_target_tag business-api' \
  'keycloak|wotb-frontend|business-api) return 0' \
  'is_business_api_group_selected'; do
  grep -Fq "$contract" "$TX_DIR/deploy.sh" \
    || fail "TX deploy lost required business-api contract: $contract"
done
grep -Fq 'business-api' <<< "$(sed -n '/^compose_service_list()/,/^}/p' "$TX_DIR/deploy.sh")" \
  || fail "the TX all-service set must include the business runtime"

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
  -e BACKEND_UPSTREAM=http://business-api:8087 \
  -v "$TEMPLATE:/etc/nginx/templates/default.conf.template:ro" \
  "$NGINX_TEST_IMAGE" sh -ec "envsubst '\${BACKEND_UPSTREAM}' < /etc/nginx/templates/default.conf.template"
grep -Fq 'proxy_pass http://business-api:8087/api/;' "$WORK/nginx.conf" \
  || fail "nginx template did not render the TX-internal API upstream"
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
  bash -c 'source "$1"; validate_inputs; set_nonselected_compose_placeholders; test "$(current_or_target_tag keycloak)" = sha-0123456789ab; test "$(current_or_target_tag business-api)" = sha-0123456789ab; test "$KC_DB_PASSWORD" = not-configured; test "$AI_API_KEY" = not-configured; echo rabbitmq-only-inputs-pass' _ "$WORK/incoming/deploy.sh")"
rabbit_only_rc=$?
set -e
[ "$rabbit_only_rc" -eq 0 ] \
  || fail "RabbitMQ-only input contract failed (rc=$rabbit_only_rc; output: $(tr '\r\n' ' ' <<< "$rabbit_only_output" | sed -E 's/[[:space:]]+/ /g'))"
grep -Fq 'rabbitmq-only-inputs-pass' <<< "$rabbit_only_output" \
  || fail "RabbitMQ-only deployment must not require Keycloak/PostgreSQL/Caddy inputs or image metadata"

set +e
business_only_output="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  TX_DEPLOY_LIBRARY_ONLY=1 WOTB_TX_DIR="$WORK/business-only" WOTB_TX_INCOMING_DIR="$WORK/incoming" \
  TX_RUNTIME_ROOT="$WORK/business-only" TAG=sha-0123456789ab \
  RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=business-postgres WOTB_DEPLOY_IMAGE_SERVICES='' \
  TX_BUSINESS_POSTGRES_ADMIN_USER=tx-business-admin TX_BUSINESS_POSTGRES_ADMIN_PASSWORD=not-real \
  TX_BUSINESS_DB_NAME=wotb TX_BUSINESS_DB_USERNAME=control_api \
  TX_BUSINESS_DB_PASSWORD=not-real-control-api TX_BUSINESS_DB_PASSWORD_VERSION=1 \
  bash -c 'source "$1"; validate_inputs; set_nonselected_compose_placeholders; test "$(current_or_target_tag keycloak)" = sha-0123456789ab; test "$(current_or_target_tag business-api)" = sha-0123456789ab; test "$KC_DB_PASSWORD" = not-configured; test "$TX_RABBITMQ_ADMIN_PASSWORD" = not-configured; echo business-only-inputs-pass' _ "$WORK/incoming/deploy.sh")"
business_only_rc=$?
set -e
[ "$business_only_rc" -eq 0 ] \
  || fail "Business PostgreSQL-only input contract failed (rc=$business_only_rc; output: $(tr '\r\n' ' ' <<< "$business_only_output" | sed -E 's/[[:space:]]+/ /g'))"
grep -Fq 'business-only-inputs-pass' <<< "$business_only_output" \
  || fail "business-postgres-only deployment must not require Keycloak/RabbitMQ/Caddy inputs or application image metadata"

set +e
business_requires_credentials="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  TX_DEPLOY_LIBRARY_ONLY=1 WOTB_TX_DIR="$WORK/business-missing" WOTB_TX_INCOMING_DIR="$WORK/incoming" \
  TX_RUNTIME_ROOT="$WORK/business-missing" TAG=sha-0123456789ab \
  RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=business-postgres WOTB_DEPLOY_IMAGE_SERVICES='' \
  bash -c 'source "$1"; validate_inputs' _ "$WORK/incoming/deploy.sh" 2>&1)"
business_missing_rc=$?
set -e
[ "$business_missing_rc" -ne 0 ] || fail "business-postgres deployment must fail closed without its credentials"
grep -Fq 'TX_BUSINESS_POSTGRES_ADMIN_USER is required' <<< "$business_requires_credentials" \
  || fail "business-postgres must name the missing variable without exposing a value (output: $(tr '\r\n' ' ' <<< "$business_requires_credentials" | sed -E 's/[[:space:]]+/ /g'))"

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
printf '%s\n' '{"schemaVersion":1,"services":{"keycloak":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"},"wotb-frontend":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"},"business-api":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"}}}' \
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
grep -Fq 'frontend: PASS' <<< "$deploy_output" \
  || fail "TX deploy must report the frontend probe, which now reaches the TX business runtime"
grep -Fq 'run --rm --no-deps health-probe --silent --show-error --connect-timeout' "$WORK/docker.log" \
  || fail "TX deploy must run backend probes from the deployment-owned health-probe"
grep -Fq 'http://wotb-frontend/api/health' "$WORK/docker.log" \
  || fail "TX deploy must probe the frontend route instead of the retired Yecao backend"
! grep -Fq '10.20.0.2:8087' "$WORK/docker.log" \
  || fail "TX deploy must not probe the retired Yecao backend path any more"
grep -Fq 'up -d --no-deps --force-recreate keycloak-postgres' "$WORK/docker.log" \
  || fail "TX deploy must start selected Keycloak PostgreSQL locally"
! grep -Fq 'rabbitmq' "$WORK/docker.log" \
  || fail "non-RabbitMQ TX deployment must not start or health-check RabbitMQ"
grep -Fq 'up -d --no-deps --force-recreate caddy' "$WORK/docker.log" \
  || fail "TX deploy must apply Caddy only through the staged TX runtime"
frontend_start_line="$(grep -nF 'up -d --no-deps --force-recreate wotb-frontend' "$WORK/docker.log" | head -n 1 | cut -d: -f1)"
caddy_start_line="$(grep -nF 'up -d --no-deps --force-recreate caddy' "$WORK/docker.log" | head -n 1 | cut -d: -f1)"
[ -n "$caddy_start_line" ] && [ -n "$frontend_start_line" ] && [ "$caddy_start_line" -lt "$frontend_start_line" ] \
  || fail "TX frontend must start only after Caddy has a Docker network endpoint"
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
frontend_start_line="$(grep -nF 'up -d --no-deps --force-recreate wotb-frontend' "$frontend_log" | head -n 1 | cut -d: -f1)"
caddy_start_line="$(grep -nF 'up -d --no-deps --force-recreate caddy' "$frontend_log" | head -n 1 | cut -d: -f1)"
[ "$caddy_start_line" -lt "$frontend_start_line" ] \
  || fail "Normal frontend deployment must start Caddy before nginx resolves its trusted peer"

caddy_log="$WORK/caddy.log"
caddy_output="$(run_live_service_deploy caddy '' "$caddy_log" 2>&1)"
grep -Fq 'TX deployment completed:' <<< "$caddy_output" \
  || fail "Explicit Caddy deployment must complete"
[ "$(grep -Fc 'up -d --no-deps --force-recreate caddy' "$caddy_log")" -eq 1 ] \
  || fail "Explicit Caddy deployment must recreate Caddy exactly once before refreshing nginx"
frontend_start_line="$(grep -nF 'up -d --no-deps --force-recreate wotb-frontend' "$caddy_log" | tail -n 1 | cut -d: -f1)"
caddy_start_line="$(grep -nF 'up -d --no-deps --force-recreate caddy' "$caddy_log" | tail -n 1 | cut -d: -f1)"
[ -n "$frontend_start_line" ] && [ -n "$caddy_start_line" ] && [ "$caddy_start_line" -lt "$frontend_start_line" ] \
  || fail "Caddy-only deployment must refresh frontend after Caddy gets a new network endpoint"

# Business PostgreSQL-only deployment: start the runtime, wait for pg_isready,
# run TX-local OpenTofu against its own mirror and state, then record the
# root-only provisioning marker. No application image, Keycloak, RabbitMQ, or
# Caddy work may happen on this path.
readonly RELEASE_SHA=0123456789abcdef0123456789abcdef01234567
mkdir -p "$WORK/business" "$WORK/business-incoming" "$WORK/tofu-bin" \
  "$WORK/business/tofu-provider-mirror" \
  "$WORK/business/tofu.incoming/$RELEASE_SHA/infra/tofu/postgres-business"
cp -a "$TX_DIR/." "$WORK/business-incoming/"
printf '%s\n' '#!/usr/bin/env bash' 'set -Eeuo pipefail' 'printf "%s\n" "$*" >> "${FAKE_TOFU_LOG:?}"' \
  > "$WORK/tofu-bin/tofu"
chmod 700 "$WORK/tofu-bin/tofu"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' \
  > "$WORK/business/tofu.incoming/$RELEASE_SHA/infra/tofu/postgres-business/validate-plan.sh"
printf 'tx-local-opentofu-keycloak\n' > "$WORK/business/keycloak.tofu-provisioned"
business_log="$WORK/business.log"
business_tofu_log="$WORK/business-tofu.log"
set +e
business_output="$(env -i \
  PATH="$WORK/bin:$WORK/tofu-bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/business" WOTB_TX_INCOMING_DIR="$WORK/business-incoming" TX_RUNTIME_ROOT="$WORK/business" \
  TX_BUSINESS_POSTGRES_ADMIN_USER=tx-business-admin TX_BUSINESS_POSTGRES_ADMIN_PASSWORD=not-real \
  TX_BUSINESS_DB_NAME=wotb TX_BUSINESS_DB_USERNAME=control_api \
  TX_BUSINESS_DB_PASSWORD=not-real-control-api TX_BUSINESS_DB_PASSWORD_VERSION=1 \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=business-postgres WOTB_DEPLOY_IMAGE_SERVICES='' \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$business_log" FAKE_TOFU_LOG="$business_tofu_log" \
  bash "$WORK/business-incoming/deploy.sh" 2>&1)"
business_rc=$?
set -e
[ "$business_rc" -eq 0 ] \
  || fail "business-postgres-only deployment failed (rc=$business_rc; output: $(tr '\r\n' ' ' <<< "$business_output" | sed -E 's/[[:space:]]+/ /g'))"
grep -Fq 'business-postgres: PASS' <<< "$business_output" \
  || fail "business-postgres-only deployment must wait for pg_isready"
grep -Fq 'Business PostgreSQL OpenTofu apply and second-plan drift check passed.' <<< "$business_output" \
  || fail "business-postgres-only deployment must run the OpenTofu apply and second-plan drift check"
grep -Fq 'up -d --no-deps --force-recreate business-postgres' "$business_log" \
  || fail "business-postgres-only deployment must start its own runtime"
! grep -Fq 'keycloak' "$business_log" \
  || fail "business-postgres-only deployment must not touch Keycloak or its PostgreSQL runtime"
! grep -Fq 'rabbitmq' "$business_log" \
  || fail "business-postgres-only deployment must not touch RabbitMQ"
! grep -Fq 'caddy' "$business_log" \
  || fail "business-postgres-only deployment must not recreate Caddy"
! grep -Fq 'ghcr.io' "$business_log" \
  || fail "business-postgres-only deployment must not pull application images"
grep -Fq 'exec -T business-postgres pg_isready -U tx-business-admin -d postgres' "$business_log" \
  || fail "business-postgres readiness must use the dedicated bootstrap administrator"
for expected in 'init -reconfigure -input=false -lockfile=readonly' 'validate' \
  'plan -input=false -no-color -out=plan.tfplan' \
  'apply -input=false -auto-approve plan.tfplan' \
  'plan -input=false -no-color -out=second-plan.tfplan'; do
  grep -Fq "$expected" "$business_tofu_log" \
    || fail "business-postgres OpenTofu must run: $expected"
done
grep -Fxq 'tx-local-opentofu-business-postgres' "$WORK/business/business-postgres.tofu-provisioned" \
  || fail "business-postgres provisioning must write its own root-only marker"
if [ "$(uname -s)" = "Linux" ]; then
  [ "$(stat -c '%a' "$WORK/business/business-postgres.tofu-provisioned")" = "600" ] \
    || fail "business-postgres provisioning marker must be root-only"
fi
grep -Fxq 'tx-local-opentofu-keycloak' "$WORK/business/keycloak.tofu-provisioned" \
  || fail "business-postgres provisioning must not consume or rewrite the Keycloak marker"
[ ! -s "$WORK/business/rabbitmq.tofu-provisioned" ] \
  || fail "business-postgres provisioning must not create a RabbitMQ marker"

# A non-clean second plan must fail the deployment before any marker is written.
# The stub fails every plan invocation, which makes the second plan the failing
# step exactly as a dirty real plan would.
rm -f -- "$WORK/business/business-postgres.tofu-provisioned"
# Fail every plan invocation, with an explicit exit trace so a stub that never
# ran is distinguishable from a deployment that ignored the failure.
printf '%s\n' '#!/usr/bin/env bash' 'set -Eeuo pipefail' 'printf "invoked %s\n" "$*" >> "${FAKE_TOFU_LOG:?}"' \
  'trap '\''printf "exiting rc=%s %s\n" "$?" "$*" >> "${FAKE_TOFU_LOG:?}"'\'' EXIT' \
  'for argument in "$@"; do' '  if [ "$argument" = plan ]; then exit 1; fi' 'done' \
  'exit 0' > "$WORK/tofu-bin/tofu"
chmod 700 "$WORK/tofu-bin/tofu"
set +e
dirty_output="$(env -i \
  PATH="$WORK/bin:$WORK/tofu-bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/business" WOTB_TX_INCOMING_DIR="$WORK/business-incoming" TX_RUNTIME_ROOT="$WORK/business" \
  TX_BUSINESS_POSTGRES_ADMIN_USER=tx-business-admin TX_BUSINESS_POSTGRES_ADMIN_PASSWORD=not-real \
  TX_BUSINESS_DB_NAME=wotb TX_BUSINESS_DB_USERNAME=control_api \
  TX_BUSINESS_DB_PASSWORD=not-real-control-api TX_BUSINESS_DB_PASSWORD_VERSION=1 \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=business-postgres WOTB_DEPLOY_IMAGE_SERVICES='' \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$WORK/business-dirty.log" FAKE_TOFU_LOG="$WORK/business-dirty-tofu.log" \
  bash "$WORK/business-incoming/deploy.sh" 2>&1)"
dirty_rc=$?
set -e
[ "$dirty_rc" -ne 0 ] || fail "a non-clean second Business PostgreSQL plan must fail the deployment"
[ ! -e "$WORK/business/business-postgres.tofu-provisioned" ] \
  || fail "a failed Business PostgreSQL provisioning run must not write the provisioning marker"

mkdir -p "$WORK/keycloak-bootstrap" "$WORK/keycloak-bootstrap-incoming"
cp -a "$TX_DIR/." "$WORK/keycloak-bootstrap-incoming/"
printf '%s\n' '{"schemaVersion":1,"services":{"wotb-frontend":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"},"business-api":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"}}}' \
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
printf '%s\n' '{"schemaVersion":1,"services":{"wotb-frontend":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"},"business-api":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"}}}' \
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

# The frontend upstream is now pinned to the TX-internal business runtime. Every
# rejected value below is a real regression this cutover must not allow: the
# retired Yecao WireGuard address, a public host, a wrong port, and a wrong host.
run_upstream_case() {
  local label="$1" upstream="$2" expect_rc="$3" log output rc
  log="$WORK/upstream-$label.log"
  set +e
  output="$(env -i \
    PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_TX_DIR="$WORK/upstream-$label" WOTB_TX_INCOMING_DIR="$WORK/incoming" \
    TX_RUNTIME_ROOT="$WORK/upstream-$label" \
    KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
    KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
    WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_BACKEND_UPSTREAM="$upstream" \
    TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
    WOTB_DEPLOY_SERVICES=keycloak-postgres FAKE_DOCKER_LOG="$log" \
    bash "$WORK/incoming/deploy.sh" 2>&1)"
  rc=$?
  set -e
  if [ "$expect_rc" -eq 0 ]; then
    [ "$rc" -eq 0 ] \
      || fail "TX deploy must accept the TX-internal upstream $upstream (rc=$rc; output: $(tr '\r\n' ' ' <<< "$output" | sed -E 's/[[:space:]]+/ /g'))"
  else
    [ "$rc" -ne 0 ] || fail "TX deploy must reject the non-TX-internal upstream $upstream"
    grep -Fq 'TX-internal business runtime' <<< "$output" \
      || fail "TX deploy must explain the rejected upstream $upstream"
  fi
}

run_upstream_case internal http://business-api:8087 0
run_upstream_case yecao-wireguard http://10.20.0.2:8087 1
run_upstream_case public-host https://example.test 1
run_upstream_case wrong-port http://business-api:9000 1
run_upstream_case foreign-host http://control-api:8087 1
run_upstream_case trailing-slash http://business-api:8087/ 1

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

# The business runtime fails closed on every credential it owns: the MinIO
# control-plane identity is the first one this fixture omits.
set +e
business_api_requires_minio="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  TX_DEPLOY_LIBRARY_ONLY=1 WOTB_TX_DIR="$WORK/business-api-missing" WOTB_TX_INCOMING_DIR="$WORK/incoming" \
  TX_RUNTIME_ROOT="$WORK/business-api-missing" TAG=sha-0123456789ab \
  RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=business-api WOTB_DEPLOY_IMAGE_SERVICES=business-api \
  TX_BUSINESS_DB_NAME=wotb TX_BUSINESS_DB_USERNAME=control_api TX_BUSINESS_DB_PASSWORD=not-real \
  TX_RABBITMQ_CONTROL_API_PASSWORD=not-real KEYCLOAK_ADMIN_CLIENT_SECRET=not-real AI_API_KEY=not-real \
  bash -c 'source "$1"; validate_inputs' _ "$WORK/incoming/deploy.sh" 2>&1)"
business_api_requires_minio_rc=$?
set -e
[ "$business_api_requires_minio_rc" -ne 0 ] \
  || fail "business-api deployment must fail closed without the MinIO control-plane identity"
grep -Fq 'YECAO_MINIO_CONTROL_API_ACCESS_KEY is required' <<< "$business_api_requires_minio" \
  || fail "business-api must name the missing MinIO identity variable without exposing a value"

# Business runtime deployment on a live host: it starts only itself, proves both
# the application and the dedicated management surface through the
# deployment-owned health-probe, and records its immutable identity. It must not
# touch the broker, PostgreSQL, Keycloak, or Caddy runtimes.
mkdir -p "$WORK/business-api" "$WORK/business-api-incoming"
cp -a "$TX_DIR/." "$WORK/business-api-incoming/"
printf '%s\n' '{"schemaVersion":1,"services":{"keycloak":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"},"wotb-frontend":{"commitSha":"0123456789abcdef0123456789abcdef01234567","imageTag":"sha-0123456789ab"}}}' \
  > "$WORK/business-api/tx-production-release.json"
business_api_log="$WORK/business-api.log"
set +e
business_api_output="$(env -i \
  PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/business-api" WOTB_TX_INCOMING_DIR="$WORK/business-api-incoming" TX_RUNTIME_ROOT="$WORK/business-api" \
  TX_BUSINESS_DB_NAME=wotb TX_BUSINESS_DB_USERNAME=control_api TX_BUSINESS_DB_PASSWORD=not-real \
  TX_RABBITMQ_CONTROL_API_PASSWORD=not-real \
  YECAO_MINIO_CONTROL_API_ACCESS_KEY=not-real YECAO_MINIO_CONTROL_API_SECRET_KEY=not-real \
  KEYCLOAK_ADMIN_CLIENT_SECRET=not-real AI_API_KEY=not-real \
  TAG=sha-0123456789ab RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  WOTB_DEPLOY_SERVICES=business-api WOTB_DEPLOY_IMAGE_SERVICES=business-api \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$business_api_log" \
  bash "$WORK/business-api-incoming/deploy.sh" 2>&1)"
business_api_rc=$?
set -e
[ "$business_api_rc" -eq 0 ] \
  || fail "business-api deployment failed (rc=$business_api_rc; output: $(tr '\r\n' ' ' <<< "$business_api_output" | sed -E 's/[[:space:]]+/ /g'))"
grep -Fq 'business-api: PASS' <<< "$business_api_output" \
  || fail "business-api deployment must prove the management health surface"
grep -Fq 'business-api-app: PASS' <<< "$business_api_output" \
  || fail "business-api deployment must prove the application health surface"
grep -Fq 'pull business-api' "$business_api_log" \
  || fail "business-api deployment must pull only its own image"
grep -Fq 'up -d --no-deps --force-recreate business-api' "$business_api_log" \
  || fail "business-api deployment must start the business runtime"
grep -Fq 'run --rm --no-deps health-probe' "$business_api_log" \
  || fail "business-api deployment must probe from the internal health-probe container"
for forbidden in keycloak wotb-frontend rabbitmq business-postgres caddy; do
  ! grep -Fq "up -d --no-deps --force-recreate $forbidden" "$business_api_log" \
    || fail "business-api deployment must not start $forbidden"
done
grep -Fq '"business-api"' "$WORK/business-api/tx-production-release.json" \
  || fail "business-api deployment must record its immutable image identity"
grep -Fq '"keycloak"' "$WORK/business-api/tx-production-release.json" \
  || fail "business-api deployment must preserve other TX service metadata"

# ---------------------------------------------------------------- cutover E2E
# The gate must expose the full business-E2E token set, and every instrument it
# depends on (probe-mounted fixtures, machine identity, snapshot) must be wired.
for token in \
  'auth-token' 'tx-control-plane' 'anonymous-rejected' \
  'admin-authz' 'business-profile' 'business-hof' 'business-boost' \
  'hof-replay-storage' 'parser-worker' 'processing-e2e' 'dataset-result' \
  'map-overview' 'battle-playback-v2' 'minio' 'ai-facts' 'export' \
  'business-data-integrity'; do
  grep -Fq "e2e_emit $token" "$TX_DIR/deploy.sh" \
    || fail "cutover E2E gate lost required token: $token"
done
for contract in \
  'KEYCLOAK_E2E_CLIENT_SECRET' \
  'wotbtools-e2e' \
  'wait_for_probe tx-business-api' \
  'presign_minio_url GET' \
  'WOTB_E2E_REPLAY_PATH' \
  'WOTB_E2E_DATA_SNAPSHOT' \
  '--resolve "$host:443:$E2E_PUBLIC_IP"'; do
  grep -Fq -- "$contract" "$TX_DIR/deploy.sh" \
    || fail "cutover E2E gate lost required contract: $contract"
done
! grep -Fq 'openid-connect/token' <<< "$(sed -n '/^business_e2e_check()/,/^}/p' "$TX_DIR/deploy.sh")" \
  || grep -Fq 'client_credentials' <<< "$(sed -n '/^business_e2e_check()/,/^}/p' "$TX_DIR/deploy.sh")" \
  || fail "cutover E2E gate must authenticate with client_credentials"
grep -Fq 'files=@$E2E_REPLAY_PATH' "$TX_DIR/deploy.sh" \
  || fail "cutover E2E gate must upload the staged replay fixture"
grep -Fq '${TX_RUNTIME_ROOT:?TX_RUNTIME_ROOT is required}/e2e:/e2e:ro' "$COMPOSE" \
  || fail "health-probe must mount the staged E2E fixtures read-only"
grep -Fq 'mkdir -p "$TX_RUNTIME_ROOT/e2e"' "$TX_DIR/deploy.sh" \
  || fail "TX deploy must create the E2E fixture directory"
grep -Fq 'common/fixtures/replays' "$ROOT/.github/workflows/deploy.yml" \
  || fail "Deploy must stage the cutover E2E replay fixtures onto TX"
grep -Fq 'KEYCLOAK_E2E_CLIENT_SECRET' "$ROOT/.github/workflows/deploy.yml" \
  || fail "Deploy must forward the cutover E2E client secret to the Keycloak OpenTofu apply"
grep -Fq 'keycloak_openid_client_service_account_realm_role' "$ROOT/infra/tofu/keycloak/roles.tf" \
  || fail "the cutover E2E identity must be granted its realm role explicitly"
grep -Fq 'keycloak_openid_client.e2e' "$ROOT/infra/tofu/keycloak/validate-plan.sh" \
  || fail "the plan guard must protect the cutover E2E client"
grep -Fq 'TF_VAR_e2e_client_secret' "$TX_DIR/keycloak-tofu.sh" \
  || fail "the Keycloak OpenTofu runner must forward the cutover E2E secret"
! grep -Eq '(nsupdate|route53|cloudflare|gcloud dns|az network dns)' <<< "$(sed -n '/^public_edge_check()/,/^}/p' "$TX_DIR/deploy.sh")" \
  || fail "the public edge preflight must never change DNS"

# The gate reads MinIO with an ad-hoc SigV4 presign. Prove the signature is real
# against a disposable MinIO instead of trusting the implementation.
if command -v docker >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  docker rm -f "$MINIO_CONTAINER" >/dev/null 2>&1 || true
  if docker run -d --name "$MINIO_CONTAINER" -p 127.0.0.1:19080:9000 \
      -e MINIO_ROOT_USER=wotb-e2e-user -e MINIO_ROOT_PASSWORD=wotb-e2e-secret \
      "$MINIO_IMAGE" server /data >/dev/null 2>&1; then
    minio_ready=0
    for _ in $(seq 1 60); do
      if curl -fsS http://127.0.0.1:19080/minio/health/live >/dev/null 2>&1; then
        minio_ready=1
        break
      fi
      sleep 1
    done
    [ "$minio_ready" = 1 ] || fail "disposable MinIO did not become ready"
    minio_env=(
      YECAO_MINIO_ENDPOINT=127.0.0.1:19080
      YECAO_MINIO_BUCKET=wotbtools-temp
      YECAO_MINIO_CONTROL_API_ACCESS_KEY=wotb-e2e-user
      YECAO_MINIO_CONTROL_API_SECRET_KEY=wotb-e2e-secret
    )
    # The gate only needs to read; bucket creation uses the same signing path with PUT.
    presign() {
      env "${minio_env[@]}" TX_DEPLOY_LIBRARY_ONLY=1 bash -c \
        'source "$1"; presign_minio_url "$2" "$3"' _ "$TX_DIR/deploy.sh" "$1" "$2"
    }
    bucket_url="$(presign PUT "")"
    [ -n "$bucket_url" ] || fail "bucket presign produced no URL"
    curl -fsS -X PUT "$bucket_url" >/dev/null \
      || fail "the SigV4 presign helper could not create a bucket on a real MinIO"
    put_url="$(presign PUT "temp/jobs/e2e-contract/probe.json")"
    get_url="$(presign GET "temp/jobs/e2e-contract/probe.json")"
    printf '{"presign":"ok"}\n' > "$WORK/probe.json"
    curl -fsS -X PUT --data-binary "@$WORK/probe.json" "$put_url" >/dev/null \
      || fail "the SigV4 presign helper could not write an object to a real MinIO"
    curl -fsS "$get_url" > "$WORK/probe-read.json" \
      || fail "the SigV4 presign helper could not read the object back"
    grep -Fq '"presign":"ok"' "$WORK/probe-read.json" \
      || fail "the presigned read returned unexpected content"
    echo "OK: SigV4 presign helper verified against a disposable MinIO"
  else
    echo "SKIP: disposable MinIO unavailable; presign helper not verified here"
  fi
fi

echo "OK: TX Compose/Caddy/nginx/deploy contracts are deterministic and use Docker service DNS"
