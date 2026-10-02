#!/usr/bin/env bash
# Staged selective production deployment for the Yecao host.
#
# The Yecao runtime is the AI review service plus the shared observability stack. The business
# runtime (`business-api`), its PostgreSQL, Keycloak, Keycloak's PostgreSQL, and the public frontend
# live on TX and are deployed by deploy/tx/deploy.sh; they are not selectable here any more.
# Failure is fail-closed and operator-led.
set -Eeuo pipefail

readonly WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
readonly INCOMING_DIR="${WOTB_INCOMING_DIR:-$WOTB_DIR/deploy.incoming}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
readonly LIVE_COMPOSE="$WOTB_DIR/docker-compose.yml"
readonly HEALTH_ATTEMPTS="${WOTB_HEALTH_ATTEMPTS:-60}"
readonly HEALTH_INTERVAL_SEC="${WOTB_HEALTH_INTERVAL_SEC:-2}"
readonly PULL_ATTEMPTS="${WOTB_PULL_ATTEMPTS:-3}"
readonly DEPLOY_SERVICE_VALUE="${WOTB_DEPLOY_SERVICE:-}"
readonly CONFIG_SHA_VALUE="${WOTB_DEPLOY_CONFIG_SHA:-}"

declare -a DEPLOY_SERVICES=()
declare -a APPLY_SERVICES=()
DEPLOY_SERVICES_RAW=""
FAILED_SERVICE=""

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
  [ -n "${!name:-}" ] || die "$name secret is not configured."
}

is_selected() {
  local wanted="$1" service
  for service in "${DEPLOY_SERVICES[@]}"; do
    [ "$service" = "$wanted" ] && return 0
  done
  return 1
}

validate_inputs() {
  is_safe_path "$WOTB_DIR" || die "unsafe WOTB_DIR."
  is_safe_path "$INCOMING_DIR" || die "unsafe WOTB_INCOMING_DIR."
  [ "$INCOMING_DIR" != "$WOTB_DIR" ] || die "incoming directory must differ from live directory."
  [[ "$CONFIG_SHA_VALUE" =~ ^[0-9a-f]{40}$ ]] || die "WOTB_DEPLOY_CONFIG_SHA must be a full lowercase commit SHA."
  is_positive_integer "$HEALTH_ATTEMPTS" || die "WOTB_HEALTH_ATTEMPTS must be a positive integer."
  is_positive_integer "$HEALTH_INTERVAL_SEC" || die "WOTB_HEALTH_INTERVAL_SEC must be a positive integer."
  is_positive_integer "$PULL_ATTEMPTS" || die "WOTB_PULL_ATTEMPTS must be a positive integer."
  DEPLOY_SERVICES=("$DEPLOY_SERVICE_VALUE")
  DEPLOY_SERVICES_RAW="$DEPLOY_SERVICE_VALUE"
  local service
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      node-exporter|prometheus|loki|alloy|grafana|ai-service) ;;
      *) die "unsupported deployment service: $service" ;;
    esac
  done
  if is_selected ai-service; then
    require_env AI_API_KEY
  fi

  if is_selected grafana; then
    require_env GRAFANA_ADMIN_USER
    require_env GRAFANA_ADMIN_PASSWORD
  else
    : "${GRAFANA_ADMIN_USER:=not-configured}"
    : "${GRAFANA_ADMIN_PASSWORD:=not-configured}"
    export GRAFANA_ADMIN_USER GRAFANA_ADMIN_PASSWORD
  fi
}

stage_and_validate() {
  local staged_source="$INCOMING_DIR/deploy/docker-compose.prod.yml"
  readonly EFFECTIVE_COMPOSE="$INCOMING_DIR/docker-compose.effective.yml"
  [ -f "$staged_source" ] || die "staged deployment tree is missing docker-compose.prod.yml."
  mkdir -p "$INCOMING_DIR"
  cp -f "$staged_source" "$EFFECTIVE_COMPOSE"
  chmod 600 "$EFFECTIVE_COMPOSE"
  if ! docker compose -f "$EFFECTIVE_COMPOSE" config >/dev/null; then
    die "staged compose config is invalid; live deployment was not changed."
  fi
  local observability_selected=false service
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      prometheus|loki|alloy|grafana|node-exporter) observability_selected=true ;;
    esac
  done
  if [ "$observability_selected" = true ]; then
    [ -f "$INCOMING_DIR/deploy/validate-alloy-config.sh" ] || die "staged Alloy validator is missing."
    bash "$INCOMING_DIR/deploy/validate-alloy-config.sh" \
      "$INCOMING_DIR/deploy/observability/alloy/config.alloy" \
      || die "staged Alloy config validation failed; live deployment was not changed."
  fi
}

pull_images() {
  local attempt
  for attempt in $(seq 1 "$PULL_ATTEMPTS"); do
    if docker compose -f "$EFFECTIVE_COMPOSE" pull "$DEPLOY_SERVICES_RAW"; then
      return 0
    fi
    if [ "$attempt" -lt "$PULL_ATTEMPTS" ]; then
      echo "image pull failed (attempt $attempt), retrying in 10s..."
      sleep 10
    fi
  done
  return 1
}

promote_files() {
  local next_deploy="$WOTB_DIR/deploy.next.$$" next_compose="$WOTB_DIR/docker-compose.next.$$"
  local old_deploy="$WOTB_DIR/deploy.old.$$" old_compose="$WOTB_DIR/docker-compose.old.$$"
  local observability_file observability_selected=false service
  rm -rf -- "$next_deploy"
  rm -f -- "$next_compose"
  mkdir -p "$next_deploy" || return 1
  if [ -d "$LIVE_DEPLOY_DIR" ]; then
    cp -a "$LIVE_DEPLOY_DIR/." "$next_deploy/" || return 1
  fi
  [ -f "$INCOMING_DIR/deploy/deploy.sh" ] || die "staged deployment tree is missing deploy.sh."
  cp -f "$INCOMING_DIR/deploy/deploy.sh" "$next_deploy/deploy.sh" || return 1
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      prometheus|loki|alloy|grafana|node-exporter) observability_selected=true ;;
    esac
  done
  if [ "$observability_selected" = true ]; then
    for observability_file in validate-alloy-config.sh verify-observability.sh grafana-api-request.sh; do
      [ -f "$INCOMING_DIR/deploy/$observability_file" ] || die "staged observability tree is missing $observability_file."
      cp -f "$INCOMING_DIR/deploy/$observability_file" "$next_deploy/$observability_file" || return 1
    done
    rm -rf -- "$next_deploy/observability" || return 1
    mkdir -p "$next_deploy/observability" || return 1
    cp -a "$INCOMING_DIR/deploy/observability/." "$next_deploy/observability/" || return 1
  fi
  cp -f "$EFFECTIVE_COMPOSE" "$next_compose"
  chmod 600 "$next_compose"
  if [ -e "$LIVE_DEPLOY_DIR" ]; then
    mv -- "$LIVE_DEPLOY_DIR" "$old_deploy" || return 1
  fi
  if [ -e "$LIVE_COMPOSE" ]; then
    if ! mv -- "$LIVE_COMPOSE" "$old_compose"; then
      [ -e "$old_deploy" ] && mv -- "$old_deploy" "$LIVE_DEPLOY_DIR"
      return 1
    fi
  fi
  if ! mv -- "$next_deploy" "$LIVE_DEPLOY_DIR"; then
    [ -e "$old_compose" ] && mv -- "$old_compose" "$LIVE_COMPOSE"
    [ -e "$old_deploy" ] && mv -- "$old_deploy" "$LIVE_DEPLOY_DIR"
    return 1
  fi
  if ! mv -- "$next_compose" "$LIVE_COMPOSE"; then
    rm -rf -- "$LIVE_DEPLOY_DIR"
    [ -e "$old_deploy" ] && mv -- "$old_deploy" "$LIVE_DEPLOY_DIR"
    [ -e "$old_compose" ] && mv -- "$old_compose" "$LIVE_COMPOSE"
    return 1
  fi
  rm -rf -- "$old_deploy"
  rm -f -- "$old_compose"
}

compose_service_list() {
  printf '%s\n' "${DEPLOY_SERVICES[@]}"
}

ai_health() {
  is_selected ai-service || return 0
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl --fail --silent --show-error --max-time 5 http://10.20.0.2:8089/actuator/health/readiness >/dev/null; then
      echo "ai-service: PASS"
      return 0
    fi
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  FAILED_SERVICE=ai-service
  echo "ai-service: FAIL" >&2
  return 1
}

apply_services() {
  mapfile -t APPLY_SERVICES < <(compose_service_list | awk 'NF && !seen[$0]++')
  [ "${#APPLY_SERVICES[@]}" -gt 0 ] || die "no runtime service selected."
  local service
  for service in "${APPLY_SERVICES[@]}"; do
    if ! docker compose -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate "$service"; then
      FAILED_SERVICE="$service"
      return 1
    fi
  done
}

observability_health() {
  local service
  while IFS= read -r service; do
    docker compose -f "$LIVE_COMPOSE" ps -a "$service" | grep -Eq 'Up|running' || return 1
  done < <(observability_service_list)
  return 0
}

observability_service_list() {
  local service
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      node-exporter|prometheus|loki|alloy|grafana) printf '%s\n' "$service" ;;
    esac
  done
}

verify_observability() {
  [ -f "$LIVE_DEPLOY_DIR/verify-observability.sh" ] || return 1
  env \
    WOTB_DIR="$WOTB_DIR" \
    WOTB_DEPLOY_ROOT="$WOTB_DIR" \
    WOTB_ALLOY_CONFIG="$LIVE_DEPLOY_DIR/observability/alloy/config.alloy" \
    WOTB_ALLOY_VALIDATOR="$LIVE_DEPLOY_DIR/validate-alloy-config.sh" \
    WOTB_DASHBOARD_DIR="$LIVE_DEPLOY_DIR/observability/grafana/dashboards" \
    WOTB_GRAFANA_API_HELPER="$LIVE_DEPLOY_DIR/grafana-api-request.sh" \
    bash "$LIVE_DEPLOY_DIR/verify-observability.sh"
}

run_observability_checks() {
  [ -n "$(observability_service_list)" ] || return 0
  if ! observability_health; then
    echo "OBSERVABILITY DEGRADED: selected container is not running." >&2
    return 0
  fi
  if ! verify_observability; then
    echo "OBSERVABILITY DEGRADED: data-path verification failed." >&2
  fi
}

diagnostics() {
  echo "== DEPLOY DIAGNOSTICS =="
  echo "sourceSha=$CONFIG_SHA_VALUE"
  echo "deployServices=$DEPLOY_SERVICES_RAW"
  docker compose -f "$LIVE_COMPOSE" ps -a || true
  local -a diagnostic_services=("${APPLY_SERVICES[@]}")
  local failed_service="$FAILED_SERVICE" service already_present=false
  for service in "${diagnostic_services[@]}"; do
    [ "$service" = "$failed_service" ] && already_present=true
  done
  if [ -n "$failed_service" ] && [ "$already_present" = false ]; then
    diagnostic_services+=("$failed_service")
  fi
  for service in "${diagnostic_services[@]}"; do
    [ -n "$service" ] || continue
    echo "== $service inspect =="
    docker compose -f "$LIVE_COMPOSE" ps -a "$service" || true
    docker compose -f "$LIVE_COMPOSE" logs --tail 120 "$service" || true
  done
}

stop_failed_service() {
  local service="$FAILED_SERVICE"
  [ -n "$service" ] || return 0
  case "$service" in
    ai-service) ;;
    *)
      echo "Not stopping non-application health dependency: $service" >&2
      return 0
      ;;
  esac
  if ! is_selected "$service"; then
    echo "Not stopping unaffected application service: $service" >&2
    return 0
  fi
  echo "Stopping failed affected service: $service"
  docker compose -f "$LIVE_COMPOSE" stop "$service" || true
}

main() {
  validate_inputs
  mkdir -p "$WOTB_DIR" "$INCOMING_DIR"
  command -v docker >/dev/null 2>&1 || die "docker is required."
  command -v flock >/dev/null 2>&1 || die "flock is required to serialize production deployments."
  if [ -n "${WOTB_DEPLOY_LOCK_FD:-}" ]; then
    [ "$WOTB_DEPLOY_LOCK_FD" = 9 ] || die "unsupported inherited deployment lock descriptor."
    { true >&9; } 2>/dev/null || die "inherited deployment lock descriptor is unavailable."
    flock -n 9 || die "another production deployment is already running."
  else
    exec 9>"$WOTB_DIR/.deploy.lock"
    flock -n 9 || die "another production deployment is already running."
  fi
  cd "$WOTB_DIR"

  stage_and_validate
  pull_images || {
    echo "ERROR: target image pull failed; live deployment was not changed." >&2
    exit 1
  }
  promote_files || {
    echo "ERROR: live deployment file promotion failed; live deployment was restored when possible." >&2
    exit 1
  }
  if ! apply_services; then
    diagnostics
    stop_failed_service
    exit 1
  fi
  if ! ai_health; then
    diagnostics
    stop_failed_service
    echo "ERROR: ai-service readiness failed; no automatic application recovery was attempted." >&2
    exit 1
  fi
  run_observability_checks
  rm -f -- "$INCOMING_DIR/docker-compose.effective.yml"
  echo "Deployment completed: config=$CONFIG_SHA_VALUE service=$DEPLOY_SERVICES_RAW"
}

main "$@"
