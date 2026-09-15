#!/usr/bin/env bash
# Staged selective production deployment. Failure is fail-closed and operator-led.
set -Eeuo pipefail

readonly WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
readonly INCOMING_DIR="${WOTB_INCOMING_DIR:-$WOTB_DIR/deploy.incoming}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
readonly LIVE_COMPOSE="$WOTB_DIR/docker-compose.yml"
readonly METADATA_FILE="$WOTB_DIR/production-release.json"
readonly HEALTH_ATTEMPTS="${WOTB_HEALTH_ATTEMPTS:-60}"
readonly HEALTH_INTERVAL_SEC="${WOTB_HEALTH_INTERVAL_SEC:-2}"
readonly PROBE_CONNECT_TIMEOUT_SEC="${WOTB_PROBE_CONNECT_TIMEOUT_SEC:-3}"
readonly PROBE_MAX_TIME_SEC="${WOTB_PROBE_MAX_TIME_SEC:-10}"
readonly PULL_ATTEMPTS="${WOTB_PULL_ATTEMPTS:-3}"
readonly HEALTH_PROBE_SERVICE="health-probe"
readonly DEPLOY_SERVICES_RAW="${WOTB_DEPLOY_SERVICES:-}"
readonly DEPLOY_IMAGE_SERVICES_RAW="${WOTB_DEPLOY_IMAGE_SERVICES:-}"
readonly RELEASE_SHA_VALUE="${RELEASE_SHA:-}"
readonly RELEASE_RUN_NUMBER_VALUE="${RELEASE_RUN_NUMBER:-}"
readonly TAG_VALUE="${TAG:-}"
readonly BACKEND_MIGRATION_MAX_VALUE="${WOTB_BACKEND_MIGRATION_MAX_VERSION:-}"

declare -a DEPLOY_SERVICES=()
declare -a DEPLOY_IMAGE_SERVICES=()
declare -a APPLY_SERVICES=()
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

is_non_negative_integer() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)$ ]]
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || die "$name secret is not configured."
}

is_selected() {
  local wanted="$1" service
  for service in "${DEPLOY_SERVICES[@]}"; do
    if [ "$service" = all ] || [ "$service" = "$wanted" ]; then
      return 0
    fi
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

validate_inputs() {
  is_safe_path "$WOTB_DIR" || die "unsafe WOTB_DIR."
  is_safe_path "$INCOMING_DIR" || die "unsafe WOTB_INCOMING_DIR."
  [ "$INCOMING_DIR" != "$WOTB_DIR" ] || die "incoming directory must differ from live directory."
  [[ "$TAG_VALUE" =~ ^sha-[0-9a-f]{12}$ ]] || die "TAG must be an immutable sha-<12 lowercase hex> tag."
  [[ "$RELEASE_SHA_VALUE" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA must be a full lowercase commit SHA."
  is_positive_integer "$RELEASE_RUN_NUMBER_VALUE" || die "RELEASE_RUN_NUMBER must be a positive integer."
  is_non_negative_integer "$BACKEND_MIGRATION_MAX_VALUE" || die "WOTB_BACKEND_MIGRATION_MAX_VERSION must be a non-negative integer."
  is_positive_integer "$HEALTH_ATTEMPTS" || die "WOTB_HEALTH_ATTEMPTS must be a positive integer."
  is_positive_integer "$HEALTH_INTERVAL_SEC" || die "WOTB_HEALTH_INTERVAL_SEC must be a positive integer."
  is_positive_integer "$PROBE_CONNECT_TIMEOUT_SEC" || die "WOTB_PROBE_CONNECT_TIMEOUT_SEC must be a positive integer."
  is_positive_integer "$PROBE_MAX_TIME_SEC" || die "WOTB_PROBE_MAX_TIME_SEC must be a positive integer."
  is_positive_integer "$PULL_ATTEMPTS" || die "WOTB_PULL_ATTEMPTS must be a positive integer."
  [ -n "$DEPLOY_SERVICES_RAW" ] || die "WOTB_DEPLOY_SERVICES is required."

  IFS=',' read -r -a DEPLOY_SERVICES <<< "$DEPLOY_SERVICES_RAW"
  IFS=',' read -r -a DEPLOY_IMAGE_SERVICES <<< "$DEPLOY_IMAGE_SERVICES_RAW"
  [ "${#DEPLOY_SERVICES[@]}" -gt 0 ] && [ -n "${DEPLOY_SERVICES[0]}" ] \
    || die "WOTB_DEPLOY_SERVICES must contain at least one service."
  if [ "${DEPLOY_SERVICES[0]}" = all ] && [ "${#DEPLOY_SERVICES[@]}" -ne 1 ]; then
    die "all cannot be combined with other deployment services."
  fi
  local service
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      all|postgres|node-exporter|prometheus|loki|alloy|grafana|keycloak|wotb-backend|wotb-frontend) ;;
      *) die "unsupported deployment service: $service" ;;
    esac
  done
  for service in "${DEPLOY_IMAGE_SERVICES[@]}"; do
    case "$service" in
      "") ;;
      keycloak|wotb-backend|wotb-frontend) ;;
      *) die "unsupported WOTB_DEPLOY_IMAGE_SERVICES entry: $service" ;;
    esac
  done
  for service in "${DEPLOY_IMAGE_SERVICES[@]}"; do
    [ -z "$service" ] || is_selected "$service" || die "image service is not in deploy service set: $service"
  done

  for required in TAG DB_PASSWORD KC_ADMIN_PASSWORD WG_APPLICATION_ID \
    KEYCLOAK_ADMIN_CLIENT_SECRET AI_API_KEY GRAFANA_ADMIN_USER GRAFANA_ADMIN_PASSWORD; do
    require_env "$required"
  done
  [[ "$AI_API_KEY" != *$'\n'* && "$AI_API_KEY" != *$'\r'* ]] \
    || die "AI_API_KEY contains invalid control characters."
  if [ -n "${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:-}" ] \
    && [ "$AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC" != "1100" ]; then
    die "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC must remain 1100."
  fi
}

metadata_tag() {
  local service="$1"
  [ -f "$METADATA_FILE" ] || return 0
  python3 - "$METADATA_FILE" "$service" <<'PY'
import json
import re
import sys

try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    tag = data.get("services", {}).get(sys.argv[2], {}).get("imageTag", "")
except (OSError, ValueError, TypeError):
    raise SystemExit(0)
if re.fullmatch(r"sha-[0-9a-f]{12}", tag):
    print(tag)
PY
}

validate_metadata_file() {
  [ -f "$METADATA_FILE" ] || return 0
  python3 - "$METADATA_FILE" <<'PY'
import json
import re
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
if not isinstance(data, dict) or not isinstance(data.get("services", {}), dict):
    raise SystemExit("production metadata must contain an object-valued services field")
for service, entry in data["services"].items():
    if not isinstance(entry, dict):
        raise SystemExit(f"production metadata entry is invalid: {service}")
    if "commitSha" in entry and not re.fullmatch(r"[0-9a-f]{40}", entry["commitSha"]):
        raise SystemExit(f"production metadata commitSha is invalid: {service}")
    if "imageTag" in entry and not re.fullmatch(r"sha-[0-9a-f]{12}", entry["imageTag"]):
        raise SystemExit(f"production metadata imageTag is invalid: {service}")
    if "migrationMaxVersion" in entry and (
        not isinstance(entry["migrationMaxVersion"], int) or entry["migrationMaxVersion"] < 0
    ):
        raise SystemExit(f"production metadata migration ceiling is invalid: {service}")
PY
}

compose_tag() {
  local service="$1"
  [ -f "$LIVE_COMPOSE" ] || return 0
  python3 - "$LIVE_COMPOSE" "$service" <<'PY'
import re
import sys

service = sys.argv[2]
current = ""
for line in open(sys.argv[1], encoding="utf-8"):
    match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
    if match:
        current = match.group(1)
        continue
    if current != service:
        continue
    match = re.match(r"^\s+image:\s+ghcr\.io/a158coke/wotbtools-[^:]+:(sha-[0-9a-f]{12})\s*$", line)
    if match:
        print(match.group(1))
        break
PY
}

current_or_target_tag() {
  local service="$1" tag=""
  case "$service" in
    wotb-backend) has_image_service "$service" && { printf '%s\n' "$TAG_VALUE"; return; } ;;
    wotb-frontend) has_image_service "$service" && { printf '%s\n' "$TAG_VALUE"; return; } ;;
    keycloak) has_image_service "$service" && { printf '%s\n' "$TAG_VALUE"; return; } ;;
    *) die "unsupported application service: $service" ;;
  esac
  tag="$(metadata_tag "$service")"
  [ -n "$tag" ] || tag="$(compose_tag "$service")"
  [[ "$tag" =~ ^sha-[0-9a-f]{12}$ ]] || die "current immutable image identity is unavailable for $service."
  printf '%s\n' "$tag"
}

render_effective_compose() {
  local source="$1" target="$2" backend_tag="$3" frontend_tag="$4" keycloak_tag="$5"
  BACKEND_TAG="$backend_tag" FRONTEND_TAG="$frontend_tag" KEYCLOAK_TAG="$keycloak_tag" \
    python3 - "$source" "$target" <<'PY'
import os
import re
import sys

source, target = sys.argv[1:3]
tags = {
    "wotb-backend": os.environ["BACKEND_TAG"],
    "wotb-frontend": os.environ["FRONTEND_TAG"],
    "keycloak": os.environ["KEYCLOAK_TAG"],
}
current = ""
seen = set()
output = []
for line in open(source, encoding="utf-8"):
    match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
    if match:
        current = match.group(1)
    if current in tags and re.match(r"^\s+image:\s+ghcr\.io/a158coke/wotbtools-[^:]+:", line):
        image = "ghcr.io/a158coke/wotbtools-" + current.removeprefix("wotb-")
        if current == "keycloak":
            image = "ghcr.io/a158coke/wotbtools-keycloak"
        line = f"    image: {image}:{tags[current]}\n"
        seen.add(current)
    output.append(line)
missing = set(tags) - seen
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
  mkdir -p "$WOTB_DIR/config/sponsor" "$WOTB_DIR/android-release" "$INCOMING_DIR"
  ln -sfn "$WOTB_DIR/config" "$INCOMING_DIR/config"
  ln -sfn "$WOTB_DIR/android-release" "$INCOMING_DIR/android-release"
  if [ ! -e "$WOTB_DIR/config/sponsor-config.json" ] && [ -f "$INCOMING_DIR/deploy/sponsor-config.example.json" ]; then
    install -m 644 "$INCOMING_DIR/deploy/sponsor-config.example.json" "$WOTB_DIR/config/sponsor-config.json"
  fi
  local backend_tag frontend_tag keycloak_tag
  backend_tag="$(current_or_target_tag wotb-backend)"
  frontend_tag="$(current_or_target_tag wotb-frontend)"
  keycloak_tag="$(current_or_target_tag keycloak)"
  render_effective_compose "$staged_source" "$EFFECTIVE_COMPOSE" \
    "$backend_tag" "$frontend_tag" "$keycloak_tag"
  if ! docker compose -f "$EFFECTIVE_COMPOSE" config >/dev/null; then
    die "staged compose config is invalid; live deployment was not changed."
  fi
  local observability_selected=false service
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      all|prometheus|loki|alloy|grafana|node-exporter) observability_selected=true ;;
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
  local attempt service
  [ "${#DEPLOY_IMAGE_SERVICES[@]}" -gt 0 ] || return 0
  for attempt in $(seq 1 "$PULL_ATTEMPTS"); do
    if docker compose -f "$EFFECTIVE_COMPOSE" pull "${DEPLOY_IMAGE_SERVICES[@]}"; then
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
  rm -rf -- "$next_deploy"
  rm -f -- "$next_compose"
  cp -a "$INCOMING_DIR/deploy/." "$next_deploy/"
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
  if is_selected all; then
    printf '%s\n' postgres keycloak wotb-backend wotb-frontend node-exporter prometheus loki alloy grafana
  else
    printf '%s\n' "${DEPLOY_SERVICES[@]}"
  fi
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

sanitize_probe_error() {
  local error_file="$1" sanitized
  sanitized="$(LC_ALL=C tr '\r\n' ' ' < "$error_file" | LC_ALL=C tr -cd '[:print:][:space:]' | \
    sed -E \
      -e 's/[[:space:]]+/ /g' \
      -e 's#(https?://)[^/@[:space:]]+@#\1REDACTED@#g' \
      -e 's/([Aa]uthorization:[[:space:]]*)([Bb]earer[[:space:]]+)?[^[:space:]]+/\1REDACTED/g' \
      -e 's/([Tt]oken|[Ss]ecret|[Pp]assword|[Aa][Pp][Ii][-_]?[Kk]ey)[=:][^[:space:]]*/\1=REDACTED/g')"
  sanitized="${sanitized# }"
  sanitized="${sanitized% }"
  printf '%.500s' "${sanitized:-no stderr output}"
}

probe_http() {
  local service="$1" url="$2" host_header="${3:-}" output stderr_file exit_code stderr_output
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --output /dev/null --write-out '%{http_code}')
  PROBE_LAST_SERVICE="$service"
  PROBE_LAST_URL="$url"
  PROBE_LAST_HTTP_STATUS="unavailable"
  PROBE_LAST_ERROR=""
  [ -n "$host_header" ] && args+=(--header "$host_header")
  args+=("$url")
  if ! stderr_file="$(mktemp)"; then
    PROBE_LAST_ERROR="unable to allocate probe stderr capture"
    FAILED_SERVICE="$service"
    return 1
  fi
  if output="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps "$HEALTH_PROBE_SERVICE" "${args[@]}" 2>"$stderr_file")"; then
    exit_code=0
  else
    exit_code=$?
  fi
  stderr_output="$(sanitize_probe_error "$stderr_file")"
  rm -f -- "$stderr_file"

  if [[ "$output" =~ ^[0-9]{3}$ ]]; then
    PROBE_LAST_HTTP_STATUS="$output"
  fi
  if [ "$exit_code" -ne 0 ]; then
    PROBE_LAST_ERROR="compose/curl exited with status $exit_code: $stderr_output"
    FAILED_SERVICE="$service"
    return 1
  fi
  if [ "$PROBE_LAST_HTTP_STATUS" = unavailable ]; then
    PROBE_LAST_ERROR="curl stdout did not contain exactly one three-digit HTTP status: $stderr_output"
    FAILED_SERVICE="$service"
    return 1
  fi
  if [[ "$PROBE_LAST_HTTP_STATUS" =~ ^2[0-9]{2}$ ]]; then
    return 0
  fi
  PROBE_LAST_ERROR="HTTP status $PROBE_LAST_HTTP_STATUS is not 2xx: $stderr_output"
  FAILED_SERVICE="$service"
  return 1
}

wait_for_probe() {
  local service="$1" url="$2" host_header="${3:-}" attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if probe_http "$service" "$url" "$host_header"; then
      echo "$service: PASS"
      return 0
    fi
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "$service: FAIL" >&2
  return 1
}

wait_for_database() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if docker compose -f "$LIVE_COMPOSE" exec -T postgres pg_isready -U wotb -d wotb >/dev/null 2>&1; then
      echo "postgres: PASS"
      return 0
    fi
    FAILED_SERVICE=postgres
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "postgres: FAIL" >&2
  return 1
}

blocking_health() {
  local app_selected=false
  is_selected wotb-backend || is_selected wotb-frontend || is_selected keycloak || is_selected all \
    && app_selected=true
  [ "$app_selected" = true ] || return 0
  wait_for_database || return 1
  wait_for_probe backend http://wotb-backend:8088/actuator/health || return 1
  wait_for_probe frontend http://wotb-frontend/api/health 'Host: wotbtools.com' || return 1
  wait_for_probe keycloak http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration || return 1
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
  if is_selected all; then
    printf '%s\n' node-exporter prometheus loki alloy grafana
    return 0
  fi
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      node-exporter|prometheus|loki|alloy|grafana) printf '%s\n' "$service" ;;
    esac
  done
}

verify_observability() {
  [ -f "$LIVE_DEPLOY_DIR/verify-observability.sh" ] || return 1
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
  echo "releaseTag=$TAG_VALUE"
  echo "deployServices=$DEPLOY_SERVICES_RAW"
  echo "imageServices=$DEPLOY_IMAGE_SERVICES_RAW"
  if [ -n "$PROBE_LAST_SERVICE" ]; then
    echo "probeService=$PROBE_LAST_SERVICE"
    echo "probeTargetUrl=$PROBE_LAST_URL"
    echo "probeHttpStatus=$PROBE_LAST_HTTP_STATUS"
    echo "probeError=$PROBE_LAST_ERROR"
  fi
  docker compose -f "$LIVE_COMPOSE" ps -a || true
  local -a diagnostic_services=("${APPLY_SERVICES[@]}")
  local failed_service="$FAILED_SERVICE" service already_present=false
  case "$failed_service" in
    backend) failed_service=wotb-backend ;;
    frontend) failed_service=wotb-frontend ;;
  esac
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
  local schema
  schema="$(docker compose -f "$LIVE_COMPOSE" exec -T postgres psql -U wotb -d wotb -Atqc \
    "select coalesce((select version from flyway_schema_history where success = true order by installed_rank desc limit 1), '0');" \
    2>/dev/null || true)"
  schema="$(tr -d '[:space:]' <<< "$schema")"
  echo "flywaySchemaVersion=${schema:-unavailable}"
}

stop_failed_service() {
  local service="$FAILED_SERVICE"
  [ -n "$service" ] || return 0
  case "$service" in
    backend) service=wotb-backend ;;
    frontend) service=wotb-frontend ;;
    keycloak) service=keycloak ;;
  esac
  case "$service" in
    wotb-backend|wotb-frontend|keycloak) ;;
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
  local backend_schema=""
  if has_image_service wotb-backend; then
    backend_schema="$(docker compose -f "$LIVE_COMPOSE" exec -T postgres psql -U wotb -d wotb -Atqc \
      "select coalesce((select version from flyway_schema_history where success = true order by installed_rank desc limit 1), '0');")" \
      || die "metadata update cannot establish backend Flyway schema version."
    backend_schema="$(tr -d '[:space:]' <<< "$backend_schema")"
    [[ "$backend_schema" =~ ^(0|[1-9][0-9]*)$ ]] || die "metadata update received an invalid backend schema version."
  fi
  local now metadata_tmp
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  metadata_tmp="${METADATA_FILE}.next.$$"
  umask 177
  BACKEND_SCHEMA="$backend_schema" BACKEND_MIGRATION_MAX="$BACKEND_MIGRATION_MAX_VALUE" NOW="$now" \
    python3 - "$METADATA_FILE" "$metadata_tmp" \
    "$RELEASE_SHA_VALUE" "$TAG_VALUE" "$DEPLOY_IMAGE_SERVICES_RAW" <<'PY'
import json
import os
import sys

source, target, commit_sha, image_tag, services_raw = sys.argv[1:]
try:
    data = json.load(open(source, encoding="utf-8")) if os.path.exists(source) else {}
except (OSError, ValueError):
    raise SystemExit("existing production metadata is invalid")
if not isinstance(data, dict):
    raise SystemExit("existing production metadata must be an object")
services = data.get("services", {})
if not isinstance(services, dict):
    raise SystemExit("existing production metadata services must be an object")
data["schemaVersion"] = 1
data["services"] = services
for service in filter(None, services_raw.split(",")):
    entry = services.get(service, {})
    if not isinstance(entry, dict):
        raise SystemExit(f"metadata entry is not an object: {service}")
    entry.update({"commitSha": commit_sha, "imageTag": image_tag, "deployedAt": os.environ["NOW"]})
    if service == "wotb-backend":
        entry["schemaVersion"] = int(os.environ["BACKEND_SCHEMA"])
        entry["migrationMaxVersion"] = int(os.environ["BACKEND_MIGRATION_MAX"])
    services[service] = entry
data["deploymentConfigSha"] = commit_sha
data["updatedAt"] = os.environ["NOW"]
with open(target, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
  chmod 600 "$metadata_tmp"
  mv -f -- "$metadata_tmp" "$METADATA_FILE"
}

main() {
  validate_inputs
  mkdir -p "$WOTB_DIR" "$INCOMING_DIR"
  command -v docker >/dev/null 2>&1 || die "docker is required."
  command -v flock >/dev/null 2>&1 || die "flock is required to serialize production deployments."
  command -v python3 >/dev/null 2>&1 || die "python3 is required for release metadata and compose identity handling."
  validate_metadata_file || die "production metadata is invalid; refusing deployment."
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
  if ! blocking_health; then
    diagnostics
    stop_failed_service
    echo "ERROR: blocking core health failed; no automatic application recovery was attempted." >&2
    exit 1
  fi
  run_observability_checks
  update_metadata
  rm -f -- "$INCOMING_DIR/docker-compose.effective.yml"
  echo "Deployment completed: $RELEASE_SHA_VALUE ($TAG_VALUE)"
}

main "$@"
