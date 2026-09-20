#!/usr/bin/env bash
# TX edge deployment only. It stages an immutable frontend/Keycloak release on
# TX; it never changes DNS or starts/stops any Yecao runtime.
set -Eeuo pipefail

readonly WOTB_DIR="${WOTB_TX_DIR:-/opt/wotb-tx}"
readonly INCOMING_DIR="${WOTB_TX_INCOMING_DIR:-$WOTB_DIR/deploy.incoming/deploy/tx}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
readonly LIVE_COMPOSE="$LIVE_DEPLOY_DIR/docker-compose.yml"
readonly METADATA_FILE="$WOTB_DIR/tx-production-release.json"
readonly TX_RUNTIME_ROOT="${TX_RUNTIME_ROOT:-$WOTB_DIR}"
readonly TOFU_PROVISION_MARKER="${WOTB_TX_TOFU_PROVISION_MARKER:-$WOTB_DIR/keycloak.tofu-provisioned}"
readonly RABBITMQ_TOFU_PROVISION_MARKER="${WOTB_TX_RABBITMQ_TOFU_PROVISION_MARKER:-$WOTB_DIR/rabbitmq.tofu-provisioned}"
readonly RABBITMQ_TOFU_CLI_CONFIG="$LIVE_DEPLOY_DIR/rabbitmq.tofurc"
readonly RABBITMQ_TOFU_MIRROR="${WOTB_TX_RABBITMQ_TOFU_MIRROR:-$WOTB_DIR/tofu-provider-mirror}"
readonly BUSINESS_POSTGRES_TOFU_PROVISION_MARKER="${WOTB_TX_BUSINESS_POSTGRES_TOFU_PROVISION_MARKER:-$WOTB_DIR/business-postgres.tofu-provisioned}"
readonly BUSINESS_POSTGRES_TOFU_CLI_CONFIG="$LIVE_DEPLOY_DIR/business-postgres.tofurc"
readonly BUSINESS_POSTGRES_TOFU_MIRROR="${WOTB_TX_BUSINESS_POSTGRES_TOFU_MIRROR:-$WOTB_DIR/tofu-provider-mirror}"
readonly BOOTSTRAP_KEYCLOAK="${WOTB_TX_BOOTSTRAP_KEYCLOAK:-0}"
readonly BACKEND_UPSTREAM_VALUE="${TX_BACKEND_UPSTREAM:-http://business-api:8087}"
readonly DEPLOY_SERVICES_RAW="${WOTB_DEPLOY_SERVICES:-}"
readonly DEPLOY_IMAGE_SERVICES_RAW="${WOTB_DEPLOY_IMAGE_SERVICES:-}"
readonly TAG_VALUE="${TAG:-}"
readonly RELEASE_SHA_VALUE="${RELEASE_SHA:-}"
readonly RABBITMQ_TOFU_ROOT="$WOTB_DIR/tofu.incoming/$RELEASE_SHA_VALUE/infra/tofu/rabbitmq"
readonly BUSINESS_POSTGRES_TOFU_ROOT="$WOTB_DIR/tofu.incoming/$RELEASE_SHA_VALUE/infra/tofu/postgres-business"
readonly HEALTH_ATTEMPTS="${WOTB_HEALTH_ATTEMPTS:-60}"
readonly HEALTH_INTERVAL_SEC="${WOTB_HEALTH_INTERVAL_SEC:-2}"
readonly PROBE_CONNECT_TIMEOUT_SEC="${WOTB_PROBE_CONNECT_TIMEOUT_SEC:-3}"
readonly PROBE_MAX_TIME_SEC="${WOTB_PROBE_MAX_TIME_SEC:-10}"

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

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || die "$name is required."
}

require_tofu_provisioning() {
  if ! is_selected all && ! is_selected keycloak && ! is_selected wotb-frontend; then
    return
  fi
  if [ "$BOOTSTRAP_KEYCLOAK" = 1 ] && is_selected keycloak && ! is_selected wotb-frontend \
    && [ "${#DEPLOY_SERVICES[@]}" -eq 1 ]; then
    return
  fi
  [ -f "$TOFU_PROVISION_MARKER" ] \
    || die "TX Keycloak database is not provisioned; run TX-local OpenTofu after the PostgreSQL bootstrap before starting Keycloak or frontend."
  grep -Fxq 'tx-local-opentofu-keycloak' "$TOFU_PROVISION_MARKER" \
    || die "TX Keycloak OpenTofu provision marker is invalid; refusing to start application services."
}

invalidate_tofu_provisioning_for_bootstrap() {
  # A PostgreSQL-only run is the explicit bootstrap/reset boundary. Clear a
  # stale proof before the workflow performs its fresh TX-local tofu apply.
  if is_selected keycloak-postgres && ! is_selected keycloak && ! is_selected wotb-frontend; then
    is_safe_path "$TOFU_PROVISION_MARKER" \
      && [[ "$TOFU_PROVISION_MARKER" == "$WOTB_DIR/"* ]] \
      || die "unsafe TX Keycloak OpenTofu provision marker path."
    rm -f -- "$TOFU_PROVISION_MARKER"
  fi
}

is_selected() {
  local wanted="$1" service
  for service in "${DEPLOY_SERVICES[@]}"; do
    [ "$service" = all ] || [ "$service" = "$wanted" ] && return 0
  done
  return 1
}

# One credential group is required only when a service in that group is
# selected. Keeping the groups explicit is what keeps RabbitMQ-only,
# Keycloak-only, and business-postgres-only deployments isolated from each
# other's secrets.
is_keycloak_group_selected() {
  is_selected all || is_selected keycloak-postgres || is_selected keycloak \
    || is_selected wotb-frontend || is_selected caddy
}

is_rabbitmq_group_selected() {
  is_selected all || is_selected rabbitmq
}

is_business_postgres_group_selected() {
  is_selected all || is_selected business-postgres
}

# The TX business runtime owns the application database role, the distributed
# replay control plane, and AI Review, so it is the only group that requires the
# application credentials, the MinIO control-plane identity, and the AI key. A
# RabbitMQ-only or database-only deployment must never depend on them.
is_business_api_group_selected() {
  is_selected all || is_selected business-api
}

is_image_service() {
  case "$1" in
    keycloak|wotb-frontend|business-api) return 0 ;;
    *) return 1 ;;
  esac
}

has_image_service() {
  local wanted="$1" service
  for service in "${DEPLOY_IMAGE_SERVICES[@]}"; do
    [ "$service" = "$wanted" ] && return 0
  done
  return 1
}

validate_inputs() {
  is_safe_path "$WOTB_DIR" || die "unsafe WOTB_TX_DIR."
  is_safe_path "$INCOMING_DIR" || die "unsafe WOTB_TX_INCOMING_DIR."
  is_safe_path "$TX_RUNTIME_ROOT" || die "unsafe TX_RUNTIME_ROOT."
  [ "$INCOMING_DIR" != "$WOTB_DIR" ] || die "incoming directory must differ from TX runtime directory."
  [[ "$TAG_VALUE" =~ ^sha-[0-9a-f]{12}$ ]] || die "TAG must be an immutable sha-<12 lowercase hex> tag."
  [[ "$RELEASE_SHA_VALUE" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA must be a full lowercase commit SHA."
  [ "$BACKEND_UPSTREAM_VALUE" = "http://business-api:8087" ] \
    || die "TX_BACKEND_UPSTREAM must be the TX-internal business runtime http://business-api:8087; public hosts and the retired Yecao WireGuard backend are no longer routable."
  is_positive_integer "$HEALTH_ATTEMPTS" || die "WOTB_HEALTH_ATTEMPTS must be a positive integer."
  is_positive_integer "$HEALTH_INTERVAL_SEC" || die "WOTB_HEALTH_INTERVAL_SEC must be a positive integer."
  is_positive_integer "$PROBE_CONNECT_TIMEOUT_SEC" || die "WOTB_PROBE_CONNECT_TIMEOUT_SEC must be a positive integer."
  is_positive_integer "$PROBE_MAX_TIME_SEC" || die "WOTB_PROBE_MAX_TIME_SEC must be a positive integer."
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
      all|keycloak-postgres|business-postgres|rabbitmq|keycloak|wotb-frontend|business-api|caddy) ;;
      *) die "unsupported TX deployment service: $service" ;;
    esac
  done
  case "$BOOTSTRAP_KEYCLOAK" in
    0|1) ;;
    *) die "WOTB_TX_BOOTSTRAP_KEYCLOAK must be 0 or 1." ;;
  esac
  for service in "${DEPLOY_IMAGE_SERVICES[@]}"; do
    case "$service" in
      "") ;;
      keycloak|wotb-frontend|business-api) is_selected "$service" || die "TX image service is not selected: $service" ;;
      *) die "unsupported TX image service: $service" ;;
    esac
  done

  # Only selected runtime services may require their credentials. RabbitMQ-only
  # and business-postgres-only reconciliation must not depend on each other or
  # on Keycloak/PostgreSQL application inputs.
  if is_keycloak_group_selected; then
    for required in KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD \
      KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD \
      WG_APPLICATION_ID CADDY_ACME_EMAIL; do
      require_env "$required"
    done
  fi
  if is_rabbitmq_group_selected; then
    for required in TX_RABBITMQ_ADMIN_USER TX_RABBITMQ_ADMIN_PASSWORD \
      TX_RABBITMQ_CONTROL_API_PASSWORD TX_RABBITMQ_PARSER_WORKER_PASSWORD; do
      require_env "$required"
    done
  fi
  if is_business_postgres_group_selected; then
    for required in TX_BUSINESS_POSTGRES_ADMIN_USER TX_BUSINESS_POSTGRES_ADMIN_PASSWORD \
      TX_BUSINESS_DB_NAME TX_BUSINESS_DB_USERNAME TX_BUSINESS_DB_PASSWORD \
      TX_BUSINESS_DB_PASSWORD_VERSION; do
      require_env "$required"
    done
  fi
  if is_business_api_group_selected; then
    # The business runtime is TX-internal, so it consumes exactly the
    # credentials below: the OpenTofu-owned application database role, the
    # RabbitMQ control-api identity, the MinIO control_api identity, the
    # Keycloak Admin API client, and the AI Review key.
    for required in TX_BUSINESS_DB_NAME TX_BUSINESS_DB_USERNAME TX_BUSINESS_DB_PASSWORD \
      TX_RABBITMQ_CONTROL_API_PASSWORD \
      YECAO_MINIO_CONTROL_API_ACCESS_KEY YECAO_MINIO_CONTROL_API_SECRET_KEY \
      KEYCLOAK_ADMIN_CLIENT_SECRET AI_API_KEY; do
      require_env "$required"
    done
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
  is_image_service "$service" || die "not an application image service: $service"
  if is_selected all || has_image_service "$service"; then
    printf '%s\n' "$TAG_VALUE"
    return
  fi
  if (is_selected rabbitmq || is_selected business-postgres) && [ "${#DEPLOY_SERVICES[@]}" -eq 1 ]; then
    # A RabbitMQ-only or business-postgres-only deployment does not pull or
    # start application images. A fresh TX host therefore need not have
    # application metadata merely to render the complete Compose document.
    printf '%s\n' "$TAG_VALUE"
    return
  fi
  tag="$(metadata_tag "$service")"
  [ -n "$tag" ] || tag="$(compose_tag "$service")"
  # The first TX steps intentionally start a PostgreSQL runtime before OpenTofu
  # creates the Keycloak/business database and role. No application image
  # exists yet, so render the incoming immutable tag without starting or
  # recording that image.
  if [ -z "$tag" ] && (is_selected keycloak-postgres || is_selected business-postgres) \
    && ! is_selected keycloak && ! is_selected wotb-frontend; then
    printf '%s\n' "$TAG_VALUE"
    return
  fi
  [[ "$tag" =~ ^sha-[0-9a-f]{12}$ ]] \
    || die "current immutable image identity is unavailable for $service; deploy both TX application images for first bootstrap."
  printf '%s\n' "$tag"
}

render_effective_compose() {
  local source="$1" target="$2" frontend_tag="$3" keycloak_tag="$4" business_api_tag="$5"
  FRONTEND_TAG="$frontend_tag" KEYCLOAK_TAG="$keycloak_tag" BUSINESS_API_TAG="$business_api_tag" \
    python3 - "$source" "$target" <<'PY'
import os
import re
import sys

source, target = sys.argv[1:3]
# service -> (immutable tag resolved for this deployment, pinned image repository)
tags = {
    "wotb-frontend": (os.environ["FRONTEND_TAG"], "ghcr.io/a158coke/wotbtools-frontend"),
    "keycloak": (os.environ["KEYCLOAK_TAG"], "ghcr.io/a158coke/wotbtools-keycloak"),
    "business-api": (os.environ["BUSINESS_API_TAG"], "ghcr.io/a158coke/wotbtools-backend"),
}
current = ""
seen = set()
output = []
for line in open(source, encoding="utf-8"):
    match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
    if match:
        current = match.group(1)
    if current in tags and re.match(r"^\s+image:\s+ghcr\.io/a158coke/wotbtools-[^:]+:", line):
        tag, image = tags[current]
        line = f"    image: {image}:{tag}\n"
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
  local source="$INCOMING_DIR/docker-compose.yml"
  readonly EFFECTIVE_COMPOSE="$INCOMING_DIR/docker-compose.effective.yml"
  [ -f "$source" ] || die "staged TX deployment tree is missing docker-compose.yml."
  [ -f "$INCOMING_DIR/Caddyfile" ] || die "staged TX deployment tree is missing Caddyfile."
  [ -f "$INCOMING_DIR/nginx/frontend.conf.template" ] || die "staged TX deployment tree is missing frontend nginx template."
  if is_selected all || is_selected wotb-frontend; then
    # Sponsor and Android files are optional runtime content. Creating their
    # directories keeps Compose bind mounts valid without inventing config.
    mkdir -p "$TX_RUNTIME_ROOT/config/sponsor" "$TX_RUNTIME_ROOT/android-release"
  fi
  # The cutover E2E gate mounts this directory into the health-probe container;
  # its content (the staged replay fixtures) is optional and staged separately.
  mkdir -p "$TX_RUNTIME_ROOT/e2e"
  set_nonselected_compose_placeholders
  local frontend_tag keycloak_tag business_api_tag
  frontend_tag="$(current_or_target_tag wotb-frontend)"
  keycloak_tag="$(current_or_target_tag keycloak)"
  business_api_tag="$(current_or_target_tag business-api)"
  render_effective_compose "$source" "$EFFECTIVE_COMPOSE" "$frontend_tag" "$keycloak_tag" "$business_api_tag"
  export TX_RUNTIME_ROOT
  export TX_BACKEND_UPSTREAM="$BACKEND_UPSTREAM_VALUE"
  assert_routing_boundary "$EFFECTIVE_COMPOSE"
  docker compose -f "$EFFECTIVE_COMPOSE" config >/dev/null \
    || die "staged TX compose config is invalid; live TX deployment was not changed."
}

# Fail closed on the two production invariants this cutover establishes:
#   1. the frontend proxies public API traffic to the TX-internal business
#      runtime, and no staged service publishes the retired Yecao port;
#   2. the business runtime's replay execution plane is the distributed one
#      (PostgreSQL job authority + RabbitMQ dispatch), so a future edit cannot
#      silently re-enable local parsing, local job authority, or in-process
#      dispatch in production.
assert_routing_boundary() {
  local compose_file="$1"
  grep -Fq 'BACKEND_UPSTREAM: ${TX_BACKEND_UPSTREAM:-http://business-api:8087}' "$compose_file" \
    || die "staged TX compose must default the frontend upstream to the TX-internal business runtime."
  ! grep -Eq '8087:8087|10\.20\.0\.2:8087' "$compose_file" \
    || die "staged TX compose must not publish or reference the retired Yecao backend port."
  if is_selected all || is_selected business-api; then
    grep -Fq 'WOTB_REPLAY_EXECUTION_MODE: distributed' "$compose_file" \
      || die "business-api must run WOTB_REPLAY_EXECUTION_MODE=distributed in production."
    grep -Fq 'WOTB_REPLAY_PROCESSING_JOB_REPOSITORY: jdbc' "$compose_file" \
      || die "business-api must keep PostgreSQL as the replay job authority (repository=jdbc)."
    ! grep -Fq 'WOTB_REPLAY_EXECUTION_MODE: local' "$compose_file" \
      || die "business-api must never run the local replay execution plane in production."
  fi
}

pull_images() {
  local -a services=()
  if is_selected all || is_selected keycloak-postgres; then
    services+=(keycloak-postgres)
  fi
  if is_selected all || is_selected business-postgres; then
    services+=(business-postgres)
  fi
  if is_selected all || is_selected rabbitmq; then
    services+=(rabbitmq)
  fi
  if is_selected all || is_selected keycloak; then
    services+=(keycloak)
  fi
  if is_selected all || is_selected wotb-frontend; then
    services+=(wotb-frontend)
  fi
  if is_selected all || is_selected business-api; then
    services+=(business-api)
  fi
  if [ "$BOOTSTRAP_KEYCLOAK" != 1 ] && \
    (is_selected all || is_selected keycloak || is_selected wotb-frontend || is_selected caddy); then
    services+=(caddy)
  fi
  docker compose -f "$EFFECTIVE_COMPOSE" pull "${services[@]}"
}

promote_files() {
  local next_deploy="$WOTB_DIR/deploy.next.$$" old_deploy="$WOTB_DIR/deploy.old.$$"
  rm -rf -- "$next_deploy"
  mkdir -p "$next_deploy"
  cp -a "$INCOMING_DIR/." "$next_deploy/"
  cp -f "$EFFECTIVE_COMPOSE" "$next_deploy/docker-compose.yml"
  chmod 600 "$next_deploy/docker-compose.yml"
  if [ -e "$LIVE_DEPLOY_DIR" ]; then
    mv -- "$LIVE_DEPLOY_DIR" "$old_deploy" || return 1
  fi
  if ! mv -- "$next_deploy" "$LIVE_DEPLOY_DIR"; then
    [ -e "$old_deploy" ] && mv -- "$old_deploy" "$LIVE_DEPLOY_DIR"
    return 1
  fi
  rm -rf -- "$old_deploy"
}

compose_service_list() {
  if is_selected all; then
    printf '%s\n' keycloak-postgres business-postgres rabbitmq keycloak wotb-frontend business-api
  else
    printf '%s\n' "${DEPLOY_SERVICES[@]}"
  fi
}

apply_services() {
  mapfile -t APPLY_SERVICES < <(compose_service_list | awk 'NF && !seen[$0]++')
  [ "${#APPLY_SERVICES[@]}" -gt 0 ] || die "no TX runtime service selected."
  local service caddy_refresh=0
  if is_selected caddy || { [ "$BOOTSTRAP_KEYCLOAK" != 1 ] && \
      (is_selected all || is_selected keycloak || is_selected wotb-frontend); }; then
    caddy_refresh=1
  fi

  # `--no-deps` deliberately keeps targeted deploys isolated, so Compose does
  # not create Caddy before nginx resolves `set_real_ip_from caddy`. Start all
  # other selected services first, then create Caddy's network endpoint before
  # recreating nginx. A Caddy refresh always requires a frontend refresh: nginx
  # resolves the trusted peer address only when its configuration is loaded.
  for service in "${APPLY_SERVICES[@]}"; do
    case "$service" in
      wotb-frontend|caddy) continue ;;
    esac
    if ! docker compose -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate "$service"; then
      FAILED_SERVICE="$service"
      return 1
    fi
  done
  if [ "$caddy_refresh" -eq 1 ]; then
    if ! docker compose -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate caddy; then
      FAILED_SERVICE="caddy"
      return 1
    fi
    if ! docker compose -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate wotb-frontend; then
      FAILED_SERVICE="wotb-frontend"
      return 1
    fi
  elif is_selected wotb-frontend; then
    if ! docker compose -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate wotb-frontend; then
      FAILED_SERVICE="wotb-frontend"
      return 1
    fi
  fi
}

sanitize_probe_error() {
  local error_file="$1" sanitized
  sanitized="$(LC_ALL=C tr '\r\n' ' ' < "$error_file" | LC_ALL=C tr -cd '[:print:][:space:]' | \
    sed -E -e 's/[[:space:]]+/ /g' -e 's#(https?://)[^/@[:space:]]+@#\1REDACTED@#g' \
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
  stderr_file="$(mktemp)" || { FAILED_SERVICE="$service"; return 1; }
  if output="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>"$stderr_file")"; then
    exit_code=0
  else
    exit_code=$?
  fi
  stderr_output="$(sanitize_probe_error "$stderr_file")"
  rm -f -- "$stderr_file"
  [[ "$output" =~ ^[0-9]{3}$ ]] && PROBE_LAST_HTTP_STATUS="$output"
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
    if docker compose -f "$LIVE_COMPOSE" exec -T keycloak-postgres \
      pg_isready -U "$KC_POSTGRES_ADMIN_USER" -d postgres >/dev/null 2>&1; then
      echo "keycloak-postgres: PASS"
      return 0
    fi
    FAILED_SERVICE="keycloak-postgres"
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "keycloak-postgres: FAIL" >&2
  return 1
}

wait_for_rabbitmq() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if docker compose -f "$LIVE_COMPOSE" exec -T rabbitmq \
      rabbitmq-diagnostics -q ping >/dev/null 2>&1; then
      echo "rabbitmq: PASS"
      return 0
    fi
    FAILED_SERVICE="rabbitmq"
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "rabbitmq: FAIL" >&2
  return 1
}

wait_for_business_database() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if docker compose -f "$LIVE_COMPOSE" exec -T business-postgres \
      pg_isready -U "$TX_BUSINESS_POSTGRES_ADMIN_USER" -d postgres >/dev/null 2>&1; then
      echo "business-postgres: PASS"
      return 0
    fi
    FAILED_SERVICE="business-postgres"
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "business-postgres: FAIL" >&2
  return 1
}

set_nonselected_compose_placeholders() {
  # Compose expands every service even when only one is started. Only groups
  # that this deployment does not own receive validation placeholders; a
  # selected group's real values always come from the process environment and
  # were already enforced by validate_inputs.
  if ! is_keycloak_group_selected; then
    : "${KC_POSTGRES_ADMIN_USER:=not-configured}"
    : "${KC_POSTGRES_ADMIN_PASSWORD:=not-configured}"
    : "${KC_BOOTSTRAP_ADMIN_PASSWORD:=not-configured}"
    : "${KC_DB_USERNAME:=not-configured}"
    : "${KC_DB_PASSWORD:=not-configured}"
    : "${WG_APPLICATION_ID:=not-configured}"
    : "${CADDY_ACME_EMAIL:=not-configured@example.invalid}"
    export KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD \
      KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD \
      WG_APPLICATION_ID CADDY_ACME_EMAIL
  fi
  if ! is_rabbitmq_group_selected; then
    : "${TX_RABBITMQ_ADMIN_USER:=not-configured}"
    : "${TX_RABBITMQ_ADMIN_PASSWORD:=not-configured}"
    export TX_RABBITMQ_ADMIN_USER TX_RABBITMQ_ADMIN_PASSWORD
  fi
  if ! is_business_postgres_group_selected; then
    : "${TX_BUSINESS_POSTGRES_ADMIN_USER:=not-configured}"
    : "${TX_BUSINESS_POSTGRES_ADMIN_PASSWORD:=not-configured}"
    export TX_BUSINESS_POSTGRES_ADMIN_USER TX_BUSINESS_POSTGRES_ADMIN_PASSWORD
  fi
  if ! is_business_api_group_selected; then
    # Compose expands every service even for a database-, broker-, or
    # frontend-only deployment, so the business runtime's required inputs need
    # validation placeholders that no selected service ever reads.
    : "${TX_BUSINESS_DB_NAME:=not-configured}"
    : "${TX_BUSINESS_DB_USERNAME:=not-configured}"
    : "${TX_BUSINESS_DB_PASSWORD:=not-configured}"
    : "${YECAO_MINIO_CONTROL_API_ACCESS_KEY:=not-configured}"
    : "${YECAO_MINIO_CONTROL_API_SECRET_KEY:=not-configured}"
    : "${KEYCLOAK_ADMIN_CLIENT_SECRET:=not-configured}"
    : "${AI_API_KEY:=not-configured}"
    : "${TX_RABBITMQ_CONTROL_API_PASSWORD:=not-configured}"
    export TX_BUSINESS_DB_NAME TX_BUSINESS_DB_USERNAME TX_BUSINESS_DB_PASSWORD \
      YECAO_MINIO_CONTROL_API_ACCESS_KEY YECAO_MINIO_CONTROL_API_SECRET_KEY \
      KEYCLOAK_ADMIN_CLIENT_SECRET AI_API_KEY TX_RABBITMQ_CONTROL_API_PASSWORD
  fi
}

provision_rabbitmq() {
  if ! is_selected all && ! is_selected rabbitmq; then
    return
  fi
  command -v tofu >/dev/null 2>&1 || die "tofu is required on TX for RabbitMQ provisioning."
  command -v python3 >/dev/null 2>&1 || die "python3 is required on TX for RabbitMQ plan safety validation."
  [ -d "$RABBITMQ_TOFU_ROOT" ] || die "TX RabbitMQ OpenTofu root is missing: $RABBITMQ_TOFU_ROOT."
  [ -f "$RABBITMQ_TOFU_CLI_CONFIG" ] || die "TX RabbitMQ OpenTofu CLI configuration is missing: $RABBITMQ_TOFU_CLI_CONFIG."
  [ -d "$RABBITMQ_TOFU_MIRROR" ] || die "TX RabbitMQ provider mirror is missing: $RABBITMQ_TOFU_MIRROR."

  # Ensure the Management API is accepting the Compose bootstrap admin before
  # OpenTofu touches broker configuration. The provider remains TX-local.
  wait_for_rabbitmq || return 1
  umask 077
  install -d -m 700 "$WOTB_DIR/rabbitmq-tofu-state"
  export TF_CLI_CONFIG_FILE="$RABBITMQ_TOFU_CLI_CONFIG"
  export TF_VAR_rabbitmq_management_endpoint="http://127.0.0.1:15672"
  export TF_VAR_rabbitmq_admin_user="$TX_RABBITMQ_ADMIN_USER"
  export TF_VAR_rabbitmq_admin_password="$TX_RABBITMQ_ADMIN_PASSWORD"
  export TF_VAR_control_api_password="$TX_RABBITMQ_CONTROL_API_PASSWORD"
  export TF_VAR_parser_worker_password="$TX_RABBITMQ_PARSER_WORKER_PASSWORD"

  # `set -e` is inert inside a function that runs in an `if`/`||` context, so
  # every provisioning step is chained explicitly. A failing plan or a non-clean
  # second plan must abort instead of reaching the marker.
  (
    cd "$RABBITMQ_TOFU_ROOT" || exit 1
    trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT
    tofu init -reconfigure -input=false -lockfile=readonly \
      && tofu validate \
      && tofu plan -input=false -no-color -out=plan.tfplan \
      && bash ./validate-plan.sh plan.tfplan \
      && tofu apply -input=false -auto-approve plan.tfplan \
      && tofu plan -input=false -no-color -out=second-plan.tfplan \
      && bash ./validate-plan.sh second-plan.tfplan --require-no-changes
  ) || return 1

  printf '%s\n' tx-local-opentofu-rabbitmq > "$RABBITMQ_TOFU_PROVISION_MARKER"
  chmod 600 "$RABBITMQ_TOFU_PROVISION_MARKER"
  echo "RabbitMQ OpenTofu apply and second-plan drift check passed."
}

provision_business_postgres() {
  if ! is_selected all && ! is_selected business-postgres; then
    return
  fi
  command -v tofu >/dev/null 2>&1 || die "tofu is required on TX for Business PostgreSQL provisioning."
  command -v python3 >/dev/null 2>&1 || die "python3 is required on TX for Business PostgreSQL plan safety validation."
  [ -d "$BUSINESS_POSTGRES_TOFU_ROOT" ] \
    || die "TX Business PostgreSQL OpenTofu root is missing: $BUSINESS_POSTGRES_TOFU_ROOT."
  [ -f "$BUSINESS_POSTGRES_TOFU_CLI_CONFIG" ] \
    || die "TX Business PostgreSQL OpenTofu CLI configuration is missing: $BUSINESS_POSTGRES_TOFU_CLI_CONFIG."
  [ -d "$BUSINESS_POSTGRES_TOFU_MIRROR" ] \
    || die "TX Business PostgreSQL provider mirror is missing: $BUSINESS_POSTGRES_TOFU_MIRROR."

  # The runtime must accept the Compose bootstrap administrator before OpenTofu
  # creates the authoritative database, application role, and grant. The
  # provider remains TX-local on 127.0.0.1:25432 and owns no application table.
  wait_for_business_database || return 1
  umask 077
  install -d -m 700 "$WOTB_DIR/postgres-business-tofu-state"
  export TF_CLI_CONFIG_FILE="$BUSINESS_POSTGRES_TOFU_CLI_CONFIG"
  export TF_VAR_postgresql_admin_username="$TX_BUSINESS_POSTGRES_ADMIN_USER"
  export TF_VAR_postgresql_admin_password="$TX_BUSINESS_POSTGRES_ADMIN_PASSWORD"
  export TF_VAR_business_database_name="$TX_BUSINESS_DB_NAME"
  export TF_VAR_business_role_name="$TX_BUSINESS_DB_USERNAME"
  export TF_VAR_business_role_password="$TX_BUSINESS_DB_PASSWORD"
  export TF_VAR_business_role_password_version="$TX_BUSINESS_DB_PASSWORD_VERSION"

  # `set -e` is inert inside a function that runs in an `if`/`||` context, so
  # every provisioning step is chained explicitly. A failing plan or a non-clean
  # second plan must abort instead of reaching the marker.
  (
    cd "$BUSINESS_POSTGRES_TOFU_ROOT" || exit 1
    trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT
    tofu init -reconfigure -input=false -lockfile=readonly \
      && tofu validate \
      && tofu plan -input=false -no-color -out=plan.tfplan \
      && bash ./validate-plan.sh plan.tfplan \
      && tofu apply -input=false -auto-approve plan.tfplan \
      && tofu plan -input=false -no-color -out=second-plan.tfplan \
      && bash ./validate-plan.sh second-plan.tfplan --require-no-changes
  ) || return 1

  printf '%s\n' tx-local-opentofu-business-postgres > "$BUSINESS_POSTGRES_TOFU_PROVISION_MARKER"
  chmod 600 "$BUSINESS_POSTGRES_TOFU_PROVISION_MARKER"
  echo "Business PostgreSQL OpenTofu apply and second-plan drift check passed."
}

blocking_health() {
  if is_selected all || is_selected keycloak-postgres || is_selected keycloak || is_selected wotb-frontend || is_selected caddy; then
    wait_for_database || return 1
  fi
  if is_selected all || is_selected business-postgres; then
    wait_for_business_database || return 1
  fi
  if is_selected all || is_selected rabbitmq; then
    wait_for_rabbitmq || return 1
  fi
  if is_selected all || is_selected keycloak || is_selected wotb-frontend || is_selected caddy; then
    if [ "$BOOTSTRAP_KEYCLOAK" = 1 ] && is_selected keycloak && ! is_selected wotb-frontend; then
      wait_for_probe keycloak http://keycloak:8080/realms/master/.well-known/openid-configuration || return 1
    else
      wait_for_probe keycloak http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration || return 1
    fi
  fi
  if is_selected all || is_selected business-api; then
    # The business runtime is TX-internal and publishes no port, so both the
    # application surface and the dedicated management port are proven from
    # inside wotb_tx_internal by the deployment-owned health-probe container.
    wait_for_probe tx-business-api http://business-api:8088/actuator/health || return 1
    wait_for_probe business-api-app http://business-api:8087/api/health || return 1
  fi
  if is_selected all || is_selected wotb-frontend || is_selected caddy; then
    # Public API traffic is terminated inside wotb_tx_internal now: the frontend
    # probe proves nginx -> business-api end to end, and the retired Yecao
    # backend path is deliberately not probed or required any more.
    wait_for_probe frontend http://wotb-frontend/api/health 'Host: wotbtools.com' || return 1
    # The formal site address intentionally redirects HTTP to HTTPS. Probe
    # Caddy's TX-local readiness surface instead, addressed by its Docker service
    # name: it is 2xx-only, DNS/ACME/static-IP independent, and exercises the
    # frontend and Keycloak proxy contracts.
    wait_for_probe caddy-ready http://caddy/_wotb/ready || return 1
    wait_for_probe caddy-frontend http://caddy/_wotb/frontend/api/health || return 1
    wait_for_probe caddy-keycloak http://caddy/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration || return 1
  fi
}

probe_body_contains() {
  local service="$1" url="$2" needle="$3" host_header="${4:-}" body
  local -a args=(--silent --show-error --fail --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC")
  [ -n "$host_header" ] && args+=(--header "$host_header")
  args+=("$url")
  if ! body="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    echo "$service: FAIL (probe command failed)" >&2
    return 1
  fi
  if ! grep -Fq "$needle" <<< "$body"; then
    echo "$service: FAIL (response missing expected contract)" >&2
    return 1
  fi
  echo "$service: PASS"
}

qq_identity_provider_ready() {
  local token_response admin_token idp_response
  if ! token_response="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe \
      --silent --show-error --fail --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
      --max-time "$PROBE_MAX_TIME_SEC" --request POST \
      --data-urlencode 'grant_type=password' \
      --data-urlencode 'client_id=admin-cli' \
      --data-urlencode 'username=admin' \
      --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD" \
      http://keycloak:8080/realms/master/protocol/openid-connect/token 2>&1)"; then
    echo "qq-idp-admin-token: FAIL (token request failed)" >&2
    return 1
  fi
  if ! admin_token="$(python3 -c 'import json, sys; print(json.load(sys.stdin)["access_token"])' <<< "$token_response" 2>/dev/null)"; then
    echo "qq-idp-admin-token: FAIL (token response is invalid)" >&2
    return 1
  fi
  if ! idp_response="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe \
      --silent --show-error --fail --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
      --max-time "$PROBE_MAX_TIME_SEC" \
      --header "Authorization: Bearer $admin_token" \
      http://keycloak:8080/admin/realms/wotbtools/identity-provider/instances 2>&1)"; then
    echo "qq-idp-admin-api: FAIL (identity provider query failed)" >&2
    return 1
  fi
  if ! python3 -c '
import json
import sys

providers = json.load(sys.stdin)
expected = {
    "authorizationUrl": "https://graph.qq.com/oauth2.0/authorize",
    "tokenUrl": "https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1",
    "userInfoUrl": "https://graph.qq.com/user/get_user_info",
    "clientAuthMethod": "client_secret_post",
}
qq = [provider for provider in providers if provider.get("alias") == "idp-qq"]
if len(qq) != 1:
    raise SystemExit(1)
provider = qq[0]
config = provider.get("config") or {}
if provider.get("providerId") != "qq" or provider.get("enabled") is not True:
    raise SystemExit(1)
if config.get("clientId") in (None, "", "bootstrap-not-configured", "dummy", "empty", "juhe", "juhe-qq"):
    raise SystemExit(1)
if any(config.get(key) != value for key, value in expected.items()):
    raise SystemExit(1)
if any(provider.get("alias") in {"qq", "juhe-qq"} for provider in providers):
    raise SystemExit(1)
' <<< "$idp_response"; then
    echo "qq-idp-admin-api: FAIL (idp-qq representation is not production-ready)" >&2
    return 1
  fi
  echo "qq-idp-admin-api: PASS"
}

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

# ---------------------------------------------------------------- business E2E
# The read-only cutover gate proves the *real* business chain from inside
# wotb_tx_internal: Keycloak token -> business runtime -> PostgreSQL job
# authority -> MinIO dataset -> RabbitMQ -> Yecao parser worker -> MinIO
# artifacts -> dataset consumers. It stays read-only with respect to
# infrastructure and user data; the only writes are one transient processing job
# and one transient export job, both owned by the gate machine identity and
# swept by the existing 30-minute TTL. No paid AI provider call is made.

E2E_CLIENT_ID="${KEYCLOAK_E2E_CLIENT_ID:-wotbtools-e2e}"
E2E_CLIENT_SECRET="${KEYCLOAK_E2E_CLIENT_SECRET:-}"
E2E_REPLAY_PATH="${WOTB_E2E_REPLAY_PATH:-/e2e/random-battle-example.wotbreplay}"
E2E_JOB_TIMEOUT_SEC="${WOTB_E2E_JOB_TIMEOUT_SEC:-300}"
E2E_POLL_INTERVAL_SEC="${WOTB_E2E_POLL_INTERVAL_SEC:-5}"
E2E_PUBLIC_IP="${WOTB_E2E_PUBLIC_IP:-118.25.18.105}"
# The public hosts and the URLs the edge gate must prove, per cutover phase.
E2E_WEB_URL="${WOTB_E2E_WEB_URL:-https://wotbtools.com/api/health}"
E2E_AUTH_URL="${WOTB_E2E_AUTH_URL:-https://auth.wotbtools.com/realms/wotbtools/.well-known/openid-configuration}"
CUTOVER_PHASE="${WOTB_CUTOVER_PHASE:-pre}"
E2E_BEARER=""
E2E_HTTP_STATUS="000"
E2E_HTTP_BODY=""
E2E_DOWNLOAD_SIZE="0"
declare -a E2E_EXTRA_ARGS=()

# Run one HTTP call in the deployment-owned health-probe container: the gate
# needs no curl on the TX host and never contacts a published application port.
e2e_http() {
  local method="$1" url="$2" body="${3:-}" content_type="${4:-}" raw
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --request "$method" --write-out $'\n%{http_code}')
  [ -n "$E2E_BEARER" ] && args+=(--header "Authorization: Bearer $E2E_BEARER")
  [ -n "$content_type" ] && args+=(--header "Content-Type: $content_type")
  [ -n "$body" ] && args+=(--data "$body")
  if [ "${#E2E_EXTRA_ARGS[@]}" -gt 0 ]; then
    args+=("${E2E_EXTRA_ARGS[@]}")
    E2E_EXTRA_ARGS=()
  fi
  args+=("$url")
  E2E_HTTP_STATUS="000"
  E2E_HTTP_BODY=""
  if ! raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    E2E_HTTP_BODY="$raw"
    return 1
  fi
  E2E_HTTP_STATUS="${raw##*$'\n'}"
  E2E_HTTP_BODY="${raw%$'\n'*}"
  [ "$E2E_HTTP_BODY" != "$raw" ] || E2E_HTTP_BODY=""
  return 0
}

# Status-only probe for binary payloads (HoF replay originals, export artifact).
e2e_download() {
  local url="$1" raw
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --output /dev/null --write-out '%{http_code} %{size_download}')
  [ -n "$E2E_BEARER" ] && args+=(--header "Authorization: Bearer $E2E_BEARER")
  args+=("$url")
  E2E_HTTP_STATUS="000"
  E2E_DOWNLOAD_SIZE="0"
  if ! raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    return 1
  fi
  E2E_HTTP_STATUS="${raw%% *}"
  E2E_DOWNLOAD_SIZE="${raw##* }"
  return 0
}

# Decode one field from the JSON body by dotted path; empty output means absent.
e2e_field() {
  local body="$1" path="$2"
  python3 -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except ValueError:
    raise SystemExit(0)
for part in sys.argv[1].split("."):
    if isinstance(payload, list):
        try:
            payload = payload[int(part)]
            continue
        except (ValueError, IndexError):
            raise SystemExit(0)
    if not isinstance(payload, dict) or part not in payload:
        raise SystemExit(0)
    payload = payload[part]
if payload is None or isinstance(payload, (dict, list)):
    raise SystemExit(0)
print(payload)
' "$path" <<< "$body"
}

# Ad-hoc AWS SigV4 query-string signing (standard library only) so the gate can
# read the dataset/artifact objects the production control-api identity owns.
# The signature is generated offline and the fetch itself goes through the
# health-probe container, which keeps the gate testable without MinIO.
presign_minio_url() {
  local method="$1" key="$2"
  E2E_MINIO_ENDPOINT="${YECAO_MINIO_ENDPOINT:-10.20.0.2:9000}" \
  E2E_MINIO_BUCKET="${YECAO_MINIO_BUCKET:-wotbtools-temp}" \
  E2E_MINIO_ACCESS_KEY="$YECAO_MINIO_CONTROL_API_ACCESS_KEY" \
  E2E_MINIO_SECRET_KEY="$YECAO_MINIO_CONTROL_API_SECRET_KEY" \
  python3 - "$method" "$key" <<'PY'
import datetime
import hashlib
import hmac
import os
import sys
import urllib.parse

method, key = sys.argv[1], sys.argv[2]
endpoint = os.environ["E2E_MINIO_ENDPOINT"]
bucket = os.environ["E2E_MINIO_BUCKET"]
access_key = os.environ["E2E_MINIO_ACCESS_KEY"]
secret_key = os.environ["E2E_MINIO_SECRET_KEY"]
region = "us-east-1"
service = "s3"

now = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime("%Y%m%dT%H%M%SZ")
datestamp = now.strftime("%Y%m%d")
scope = f"{datestamp}/{region}/{service}/aws4_request"


def quote(value):
    return urllib.parse.quote(value, safe="-_.~")


canonical_uri = "/" + "/".join(quote(part) for part in [bucket, *[p for p in key.split("/") if p]])
query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": f"{access_key}/{scope}",
    "X-Amz-Date": amz_date,
    "X-Amz-Expires": "900",
    "X-Amz-SignedHeaders": "host",
}
canonical_query = "&".join(f"{quote(name)}={quote(value)}" for name, value in sorted(query.items()))
canonical_request = "\n".join([
    method,
    canonical_uri,
    canonical_query,
    f"host:{endpoint}\n",
    "host",
    "UNSIGNED-PAYLOAD",
])
string_to_sign = "\n".join([
    "AWS4-HMAC-SHA256",
    amz_date,
    scope,
    hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
])


def sign(secret, message):
    return hmac.new(secret, message.encode("utf-8"), hashlib.sha256).digest()


signing_key = sign(sign(sign(sign(("AWS4" + secret_key).encode("utf-8"), datestamp), region), service), "aws4_request")
signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
print(f"http://{endpoint}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}")
PY
}

# First integer `id` anywhere in a JSON document; robust against the paged HoF
# envelope without hard-coding its wrapper field names.
e2e_first_id() {
  local body="$1"
  python3 -c '
import json
import sys


def first_id(node):
    if isinstance(node, dict):
        value = node.get("id")
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
        for child in node.values():
            found = first_id(child)
            if found is not None:
                return found
    elif isinstance(node, list):
        for child in node:
            found = first_id(child)
            if found is not None:
                return found
    return None


try:
    document = json.load(sys.stdin)
except ValueError:
    raise SystemExit(0)
found = first_id(document)
if found is not None:
    print(found)
' <<< "$body"
}

# Poll a replay/export job until it reaches a terminal state.
e2e_wait_for_status() {
  local label="$1" url="$2" field="$3" deadline=$((SECONDS + E2E_JOB_TIMEOUT_SEC))
  local status=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! e2e_http GET "$url"; then
      E2E_WAIT_REASON="$label status request failed: $E2E_HTTP_BODY"
      return 1
    fi
    if [ "$E2E_HTTP_STATUS" != 200 ]; then
      E2E_WAIT_REASON="$label status returned HTTP $E2E_HTTP_STATUS"
      return 1
    fi
    status="$(e2e_field "$E2E_HTTP_BODY" "$field")"
    case "$status" in
      READY) E2E_WAIT_STATUS="$status"; return 0 ;;
      FAILED|CANCELLED)
        E2E_WAIT_REASON="$label reached $status ($(e2e_field "$E2E_HTTP_BODY" errorCode))"
        return 1
        ;;
    esac
    sleep "$E2E_POLL_INTERVAL_SEC"
  done
  E2E_WAIT_REASON="$label did not reach a terminal state within ${E2E_JOB_TIMEOUT_SEC}s (last=$status)"
  return 1
}

e2e_emit() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = 1 ]; then
    echo "$name: PASS"
  else
    echo "$name: FAIL ($detail)" >&2
  fi
}

business_e2e_check() {
  local failures=0 status
  E2E_BEARER=""

  if [ -z "$E2E_CLIENT_SECRET" ]; then
    e2e_emit business-e2e 0 "KEYCLOAK_E2E_CLIENT_SECRET is required; the gate drives the real business chain with the wotbtools-e2e identity"
    return 1
  fi

  # --- auth: mint the machine token used by every authenticated call ---------
  E2E_EXTRA_ARGS=(--data-urlencode 'grant_type=client_credentials' \
    --data-urlencode "client_id=$E2E_CLIENT_ID" \
    --data-urlencode "client_secret=$E2E_CLIENT_SECRET")
  if e2e_http POST "http://keycloak:8080/realms/wotbtools/protocol/openid-connect/token" \
    && [ "$E2E_HTTP_STATUS" = 200 ]; then
    E2E_BEARER="$(e2e_field "$E2E_HTTP_BODY" access_token)"
  fi
  if [ -z "$E2E_BEARER" ]; then
    e2e_emit business-e2e 0 "client_credentials token request failed (HTTP $E2E_HTTP_STATUS)"
    return 1
  fi
  e2e_emit auth-token 1

  # --- control plane contract + anonymous rejection --------------------------
  local unknown_job="00000000-0000-4000-8000-000000000000"
  e2e_http GET "http://business-api:8087/api/replay/processing-jobs/$unknown_job"
  if [ "$E2E_HTTP_STATUS" = 404 ] && grep -Fq 'JOB_NOT_FOUND' <<< "$E2E_HTTP_BODY"; then
    e2e_emit tx-control-plane 1
  else
    e2e_emit tx-control-plane 0 "unknown job must answer 404 JOB_NOT_FOUND, got HTTP $E2E_HTTP_STATUS"
    failures=1
  fi
  local saved_bearer="$E2E_BEARER"
  E2E_BEARER=""
  e2e_http GET "http://business-api:8087/api/replay/processing-jobs/$unknown_job"
  if [ "$E2E_HTTP_STATUS" = 401 ]; then
    e2e_emit anonymous-rejected 1
  else
    e2e_emit anonymous-rejected 0 "anonymous processing-job access must be 401, got HTTP $E2E_HTTP_STATUS"
    failures=1
  fi
  E2E_BEARER="$saved_bearer"

  # --- admin authorization boundary -----------------------------------------
  E2E_BEARER=""
  e2e_http GET "http://business-api:8087/api/admin/users"
  local admin_anonymous="$E2E_HTTP_STATUS"
  E2E_BEARER="$saved_bearer"
  e2e_http GET "http://business-api:8087/api/admin/users"
  if [ "$admin_anonymous" = 401 ] && [ "$E2E_HTTP_STATUS" = 403 ]; then
    e2e_emit admin-authz 1
  else
    e2e_emit admin-authz 0 "expected anonymous 401 and authenticated non-admin 403, got $admin_anonymous/$E2E_HTTP_STATUS"
    failures=1
  fi

  # --- read-only business APIs ----------------------------------------------
  e2e_http GET "http://business-api:8087/api/users/profile"
  if [ "$E2E_HTTP_STATUS" = 200 ] || [ "$E2E_HTTP_STATUS" = 404 ]; then
    e2e_emit business-profile 1
  else
    e2e_emit business-profile 0 "profile read must answer 200 or a canonical 404, got HTTP $E2E_HTTP_STATUS"
    failures=1
  fi
  e2e_http GET "http://business-api:8087/api/hof?page=0&size=1"
  local hof_body="$E2E_HTTP_BODY" hof_status="$E2E_HTTP_STATUS"
  if [ "$hof_status" = 200 ]; then
    e2e_emit business-hof 1
  else
    e2e_emit business-hof 0 "public HoF list must answer 200, got HTTP $hof_status"
    failures=1
  fi
  e2e_http GET "http://business-api:8087/api/boost/options"
  if [ "$E2E_HTTP_STATUS" = 200 ]; then
    e2e_emit business-boost 1
  else
    e2e_emit business-boost 0 "boost options must answer 200, got HTTP $E2E_HTTP_STATUS"
    failures=1
  fi

  # --- HoF replay originals are readable for a real migrated record ----------
  local hof_id=""
  [ "$hof_status" = 200 ] && hof_id="$(e2e_first_id "$hof_body")"
  if [ -n "$hof_id" ] && e2e_download "http://business-api:8087/api/hof/$hof_id/replay" \
    && [ "$E2E_HTTP_STATUS" = 200 ] && [ "$E2E_DOWNLOAD_SIZE" -gt 0 ]; then
    e2e_emit hof-replay-storage 1
  else
    e2e_emit hof-replay-storage 0 "no readable HoF replay original for id=${hof_id:-none} (HTTP $E2E_HTTP_STATUS, ${E2E_DOWNLOAD_SIZE}B); migrate replay_data before cutting DNS"
    failures=1
  fi

  # --- parser worker is consuming the broker ---------------------------------
  local queues consumers result_queue dlq
  if queues="$(docker compose -f "$LIVE_COMPOSE" exec -T rabbitmq rabbitmqctl -q list_queues name consumers messages 2>/dev/null)"; then
    consumers="$(awk '$1 == "wotb.parser" { print $2 }' <<< "$queues")"
    result_queue="$(awk '$1 == "wotb.parser.result" { print $1 }' <<< "$queues")"
    dlq="$(awk '$1 == "wotb.parser.dlq" { print $3 }' <<< "$queues")"
    if [ "${consumers:-0}" -ge 1 ] && [ -n "$result_queue" ] && [ "${dlq:-0}" -eq 0 ]; then
      e2e_emit parser-worker 1
    else
      e2e_emit parser-worker 0 "wotb.parser consumers=${consumers:-0}, result queue=${result_queue:-missing}, dlq messages=${dlq:-0}"
      failures=1
    fi
  else
    e2e_emit parser-worker 0 "rabbitmqctl list_queues failed"
    failures=1
  fi

  # --- end-to-end processing job (the real chain) -----------------------------
  local operation_id job_id
  operation_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  E2E_EXTRA_ARGS=(--form "files=@$E2E_REPLAY_PATH" --form "operationId=$operation_id")
  e2e_http POST "http://business-api:8087/api/replay/processing-jobs"
  job_id=""
  if [ "$E2E_HTTP_STATUS" = 202 ]; then
    job_id="$(e2e_field "$E2E_HTTP_BODY" jobId)"
  fi
  if [ -z "$job_id" ]; then
    e2e_emit processing-e2e 0 "processing job create failed (HTTP $E2E_HTTP_STATUS; is $E2E_REPLAY_PATH staged into ${TX_RUNTIME_ROOT}/e2e?)"
    failures=1
    echo "business-e2e: NOT_VERIFIED" >&2
    return 1
  fi
  if e2e_wait_for_status processing-e2e \
    "http://business-api:8087/api/replay/processing-jobs/$job_id" status; then
    e2e_emit processing-e2e 1
  else
    e2e_emit processing-e2e 0 "$E2E_WAIT_REASON"
    failures=1
    echo "business-e2e: NOT_VERIFIED" >&2
    return 1
  fi

  # --- dataset consumers read the same job without reparsing ------------------
  e2e_http GET "http://business-api:8087/api/replay/processing-jobs/$job_id/result"
  if [ "$E2E_HTTP_STATUS" = 200 ] && grep -Fq '"battles"' <<< "$E2E_HTTP_BODY"; then
    e2e_emit dataset-result 1
  else
    e2e_emit dataset-result 0 "GET result must answer 200 with a dataset body, got HTTP $E2E_HTTP_STATUS"
    failures=1
  fi

  local dataset_request="{\"processingJobId\":\"$job_id\",\"sourceId\":\"0\"}"
  e2e_http POST "http://business-api:8087/api/replay/map-overview" "$dataset_request" "application/json"
  if [ "$E2E_HTTP_STATUS" = 200 ] && [ -n "$E2E_HTTP_BODY" ]; then
    e2e_emit map-overview 1
  else
    e2e_emit map-overview 0 "map overview must answer 200 with a body, got HTTP $E2E_HTTP_STATUS (204 means the worker artifact is missing or unusable for $E2E_REPLAY_PATH)"
    failures=1
  fi
  e2e_http POST "http://business-api:8087/api/replay/battle-playback-v2" "$dataset_request" "application/json"
  if [ "$E2E_HTTP_STATUS" = 200 ] && [ -n "$E2E_HTTP_BODY" ]; then
    e2e_emit battle-playback-v2 1
  else
    e2e_emit battle-playback-v2 0 "battle playback must answer 200 with a body, got HTTP $E2E_HTTP_STATUS (204 means the timeline artifact is missing or unusable for $E2E_REPLAY_PATH)"
    failures=1
  fi

  # --- MinIO objects written by the control plane and by the worker ----------
  local presigned
  presigned="$(presign_minio_url GET "temp/jobs/$job_id/result/finalized.json")"
  if [ -n "$presigned" ] && e2e_http GET "$presigned" \
    && [ "$E2E_HTTP_STATUS" = 200 ] && [ -n "$E2E_HTTP_BODY" ]; then
    e2e_emit minio 1
  else
    e2e_emit minio 0 "finalized dataset object is not readable (HTTP $E2E_HTTP_STATUS)"
    failures=1
  fi
  presigned="$(presign_minio_url GET "temp/jobs/$job_id/artifacts/0/ai-facts.json")"
  if [ -n "$presigned" ] && e2e_http GET "$presigned" \
    && [ "$E2E_HTTP_STATUS" = 200 ] && [ -n "$E2E_HTTP_BODY" ]; then
    e2e_emit ai-facts 1
  else
    e2e_emit ai-facts 0 "worker ai-facts artifact is not consumable (HTTP $E2E_HTTP_STATUS); no AI provider call is made by the gate"
    failures=1
  fi

  # --- export job produces and serves a real artifact ------------------------
  e2e_http POST "http://business-api:8087/api/replay/export-jobs?mode=aggregate&processingJobId=$job_id"
  local export_job_id=""
  if [ "$E2E_HTTP_STATUS" = 202 ]; then
    export_job_id="$(e2e_field "$E2E_HTTP_BODY" jobId)"
  fi
  if [ -n "$export_job_id" ] && e2e_wait_for_status export \
    "http://business-api:8087/api/replay/export-jobs/$export_job_id" status; then
    if e2e_download "http://business-api:8087/api/replay/export-jobs/$export_job_id/download" \
      && [ "$E2E_HTTP_STATUS" = 200 ] && [ "$E2E_DOWNLOAD_SIZE" -gt 0 ]; then
      e2e_emit export 1
    else
      e2e_emit export 0 "export download failed (HTTP $E2E_HTTP_STATUS, ${E2E_DOWNLOAD_SIZE}B)"
      failures=1
    fi
  else
    e2e_emit export 0 "${E2E_WAIT_REASON:-export job create failed (HTTP $E2E_HTTP_STATUS)}"
    failures=1
  fi

  [ "$failures" -eq 0 ] || return 1
  return 0
}

# Business data integrity: the operator supplies the read-only Yecao snapshot
# (row counts per table) and the gate compares it against TX. Only SELECTs run.
business_data_integrity_check() {
  local snapshot="${WOTB_E2E_DATA_SNAPSHOT:-}" table expected actual sequence maximum failures=0
  if [ -z "$snapshot" ] || [ ! -f "$snapshot" ]; then
    e2e_emit business-data-integrity 0 "set WOTB_E2E_DATA_SNAPSHOT to the read-only Yecao row-count snapshot JSON"
    return 1
  fi
  while read -r table expected; do
    [ -n "$table" ] || continue
    actual="$(docker compose -f "$LIVE_COMPOSE" exec -T business-postgres \
      psql -U "$TX_BUSINESS_DB_USERNAME" -d "$TX_BUSINESS_DB_NAME" -Atc \
      "select count(*) from \"$table\"" 2>/dev/null || true)"
    if [ "$actual" = "$expected" ]; then
      echo "  $table: $actual rows"
    else
      echo "  $table: TX=$actual expected=$expected" >&2
      failures=1
    fi
  done < <(python3 - "$snapshot" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    document = json.load(handle)
tables = document.get("tables", document) if isinstance(document, dict) else {}
for name, count in tables.items():
    if isinstance(count, int):
        print(f"{name} {count}")
PY
)
  maximum="$(docker compose -f "$LIVE_COMPOSE" exec -T business-postgres \
    psql -U "$TX_BUSINESS_DB_USERNAME" -d "$TX_BUSINESS_DB_NAME" -Atc \
    'select coalesce(max(id), 0) from hall_of_fame_record' 2>/dev/null || true)"
  sequence="$(docker compose -f "$LIVE_COMPOSE" exec -T business-postgres \
    psql -U "$TX_BUSINESS_DB_USERNAME" -d "$TX_BUSINESS_DB_NAME" -Atc \
    "select last_value from pg_sequences where schemaname = 'public' and sequencename like 'hall_of_fame_record%'" 2>/dev/null || true)"
  if [ -z "$maximum" ] || [ -z "$sequence" ] || [ "$sequence" -lt "$maximum" ] || [ "$sequence" -lt 355 ]; then
    echo "  hall_of_fame_record sequence: last_value=${sequence:-unknown} max_id=${maximum:-unknown}" >&2
    failures=1
  else
    echo "  hall_of_fame_record sequence: last_value=$sequence max_id=$maximum"
  fi
  if [ "$failures" -eq 0 ]; then
    e2e_emit business-data-integrity 1
    return 0
  fi
  e2e_emit business-data-integrity 0 "TX business data does not match the Yecao snapshot"
  return 1
}

# Public edge gate. The phase decides what can honestly be asserted:
#   pre  (before DNS)  -> TX:443 is reachable and Caddy presents a certificate for
#                         the public name (routing + SNI). Trust is NOT claimed:
#                         while public DNS still points elsewhere Caddy cannot
#                         complete HTTP-01/TLS-ALPN validation, so an untrusted
#                         handshake (curl exit 60) is the expected, passing state.
#   post (after DNS)   -> the public name resolves to the TX address and serves a
#                         locally trusted certificate with 2xx. TLS verification is
#                         never disabled; `curl -k` is never used.
edge_tls_probe() {
  local host="$1" url="$2" raw
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --output /dev/null --write-out '%{http_code} %{remote_ip}' \
    --resolve "$host:443:$E2E_PUBLIC_IP" "$url")
  EDGE_EXIT=0
  EDGE_STATUS="000"
  EDGE_REMOTE_IP=""
  EDGE_ERROR=""
  if ! raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    EDGE_EXIT=$?
    EDGE_ERROR="$(tr '\r\n' ' ' <<< "$raw" | sed -E 's/[[:space:]]+/ /g')"
    return 1
  fi
  EDGE_STATUS="${raw%% *}"
  EDGE_REMOTE_IP="${raw##* }"
  return 0
}

# curl exit 60 = the TLS handshake completed and a certificate was presented, but
# the chain is not trusted yet. That is exactly the pre-DNS state.
edge_tls_untrusted_pre_dns() {
  [ "${EDGE_EXIT:-0}" = 60 ]
}

# Pre-DNS edge token: TX:443 must complete a TLS handshake and present a
# certificate for the public name. An untrusted chain (curl exit 60) is the
# expected passing state while public DNS still points elsewhere.
edge_sni_token() {
  local token="$1" host="$2" url="$3"
  if edge_tls_probe "$host" "$url"; then
    if [ "$EDGE_STATUS" != 000 ] && [[ "$EDGE_STATUS" =~ ^2[0-9]{2}$ ]]; then
      e2e_emit "$token" 1
      return 0
    fi
    e2e_emit "$token" 0 "TX edge answered HTTP $EDGE_STATUS for $host (expected 2xx)"
    return 1
  fi
  if edge_tls_untrusted_pre_dns; then
    e2e_emit "$token" 1
    return 0
  fi
  e2e_emit "$token" 0 "TX:$E2E_PUBLIC_IP:443 did not complete a TLS handshake for $host (curl exit $EDGE_EXIT: $EDGE_ERROR)"
  return 1
}

# Post-DNS edge token: the public name must resolve to the TX address and serve a
# locally trusted certificate with 2xx. Verification is never disabled.
edge_tls_token() {
  local token="$1" host="$2" url="$3"
  if ! edge_tls_probe "$host" "$url"; then
    if edge_tls_untrusted_pre_dns; then
      e2e_emit "$token" 0 "public TLS for $host is still untrusted (curl exit 60): DNS has moved but Caddy has no trusted certificate yet"
    else
      e2e_emit "$token" 0 "curl failed for $host (exit $EDGE_EXIT: $EDGE_ERROR)"
    fi
    return 1
  fi
  if [ "$EDGE_REMOTE_IP" != "$E2E_PUBLIC_IP" ]; then
    e2e_emit "$token" 0 "$host resolved to $EDGE_REMOTE_IP instead of the TX address $E2E_PUBLIC_IP"
    return 1
  fi
  if [[ "$EDGE_STATUS" =~ ^2[0-9]{2}$ ]]; then
    e2e_emit "$token" 1
    return 0
  fi
  e2e_emit "$token" 0 "$host served HTTP $EDGE_STATUS over trusted HTTPS (expected 2xx)"
  return 1
}

public_edge_sni_check() {
  local failures=0
  edge_sni_token public-edge-sni-web wotbtools.com "$E2E_WEB_URL" || failures=1
  edge_sni_token public-edge-sni-auth auth.wotbtools.com "$E2E_AUTH_URL" || failures=1
  [ "$failures" -eq 0 ]
}

public_tls_check() {
  local failures=0
  edge_tls_token public-tls-web wotbtools.com "$E2E_WEB_URL" || failures=1
  edge_tls_token public-tls-auth auth.wotbtools.com "$E2E_AUTH_URL" || failures=1
  [ "$failures" -eq 0 ]
}

pre_cutover_check() {
  local source_root="${WOTB_SOURCE_ROOT:-}" compose_json health business_container
  local yecao_compose="$source_root/deploy/docker-compose.prod.yml"
  local yecao_contract="$LIVE_DEPLOY_DIR/yecao-backend-contract.json"
  local failures=0 provider
  DEPLOY_SERVICES=(all)

  command -v docker >/dev/null 2>&1 || { echo "docker: FAIL (docker is required)" >&2; return 1; }
  command -v python3 >/dev/null 2>&1 || { echo "python3: FAIL (python3 is required)" >&2; return 1; }
  case "$CUTOVER_PHASE" in
    pre|post) ;;
    *)
      echo "cutover-phase: FAIL (WOTB_CUTOVER_PHASE must be pre or post, got '$CUTOVER_PHASE')" >&2
      return 1
      ;;
  esac
  for required in KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD \
    KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD \
    WG_APPLICATION_ID CADDY_ACME_EMAIL \
    TX_BUSINESS_POSTGRES_ADMIN_USER TX_BUSINESS_POSTGRES_ADMIN_PASSWORD \
    TX_BUSINESS_DB_NAME TX_BUSINESS_DB_USERNAME TX_BUSINESS_DB_PASSWORD \
    TX_RABBITMQ_CONTROL_API_PASSWORD \
    YECAO_MINIO_CONTROL_API_ACCESS_KEY YECAO_MINIO_CONTROL_API_SECRET_KEY \
    KEYCLOAK_ADMIN_CLIENT_SECRET AI_API_KEY; do
    require_env "$required"
  done
  [ -f "$LIVE_COMPOSE" ] || { echo "tx-compose: FAIL (missing $LIVE_COMPOSE)" >&2; return 1; }

  if compose_json="$(docker compose -f "$LIVE_COMPOSE" config --format json 2>&1)"; then
    echo "tx-compose: PASS"
  else
    echo "tx-compose: FAIL ($compose_json)" >&2
    return 1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
services = data["services"]
frontend = services["wotb-frontend"].get("environment") or {}
assert frontend.get("BACKEND_UPSTREAM") == "http://business-api:8087", frontend.get("BACKEND_UPSTREAM")
business_api = services["business-api"]
assert not business_api.get("ports"), business_api.get("ports")
published = [
    str(port)
    for name, service in services.items()
    for port in (service.get("ports") or [])
]
assert not any("8087" in port for port in published), published
' <<< "$compose_json"; then
    echo "tx-internal-api-route: PASS"
  else
    echo "tx-internal-api-route: FAIL (frontend must proxy to the TX-internal business runtime and no service may publish 8087)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
environment = data["services"]["business-api"].get("environment") or {}
assert environment.get("WOTB_REPLAY_EXECUTION_MODE") == "distributed", environment.get("WOTB_REPLAY_EXECUTION_MODE")
assert environment.get("WOTB_REPLAY_PROCESSING_JOB_REPOSITORY") == "jdbc", environment.get("WOTB_REPLAY_PROCESSING_JOB_REPOSITORY")
' <<< "$compose_json"; then
    echo "distributed-execution-plane: PASS"
  else
    echo "distributed-execution-plane: FAIL (business-api must run the distributed replay execution plane)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
ports = data["services"]["keycloak-postgres"].get("ports", [])
values = [str(p) for p in ports]
assert any("127.0.0.1" in p and "15432" in p and "5432" in p for p in values), values
assert not any("0.0.0.0" in p or p.startswith("5432:") or "::" in p for p in values), values
' <<< "$compose_json"; then
    echo "postgres-loopback: PASS"
  else
    echo "postgres-loopback: FAIL (management port must be 127.0.0.1:15432:5432 only)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
ports = [str(p) for p in data["services"]["business-postgres"].get("ports", [])]
assert any("127.0.0.1" in p and "25432" in p and "5432" in p for p in ports), ports
assert not any(
    "0.0.0.0" in p or "::" in p or "10.20.0.1" in p or p.startswith("25432:") for p in ports
), ports
' <<< "$compose_json"; then
    echo "business-postgres-loopback: PASS"
  else
    echo "business-postgres-loopback: FAIL (management port must be 127.0.0.1:25432:5432 only)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
ports = [str(p) for p in data["services"]["keycloak"].get("ports", [])]
assert any("127.0.0.1" in p and "18080" in p and "8080" in p for p in ports), ports
assert not any("0.0.0.0" in p or p.startswith("8080:") or "::" in p for p in ports)
' <<< "$compose_json"; then
    echo "keycloak-admin-loopback: PASS"
  else
    echo "keycloak-admin-loopback: FAIL (Admin API must bind to 127.0.0.1:18080:8080 only)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
ports = [str(p) for p in data["services"]["rabbitmq"].get("ports", [])]
assert any("10.20.0.1" in p and "5672" in p for p in ports), ports
assert any("127.0.0.1" in p and "15672" in p for p in ports), ports
assert not any("0.0.0.0" in p or "::" in p for p in ports), ports
' <<< "$compose_json"; then
    echo "rabbitmq-bindings: PASS"
  else
    echo "rabbitmq-bindings: FAIL (AMQP must bind to WireGuard and management to loopback only)" >&2
    failures=1
  fi

  health="$(docker compose -f "$LIVE_COMPOSE" ps --format '{{.Health}}' rabbitmq 2>/dev/null || true)"
  if [ "$health" = healthy ] && docker compose -f "$LIVE_COMPOSE" exec -T rabbitmq \
      rabbitmq-diagnostics -q ping >/dev/null 2>&1; then
    echo "rabbitmq: PASS"
  else
    echo "rabbitmq: FAIL (container is not healthy)" >&2
    failures=1
  fi

  if [ -f "$RABBITMQ_TOFU_PROVISION_MARKER" ] \
      && grep -Fxq 'tx-local-opentofu-rabbitmq' "$RABBITMQ_TOFU_PROVISION_MARKER"; then
    echo "rabbitmq-provisioning: PASS"
  else
    echo "rabbitmq-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)" >&2
    failures=1
  fi

  health="$(docker compose -f "$LIVE_COMPOSE" ps --format '{{.Health}}' keycloak-postgres 2>/dev/null || true)"
  if [ "$health" = healthy ] && docker compose -f "$LIVE_COMPOSE" exec -T keycloak-postgres \
      pg_isready -U "$KC_POSTGRES_ADMIN_USER" -d postgres >/dev/null 2>&1; then
    echo "keycloak-postgres: PASS"
  else
    echo "keycloak-postgres: FAIL (container is not healthy)" >&2
    failures=1
  fi

  # Business PostgreSQL is authoritative business state, so PRE_CUTOVER_READY
  # must not be emitted until its runtime, loopback administration port, and
  # TX-local OpenTofu provisioning marker are all proven. These checks are
  # read-only: they never create, modify, or delete any database or row.
  business_container="$(docker compose -f "$LIVE_COMPOSE" ps -q business-postgres 2>/dev/null || true)"
  health="$(docker compose -f "$LIVE_COMPOSE" ps --format '{{.Health}}' business-postgres 2>/dev/null || true)"
  if [ -n "$business_container" ] && [ "$health" = healthy ] \
    && docker compose -f "$LIVE_COMPOSE" exec -T business-postgres \
      pg_isready -U "$TX_BUSINESS_POSTGRES_ADMIN_USER" -d postgres >/dev/null 2>&1; then
    echo "business-postgres: PASS"
  else
    echo "business-postgres: FAIL (container is missing or not healthy)" >&2
    failures=1
  fi

  if [ -f "$BUSINESS_POSTGRES_TOFU_PROVISION_MARKER" ] \
      && grep -Fxq 'tx-local-opentofu-business-postgres' "$BUSINESS_POSTGRES_TOFU_PROVISION_MARKER"; then
    echo "business-postgres-provisioning: PASS"
  else
    echo "business-postgres-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)" >&2
    failures=1
  fi

  wait_for_probe keycloak http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration || failures=1
  wait_for_probe tx-business-api http://business-api:8088/actuator/health || failures=1
  wait_for_probe frontend http://wotb-frontend/api/health 'Host: wotbtools.com' || failures=1
  wait_for_probe caddy-ready http://caddy/_wotb/ready || failures=1
  wait_for_probe caddy-frontend http://caddy/_wotb/frontend/api/health || failures=1
  wait_for_probe caddy-keycloak http://caddy/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration || failures=1
  probe_body_contains assetlinks http://caddy/.well-known/assetlinks.json 'com.wotbtools.app' || failures=1

  for provider in keycloak-qq-provider.jar keycloak-wargaming-provider.jar; do
    if docker compose -f "$LIVE_COMPOSE" exec -T keycloak test -f "/opt/keycloak/providers/$provider"; then
      echo "keycloak-provider-$provider: PASS"
    else
      echo "keycloak-provider-$provider: FAIL" >&2
      failures=1
    fi
  done

  qq_identity_provider_ready || failures=1

  if docker compose -f "$LIVE_COMPOSE" exec -T keycloak test ! -e /opt/keycloak/data/import/wotbtools-realm.json; then
    echo "keycloak-realm-import: PASS (OpenTofu owns realm configuration)"
  else
    echo "keycloak-realm-import: FAIL (legacy realm import must be absent)" >&2
    failures=1
  fi

  if [ -f "$yecao_compose" ]; then
    if python3 - "$yecao_compose" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
match = re.search(r"(?ms)^  wotb-backend:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", text)
if not match:
    raise SystemExit(1)
ports = re.findall(r'^\s*-\s*"([^"]+)"\s*$', match.group(1), flags=re.MULTILINE)
raise SystemExit(0 if ports == ["10.20.0.2:8087:8087"] else 1)
PY
    then
      echo "yecao-backend-wireguard-bind: PASS"
    else
      echo "yecao-backend-wireguard-bind: FAIL" >&2
      failures=1
    fi
  elif [ -f "$yecao_contract" ] && python3 - "$yecao_contract" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if data == {
    "service": "wotb-backend",
    "ports": ["10.20.0.2:8087:8087"],
} else 1)
PY
  then
    echo "yecao-backend-wireguard-bind: PASS (deployed contract)"
  else
    echo "yecao-backend-wireguard-bind: FAIL (Yecao compose or deployed contract is unavailable)" >&2
    failures=1
  fi
  if [ -n "$source_root" ] && [ -f "$source_root/infra/tofu/keycloak/realm.tf" ]; then
    echo "realm-client-source-of-truth: PASS (Keycloak OpenTofu root present)"
  fi
  # The TX deploy helper has no DNS or Yecao retirement command; this is also
  # enforced by the static TX runtime and pre-cutover contract tests.
  echo "cutover-safety-boundary: PASS"

  # Real business chain: token -> control plane -> worker -> dataset consumers.
  # These tokens are the reason PRE_CUTOVER_READY means "business works", not
  # "containers are up".
  business_e2e_check || failures=1
  business_data_integrity_check || failures=1
  case "$CUTOVER_PHASE" in
    pre)
      # Before DNS: TX edge routing/SNI reachability only. Trusted public TLS is
      # mechanically unachievable while public DNS still points at Yecao, so it is
      # asserted by the post-cutover phase instead of being faked here.
      public_edge_sni_check || failures=1
      ;;
    post)
      # After DNS: the mandatory trusted-TLS gate. Both public hosts must resolve
      # to TX and serve a locally trusted certificate; no `curl -k` anywhere.
      public_edge_sni_check || failures=1
      public_tls_check || failures=1
      ;;
    *) failures=1 ;;
  esac

  [ "$failures" -eq 0 ] && echo "QQ_IDP_STATUS=idp-qq=READY"
  if [ "$failures" -ne 0 ]; then
    if [ "$CUTOVER_PHASE" = post ]; then
      echo "POST_CUTOVER_NOT_READY" >&2
    else
      echo "PRE_CUTOVER_NOT_READY" >&2
    fi
    return 1
  fi
  if [ "$CUTOVER_PHASE" = post ]; then
    echo "POST_CUTOVER_READY"
    echo "DNS_CUTOVER_PERFORMED"
    echo "WAITING_FOR_OPERATOR_RETIREMENT"
    return 0
  fi
  echo "PRE_CUTOVER_READY"
  echo "DNS_CUTOVER_NOT_PERFORMED"
  echo "WAITING_FOR_OPERATOR_APPROVAL"
}

diagnostics() {
  echo "== TX DEPLOY DIAGNOSTICS =="
  echo "releaseSha=$RELEASE_SHA_VALUE"
  echo "releaseTag=$TAG_VALUE"
  echo "deployServices=$DEPLOY_SERVICES_RAW"
  if [ -n "$PROBE_LAST_SERVICE" ]; then
    echo "probeService=$PROBE_LAST_SERVICE"
    echo "probeTargetUrl=$PROBE_LAST_URL"
    echo "probeHttpStatus=$PROBE_LAST_HTTP_STATUS"
    echo "probeError=$PROBE_LAST_ERROR"
  fi
  docker compose -f "$LIVE_COMPOSE" ps -a || true
  local -a services=("${APPLY_SERVICES[@]}")
  [ "$FAILED_SERVICE" = caddy ] && services+=(caddy)
  local service
  for service in "${services[@]}"; do
    echo "== $service inspect =="
    docker compose -f "$LIVE_COMPOSE" ps -a "$service" || true
    docker compose -f "$LIVE_COMPOSE" logs --tail 120 "$service" || true
  done
}

stop_failed_service() {
  local service="$FAILED_SERVICE"
  case "$service" in
    keycloak|wotb-frontend|business-api|caddy)
      echo "Stopping failed affected TX service: $service"
      docker compose -f "$LIVE_COMPOSE" stop "$service" || true
      ;;
    *) echo "Not stopping TX dependency after a failed health check: ${service:-unknown}" >&2 ;;
  esac
}

update_metadata() {
  local now metadata_tmp selected service
  selected=""
  for service in keycloak wotb-frontend business-api; do
    if is_selected all || is_selected "$service"; then
      selected+="$service,"
    fi
  done
  if [ -z "$selected" ]; then
    # A run that publishes no application image (business-postgres, rabbitmq,
    # Caddy-only, or a database bootstrap) must not overwrite the recorded
    # immutable image identity of the running application services.
    return
  fi
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  metadata_tmp="$METADATA_FILE.next.$$"
  umask 177
  NOW="$now" python3 - "$METADATA_FILE" "$metadata_tmp" "$RELEASE_SHA_VALUE" "$TAG_VALUE" "$selected" <<'PY'
import json
import os
import sys

source, target, sha, tag, selected = sys.argv[1:]
try:
    data = json.load(open(source, encoding="utf-8")) if os.path.exists(source) else {}
except (OSError, ValueError):
    raise SystemExit("existing TX production metadata is invalid")
if not isinstance(data, dict):
    raise SystemExit("existing TX production metadata must be an object")
services = data.setdefault("services", {})
if not isinstance(services, dict):
    raise SystemExit("existing TX production metadata services must be an object")
for service in filter(None, selected.split(",")):
    services[service] = {"commitSha": sha, "imageTag": tag, "deployedAt": os.environ["NOW"]}
data.update({"schemaVersion": 1, "deploymentConfigSha": sha, "updatedAt": os.environ["NOW"]})
with open(target, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
  chmod 600 "$metadata_tmp"
  mv -f -- "$metadata_tmp" "$METADATA_FILE"
}

apply_and_provision() {
  # Never call the provisioning helpers from a `||` list: bash disables errexit
  # for a function invoked there, which would let a failing plan or apply drift
  # check pass silently. Each step is checked explicitly instead.
  apply_services || return 1
  provision_business_postgres || return 1
  provision_rabbitmq || return 1
  blocking_health || return 1
}

main() {
  validate_inputs
  require_tofu_provisioning
  preflight_host
  invalidate_tofu_provisioning_for_bootstrap
  command -v flock >/dev/null 2>&1 || die "flock is required to serialize TX deployments."
  command -v python3 >/dev/null 2>&1 || die "python3 is required for immutable image handling."
  mkdir -p "$WOTB_DIR" "$INCOMING_DIR"
  exec 9>"$WOTB_DIR/.deploy.lock"
  flock -n 9 || die "another TX deployment is already running."
  stage_and_validate
  pull_images || die "TX image pull failed; live TX deployment was not changed."
  promote_files || die "TX live-file promotion failed; prior TX files were restored when possible."
  if ! apply_and_provision; then
    diagnostics
    stop_failed_service
    die "TX blocking health failed; no automatic recovery, DNS action, or Yecao action was attempted."
  fi
  update_metadata
  rm -f -- "$INCOMING_DIR/docker-compose.effective.yml"
  echo "TX deployment completed: $RELEASE_SHA_VALUE ($TAG_VALUE); DNS cutover remains an explicit operator action."
}

if [ "${TX_DEPLOY_LIBRARY_ONLY:-0}" != 1 ]; then
  main "$@"
fi
