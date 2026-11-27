#!/usr/bin/env bash
set -Eeuo pipefail

readonly WOTB_DIR="${WOTB_TX_DIR:-/opt/wotb-tx}"
readonly INCOMING_DIR="${WOTB_TX_INCOMING_DIR:-$WOTB_DIR/deploy.incoming/deploy/tx}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
LIVE_COMPOSE="$LIVE_DEPLOY_DIR/docker-compose.yml"
readonly LIVE_COMMON="$LIVE_DEPLOY_DIR/common.compose.yml"
readonly TX_RUNTIME_ROOT="${TX_RUNTIME_ROOT:-$WOTB_DIR}"
readonly TOFU_PROVISION_MARKER="${WOTB_TX_TOFU_PROVISION_MARKER:-$WOTB_DIR/keycloak.tofu-provisioned}"
readonly BUSINESS_POSTGRES_TOFU_PROVISION_MARKER="${WOTB_TX_BUSINESS_POSTGRES_TOFU_PROVISION_MARKER:-$WOTB_DIR/business-postgres.tofu-provisioned}"
readonly BOOTSTRAP_KEYCLOAK="${WOTB_TX_BOOTSTRAP_KEYCLOAK:-0}"
readonly BACKEND_UPSTREAM_VALUE="${TX_BACKEND_UPSTREAM:-http://business-api:8087}"
readonly AI_UPSTREAM_VALUE="${TX_AI_UPSTREAM:-http://10.20.0.2:8089}"
readonly BUSINESS_DB_HOST_VALUE="${TX_BUSINESS_DB_HOST:-business-postgres}"
readonly BUSINESS_DB_PORT_VALUE="${TX_BUSINESS_DB_PORT:-5432}"
readonly KEYCLOAK_ADMIN_SERVER_URL_VALUE="${TX_KEYCLOAK_ADMIN_SERVER_URL:-http://keycloak:8080}"
readonly KEYCLOAK_DB_HOST_VALUE="${TX_KEYCLOAK_DB_HOST:-keycloak-postgres}"
readonly KEYCLOAK_DB_PORT_VALUE="${TX_KEYCLOAK_DB_PORT:-5432}"
readonly CADDY_FRONTEND_UPSTREAM_VALUE="${CADDY_FRONTEND_UPSTREAM:-wotb-frontend:80}"
readonly CADDY_KEYCLOAK_UPSTREAM_VALUE="${CADDY_KEYCLOAK_UPSTREAM:-keycloak:8080}"
readonly DEPLOY_SERVICE_VALUE="${WOTB_DEPLOY_SERVICE:-}"
readonly CONFIG_SHA_VALUE="${WOTB_DEPLOY_CONFIG_SHA:-}"
readonly TX_IMAGE_REGISTRY_PREFIX_VALUE="${TX_IMAGE_REGISTRY_PREFIX:-ccr.ccs.tencentyun.com/wotbtools}"
readonly TX_FRONTEND_IMAGE_REF_VALUE="${TX_FRONTEND_IMAGE_REF:-}"
readonly TX_BUSINESS_API_IMAGE_REF_VALUE="${TX_BUSINESS_API_IMAGE_REF:-}"
readonly HEALTH_ATTEMPTS="${WOTB_HEALTH_ATTEMPTS:-60}"
readonly HEALTH_INTERVAL_SEC="${WOTB_HEALTH_INTERVAL_SEC:-2}"
readonly PROBE_CONNECT_TIMEOUT_SEC="${WOTB_PROBE_CONNECT_TIMEOUT_SEC:-3}"
readonly PROBE_MAX_TIME_SEC="${WOTB_PROBE_MAX_TIME_SEC:-10}"

declare -a DEPLOY_SERVICES=()
declare -a APPLY_SERVICES=()
DEPLOY_SERVICES_RAW=""
SERVICE_COMPOSE=""
FAILED_SERVICE=""
PROBE_LAST_SERVICE=""
PROBE_LAST_URL=""
PROBE_LAST_HTTP_STATUS="unavailable"
PROBE_LAST_ERROR=""

die() {
  echo "ERROR: $*" >&2
  exit 1
}

is_safe_path() {
  local path="$1"
  [ -n "$path" ] && [ "$path" != "/" ] && [ "$path" != "." ] && [[ "$path" != *$'\n'* ]]
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || die "$name is required."
}

validate_http_endpoint() {
  local name="$1" value="$2" local_value="$3" wg_port="$4"
  case "$value" in
    "$local_value"|"http://10.20.0.1:$wg_port"|"http://10.20.0.3:$wg_port") return 0 ;;
    *) die "$name must be $local_value or a reviewed TX1/TX2 WireGuard HTTP endpoint on port $wg_port." ;;
  esac
}

validate_database_endpoint() {
  local name="$1" host="$2" port="$3" local_host="$4" local_port="$5" wg_port="$6"
  if [ "$host" = "$local_host" ] && [ "$port" = "$local_port" ]; then
    return 0
  fi
  case "$host:$port" in
    "10.20.0.1:$wg_port"|"10.20.0.3:$wg_port") return 0 ;;
    *) die "$name must be $local_host:$local_port or a reviewed TX1/TX2 WireGuard endpoint on port $wg_port." ;;
  esac
}

validate_caddy_upstream() {
  local name="$1" value="$2" local_value="$3" wg_port="$4"
  case "$value" in
    "$local_value"|"10.20.0.1:$wg_port"|"10.20.0.3:$wg_port") return 0 ;;
    *) die "$name must be $local_value or a reviewed TX1/TX2 WireGuard endpoint on port $wg_port." ;;
  esac
}

require_tofu_provisioning() {
  if ! is_selected keycloak; then
    return
  fi
  if [ "$BOOTSTRAP_KEYCLOAK" = 1 ]; then
    return
  fi
  [ -f "$TOFU_PROVISION_MARKER" ] \
    || die "TX Keycloak realm is not provisioned; apply infra/tofu/keycloak before starting Keycloak runtime."
  grep -Fxq 'tx-local-opentofu-keycloak' "$TOFU_PROVISION_MARKER" \
    || die "TX Keycloak OpenTofu provision marker is invalid; refusing to start Keycloak runtime."
}

is_selected() {
  local wanted="$1" service
  for service in "${DEPLOY_SERVICES[@]}"; do
    [ "$service" = "$wanted" ] && return 0
  done
  return 1
}

is_keycloak_postgres_group_selected() {
  is_selected keycloak-postgres || is_selected keycloak
}

is_keycloak_runtime_selected() {
  is_selected keycloak
}

is_business_postgres_group_selected() {
  is_selected business-postgres
}

is_business_api_group_selected() {
  is_selected business-api
}

validate_inputs() {
  is_safe_path "$WOTB_DIR" || die "unsafe WOTB_TX_DIR."
  is_safe_path "$INCOMING_DIR" || die "unsafe WOTB_TX_INCOMING_DIR."
  is_safe_path "$TX_RUNTIME_ROOT" || die "unsafe TX_RUNTIME_ROOT."
  [ "$INCOMING_DIR" != "$WOTB_DIR" ] || die "incoming directory must differ from TX runtime directory."
  [[ "$CONFIG_SHA_VALUE" =~ ^[0-9a-f]{40}$ ]] || die "WOTB_DEPLOY_CONFIG_SHA must be a full lowercase commit SHA."
  is_positive_integer "$HEALTH_ATTEMPTS" || die "WOTB_HEALTH_ATTEMPTS must be a positive integer."
  is_positive_integer "$HEALTH_INTERVAL_SEC" || die "WOTB_HEALTH_INTERVAL_SEC must be a positive integer."
  is_positive_integer "$PROBE_CONNECT_TIMEOUT_SEC" || die "WOTB_PROBE_CONNECT_TIMEOUT_SEC must be a positive integer."
  is_positive_integer "$PROBE_MAX_TIME_SEC" || die "WOTB_PROBE_MAX_TIME_SEC must be a positive integer."
  case "$DEPLOY_SERVICE_VALUE" in
    frontend) DEPLOY_SERVICES=(wotb-frontend) ;;
    keycloak-postgres|business-postgres|keycloak|business-api|caddy|alloy-tx)
      DEPLOY_SERVICES=("$DEPLOY_SERVICE_VALUE") ;;
    *) die "unsupported TX deployment service: $DEPLOY_SERVICE_VALUE" ;;
  esac
  DEPLOY_SERVICES_RAW="${DEPLOY_SERVICES[0]}"
  case "$DEPLOY_SERVICES_RAW" in
    wotb-frontend) SERVICE_COMPOSE=frontend.compose.yml ;;
    *) SERVICE_COMPOSE="$DEPLOY_SERVICES_RAW.compose.yml" ;;
  esac
  LIVE_COMPOSE="$LIVE_DEPLOY_DIR/$SERVICE_COMPOSE"
  if is_selected keycloak || is_selected wotb-frontend || is_selected business-api; then
    [[ "$TX_IMAGE_REGISTRY_PREFIX_VALUE" =~ ^([a-z0-9][a-z0-9-]*\.)+tencentyun\.com/[a-z0-9][a-z0-9._-]*$ ]] \
      || die "TX_IMAGE_REGISTRY_PREFIX must be a Tencent TCR registry and namespace."
  fi
  if is_selected wotb-frontend; then
    require_env TX_FRONTEND_IMAGE_REF
    case "$TX_FRONTEND_IMAGE_REF_VALUE" in
      "$TX_IMAGE_REGISTRY_PREFIX_VALUE/wotbtools-frontend@sha256:"*) ;;
      *) die "TX_FRONTEND_IMAGE_REF must pin wotbtools-frontend by TCR sha256 digest." ;;
    esac
    local frontend_digest="${TX_FRONTEND_IMAGE_REF_VALUE##*@sha256:}"
    [[ "$frontend_digest" =~ ^[0-9a-f]{64}$ ]] \
      || die "TX_FRONTEND_IMAGE_REF must contain a 64-character lowercase sha256 digest."
    validate_http_endpoint TX_BACKEND_UPSTREAM "$BACKEND_UPSTREAM_VALUE" http://business-api:8087 8087
    [ "$AI_UPSTREAM_VALUE" = "http://10.20.0.2:8089" ] \
      || die "TX_AI_UPSTREAM must be the Yecao ai-service WireGuard endpoint http://10.20.0.2:8089."
  fi
  local service
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      keycloak-postgres|business-postgres|keycloak|wotb-frontend|business-api|caddy|alloy-tx) ;;
      *) die "unsupported TX deployment service: $service" ;;
    esac
  done
  case "$BOOTSTRAP_KEYCLOAK" in
    0|1) ;;
    *) die "WOTB_TX_BOOTSTRAP_KEYCLOAK must be 0 or 1." ;;
  esac
  if is_keycloak_postgres_group_selected; then
    for required in KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD; do
      require_env "$required"
    done
  fi
  if is_keycloak_runtime_selected; then
    for required in KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD WG_APPLICATION_ID; do
      require_env "$required"
    done
    validate_database_endpoint TX_KEYCLOAK_DB "$KEYCLOAK_DB_HOST_VALUE" "$KEYCLOAK_DB_PORT_VALUE" keycloak-postgres 5432 15432
  fi
  if is_selected caddy; then
    require_env CADDY_ACME_EMAIL
    validate_caddy_upstream CADDY_FRONTEND_UPSTREAM "$CADDY_FRONTEND_UPSTREAM_VALUE" wotb-frontend:80 8081
    validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM "$CADDY_KEYCLOAK_UPSTREAM_VALUE" keycloak:8080 8080
  fi
  if is_business_postgres_group_selected; then
    for required in TX_BUSINESS_POSTGRES_ADMIN_USER TX_BUSINESS_POSTGRES_ADMIN_PASSWORD \
      TX_BUSINESS_DB_NAME TX_BUSINESS_DB_USERNAME TX_BUSINESS_DB_PASSWORD \
      TX_BUSINESS_DB_PASSWORD_VERSION; do
      require_env "$required"
    done
  fi
  if is_business_api_group_selected; then
    require_env TX_BUSINESS_API_IMAGE_REF
    case "$TX_BUSINESS_API_IMAGE_REF_VALUE" in
      "$TX_IMAGE_REGISTRY_PREFIX_VALUE/wotbtools-business-api@sha256:"*) ;;
      *) die "TX_BUSINESS_API_IMAGE_REF must pin wotbtools-business-api by TCR sha256 digest." ;;
    esac
    local business_api_digest="${TX_BUSINESS_API_IMAGE_REF_VALUE##*@sha256:}"
    [[ "$business_api_digest" =~ ^[0-9a-f]{64}$ ]]       || die "TX_BUSINESS_API_IMAGE_REF must contain a 64-character lowercase sha256 digest."
    for required in TX_BUSINESS_DB_NAME TX_BUSINESS_DB_USERNAME TX_BUSINESS_DB_PASSWORD \
      KEYCLOAK_ADMIN_CLIENT_SECRET; do
      require_env "$required"
    done
    validate_database_endpoint TX_BUSINESS_DB "$BUSINESS_DB_HOST_VALUE" "$BUSINESS_DB_PORT_VALUE" business-postgres 5432 25432
    validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL "$KEYCLOAK_ADMIN_SERVER_URL_VALUE" http://keycloak:8080 8080
  fi
}

source "$(dirname "${BASH_SOURCE[0]}")/deploy-stage.sh"

source "$(dirname "${BASH_SOURCE[0]}")/deploy-health.sh"

preflight_host() {
  command -v docker >/dev/null 2>&1 || die "docker is required."
  docker compose version >/dev/null 2>&1 || die "docker compose is required."
  command -v ip >/dev/null 2>&1 || die "ip is required for WireGuard checks."
  ip link show wg0 >/dev/null 2>&1 || die "wg0 is required."
  ip -4 addr show dev wg0 | grep -Eq 'inet 10\.20\.0\.1/24([[:space:]]|$)' \
    || die "wg0 must have 10.20.0.1/24."
  ip route get 10.20.0.2 >/dev/null 2>&1 \
    || die "a route to 10.20.0.2 is required."
}

diagnostics() {
  echo "== TX DEPLOY DIAGNOSTICS =="
  echo "configSha=$CONFIG_SHA_VALUE"
  case "$DEPLOY_SERVICES_RAW" in
    business-api) echo "image=$TX_BUSINESS_API_IMAGE_REF_VALUE" ;;
    wotb-frontend) echo "image=$TX_FRONTEND_IMAGE_REF_VALUE" ;;
    keycloak) echo "image=latest" ;;
  esac
  echo "deployServices=$DEPLOY_SERVICES_RAW"
  if [ -n "$PROBE_LAST_SERVICE" ]; then
    echo "probeService=$PROBE_LAST_SERVICE"
    echo "probeTargetUrl=$PROBE_LAST_URL"
    echo "probeHttpStatus=$PROBE_LAST_HTTP_STATUS"
    echo "probeError=$PROBE_LAST_ERROR"
  fi
  docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" ps -a || true
  local -a services=("${APPLY_SERVICES[@]}")
  [ "$FAILED_SERVICE" = caddy ] && services+=(caddy)
  local service
  for service in "${services[@]}"; do
    echo "== $service inspect =="
    docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" ps -a "$service" || true
    docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" logs --tail 120 "$service" || true
  done
}

stop_failed_service() {
  local service="$FAILED_SERVICE"
  case "$service" in
    caddy|caddy-*)
      echo "Caddy deployment or verification failed; keeping the gateway process available for diagnosis." >&2
      return 0
      ;;
  esac
  case "$service" in
    tx-business-api|business-api-app) service=business-api ;;
    frontend-static|frontend-api) service=wotb-frontend ;;
    caddy-ready) service=caddy ;;
  esac
  if ! is_selected "$service"; then
    echo "Not stopping unaffected TX health dependency: ${service:-unknown}" >&2
    return 0
  fi
  case "$service" in
    keycloak|wotb-frontend|business-api|caddy|alloy-tx)
      echo "Stopping failed affected TX service: $service"
      docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" stop "$service" || true
      ;;
    *) echo "Not stopping TX dependency after a failed health check: ${service:-unknown}" >&2 ;;
  esac
}

acquire_deploy_lock() {
  command -v flock >/dev/null 2>&1 || die "flock is required to serialize TX deployments."
  if [ -n "${WOTB_DEPLOY_LOCK_FD:-}" ]; then
    [ "$WOTB_DEPLOY_LOCK_FD" = 9 ] || die "unsupported inherited TX deployment lock descriptor."
    { true >&9; } 2>/dev/null || die "inherited TX deployment lock descriptor is unavailable."
    flock -n 9 || die "another TX deployment is already running."
  else
    lock_wait="${WOTB_TX_DEPLOY_LOCK_WAIT_SEC:-900}"
    exec 9>"$WOTB_DIR/.deploy.lock"
    if ! flock -w "$lock_wait" 9; then
      die "another TX deployment is still running after waiting ${lock_wait}s; lock: $WOTB_DIR/.deploy.lock"
    fi
  fi
}

apply_and_check() {
  apply_services || return 1
  blocking_health || return 1
}
main() {
  validate_inputs
  preflight_host
  require_tofu_provisioning
  mkdir -p "$WOTB_DIR" "$INCOMING_DIR"
  acquire_deploy_lock
  stage_and_validate
  require_frontend_backend
  assert_stateful_volume_identity
  pull_images || die "TX image pull failed; live TX deployment was not changed."
  promote_files || die "TX live-file promotion failed; prior TX files were restored when possible."
  if ! apply_and_check; then
    diagnostics
    stop_failed_service
    die "TX blocking health failed; no automatic recovery, DNS action, or Yecao action was attempted."
  fi
  echo "TX deployment completed: config=$CONFIG_SHA_VALUE service=$DEPLOY_SERVICES_RAW"
}

if [ "${TX_DEPLOY_LIBRARY_ONLY:-0}" != 1 ]; then
  main "$@"
fi
