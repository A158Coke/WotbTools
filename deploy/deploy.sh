#!/usr/bin/env bash
# Production deployment with staged validation, validated LKG promotion and fail-closed rollback.
set -euo pipefail

readonly WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
readonly INCOMING_DIR="${WOTB_INCOMING_DIR:-$WOTB_DIR/deploy.incoming}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
readonly PREV_DEPLOY_DIR="$WOTB_DIR/deploy.prev"
readonly PREV_COMPOSE="$WOTB_DIR/docker-compose.prev.yml"
readonly TARGETED_FAILED_DEPLOY_DIR="$WOTB_DIR/deploy.targeted.failed"
readonly TARGETED_FAILED_COMPOSE="$WOTB_DIR/docker-compose.targeted.failed.yml"
readonly LKG_DEPLOY_DIR="$WOTB_DIR/deploy.lkg"
readonly LKG_DEPLOY_NEXT_DIR="$WOTB_DIR/deploy.lkg.next"
readonly LKG_DEPLOY_RETIRING_DIR="$WOTB_DIR/deploy.lkg.retiring"
readonly LKG_COMPOSE="$WOTB_DIR/docker-compose.lkg.yml"
readonly LKG_COMPOSE_NEXT="$WOTB_DIR/docker-compose.lkg.next.yml"
readonly LKG_COMPOSE_INSTALLING="$WOTB_DIR/docker-compose.lkg.installing.yml"
readonly LKG_COMPOSE_RETIRING="$WOTB_DIR/docker-compose.lkg.retiring.yml"
readonly LKG_SHA="$WOTB_DIR/DEPLOYED_SHA.lkg"
readonly LKG_SHA_NEXT="$WOTB_DIR/DEPLOYED_SHA.lkg.next"
readonly LKG_SHA_RETIRING="$WOTB_DIR/DEPLOYED_SHA.lkg.retiring"
readonly LIVE_COMPOSE="$WOTB_DIR/docker-compose.yml"
readonly RESTORE_DEPLOY_NEXT_DIR="$WOTB_DIR/deploy.restore.next"
readonly RESTORE_DEPLOY_FAILED_DIR="$WOTB_DIR/deploy.failed"
readonly RESTORE_COMPOSE_NEXT="$WOTB_DIR/docker-compose.restore.next.yml"
readonly RESTORE_COMPOSE_INSTALLING="$WOTB_DIR/docker-compose.restore.installing.yml"
readonly RESTORE_COMPOSE_FAILED="$WOTB_DIR/docker-compose.failed.yml"
readonly HEALTH_RETRIES="${WOTB_HEALTH_RETRIES:-60}"
readonly GRAFANA_READINESS_RETRIES="${WOTB_GRAFANA_READINESS_RETRIES:-20}"
readonly GRAFANA_READINESS_INTERVAL_SEC="${WOTB_GRAFANA_READINESS_INTERVAL_SEC:-1}"
readonly DEPLOY_SERVICES_RAW="${WOTB_DEPLOY_SERVICES:-${WOTB_DEPLOY_SERVICE:-all}}"
DEPLOY_IMAGE_SERVICES_RAW="${WOTB_DEPLOY_IMAGE_SERVICES:-}"
readonly RELEASE_SHA_VALUE="${RELEASE_SHA:-}"
readonly RELEASE_RUN_NUMBER_VALUE="${RELEASE_RUN_NUMBER:-}"
STALE_RELEASE_GUARD="${WOTB_STALE_RELEASE_GUARD:-0}"
case "$STALE_RELEASE_GUARD" in
  1|true|TRUE) STALE_RELEASE_GUARD=1 ;;
  0|false|FALSE|'') STALE_RELEASE_GUARD=0 ;;
  *) echo "ERROR: WOTB_STALE_RELEASE_GUARD must be 0/1 or false/true." >&2; exit 1 ;;
esac
readonly STALE_RELEASE_GUARD
readonly DEPLOYED_SHA_FILE="$WOTB_DIR/DEPLOYED_SHA"
readonly DEPLOYED_RUN_NUMBER_FILE="$WOTB_DIR/DEPLOYED_RUN_NUMBER"
readonly DEPLOYED_STATE_DIR="$WOTB_DIR/deployed-state"
readonly DEPLOYED_STATE_MIGRATION_MARKER="$DEPLOYED_STATE_DIR/.legacy-migrated"

declare -a DEPLOY_SERVICES=()
declare -a DEPLOY_IMAGE_SERVICES=()
IFS=',' read -r -a DEPLOY_SERVICES <<< "$DEPLOY_SERVICES_RAW"
if [ -z "$DEPLOY_IMAGE_SERVICES_RAW" ] && [ -n "${WOTB_DEPLOY_SERVICE:-}" ]; then
  case "$DEPLOY_SERVICES_RAW" in
    keycloak|wotb-backend|wotb-frontend) DEPLOY_IMAGE_SERVICES_RAW="$DEPLOY_SERVICES_RAW" ;;
  esac
fi
if [ -z "$DEPLOY_IMAGE_SERVICES_RAW" ] \
    && [ "$STALE_RELEASE_GUARD" != 1 ] \
    && [ "$DEPLOY_SERVICES_RAW" = all ]; then
  # Legacy/manual callers that only supplied TAG=... and full deploy semantics
  # historically updated all application images. Automatic manifest-driven
  # deploys always set STALE_RELEASE_GUARD=1, so config-only all remains no-op
  # for application images and preserves the live immutable tags.
  DEPLOY_IMAGE_SERVICES_RAW="wotb-backend,wotb-frontend,keycloak"
fi
IFS=',' read -r -a DEPLOY_IMAGE_SERVICES <<< "$DEPLOY_IMAGE_SERVICES_RAW"

if [ "${#DEPLOY_SERVICES[@]}" -eq 0 ] || [ -z "${DEPLOY_SERVICES[0]}" ]; then
  echo "ERROR: WOTB_DEPLOY_SERVICES must contain at least one service." >&2
  exit 1
fi
if [ "${DEPLOY_SERVICES[0]}" = all ] && [ "${#DEPLOY_SERVICES[@]}" -ne 1 ]; then
  echo "ERROR: all cannot be combined with other deployment services." >&2
  exit 1
fi
for service in "${DEPLOY_SERVICES[@]}"; do
  case "$service" in
    all|postgres|node-exporter|prometheus|loki|alloy|grafana|keycloak|wotb-backend|wotb-frontend)
      ;;
    *)
      echo "ERROR: unsupported deployment service: $service" >&2
      exit 1
      ;;
  esac
done
for service in "${DEPLOY_IMAGE_SERVICES[@]}"; do
  case "$service" in
    "") ;;
    keycloak|wotb-backend|wotb-frontend) ;;
    *)
      echo "ERROR: unsupported WOTB_DEPLOY_IMAGE_SERVICES entry: $service" >&2
      exit 1
      ;;
  esac
done

has_deploy_service() {
  local wanted="$1" service
  for service in "${DEPLOY_SERVICES[@]}"; do
    [ "$service" = "$wanted" ] && return 0
  done
  return 1
}

has_image_service() {
  local wanted="$1" service
  for service in "${DEPLOY_IMAGE_SERVICES[@]}"; do
    [ "$service" = "$wanted" ] && return 0
  done
  return 1
}

is_full_deploy() {
  [ "${#DEPLOY_SERVICES[@]}" -eq 1 ] && [ "${DEPLOY_SERVICES[0]}" = all ]
}

state_services() {
  local service
  for service in "${DEPLOY_IMAGE_SERVICES[@]}"; do
    case "$service" in
      wotb-backend|wotb-frontend|keycloak) printf '%s\n' "$service" ;;
    esac
  done
}

state_file() {
  local service="$1" kind="$2"
  printf '%s/%s.%s\n' "$DEPLOYED_STATE_DIR" "$service" "$kind"
}

write_atomic_value() {
  local target="$1" value="$2" temporary
  temporary="${target}.next.$$"
  umask 177
  printf '%s\n' "$value" > "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$target"
}

migrate_legacy_state() {
  [ -e "$DEPLOYED_STATE_MIGRATION_MARKER" ] && return 0
  mkdir -p "$DEPLOYED_STATE_DIR"
  if [ -f "$DEPLOYED_RUN_NUMBER_FILE" ] && [ -f "$DEPLOYED_SHA_FILE" ]; then
    local legacy_run legacy_sha service
    legacy_run="$(tr -d '\r\n' < "$DEPLOYED_RUN_NUMBER_FILE")"
    legacy_sha="$(tr -d '\r\n' < "$DEPLOYED_SHA_FILE")"
    [[ "$legacy_run" =~ ^[1-9][0-9]*$ ]] || {
      echo "ERROR: existing DEPLOYED_RUN_NUMBER is invalid; refusing state migration." >&2
      return 1
    }
    for service in wotb-backend wotb-frontend keycloak; do
      write_atomic_value "$(state_file "$service" run)" "$legacy_run"
      write_atomic_value "$(state_file "$service" sha)" "$legacy_sha"
    done
  fi
  write_atomic_value "$DEPLOYED_STATE_MIGRATION_MARKER" "schema=1"
}

update_deployed_state() {
  local deployment_id="$1" service run_file sha_file
  mkdir -p "$DEPLOYED_STATE_DIR"
  while IFS= read -r service; do
    [ -n "$service" ] || continue
    sha_file="$(state_file "$service" sha)"
    write_atomic_value "$sha_file" "$deployment_id"
    if [ -n "$RELEASE_RUN_NUMBER_VALUE" ]; then
      run_file="$(state_file "$service" run)"
      write_atomic_value "$run_file" "$RELEASE_RUN_NUMBER_VALUE"
    fi
  done < <(state_services)
  if is_full_deploy; then
    write_atomic_value "$DEPLOYED_SHA_FILE" "$deployment_id"
    if [ -n "$RELEASE_RUN_NUMBER_VALUE" ]; then
      write_atomic_value "$DEPLOYED_RUN_NUMBER_FILE" "$RELEASE_RUN_NUMBER_VALUE"
    fi
  fi
}

if [ "$STALE_RELEASE_GUARD" = 1 ]; then
  [[ "$RELEASE_SHA_VALUE" =~ ^[0-9a-f]{40}$ ]] || {
    echo "ERROR: automatic deployment requires a full RELEASE_SHA." >&2
    exit 1
  }
  [[ "$RELEASE_RUN_NUMBER_VALUE" =~ ^[1-9][0-9]*$ ]] || {
    echo "ERROR: automatic deployment requires a positive RELEASE_RUN_NUMBER." >&2
    exit 1
  }
  [ "$TAG" = "sha-${RELEASE_SHA_VALUE:0:12}" ] || {
    echo "ERROR: TAG does not match RELEASE_SHA." >&2
    exit 1
  }
fi

if [[ ! "$HEALTH_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: WOTB_HEALTH_RETRIES must be a positive integer." >&2
  exit 1
fi
if [[ ! "$GRAFANA_READINESS_RETRIES" =~ ^[1-9][0-9]*$ \
    || ! "$GRAFANA_READINESS_INTERVAL_SEC" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: Grafana readiness retry settings must be positive integers." >&2
  exit 1
fi
if [ -z "$WOTB_DIR" ] || [ "$WOTB_DIR" = "/" ] || [ -z "$INCOMING_DIR" ] || [ "$INCOMING_DIR" = "/" ]; then
  echo "ERROR: refusing to operate on an unsafe deployment path." >&2
  exit 1
fi
require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name secret is not configured." >&2
    exit 1
  fi
}
for required in TAG DB_PASSWORD KC_ADMIN_PASSWORD WG_APPLICATION_ID KEYCLOAK_ADMIN_CLIENT_SECRET AI_API_KEY GRAFANA_ADMIN_USER GRAFANA_ADMIN_PASSWORD; do
  require_env "$required"
done

if [[ "$AI_API_KEY" =~ [[:cntrl:]] ]]; then
  echo "ERROR: AI_API_KEY contains invalid control characters." >&2
  exit 1
fi

if [ -n "${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:-}" ] \
    && [ "$AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC" != "1100" ]; then
  printf 'ERROR: AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC must be 1100 to stay aligned with frontend(1100s)/nginx(1120s); got %s\n' \
    "$AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC" >&2
  exit 3
fi

mkdir -p "$WOTB_DIR" "$DEPLOYED_STATE_DIR"
if ! command -v flock >/dev/null 2>&1; then
  echo "ERROR: flock is required to serialize production deployments." >&2
  exit 1
fi
exec 9>"$WOTB_DIR/.deploy.lock"
if ! flock -n 9; then
  echo "ERROR: another production deployment is already running." >&2
  exit 1
fi
cd "$WOTB_DIR"
migrate_legacy_state
readonly STAGED_DEPLOY_DIR="$INCOMING_DIR/deploy"
readonly STAGED_COMPOSE="$INCOMING_DIR/docker-compose.next.yml"
readonly STAGED_RESOLVED_COMPOSE="$INCOMING_DIR/docker-compose.next.resolved.yml"
readonly RUNNER_DIR="$INCOMING_DIR/.runner"
readonly RUNNER_VERIFIER="$RUNNER_DIR/verify-observability.sh"
readonly RUNNER_VALIDATOR="$RUNNER_DIR/validate-alloy-config.sh"
readonly RUNNER_GRAFANA_API_HELPER="$RUNNER_DIR/grafana-api-request.sh"
readonly STAGED_SERVICE_OVERRIDE="$INCOMING_DIR/docker-compose.service.override.yml"
if [ ! -f "$STAGED_DEPLOY_DIR/docker-compose.prod.yml" ]; then
  echo "ERROR: staged deployment tree is missing: $STAGED_DEPLOY_DIR/docker-compose.prod.yml" >&2
  exit 1
fi

# Compose paths are relative to the incoming project root. Application data is
# shared explicitly; deployment/config files remain inside the staged tree.
mkdir -p "$INCOMING_DIR" "$WOTB_DIR/config/sponsor" "$WOTB_DIR/android-release"
ln -sfn "$WOTB_DIR/config" "$INCOMING_DIR/config"
ln -sfn "$WOTB_DIR/android-release" "$INCOMING_DIR/android-release"
if [ ! -e "$WOTB_DIR/config/sponsor-config.json" ] && [ -f "$STAGED_DEPLOY_DIR/sponsor-config.example.json" ]; then
  install -m 644 "$STAGED_DEPLOY_DIR/sponsor-config.example.json" "$WOTB_DIR/config/sponsor-config.json"
fi

PREV_SHA=""
if [ -f "$DEPLOYED_SHA_FILE" ]; then PREV_SHA=$(tr -d '\r\n' < "$DEPLOYED_SHA_FILE"); fi

if [ "$STALE_RELEASE_GUARD" = 1 ]; then
  while IFS= read -r service; do
    [ -n "$service" ] || continue
    current_run_number=""
    current_sha=""
    run_file="$(state_file "$service" run)"
    sha_file="$(state_file "$service" sha)"
    [ -f "$run_file" ] && current_run_number="$(tr -d '\r\n' < "$run_file")"
    [ -f "$sha_file" ] && current_sha="$(tr -d '\r\n' < "$sha_file")"
    if [ -n "$current_run_number" ] && [[ ! "$current_run_number" =~ ^[1-9][0-9]*$ ]]; then
      echo "ERROR: existing deployed run for $service is invalid; refusing automatic deployment." >&2
      exit 1
    fi
    if [ -n "$current_run_number" ] && [ "$RELEASE_RUN_NUMBER_VALUE" -lt "$current_run_number" ]; then
      echo "ERROR: stale release run $RELEASE_RUN_NUMBER_VALUE cannot overwrite deployed $service run $current_run_number." >&2
      exit 1
    fi
    if [ -n "$current_run_number" ] && [ "$RELEASE_RUN_NUMBER_VALUE" -eq "$current_run_number" ] \
        && [ -n "$current_sha" ] && [ "$current_sha" != "$RELEASE_SHA_VALUE" ]; then
      echo "ERROR: release run number is reused for a different $service commit." >&2
      exit 1
    fi
  done < <(state_services)
fi

current_image_tag() {
  local service="$1" tag
  tag="$(awk -v prefix="ghcr.io/a158coke/wotbtools-${service}:" \
    '$1 == "image:" && index($2, prefix) == 1 { sub(prefix, "", $2); print $2; exit }' \
    "$LIVE_COMPOSE")"
  if [ -z "$tag" ] || [[ "$tag" =~ [[:space:]] ]]; then
    echo "ERROR: could not resolve the current immutable ${service} image tag." >&2
    return 1
  fi
  printf '%s\n' "$tag"
}

prepare_service_override() {
  rm -f -- "$STAGED_SERVICE_OVERRIDE"
  if is_full_deploy && [ "${#DEPLOY_IMAGE_SERVICES[@]}" -eq 3 ]; then
    return 0
  fi
  if [ ! -f "$LIVE_COMPOSE" ]; then
    echo "ERROR: deployment requires an existing live compose file to preserve non-target application images." >&2
    return 1
  fi

  local backend_tag frontend_tag keycloak_tag
  backend_tag="$(current_image_tag backend)"
  frontend_tag="$(current_image_tag frontend)"
  keycloak_tag="$(current_image_tag keycloak)"
  has_image_service wotb-backend && backend_tag="$TAG"
  has_image_service wotb-frontend && frontend_tag="$TAG"
  has_image_service keycloak && keycloak_tag="$TAG"

  umask 177
  cat > "$STAGED_SERVICE_OVERRIDE" <<EOF
services:
  keycloak:
    image: ghcr.io/a158coke/wotbtools-keycloak:${keycloak_tag}
  wotb-backend:
    image: ghcr.io/a158coke/wotbtools-backend:${backend_tag}
  wotb-frontend:
    image: ghcr.io/a158coke/wotbtools-frontend:${frontend_tag}
EOF
  chmod 600 "$STAGED_SERVICE_OVERRIDE"
}

if [ -f docker-compose.yml ] && [ -x "$LIVE_DEPLOY_DIR/postgres-backup.sh" ]; then
  "$LIVE_DEPLOY_DIR/postgres-backup.sh" --database wotb
  "$LIVE_DEPLOY_DIR/postgres-backup.sh" --database keycloak
else
  echo "No existing deployment; skipping pre-deploy backup."
fi

umask 177
printf 'GRAFANA_ADMIN_USER=%s\nGRAFANA_ADMIN_PASSWORD=%s\n' \
  "$GRAFANA_ADMIN_USER" "$GRAFANA_ADMIN_PASSWORD" > .env
chmod 600 .env

prepare_service_override
STAGED_COMPOSE_ARGS=(-f "$STAGED_COMPOSE")
if [ -f "$STAGED_SERVICE_OVERRIDE" ]; then
  STAGED_COMPOSE_ARGS+=(-f "$STAGED_SERVICE_OVERRIDE")
fi
cp -f "$STAGED_DEPLOY_DIR/docker-compose.prod.yml" "$STAGED_COMPOSE"
if ! docker compose "${STAGED_COMPOSE_ARGS[@]}" config > "$STAGED_RESOLVED_COMPOSE"; then
  echo "ERROR: staged compose config is invalid; live deployment was not changed." >&2
  exit 1
fi
chmod 600 "$STAGED_RESOLVED_COMPOSE"

pull_compose() {
  local compose_file="$1" attempt service
  shift
  local -a compose_args=(-f "$compose_file")
  if [ "$compose_file" = "$STAGED_COMPOSE" ] && [ -f "$STAGED_SERVICE_OVERRIDE" ]; then
    compose_args+=(-f "$STAGED_SERVICE_OVERRIDE")
  fi
  local -a pull_args=()
  for service in "$@"; do
    [ -n "$service" ] && pull_args+=("$service")
  done
  for attempt in 1 2 3; do
    if docker compose "${compose_args[@]}" pull "${pull_args[@]}"; then return 0; fi
    if [ "$attempt" -lt 3 ]; then
      echo "docker compose pull failed (${compose_file}, attempt $attempt), retrying in 10s..."
      sleep 10
    fi
  done
  return 1
}

assert_service_running() {
  local service="$1" label="$2" status
  status="$(docker compose ps -a "$service" 2>/dev/null || true)"
  if ! grep -qE "Up|running" <<<"$status" || grep -qE "Restarting|Exited|Dead" <<<"$status"; then
    echo "ERROR: ${label} is not running." >&2
    return 1
  fi
}

apply_observability_services() {
  echo "== Applying Prometheus/Loki/Alloy/Grafana configuration =="
  docker compose up -d --force-recreate prometheus loki alloy grafana
  assert_service_running prometheus Prometheus || return 1
  assert_service_running loki Loki || return 1
  assert_service_running alloy Alloy || return 1
  assert_service_running grafana Grafana || return 1
}

verify_grafana_from_frontend_network() {
  echo "== Verifying frontend can resolve Grafana through runtime Docker DNS =="
  local attempt
  for attempt in $(seq 1 "$GRAFANA_READINESS_RETRIES"); do
    if docker compose exec -T wotb-frontend wget -qO- http://grafana:3000/api/health >/dev/null 2>&1; then
      return 0
    fi
    [ "$attempt" -lt "$GRAFANA_READINESS_RETRIES" ] \
      && sleep "$GRAFANA_READINESS_INTERVAL_SEC"
  done
  echo "ERROR: Grafana did not become ready from the frontend network after ${GRAFANA_READINESS_RETRIES} attempts." >&2
  return 1
}

deploy_selected_service() {
  if is_full_deploy; then
    docker compose up -d --remove-orphans postgres keycloak wotb-backend wotb-frontend
    return 0
  fi
  echo "== Deploying selected services: ${DEPLOY_SERVICES[*]} =="
  docker compose up -d --no-deps --force-recreate --remove-orphans "${DEPLOY_SERVICES[@]}"
  local service
  for service in "${DEPLOY_SERVICES[@]}"; do
    assert_service_running "$service" "$service" || return 1
  done
}

deploy_service_label() {
  if is_full_deploy; then
    printf 'all\n'
  else
    local joined="" service
    for service in "${DEPLOY_SERVICES[@]}"; do
      [ -n "$joined" ] && joined+=,
      joined+="$service"
    done
    printf '%s\n' "$joined"
  fi
}

assert_services_running() {
  local service
  for service in "$@"; do
    assert_service_running "$service" "$service" || return 1
  done
}

wait_application_healthy() {
  local i ok service_pattern="wotb-backend|wotb-frontend|keycloak"
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if docker compose ps -a | grep -E "$service_pattern" | grep -qE "Restarting|Exited|Dead"; then
      sleep 2
      continue
    fi
    ok=true
    docker compose exec -T wotb-backend wget -qO- http://127.0.0.1:8087/api/health >/dev/null 2>&1 || ok=false
    [ "$ok" = true ] && docker compose exec -T wotb-frontend wget --header='Host: wotbtools.com' -qO- http://127.0.0.1:80/api/health >/dev/null 2>&1 || ok=false
    [ "$ok" = true ] && docker compose exec -T wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration >/dev/null 2>&1 || ok=false
    if [ "$ok" = true ]; then return 0; fi
    [ "$i" -lt "$HEALTH_RETRIES" ] && sleep 2
  done
  echo "Health check failed:" >&2
  report_health_status
  return 1
}

wait_healthy() {
  if is_full_deploy; then
    wait_application_healthy
    return
  fi
  local i ok service
  local has_probe=false
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      wotb-backend|wotb-frontend|keycloak) has_probe=true ;;
    esac
  done
  if [ "$has_probe" = false ]; then
    return 0
  fi
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    ok=true
    for service in "${DEPLOY_SERVICES[@]}"; do
      case "$service" in
        wotb-backend)
          docker compose exec -T wotb-backend wget -qO- http://127.0.0.1:8087/api/health >/dev/null 2>&1 || ok=false
          ;;
        wotb-frontend)
          [ "$ok" = true ] && docker compose exec -T wotb-frontend wget --header='Host: wotbtools.com' -qO- http://127.0.0.1:80/api/health >/dev/null 2>&1 || ok=false
          ;;
        keycloak)
          [ "$ok" = true ] && docker compose exec -T wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration >/dev/null 2>&1 || ok=false
          ;;
      esac
    done
    if [ "$ok" = true ]; then return 0; fi
    [ "$i" -lt "$HEALTH_RETRIES" ] && sleep 2
  done
  echo "Targeted health check failed for: ${DEPLOY_SERVICES[*]}" >&2
  report_health_status
  return 1
}

verify_observability() {
  WOTB_ALLOY_CONFIG="$LIVE_DEPLOY_DIR/observability/alloy/config.alloy" \
    WOTB_ALLOY_VALIDATOR="$RUNNER_VALIDATOR" \
    WOTB_DASHBOARD_DIR="$LIVE_DEPLOY_DIR/observability/grafana/dashboards" \
    WOTB_GRAFANA_API_HELPER="$RUNNER_GRAFANA_API_HELPER" \
    bash "$RUNNER_VERIFIER"
}

report_observability_status() {
  if verify_observability; then
    echo "OBSERVABILITY HEALTHY"
    return 0
  fi
  echo "OBSERVABILITY DEGRADED" >&2
  dump_logs
  return 1
}

prepare_runner_tools() {
  if ! mkdir -m 700 -p "$RUNNER_DIR" \
      || ! chmod 700 "$RUNNER_DIR" \
      || ! install -m 755 "$STAGED_DEPLOY_DIR/verify-observability.sh" "$RUNNER_VERIFIER" \
      || ! install -m 755 "$STAGED_DEPLOY_DIR/validate-alloy-config.sh" "$RUNNER_VALIDATOR" \
      || ! install -m 755 "$STAGED_DEPLOY_DIR/grafana-api-request.sh" "$RUNNER_GRAFANA_API_HELPER"; then
    echo "ERROR: deployment-owned rollback verifier could not be staged." >&2
    return 1
  fi
}

report_health_status() {
  local running
  running="$(docker compose ps -a 2>/dev/null || true)"
  probe() {
    local label="$1" service="$2"
    shift 2
    if ! grep -qE "$service" <<<"$running"; then
      echo "  ${label}: SKIPPED (${service} container absent)"
    elif docker compose exec -T "$@" >/dev/null 2>&1; then
      echo "  ${label}: PASS"
    else
      echo "  ${label}: FAILED"
    fi
  }
  probe backend wotb-backend wotb-backend wget -qO- http://127.0.0.1:8087/api/health
  probe frontend wotb-frontend wotb-frontend wget --header='Host: wotbtools.com' -qO- http://127.0.0.1:80/api/health
  probe keycloak keycloak wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration
}

dump_logs() {
  docker compose ps -a || true
  echo "== service list (no container environment dump) =="
  docker compose config --services || true
  for service in wotb-backend wotb-frontend keycloak prometheus loki alloy grafana; do
    echo "== ${service} logs =="
    docker compose logs --tail 120 "$service" || true
  done
}

rewrite_compose_tree_path() {
  local source_file="$1" destination_file="$2" from_tree="$3" to_tree="$4"
  local from_path="${WOTB_DIR%/}/${from_tree}/"
  local to_path="${WOTB_DIR%/}/${to_tree}/"
  if ! sed "s|$from_path|$to_path|g; s|\./${from_tree}/|./${to_tree}/|g" \
      "$source_file" > "$destination_file"; then
    echo "ERROR: failed to rewrite compose paths from ${from_tree} to ${to_tree}." >&2
    return 1
  fi
}

copy_tree() {
  local purpose="$1" source_dir="$2" destination_dir="$3"
  if [ "$purpose" = lkg-stage ] && [ "${WOTB_TEST_FAIL_LKG_STAGE_COPY:-0}" = 1 ]; then
    echo "TEST INJECTION: refusing LKG stage copy." >&2
    return 1
  fi
  if [ "$purpose" = lkg-restore ] && [ "${WOTB_TEST_FAIL_LKG_RESTORE_COPY:-0}" = 1 ]; then
    echo "TEST INJECTION: refusing LKG restore copy." >&2
    return 1
  fi
  cp -a "$source_dir" "$destination_dir"
}

move_path() {
  local purpose="$1" source_path="$2" destination_path="$3"
  if [ "$purpose" = restore-live ] \
      && [ "${WOTB_TEST_FAIL_LKG_RESTORE_LIVE_SWITCH:-0}" = 1 ]; then
    echo "TEST INJECTION: refusing LKG live tree switch." >&2
    return 1
  fi
  if [ "$purpose" = restore-compose ] \
      && [ "${WOTB_TEST_FAIL_LKG_RESTORE_COMPOSE_INSTALL:-0}" = 1 ]; then
    echo "TEST INJECTION: refusing LKG compose installation." >&2
    return 1
  fi
  mv -- "$source_path" "$destination_path"
}

retire_lkg_path() {
  local source_path="$1" destination_path="$2" failure_flag="$3"
  if [ "${!failure_flag:-0}" = 1 ]; then
    echo "TEST INJECTION: refusing LKG retirement move." >&2
    return 1
  fi
  mv -- "$source_path" "$destination_path"
}

lkg_bundle_present() {
  [ -e "$LKG_DEPLOY_DIR" ] || [ -e "$LKG_COMPOSE" ] || [ -e "$LKG_SHA" ]
}

validate_lkg_bundle() {
  local deploy_dir="$1" compose_file="$2" sha_file="$3" label="$4" sha service
  if [ ! -d "$deploy_dir" ] || [ ! -f "$compose_file" ] || [ ! -f "$sha_file" ]; then
    echo "${label}: LKG bundle is incomplete." >&2
    return 1
  fi
  if ! sha="$(tr -d '\r\n' < "$sha_file")"; then
    echo "${label}: LKG SHA metadata could not be read." >&2
    return 1
  fi
  if [ -z "$sha" ] || [[ "$sha" =~ [[:space:]] ]]; then
    echo "${label}: LKG SHA metadata is invalid." >&2
    return 1
  fi
  if ! docker compose -f "$compose_file" config >/dev/null 2>&1; then
    echo "${label}: LKG compose parse failed." >&2
    return 1
  fi
  for service in backend frontend keycloak; do
    if ! grep -Eq "wotbtools-${service}:sha-[^[:space:]]+([[:space:]]|$)" "$compose_file"; then
      echo "${label}: LKG immutable tag missing for ${service}." >&2
      return 1
    fi
  done
}

stage_lkg_snapshot() {
  local source_dir="$1" source_compose="$2" sha="$3"
  if ! rm -rf -- "$LKG_DEPLOY_NEXT_DIR" "$LKG_COMPOSE_NEXT" "$LKG_SHA_NEXT"; then
    echo "ERROR: failed to clear the LKG staging paths." >&2
    return 1
  fi
  if ! copy_tree lkg-stage "$source_dir" "$LKG_DEPLOY_NEXT_DIR"; then
    echo "ERROR: failed to copy the deployment tree into the LKG staging path." >&2
    return 1
  fi
  if ! rewrite_compose_tree_path "$source_compose" "$LKG_COMPOSE_NEXT" deploy deploy.lkg.next; then
    return 1
  fi
  if ! printf '%s\n' "$sha" > "$LKG_SHA_NEXT"; then
    echo "ERROR: failed to write the LKG SHA staging metadata." >&2
    return 1
  fi
  if ! chmod 600 "$LKG_COMPOSE_NEXT" "$LKG_SHA_NEXT"; then
    echo "ERROR: failed to protect the LKG staging metadata." >&2
    return 1
  fi
}

validate_lkg_candidate() {
  validate_lkg_bundle \
    "$LKG_DEPLOY_NEXT_DIR" "$LKG_COMPOSE_NEXT" "$LKG_SHA_NEXT" \
    "LKG candidate"
}

promote_lkg_candidate() {
  local restore_failed=false
  local deploy_retired=false compose_retired=false sha_retired=false
  local deploy_installed=false compose_installed=false sha_installed=false
  validate_lkg_candidate || return 1
  if [ -e "$LKG_DEPLOY_RETIRING_DIR" ] || [ -e "$LKG_COMPOSE_RETIRING" ] \
      || [ -e "$LKG_SHA_RETIRING" ]; then
    if ! validate_lkg_bundle "$LKG_DEPLOY_DIR" "$LKG_COMPOSE" "$LKG_SHA" \
        "Existing LKG before stale-retirement cleanup"; then
      echo "ERROR: incomplete prior LKG promotion found; refusing to overwrite it." >&2
      return 1
    fi
    if ! rm -rf -- "$LKG_DEPLOY_RETIRING_DIR" \
        || ! rm -f -- "$LKG_COMPOSE_RETIRING" "$LKG_SHA_RETIRING"; then
      echo "ERROR: stale LKG retirement paths could not be recovered safely." >&2
      return 1
    fi
  fi

  restore_retired_lkg() {
    if [ "$deploy_installed" = true ] && ! rm -rf -- "$LKG_DEPLOY_DIR"; then
      restore_failed=true
    fi
    if [ "$compose_installed" = true ] && ! rm -f -- "$LKG_COMPOSE"; then
      restore_failed=true
    fi
    if [ "$sha_installed" = true ] && ! rm -f -- "$LKG_SHA"; then
      restore_failed=true
    fi
    if ! rm -f -- "$LKG_COMPOSE_INSTALLING"; then
      restore_failed=true
    fi
    if [ "$deploy_retired" = true ] && [ -e "$LKG_DEPLOY_RETIRING_DIR" ] \
        && ! mv -- "$LKG_DEPLOY_RETIRING_DIR" "$LKG_DEPLOY_DIR"; then
      restore_failed=true
    fi
    if [ "$compose_retired" = true ] && [ -e "$LKG_COMPOSE_RETIRING" ] \
        && ! mv -- "$LKG_COMPOSE_RETIRING" "$LKG_COMPOSE"; then
      restore_failed=true
    fi
    if [ "$sha_retired" = true ] && [ -e "$LKG_SHA_RETIRING" ] \
        && ! mv -- "$LKG_SHA_RETIRING" "$LKG_SHA"; then
      restore_failed=true
    fi
    if [ "$restore_failed" = true ]; then
      echo "ERROR: failed to restore the previous validated LKG after promotion failure." >&2
      return 1
    fi
    return 0
  }

  if [ -e "$LKG_DEPLOY_DIR" ]; then
    if ! retire_lkg_path "$LKG_DEPLOY_DIR" "$LKG_DEPLOY_RETIRING_DIR" WOTB_TEST_FAIL_LKG_DEPLOY_RETIRE; then
      return 1
    fi
    deploy_retired=true
  fi
  if [ -e "$LKG_COMPOSE" ]; then
    if ! retire_lkg_path "$LKG_COMPOSE" "$LKG_COMPOSE_RETIRING" WOTB_TEST_FAIL_LKG_COMPOSE_RETIRE; then
      if ! restore_retired_lkg; then
        echo "ERROR: LKG rollback cleanup also failed." >&2
      fi
      return 1
    fi
    compose_retired=true
  fi
  if [ -e "$LKG_SHA" ]; then
    if ! retire_lkg_path "$LKG_SHA" "$LKG_SHA_RETIRING" WOTB_TEST_FAIL_LKG_SHA_RETIRE; then
      if ! restore_retired_lkg; then
        echo "ERROR: LKG rollback cleanup also failed." >&2
      fi
      return 1
    fi
    sha_retired=true
  fi
  if ! mv -- "$LKG_DEPLOY_NEXT_DIR" "$LKG_DEPLOY_DIR"; then
    if ! restore_retired_lkg; then
      echo "ERROR: LKG rollback cleanup also failed." >&2
    fi
    return 1
  fi
  deploy_installed=true
  if ! sed 's|deploy\.lkg\.next/|deploy.lkg/|g' "$LKG_COMPOSE_NEXT" > "$LKG_COMPOSE_INSTALLING" \
      || ! chmod 600 "$LKG_COMPOSE_INSTALLING" \
      || ! mv -- "$LKG_COMPOSE_INSTALLING" "$LKG_COMPOSE"; then
    if ! restore_retired_lkg; then
      echo "ERROR: LKG rollback cleanup also failed." >&2
    fi
    return 1
  fi
  compose_installed=true
  if ! mv -- "$LKG_SHA_NEXT" "$LKG_SHA"; then
    if ! restore_retired_lkg; then
      echo "ERROR: LKG rollback cleanup also failed." >&2
    fi
    return 1
  fi
  sha_installed=true
  if ! validate_lkg_bundle "$LKG_DEPLOY_DIR" "$LKG_COMPOSE" "$LKG_SHA" "Promoted LKG"; then
    if ! restore_retired_lkg; then
      echo "ERROR: LKG rollback cleanup also failed." >&2
    fi
    return 1
  fi
  if ! rm -f -- "$LKG_COMPOSE_NEXT" "$LKG_COMPOSE_RETIRING" "$LKG_SHA_RETIRING" \
      || ! rm -rf -- "$LKG_DEPLOY_RETIRING_DIR"; then
    echo "WARNING: new LKG is validated, but retired LKG cleanup was incomplete; next promotion will retry cleanup." >&2
  fi
  return 0
}

seed_current_lkg() {
  [ -d "$LIVE_DEPLOY_DIR" ] || return 1
  [ -f docker-compose.yml ] || return 1
  [ -n "$PREV_SHA" ] || return 1
  echo "== Validating current deployment for LKG seeding =="
  docker compose -f docker-compose.yml config >/dev/null 2>&1 || return 1
  bash "$STAGED_DEPLOY_DIR/validate-alloy-config.sh" \
    "$STAGED_DEPLOY_DIR/observability/alloy/config.alloy" >/dev/null || return 1
  wait_application_healthy || return 1
  stage_lkg_snapshot "$LIVE_DEPLOY_DIR" docker-compose.yml "$PREV_SHA" || return 1
  if ! install -m 644 "$STAGED_DEPLOY_DIR/observability/alloy/config.alloy" \
      "$LKG_DEPLOY_NEXT_DIR/observability/alloy/config.alloy"; then
    echo "ERROR: failed to add the current Alloy config to the LKG snapshot." >&2
    return 1
  fi
  if [ ! -f "$LKG_DEPLOY_NEXT_DIR/validate-alloy-config.sh" ]; then
    if ! install -m 755 "$STAGED_DEPLOY_DIR/validate-alloy-config.sh" \
        "$LKG_DEPLOY_NEXT_DIR/validate-alloy-config.sh"; then
      echo "ERROR: failed to add the current Alloy validator to the LKG snapshot." >&2
      return 1
    fi
  fi
  promote_lkg_candidate || return 1
}

prepare_lkg_restore() {
  if [ -e "$RESTORE_DEPLOY_FAILED_DIR" ] || [ -e "$RESTORE_COMPOSE_FAILED" ]; then
    echo "ERROR: stale failed LKG restore paths exist; refusing to overwrite them." >&2
    return 1
  fi
  if ! rm -rf -- "$RESTORE_DEPLOY_NEXT_DIR" "$RESTORE_COMPOSE_NEXT" "$RESTORE_COMPOSE_INSTALLING"; then
    echo "ERROR: failed to clear the LKG restore staging paths." >&2
    return 1
  fi
  if ! copy_tree lkg-restore "$LKG_DEPLOY_DIR" "$RESTORE_DEPLOY_NEXT_DIR"; then
    echo "ERROR: failed to stage the validated LKG for restore; live was not changed." >&2
    return 1
  fi
  if ! rewrite_compose_tree_path "$LKG_COMPOSE" "$RESTORE_COMPOSE_NEXT" deploy.lkg deploy.restore.next; then
    return 1
  fi
  if ! chmod 600 "$RESTORE_COMPOSE_NEXT"; then
    echo "ERROR: failed to protect the staged LKG restore compose." >&2
    return 1
  fi
  if ! docker compose -f "$RESTORE_COMPOSE_NEXT" config >/dev/null; then
    echo "ERROR: staged LKG restore compose validation failed; live was not changed." >&2
    return 1
  fi
  if ! validate_lkg_bundle "$RESTORE_DEPLOY_NEXT_DIR" "$RESTORE_COMPOSE_NEXT" "$LKG_SHA" \
      "LKG restore candidate"; then
    echo "ERROR: staged LKG restore bundle validation failed; live was not changed." >&2
    return 1
  fi
}

restore_previous_live_after_failed_switch() {
  local restore_failed=false
  if [ -e "$LIVE_DEPLOY_DIR" ] && ! rm -rf -- "$LIVE_DEPLOY_DIR"; then
    restore_failed=true
  fi
  if [ -e "$LIVE_COMPOSE" ] && [ -e "$RESTORE_COMPOSE_FAILED" ] \
      && ! rm -f -- "$LIVE_COMPOSE"; then
    restore_failed=true
  fi
  if [ -e "$RESTORE_DEPLOY_FAILED_DIR" ] \
      && ! move_path restore-recover-live "$RESTORE_DEPLOY_FAILED_DIR" "$LIVE_DEPLOY_DIR"; then
    restore_failed=true
  fi
  if [ -e "$RESTORE_COMPOSE_FAILED" ] \
      && ! move_path restore-recover-compose "$RESTORE_COMPOSE_FAILED" "$LIVE_COMPOSE"; then
    restore_failed=true
  fi
  if [ "$restore_failed" = true ]; then
    echo "ERROR: failed to restore the pre-rollback live state after a switch failure." >&2
    return 1
  fi
  return 0
}

restore_lkg_to_live() {
  prepare_lkg_restore || return 1
  if [ -e "$LIVE_DEPLOY_DIR" ] \
      && ! move_path restore-preserve-live "$LIVE_DEPLOY_DIR" "$RESTORE_DEPLOY_FAILED_DIR"; then
    echo "ERROR: failed to preserve the current live deployment tree." >&2
    return 1
  fi
  if [ -e "$LIVE_COMPOSE" ] \
      && ! move_path restore-preserve-compose "$LIVE_COMPOSE" "$RESTORE_COMPOSE_FAILED"; then
    echo "ERROR: failed to preserve the current live compose file." >&2
    if ! restore_previous_live_after_failed_switch; then
      echo "ERROR: current live tree may require manual recovery." >&2
    fi
    return 1
  fi
  if ! move_path restore-live "$RESTORE_DEPLOY_NEXT_DIR" "$LIVE_DEPLOY_DIR"; then
    echo "ERROR: failed to switch the validated LKG tree into live." >&2
    if ! restore_previous_live_after_failed_switch; then
      echo "ERROR: current live tree may require manual recovery." >&2
    fi
    return 1
  fi
  if ! rewrite_compose_tree_path "$RESTORE_COMPOSE_NEXT" "$RESTORE_COMPOSE_INSTALLING" \
      deploy.restore.next deploy; then
    echo "ERROR: failed to prepare the live LKG compose file." >&2
    if [ -e "$LIVE_DEPLOY_DIR" ] && [ -e "$RESTORE_DEPLOY_FAILED_DIR" ] \
        && ! move_path restore-partial-live "$LIVE_DEPLOY_DIR" "$RESTORE_DEPLOY_NEXT_DIR"; then
      echo "ERROR: failed to preserve the partially switched LKG tree." >&2
    fi
    if ! restore_previous_live_after_failed_switch; then
      echo "ERROR: current live tree may require manual recovery." >&2
    fi
    return 1
  fi
  if ! chmod 600 "$RESTORE_COMPOSE_INSTALLING"; then
    echo "ERROR: failed to protect the live LKG compose file." >&2
    if [ -e "$LIVE_DEPLOY_DIR" ] && [ -e "$RESTORE_DEPLOY_FAILED_DIR" ] \
        && ! move_path restore-partial-live "$LIVE_DEPLOY_DIR" "$RESTORE_DEPLOY_NEXT_DIR"; then
      echo "ERROR: failed to preserve the partially switched LKG tree." >&2
    fi
    if ! restore_previous_live_after_failed_switch; then
      echo "ERROR: current live tree may require manual recovery." >&2
    fi
    return 1
  fi
  if ! move_path restore-compose "$RESTORE_COMPOSE_INSTALLING" "$LIVE_COMPOSE"; then
    echo "ERROR: failed to install the validated LKG compose file." >&2
    if [ -e "$LIVE_DEPLOY_DIR" ] && [ -e "$RESTORE_DEPLOY_FAILED_DIR" ] \
        && ! move_path restore-partial-live "$LIVE_DEPLOY_DIR" "$RESTORE_DEPLOY_NEXT_DIR"; then
      echo "ERROR: failed to preserve the partially switched LKG tree." >&2
    fi
    if ! restore_previous_live_after_failed_switch; then
      echo "ERROR: current live tree may require manual recovery." >&2
    fi
    return 1
  fi
  if ! rm -rf -- "$RESTORE_DEPLOY_FAILED_DIR"; then
    echo "WARNING: restored LKG is live, but the retired live tree could not be removed." >&2
  fi
  if ! rm -f -- "$RESTORE_COMPOSE_FAILED"; then
    echo "WARNING: restored LKG is live, but the retired compose file could not be removed." >&2
  fi
  return 0
}

rollback_to_lkg() {
  echo "== DEPLOY FAILED: rolling back to LKG runtime =="
  if ! validate_lkg_bundle "$LKG_DEPLOY_DIR" "$LKG_COMPOSE" "$LKG_SHA" \
      "ROLLBACK ABORTED"; then
    echo "ROLLBACK ABORTED: LKG runtime is unavailable or corrupted" >&2
    echo "manual intervention required; current live tree was not destroyed" >&2
    return 1
  fi
  if ! restore_lkg_to_live; then
    echo "ROLLBACK ABORTED: LKG runtime could not be installed transactionally." >&2
    return 1
  fi
  if pull_compose "$LIVE_COMPOSE" \
      && docker compose up -d --remove-orphans postgres keycloak wotb-backend wotb-frontend; then
    if apply_observability_services && verify_grafana_from_frontend_network; then
      :
    else
      echo "OBSERVABILITY DEGRADED: observability services or Grafana frontend-network readiness failed during rollback" >&2
    fi
    if wait_healthy; then
      cp -f "$LKG_SHA" "$DEPLOYED_SHA_FILE"
      echo "== ROLLBACK OK: $(cat "$LKG_SHA") =="
      report_observability_status || true
      return 0
    fi
  fi
  echo "== ROLLBACK FAILED: LKG application health gate failed; manual intervention required ==" >&2
  dump_logs
  return 1
}

rollback_targeted_to_previous() {
  local preserved_live=false preserved_compose=false
  local snapshot_installed=false snapshot_compose_installed=false

  restore_targeted_candidate_after_failed_switch() {
    local recovery_failed=false
    if [ "$snapshot_installed" = true ] && [ -e "$LIVE_DEPLOY_DIR" ] \
        && ! move_path targeted-recover-previous-live "$LIVE_DEPLOY_DIR" "$PREV_DEPLOY_DIR"; then
      recovery_failed=true
    fi
    if [ "$snapshot_compose_installed" = true ] && [ -e "$LIVE_COMPOSE" ] \
        && ! move_path targeted-recover-previous-compose "$LIVE_COMPOSE" "$PREV_COMPOSE"; then
      recovery_failed=true
    fi
    if [ "$preserved_live" = true ] && [ -e "$TARGETED_FAILED_DEPLOY_DIR" ] \
        && ! move_path targeted-recover-candidate-live "$TARGETED_FAILED_DEPLOY_DIR" "$LIVE_DEPLOY_DIR"; then
      recovery_failed=true
    fi
    if [ "$preserved_compose" = true ] && [ -e "$TARGETED_FAILED_COMPOSE" ] \
        && ! move_path targeted-recover-candidate-compose "$TARGETED_FAILED_COMPOSE" "$LIVE_COMPOSE"; then
      recovery_failed=true
    fi
    if [ "$recovery_failed" = true ]; then
      echo "ERROR: failed to restore the candidate after a targeted rollback switch failure." >&2
      return 1
    fi
  }

  local target_label
  target_label="$(deploy_service_label)"
  echo "== TARGETED DEPLOY FAILED: restoring pre-deploy ${target_label} runtime =="
  if [ ! -d "$PREV_DEPLOY_DIR" ] || [ ! -f "$PREV_COMPOSE" ]; then
    echo "TARGETED ROLLBACK ABORTED: pre-deploy snapshot is unavailable." >&2
    return 1
  fi
  if [ -e "$TARGETED_FAILED_DEPLOY_DIR" ] || [ -e "$TARGETED_FAILED_COMPOSE" ]; then
    echo "TARGETED ROLLBACK ABORTED: stale failed-target snapshot exists; refusing to overwrite it." >&2
    return 1
  fi
  if ! docker compose -f "$PREV_COMPOSE" config >/dev/null; then
    echo "TARGETED ROLLBACK ABORTED: pre-deploy compose snapshot is invalid." >&2
    return 1
  fi

  if ! move_path targeted-preserve-candidate-live "$LIVE_DEPLOY_DIR" "$TARGETED_FAILED_DEPLOY_DIR"; then
    echo "TARGETED ROLLBACK ABORTED: failed to preserve the failed candidate tree." >&2
    return 1
  fi
  preserved_live=true
  if ! move_path targeted-preserve-candidate-compose "$LIVE_COMPOSE" "$TARGETED_FAILED_COMPOSE"; then
    echo "TARGETED ROLLBACK ABORTED: failed to preserve the failed candidate compose." >&2
    restore_targeted_candidate_after_failed_switch || true
    return 1
  fi
  preserved_compose=true
  if ! move_path targeted-restore-previous-live "$PREV_DEPLOY_DIR" "$LIVE_DEPLOY_DIR"; then
    echo "TARGETED ROLLBACK ABORTED: failed to restore the pre-deploy tree." >&2
    restore_targeted_candidate_after_failed_switch || true
    return 1
  fi
  snapshot_installed=true
  if ! move_path targeted-restore-previous-compose "$PREV_COMPOSE" "$LIVE_COMPOSE"; then
    echo "TARGETED ROLLBACK ABORTED: failed to restore the pre-deploy compose." >&2
    restore_targeted_candidate_after_failed_switch || true
    return 1
  fi
  snapshot_compose_installed=true

  if pull_compose "$LIVE_COMPOSE" "${DEPLOY_SERVICES[@]}" \
      && docker compose up -d --no-deps --force-recreate --remove-orphans "${DEPLOY_SERVICES[@]}" \
      && assert_services_running "${DEPLOY_SERVICES[@]}" \
      && wait_healthy; then
    if ! rm -rf -- "$TARGETED_FAILED_DEPLOY_DIR" "$TARGETED_FAILED_COMPOSE"; then
    echo "WARNING: targeted rollback restored a healthy ${target_label}, but failed-target forensic snapshot cleanup failed." >&2
    fi
    echo "== TARGETED ROLLBACK OK: $target_label =="
    report_observability_status || true
    return 0
  fi

  echo "TARGETED ROLLBACK FAILED: pre-deploy ${target_label} runtime could not be restored; manual intervention required." >&2
  dump_logs
  return 1
}

staged_pull_services=()
if ! is_full_deploy; then
  staged_pull_services=("${DEPLOY_SERVICES[@]}")
fi
if ! pull_compose "$STAGED_COMPOSE" "${staged_pull_services[@]}"; then
  echo "ERROR: staged docker compose pull failed after 3 attempts; live deployment was not changed." >&2
  exit 1
fi

if ! bash "$STAGED_DEPLOY_DIR/validate-alloy-config.sh" \
    "$STAGED_DEPLOY_DIR/observability/alloy/config.alloy"; then
  echo "ERROR [ALLOY]: staged Alloy config validation failed; live deployment was not changed." >&2
  exit 1
fi
prepare_runner_tools

if lkg_bundle_present; then
  if ! validate_lkg_bundle "$LKG_DEPLOY_DIR" "$LKG_COMPOSE" "$LKG_SHA" "Existing LKG"; then
    echo "ROLLBACK ABORTED: existing LKG is unavailable or corrupted; live deployment was not changed." >&2
    exit 1
  fi
else
  if seed_current_lkg; then
    echo "== Current application-healthy deployment promoted as LKG =="
  else
    echo "ERROR: No application-validated LKG exists." >&2
    echo "Current deployment cannot be promoted to LKG." >&2
    echo "NO_VALIDATED_LKG: live deployment was not changed." >&2
    exit 1
  fi
fi

rollback_needed=false
# Same-filesystem moves make promotion preserve the previous tree for forensics.
if [ -d "$LIVE_DEPLOY_DIR" ]; then
  if [ -f "$LIVE_COMPOSE" ]; then cp -f "$LIVE_COMPOSE" "$PREV_COMPOSE"; fi
  rm -rf -- "$PREV_DEPLOY_DIR"
  mv -- "$LIVE_DEPLOY_DIR" "$PREV_DEPLOY_DIR"
  echo "Previous deployment tree saved (PREV_SHA=${PREV_SHA:-unknown})."
fi
mv -- "$STAGED_DEPLOY_DIR" "$LIVE_DEPLOY_DIR"
cp -f "$LIVE_DEPLOY_DIR/docker-compose.prod.yml" docker-compose.next.yml
PROMOTED_COMPOSE_ARGS=(-f docker-compose.next.yml)
if [ -f "$STAGED_SERVICE_OVERRIDE" ]; then
  PROMOTED_COMPOSE_ARGS+=(-f "$STAGED_SERVICE_OVERRIDE")
fi
if ! docker compose "${PROMOTED_COMPOSE_ARGS[@]}" config > docker-compose.next.resolved.yml; then
  echo "ERROR: promoted compose render failed; attempting rollback." >&2
  rollback_needed=true
else
  mv -f docker-compose.next.resolved.yml docker-compose.yml
  chmod 600 docker-compose.yml
fi

if [ "$rollback_needed" = false ]; then
  if ! deploy_selected_service; then
    echo "ERROR: docker compose up failed; attempting rollback." >&2
    rollback_needed=true
  else
    if is_full_deploy; then
      if apply_observability_services && verify_grafana_from_frontend_network; then
        :
      else
        echo "OBSERVABILITY DEGRADED: Grafana is not ready through runtime Docker DNS" >&2
      fi
    elif has_deploy_service grafana; then
      if verify_grafana_from_frontend_network; then
        :
      else
        echo "OBSERVABILITY DEGRADED: Grafana is not ready through runtime Docker DNS" >&2
      fi
    elif has_deploy_service prometheus || has_deploy_service loki \
        || has_deploy_service alloy || has_deploy_service node-exporter; then
      :
    fi
    if [ "$rollback_needed" = false ]; then
      if is_full_deploy; then
        docker compose exec -T postgres psql -U wotb -d wotb -c "CREATE DATABASE keycloak;" 2>/dev/null || true
      fi
    fi
    if [ "$rollback_needed" = false ] && wait_healthy; then
      if ! is_full_deploy; then
        deployment_id="${RELEASE_SHA_VALUE:-$TAG}"
        if ! update_deployed_state "$deployment_id"; then
          echo "ERROR: per-service deployed state update failed; attempting rollback." >&2
          rollback_needed=true
        else
          echo "== TARGETED DEPLOY OK: $(deploy_service_label) =="
          report_observability_status || true
          exit 0
        fi
      elif ! stage_lkg_snapshot "$LIVE_DEPLOY_DIR" "$LIVE_COMPOSE" "${RELEASE_SHA_VALUE:-$TAG}"; then
        echo "ERROR: LKG staging failed after the application health gate; attempting rollback." >&2
        rollback_needed=true
      elif promote_lkg_candidate; then
        deployment_id="${RELEASE_SHA_VALUE:-$TAG}"
        if ! update_deployed_state "$deployment_id"; then
          echo "ERROR: per-service deployed state update failed; attempting rollback." >&2
          rollback_needed=true
        else
          docker image prune -af
          docker builder prune -af
          echo "== DEPLOY OK: $TAG =="
          report_observability_status || true
          exit 0
        fi
      else
        echo "ERROR: LKG promotion failed after the application health gate; attempting rollback." >&2
        rollback_needed=true
      fi
    else
      echo "== APPLICATION GATE FAILED =="
      dump_logs
      rollback_needed=true
    fi
  fi
fi

if [ "$rollback_needed" = true ]; then
  if ! is_full_deploy; then
    if ! rollback_targeted_to_previous; then
      echo "TARGETED ROLLBACK FAILED: no usable pre-deploy runtime was restored." >&2
    fi
  elif lkg_bundle_present; then
    if ! rollback_to_lkg; then
      echo "ROLLBACK FAILED: no usable LKG runtime was restored." >&2
    fi
  else
    echo "ROLLBACK FAILED: no validated LKG runtime is available; manual intervention required." >&2
  fi
  exit 1
fi
