#!/usr/bin/env bash
# Staged selective production deployment for the Yecao host.
#
# The Yecao runtime is the parser execution plane plus the shared observability stack. The business
# runtime (`business-api`), its PostgreSQL, Keycloak, Keycloak's PostgreSQL, and the public frontend
# live on TX and are deployed by deploy/tx/deploy.sh; they are not selectable here any more.
# Failure is fail-closed and operator-led.
set -Eeuo pipefail

readonly WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
readonly INCOMING_DIR="${WOTB_INCOMING_DIR:-$WOTB_DIR/deploy.incoming}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
readonly LIVE_COMPOSE="$WOTB_DIR/docker-compose.yml"
readonly METADATA_FILE="$WOTB_DIR/production-release.json"
readonly METADATA_TOOL="$INCOMING_DIR/deploy/release-metadata.py"
readonly HEALTH_ATTEMPTS="${WOTB_HEALTH_ATTEMPTS:-60}"
readonly HEALTH_INTERVAL_SEC="${WOTB_HEALTH_INTERVAL_SEC:-2}"
readonly PULL_ATTEMPTS="${WOTB_PULL_ATTEMPTS:-3}"
readonly DEPLOY_SERVICE_VALUE="${WOTB_DEPLOY_SERVICE:-}"
readonly CONFIG_SHA_VALUE="${WOTB_DEPLOY_CONFIG_SHA:-}"
readonly IMAGE_TAG_VALUE="${WOTB_DEPLOY_IMAGE_TAG:-}"
readonly IMAGE_COMMIT_SHA_VALUE="${WOTB_DEPLOY_IMAGE_COMMIT_SHA:-}"
readonly IMAGE_DIGEST_VALUE="${WOTB_DEPLOY_IMAGE_DIGEST:-}"
readonly RELEASE_SHA_VALUE="$CONFIG_SHA_VALUE"

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

# The Yecao parser-worker is the only execution-plane service on that host and must stay stateless:
# no database credentials, no local replay job directory, no in-process execution mode and no
# replay backend-selection switch. A future
# edit that gave it any of these would silently create a second, non-authoritative replay runtime
# (PostgreSQL is the job authority on TX and MinIO holds the datasets), so the deploy refuses to
# stage such a worker instead of starting it.
assert_parser_worker_execution_plane() {
  local compose_file="$1"
  is_selected parser-worker || return 0
  local block
  block="$(awk '/^  parser-worker:/{flag=1;next} /^  [A-Za-z0-9_-]+:/{flag=0} flag' "$compose_file")"
  [ -n "$block" ] || die "staged compose is missing the parser-worker service definition."
  local entry
  for entry in POSTGRES_HOST POSTGRES_PASSWORD SPRING_DATASOURCE \
    REPLAY_PROCESSING_JOB_DIR WOTB_REPLAY_EXECUTION_MODE WOTB_REPLAY_PROCESSING_JOB_REPOSITORY; do
    ! grep -Fq "$entry" <<< "$block" \
      || die "parser-worker must stay stateless; the staged compose must not define $entry for it."
  done
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
      node-exporter|prometheus|loki|alloy|grafana|parser-worker) ;;
      *) die "unsupported deployment service: $service" ;;
    esac
  done
  if [ -n "$IMAGE_TAG_VALUE" ] || [ -n "$IMAGE_COMMIT_SHA_VALUE" ] || [ -n "$IMAGE_DIGEST_VALUE" ]; then
    [ -n "$IMAGE_TAG_VALUE" ] && [ -n "$IMAGE_COMMIT_SHA_VALUE" ] && [ -n "$IMAGE_DIGEST_VALUE" ] \
      || die "image tag, source SHA, and registry digest must be supplied together."
    [[ "$IMAGE_DIGEST_VALUE" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || die "WOTB_DEPLOY_IMAGE_DIGEST must be a sha256 digest."
    [ "$DEPLOY_SERVICE_VALUE" = parser-worker ] || die "fixed upstream service cannot receive image identity."
  fi

  # The worker is the only Yecao service that talks to two remote planes (the TX broker and the
  # Yecao MinIO). Its credentials are required exactly when it is selected, so a
  # observability-only deploy keeps working while the worker path stays fail-closed instead of
  # starting with empty settings.
  if is_selected parser-worker; then
    for service in TX_RABBITMQ_PARSER_WORKER_PASSWORD YECAO_MINIO_WORKER_ACCESS_KEY \
      YECAO_MINIO_WORKER_SECRET_KEY; do
      require_env "$service"
    done
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

worker_image_ref() {
  if [ -n "$IMAGE_TAG_VALUE" ]; then
    printf '%s@%s\n' "$IMAGE_TAG_VALUE" "$IMAGE_DIGEST_VALUE"
  else
    python3 "$METADATA_TOOL" get --host yecao --file "$METADATA_FILE" \
      --service parser-worker --field tag
  fi
}
render_effective_compose() {
  local source="$1" target="$2" worker_image="$3"
  WORKER_IMAGE="$worker_image" \
    python3 - "$source" "$target" <<'PY'
import os
import re
import sys

source, target = sys.argv[1:3]
images = {"parser-worker": os.environ["WORKER_IMAGE"]}
current = ""
seen = set()
output = []
for line in open(source, encoding="utf-8"):
    match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
    if match:
        current = match.group(1)
    if current in images and re.match(r"^\s+image:\s+", line):
        line = f"    image: {images[current]}\n"
        seen.add(current)
    output.append(line)
missing = set(images) - seen
if missing:
    raise SystemExit("compose is missing application image definitions: " + ", ".join(sorted(missing)))
with open(target, "w", encoding="utf-8") as handle:
    handle.writelines(output)
PY
  chmod 600 "$target"
}

stage_and_validate() {
  local staged_source="$INCOMING_DIR/deploy/docker-compose.prod.yml"
  readonly EFFECTIVE_COMPOSE="$INCOMING_DIR/docker-compose.effective.yml"
  [ -f "$staged_source" ] || die "staged deployment tree is missing docker-compose.prod.yml."
  mkdir -p "$INCOMING_DIR"
  local worker_image
  worker_image="$(worker_image_ref)" || die "parser-worker metadata identity is unavailable."
  render_effective_compose "$staged_source" "$EFFECTIVE_COMPOSE" "$worker_image"
  assert_parser_worker_execution_plane "$EFFECTIVE_COMPOSE"
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
  local common_file worker_file observability_file observability_selected=false service
  rm -rf -- "$next_deploy"
  rm -f -- "$next_compose"
  mkdir -p "$next_deploy" || return 1
  if [ -d "$LIVE_DEPLOY_DIR" ]; then
    cp -a "$LIVE_DEPLOY_DIR/." "$next_deploy/" || return 1
  fi
  for common_file in deploy.sh release-metadata.py; do
    [ -f "$INCOMING_DIR/deploy/$common_file" ] || die "staged deployment tree is missing $common_file."
    cp -f "$INCOMING_DIR/deploy/$common_file" "$next_deploy/$common_file" || return 1
  done
  if is_selected parser-worker; then
    for worker_file in dependency-readiness.sh dependency-readiness.py; do
      [ -f "$INCOMING_DIR/deploy/$worker_file" ] || die "staged deployment tree is missing $worker_file."
      cp -f "$INCOMING_DIR/deploy/$worker_file" "$next_deploy/$worker_file" || return 1
    done
  fi
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

worker_health() {
  is_selected parser-worker || return 0
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if docker compose -f "$LIVE_COMPOSE" ps -a parser-worker | grep -Eq 'Up|running'; then
      echo "parser-worker: PASS"
      return 0
    fi
    FAILED_SERVICE=parser-worker
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "parser-worker: FAIL" >&2
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
  echo "releaseSha=$RELEASE_SHA_VALUE"
  echo "releaseImage=$IMAGE_TAG_VALUE"
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
    parser-worker) ;;
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

update_metadata() {
  is_selected parser-worker || return 0
  local -a args=(update --host yecao --file "$METADATA_FILE" \
    --service parser-worker --config-sha "$CONFIG_SHA_VALUE")
  if [ -n "$IMAGE_TAG_VALUE" ]; then
    args+=(--image-tag "$IMAGE_TAG_VALUE" --image-commit-sha "$IMAGE_COMMIT_SHA_VALUE")
  fi
  python3 "$METADATA_TOOL" "${args[@]}"
}
main() {
  validate_inputs
  mkdir -p "$WOTB_DIR" "$INCOMING_DIR"
  command -v docker >/dev/null 2>&1 || die "docker is required."
  command -v flock >/dev/null 2>&1 || die "flock is required to serialize production deployments."
  command -v python3 >/dev/null 2>&1 || die "python3 is required for release metadata and compose identity handling."
  [ -f "$METADATA_TOOL" ] || die "staged release metadata validator is missing."
  local -a metadata_args=(validate --host yecao --file "$METADATA_FILE")
  if [ -n "$IMAGE_TAG_VALUE" ]; then
    metadata_args+=(--service parser-worker --image-tag "$IMAGE_TAG_VALUE" --image-commit-sha "$IMAGE_COMMIT_SHA_VALUE")
  fi
  python3 "$METADATA_TOOL" "${metadata_args[@]}" || die "production metadata or incoming image identity is invalid."
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
  # The worker exposes no HTTP endpoint, so its gate is the container staying up: a crash loop from
  # a missing credential or an unreachable broker must fail the deployment, not pass silently.
  if ! worker_health; then
    diagnostics
    stop_failed_service
    echo "ERROR: parser-worker did not stay running; no automatic application recovery was attempted." >&2
    exit 1
  fi
  run_observability_checks
  update_metadata
  rm -f -- "$INCOMING_DIR/docker-compose.effective.yml"
  echo "Deployment completed: config=$CONFIG_SHA_VALUE service=$DEPLOY_SERVICES_RAW image=$IMAGE_TAG_VALUE"
}

main "$@"
