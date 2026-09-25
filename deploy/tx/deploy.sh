#!/usr/bin/env bash
# TX runtime deployment. A single selected service is reconciled per invocation.
set -Eeuo pipefail

readonly WOTB_DIR="${WOTB_TX_DIR:-/opt/wotb-tx}"
readonly INCOMING_DIR="${WOTB_TX_INCOMING_DIR:-$WOTB_DIR/deploy.incoming/deploy/tx}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
readonly LIVE_COMPOSE="$LIVE_DEPLOY_DIR/docker-compose.yml"
readonly METADATA_FILE="$WOTB_DIR/production-release.json"
readonly METADATA_TOOL="$(dirname "$INCOMING_DIR")/release-metadata.py"
readonly TX_RUNTIME_ROOT="${TX_RUNTIME_ROOT:-$WOTB_DIR}"
readonly TOFU_PROVISION_MARKER="${WOTB_TX_TOFU_PROVISION_MARKER:-$WOTB_DIR/keycloak.tofu-provisioned}"
readonly RABBITMQ_TOFU_PROVISION_MARKER="${WOTB_TX_RABBITMQ_TOFU_PROVISION_MARKER:-$WOTB_DIR/rabbitmq.tofu-provisioned}"
readonly BUSINESS_POSTGRES_TOFU_PROVISION_MARKER="${WOTB_TX_BUSINESS_POSTGRES_TOFU_PROVISION_MARKER:-$WOTB_DIR/business-postgres.tofu-provisioned}"
readonly BOOTSTRAP_KEYCLOAK="${WOTB_TX_BOOTSTRAP_KEYCLOAK:-0}"
readonly DEFER_RELEASE_METADATA="${WOTB_DEPLOY_DEFER_METADATA:-0}"
readonly BACKEND_UPSTREAM_VALUE="${TX_BACKEND_UPSTREAM:-http://business-api:8087}"
readonly DEPLOY_SERVICE_VALUE="${WOTB_DEPLOY_SERVICE:-}"
readonly CONFIG_SHA_VALUE="${WOTB_DEPLOY_CONFIG_SHA:-}"
readonly IMAGE_TAG_VALUE="${WOTB_DEPLOY_IMAGE_TAG:-}"
readonly IMAGE_COMMIT_SHA_VALUE="${WOTB_DEPLOY_IMAGE_COMMIT_SHA:-}"
readonly IMAGE_DIGEST_VALUE="${WOTB_DEPLOY_IMAGE_DIGEST:-}"
readonly TX_IMAGE_REGISTRY_PREFIX_VALUE="${TX_IMAGE_REGISTRY_PREFIX:-ccr.ccs.tencentyun.com/wotbtools}"
readonly HEALTH_ATTEMPTS="${WOTB_HEALTH_ATTEMPTS:-60}"
readonly HEALTH_INTERVAL_SEC="${WOTB_HEALTH_INTERVAL_SEC:-2}"
readonly PROBE_CONNECT_TIMEOUT_SEC="${WOTB_PROBE_CONNECT_TIMEOUT_SEC:-3}"
readonly PROBE_MAX_TIME_SEC="${WOTB_PROBE_MAX_TIME_SEC:-10}"

declare -a DEPLOY_SERVICES=()
declare -a DEPLOY_IMAGE_SERVICES=()
declare -a APPLY_SERVICES=()
DEPLOY_SERVICES_RAW=""
FAILED_SERVICE=""
CADDY_RELOAD_ONLY=false
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

# One credential group is required only when a service in that group is
# selected. Keeping the groups explicit is what keeps RabbitMQ-only,
# Keycloak-only, and business-postgres-only deployments isolated from each
# other's secrets.
is_keycloak_postgres_group_selected() {
  is_selected keycloak-postgres || is_selected keycloak
}

is_keycloak_runtime_selected() {
  is_selected keycloak
}

is_rabbitmq_group_selected() {
  is_selected rabbitmq
}

is_business_postgres_group_selected() {
  is_selected business-postgres
}

# The TX business runtime owns the application database role, the distributed
# replay control plane, and AI Review, so it is the only group that requires the
# application credentials, the MinIO control-plane identity, and the AI key. A
# RabbitMQ-only or database-only deployment must never depend on them.
is_business_api_group_selected() {
  is_selected business-api
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
  [[ "$CONFIG_SHA_VALUE" =~ ^[0-9a-f]{40}$ ]] || die "WOTB_DEPLOY_CONFIG_SHA must be a full lowercase commit SHA."
  [[ "$TX_IMAGE_REGISTRY_PREFIX_VALUE" =~ ^([a-z0-9][a-z0-9-]*\.)+tencentyun\.com/[a-z0-9][a-z0-9._-]*$ ]] \
    || die "TX_IMAGE_REGISTRY_PREFIX must be a Tencent TCR registry and namespace."
  [ "$BACKEND_UPSTREAM_VALUE" = "http://business-api:8087" ] \
    || die "TX_BACKEND_UPSTREAM must be the TX-internal business runtime http://business-api:8087; public hosts and the retired Yecao WireGuard backend are no longer routable."
  is_positive_integer "$HEALTH_ATTEMPTS" || die "WOTB_HEALTH_ATTEMPTS must be a positive integer."
  is_positive_integer "$HEALTH_INTERVAL_SEC" || die "WOTB_HEALTH_INTERVAL_SEC must be a positive integer."
  is_positive_integer "$PROBE_CONNECT_TIMEOUT_SEC" || die "WOTB_PROBE_CONNECT_TIMEOUT_SEC must be a positive integer."
  is_positive_integer "$PROBE_MAX_TIME_SEC" || die "WOTB_PROBE_MAX_TIME_SEC must be a positive integer."
  case "$DEPLOY_SERVICE_VALUE" in
    frontend) DEPLOY_SERVICES=(wotb-frontend) ;;
    keycloak-postgres|business-postgres|rabbitmq|keycloak|business-api|caddy)
      DEPLOY_SERVICES=("$DEPLOY_SERVICE_VALUE") ;;
    *) die "unsupported TX deployment service: $DEPLOY_SERVICE_VALUE" ;;
  esac
  DEPLOY_SERVICES_RAW="${DEPLOY_SERVICES[0]}"
  if [ -n "$IMAGE_TAG_VALUE" ] || [ -n "$IMAGE_COMMIT_SHA_VALUE" ] || [ -n "$IMAGE_DIGEST_VALUE" ]; then
    [ -n "$IMAGE_TAG_VALUE" ] && [ -n "$IMAGE_COMMIT_SHA_VALUE" ] && [ -n "$IMAGE_DIGEST_VALUE" ] \
      || die "image tag, source SHA, and registry digest must be supplied together."
    [[ "$IMAGE_DIGEST_VALUE" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || die "WOTB_DEPLOY_IMAGE_DIGEST must be a sha256 digest."
    is_image_service "$DEPLOY_SERVICES_RAW" || die "fixed upstream service cannot receive image identity."
    DEPLOY_IMAGE_SERVICES=("$DEPLOY_SERVICES_RAW")
  else
    DEPLOY_IMAGE_SERVICES=()
  fi
  local service
  for service in "${DEPLOY_SERVICES[@]}"; do
    case "$service" in
      keycloak-postgres|business-postgres|rabbitmq|keycloak|wotb-frontend|business-api|caddy) ;;
      *) die "unsupported TX deployment service: $service" ;;
    esac
  done
  case "$BOOTSTRAP_KEYCLOAK" in
    0|1) ;;
    *) die "WOTB_TX_BOOTSTRAP_KEYCLOAK must be 0 or 1." ;;
  esac
  case "$DEFER_RELEASE_METADATA" in
    0|1) ;;
    *) die "WOTB_DEPLOY_DEFER_METADATA must be 0 or 1." ;;
  esac
  if [ "$DEFER_RELEASE_METADATA" = 1 ] && ! is_selected keycloak; then
    die "WOTB_DEPLOY_DEFER_METADATA=1 is supported only for the Keycloak runtime/Tofu chain."
  fi
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
  if is_keycloak_postgres_group_selected; then
    for required in KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD; do
      require_env "$required"
    done
  fi
  if is_keycloak_runtime_selected; then
    for required in KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD WG_APPLICATION_ID; do
      require_env "$required"
    done
  fi
  if is_selected caddy; then
    require_env CADDY_ACME_EMAIL
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
  case "$service" in wotb-frontend) service=frontend ;; esac
  python3 "$METADATA_TOOL" get --host tx --file "$METADATA_FILE" \
    --tx-prefix "$TX_IMAGE_REGISTRY_PREFIX_VALUE" --service "$service" --field tag
}

effective_image_ref() {
  local service="$1"
  if has_image_service "$service"; then
    printf '%s@%s\n' "$IMAGE_TAG_VALUE" "$IMAGE_DIGEST_VALUE"
  else
    metadata_tag "$service"
  fi
}
# Render the promoted Compose document from the staged tree, pinning the immutable
# identity resolved for every application image service (see effective_image_ref).
render_effective_compose() {
  local source="$1" target="$2" frontend_image="$3" keycloak_image="$4" business_api_image="$5"
  FRONTEND_IMAGE="$frontend_image" KEYCLOAK_IMAGE="$keycloak_image" \
    BUSINESS_API_IMAGE="$business_api_image" \
    python3 - "$source" "$target" <<'PY'
import os
import re
import sys

source, target = sys.argv[1:3]
# service -> immutable image reference resolved for this deployment. An empty value
# means the service has never been deployed on this host, so its incoming declaration
# is kept verbatim; a resolved value is pinned.
images = {
    "wotb-frontend": os.environ["FRONTEND_IMAGE"],
    "keycloak": os.environ["KEYCLOAK_IMAGE"],
    "business-api": os.environ["BUSINESS_API_IMAGE"],
}
current = ""
seen = set()
output = []
for line in open(source, encoding="utf-8"):
    match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
    if match:
        current = match.group(1)
    if current in images and re.match(r"^\s+image:\s+", line):
        image = images[current]
        seen.add(current)
        if image:
            line = f"    image: {image}\n"
    output.append(line)
missing = set(images) - seen
if missing:
    raise SystemExit("compose is missing application image definitions: " + ", ".join(sorted(missing)))
with open(target, "w", encoding="utf-8") as handle:
    handle.writelines(output)
PY
  chmod 600 "$target"
}

caddy_runtime_fingerprint() {
  local compose_file="$1" section
  awk '
    /^  caddy:[[:space:]]*$/ { capture=1 }
    capture && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ && $0 !~ /^  caddy:/ { exit }
    capture { print }
  ' "$compose_file"
  for section in volumes networks configs secrets x-logging; do
    printf '\n# top-level %s\n' "$section"
    awk -v section="$section" '
      $0 ~ ("^" section ":[[:space:]]*") { capture=1; print; next }
      capture && /^[^[:space:]#][^:]*:([[:space:]]|$)/ { exit }
      capture { print }
    ' "$compose_file"
  done
}

caddy_runtime_can_reload_in_place() {
  local candidate="$1" current="$2" container_id status active_email
  [ -f "$current" ] || return 1
  [ -f "$LIVE_DEPLOY_DIR/Caddyfile" ] || return 1
  [ -f "$LIVE_DEPLOY_DIR/assets/auth/.well-known/assetlinks.json" ] || return 1
  cmp -s <(caddy_runtime_fingerprint "$candidate") <(caddy_runtime_fingerprint "$current") || return 1
  container_id="$(docker compose -f "$current" ps -q caddy)" || return 1
  [ -n "$container_id" ] || return 1
  status="$(docker inspect --format '{{.State.Status}}' "$container_id")" || return 1
  [ "$status" = running ] || return 1
  active_email="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" |
    sed -n 's/^CADDY_ACME_EMAIL=//p' | head -n 1)" || return 1
  [ "$active_email" = "$CADDY_ACME_EMAIL" ]
}

stage_and_validate() {
  local source="$INCOMING_DIR/docker-compose.yml"
  readonly EFFECTIVE_COMPOSE="$INCOMING_DIR/docker-compose.effective.yml"
  [ -f "$source" ] || die "staged TX deployment tree is missing docker-compose.yml."
  [ -f "$INCOMING_DIR/Caddyfile" ] || die "staged TX deployment tree is missing Caddyfile."
  [ -f "$INCOMING_DIR/nginx/frontend.conf.template" ] || die "staged TX deployment tree is missing frontend nginx template."
  if is_selected caddy; then
    [ -f "$INCOMING_DIR/assets/auth/.well-known/assetlinks.json" ] \
      || die "staged TX deployment tree is missing Caddy's assetlinks file."
  fi
  if is_selected wotb-frontend; then
    # Sponsor assets and Android releases are optional runtime content. The
    # sponsor config itself is a file bind mount: if Docker ever created the
    # source path as a directory, fail before Compose can silently serve 404.
    mkdir -p "$TX_RUNTIME_ROOT/config/sponsor" "$TX_RUNTIME_ROOT/android-release"
    if [ -e "$TX_RUNTIME_ROOT/config/sponsor-config.json" ] \
       && [ ! -f "$TX_RUNTIME_ROOT/config/sponsor-config.json" ]; then
      die "TX sponsor config must be a regular file: $TX_RUNTIME_ROOT/config/sponsor-config.json"
    fi
  fi
  # The runtime E2E check mounts this directory into the health-probe container;
  # its content (the staged replay fixtures) is optional and staged separately.
  mkdir -p "$TX_RUNTIME_ROOT/e2e"
  set_nonselected_compose_placeholders
  local frontend_image keycloak_image business_api_image
  frontend_image="$(effective_image_ref wotb-frontend)"
  keycloak_image="$(effective_image_ref keycloak)"
  business_api_image="$(effective_image_ref business-api)"
  render_effective_compose "$source" "$EFFECTIVE_COMPOSE" \
    "$frontend_image" "$keycloak_image" "$business_api_image"
  export TX_RUNTIME_ROOT
  export TX_BACKEND_UPSTREAM="$BACKEND_UPSTREAM_VALUE"
  assert_routing_boundary "$EFFECTIVE_COMPOSE"
  docker compose -f "$EFFECTIVE_COMPOSE" config >/dev/null \
    || die "staged TX compose config is invalid; live TX deployment was not changed."
  if is_selected caddy; then
    docker compose -f "$EFFECTIVE_COMPOSE" run --rm --no-deps caddy \
      validate --config /etc/caddy/Caddyfile --adapter caddyfile \
      || die "staged Caddy configuration is invalid; the live gateway was not changed."
    if caddy_runtime_can_reload_in_place "$source" "$LIVE_COMPOSE"; then
      CADDY_RELOAD_ONLY=true
    fi
  fi
}

# Fail closed on the two production invariants this routing boundary establishes:
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
  if is_selected business-api; then
    # PostgreSQL 是唯一 replay job authority：执行模式与后端选择器两个已退役开关都不得出现。
    ! grep -Fq 'WOTB_REPLAY_EXECUTION_MODE' "$compose_file" \
      || die "the retired replay execution-mode switch must not appear in production."
    ! grep -Fq 'WOTB_REPLAY_PROCESSING_JOB_REPOSITORY' "$compose_file" \
      || die "the retired replay job-repository switch must not appear in production."
  fi
}

pull_images() {
  if is_selected caddy && [ "$CADDY_RELOAD_ONLY" = true ]; then
    echo "Caddy Compose runtime is unchanged; skipping image pull for config reload."
    return 0
  fi
  docker compose -f "$EFFECTIVE_COMPOSE" pull "$DEPLOY_SERVICES_RAW"
}
promote_files() {
  if is_selected caddy && [ "$CADDY_RELOAD_ONLY" = true ]; then
    [ -f "$INCOMING_DIR/Caddyfile" ] || die "staged TX Caddyfile is missing."
    [ -f "$INCOMING_DIR/assets/auth/.well-known/assetlinks.json" ] \
      || die "staged TX assetlinks file is missing."
    [ -f "$METADATA_TOOL" ] || die "staged release metadata validator is missing."
    mkdir -p "$LIVE_DEPLOY_DIR/assets/auth/.well-known" || return 1
    cp -f "$INCOMING_DIR/deploy.sh" "$LIVE_DEPLOY_DIR/deploy.sh" || return 1
    cp -f "$METADATA_TOOL" "$LIVE_DEPLOY_DIR/release-metadata.py" || return 1
    cat "$INCOMING_DIR/Caddyfile" > "$LIVE_DEPLOY_DIR/Caddyfile" || return 1
    cat "$INCOMING_DIR/assets/auth/.well-known/assetlinks.json" \
      > "$LIVE_DEPLOY_DIR/assets/auth/.well-known/assetlinks.json" || return 1
    return 0
  fi
  local next_deploy="$WOTB_DIR/deploy.next.$$" old_deploy="$WOTB_DIR/deploy.old.$$"
  rm -rf -- "$next_deploy" || return 1
  mkdir -p "$next_deploy" || return 1
  if [ -d "$LIVE_DEPLOY_DIR" ]; then
    cp -a "$LIVE_DEPLOY_DIR/." "$next_deploy/" || return 1
  fi
  [ -f "$INCOMING_DIR/deploy.sh" ] || die "staged TX deployment script is missing."
  [ -f "$INCOMING_DIR/docker-compose.yml" ] || die "staged TX compose file is missing."
  cp -f "$INCOMING_DIR/deploy.sh" "$next_deploy/deploy.sh" || return 1
  cp -f "$METADATA_TOOL" "$next_deploy/release-metadata.py" || return 1
  cp -f "$EFFECTIVE_COMPOSE" "$next_deploy/docker-compose.yml" || return 1
  chmod 600 "$next_deploy/docker-compose.yml" || return 1
  case "$DEPLOY_SERVICES_RAW" in
    wotb-frontend)
      mkdir -p "$next_deploy/nginx" || return 1
      cp -a "$INCOMING_DIR/nginx/." "$next_deploy/nginx/" || return 1
      ;;
    caddy)
      cp -f "$INCOMING_DIR/Caddyfile" "$next_deploy/Caddyfile" || return 1
      mkdir -p "$next_deploy/assets/auth/.well-known" || return 1
      cp -f "$INCOMING_DIR/assets/auth/.well-known/assetlinks.json" \
        "$next_deploy/assets/auth/.well-known/assetlinks.json" || return 1
      ;;
    keycloak)
      cp -f "$INCOMING_DIR/keycloak-tofu.sh" "$next_deploy/keycloak-tofu.sh" || return 1
      ;;
    rabbitmq)
      cp -f "$INCOMING_DIR/rabbitmq.tofurc" "$next_deploy/rabbitmq.tofurc" || return 1
      ;;
    business-postgres)
      cp -f "$INCOMING_DIR/business-postgres.tofurc" "$next_deploy/business-postgres.tofurc" || return 1
      ;;
  esac
  if [ -e "$LIVE_DEPLOY_DIR" ]; then
    mv -- "$LIVE_DEPLOY_DIR" "$old_deploy" || return 1
  fi
  if ! mv -- "$next_deploy" "$LIVE_DEPLOY_DIR"; then
    [ -e "$old_deploy" ] && mv -- "$old_deploy" "$LIVE_DEPLOY_DIR"
    return 1
  fi
  rm -rf -- "$old_deploy"
}

reload_frontend_trusted_peer() {
  local output
  if ! output="$(docker compose -f "$LIVE_COMPOSE" exec -T wotb-frontend nginx -t 2>&1)"; then
    echo "ERROR: the running frontend nginx configuration is invalid; Caddy's trusted peer was not refreshed." >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
  if ! docker compose -f "$LIVE_COMPOSE" exec -T wotb-frontend nginx -s reload; then
    echo "ERROR: the running frontend container could not reload nginx to re-resolve Caddy's address." >&2
    return 1
  fi
  echo "frontend-trusted-peer: PASS (nginx re-resolved Caddy in the running container)"
}

apply_services() {
  APPLY_SERVICES=("$DEPLOY_SERVICES_RAW")
  if is_selected caddy && [ "$CADDY_RELOAD_ONLY" = true ]; then
    if ! docker compose -f "$LIVE_COMPOSE" exec -T caddy \
        caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
      FAILED_SERVICE="caddy-reload"
      return 1
    fi
    echo "caddy-config-reload: PASS"
    return 0
  fi
  if ! docker compose -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate "$DEPLOY_SERVICES_RAW"; then
    FAILED_SERVICE="$DEPLOY_SERVICES_RAW"
    return 1
  fi
  if [ "$DEPLOY_SERVICES_RAW" = caddy ]; then
    reload_frontend_trusted_peer || return 1
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
  if ! is_keycloak_postgres_group_selected; then
    : "${KC_POSTGRES_ADMIN_USER:=not-configured}"
    : "${KC_POSTGRES_ADMIN_PASSWORD:=not-configured}"
    export KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD
  fi
  if ! is_keycloak_runtime_selected; then
    : "${KC_BOOTSTRAP_ADMIN_PASSWORD:=not-configured}"
    : "${KC_DB_USERNAME:=not-configured}"
    : "${KC_DB_PASSWORD:=not-configured}"
    : "${WG_APPLICATION_ID:=not-configured}"
    export KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD WG_APPLICATION_ID
  fi
  if ! is_selected caddy; then
    : "${CADDY_ACME_EMAIL:=not-configured@example.invalid}"
    export CADDY_ACME_EMAIL
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

blocking_health() {
  if is_selected keycloak-postgres || is_selected keycloak; then
    wait_for_database || return 1
  fi
  if is_selected business-postgres; then
    wait_for_business_database || return 1
  fi
  if is_selected rabbitmq; then
    wait_for_rabbitmq || return 1
  fi
  if is_selected keycloak; then
    if [ "$BOOTSTRAP_KEYCLOAK" = 1 ]; then
      wait_for_probe keycloak http://keycloak:8080/realms/master/.well-known/openid-configuration || return 1
    else
      wait_for_probe keycloak http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration || return 1
    fi
  fi
  if is_selected business-api; then
    # The business runtime is TX-internal and publishes no port, so both the
    # application surface and the dedicated management port are proven from
    # inside wotb_tx_internal by the deployment-owned health-probe container.
    wait_for_probe tx-business-api http://business-api:8088/actuator/health || return 1
    wait_for_probe business-api-app http://business-api:8087/api/health || return 1
  fi
  if is_selected wotb-frontend; then
    docker compose -f "$LIVE_COMPOSE" exec -T wotb-frontend nginx -t >/dev/null \
      || { FAILED_SERVICE=frontend-static; echo "frontend nginx config: FAIL" >&2; return 1; }
    wait_for_probe frontend-static http://wotb-frontend/ 'Host: wotbtools.com' || return 1
  fi
  if is_selected caddy; then
    # The gateway's own process/config readiness is separate from upstream routes.
    wait_for_probe caddy-ready http://caddy/_wotb/ready || return 1
    wait_for_probe caddy-upstream-frontend http://caddy/_wotb/frontend/api/health || return 1
    wait_for_probe caddy-upstream-keycloak http://caddy/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration || return 1
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
if config.get("clientId") in (None, "", "bootstrap-not-configured", "dummy", "empty"):
    raise SystemExit(1)
if any(config.get(key) != value for key, value in expected.items()):
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
# The read-only runtime check proves the *real* business chain from inside
# wotb_tx_internal: Keycloak token -> business runtime -> PostgreSQL job
# authority -> MinIO dataset -> RabbitMQ -> Yecao parser worker -> MinIO
# artifacts -> dataset consumers. It stays read-only with respect to
# infrastructure and user data; the only writes are one transient processing job
# and one transient export job, both owned by the check machine identity and
# swept by the existing 30-minute TTL. No paid AI provider call is made.

E2E_CLIENT_ID="${KEYCLOAK_E2E_CLIENT_ID:-wotbtools-e2e}"
E2E_CLIENT_SECRET="${KEYCLOAK_E2E_CLIENT_SECRET:-}"
E2E_REPLAY_PATH="${WOTB_E2E_REPLAY_PATH:-/e2e/random-battle-example.wotbreplay}"
E2E_JOB_TIMEOUT_SEC="${WOTB_E2E_JOB_TIMEOUT_SEC:-300}"
E2E_POLL_INTERVAL_SEC="${WOTB_E2E_POLL_INTERVAL_SEC:-5}"
E2E_PUBLIC_IP="${WOTB_E2E_PUBLIC_IP:-118.25.18.105}"
# The public hosts and the URLs the edge check must prove.
E2E_WEB_URL="${WOTB_E2E_WEB_URL:-https://wotbtools.com/api/health}"
E2E_AUTH_URL="${WOTB_E2E_AUTH_URL:-https://auth.wotbtools.com/realms/wotbtools/.well-known/openid-configuration}"
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
  # --- HoF replay originals are readable for a real migrated record ----------
  local hof_id=""
  [ "$hof_status" = 200 ] && hof_id="$(e2e_first_id "$hof_body")"
  if [ -n "$hof_id" ] && e2e_download "http://business-api:8087/api/hof/$hof_id/replay" \
    && [ "$E2E_HTTP_STATUS" = 200 ] && [ "$E2E_DOWNLOAD_SIZE" -gt 0 ]; then
    e2e_emit hof-replay-storage 1
  else
    e2e_emit hof-replay-storage 0 "no readable HoF replay original for id=${hof_id:-none} (HTTP $E2E_HTTP_STATUS, ${E2E_DOWNLOAD_SIZE}B); check the replay_data volume"
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

# Public edge check: each public name must be served by the TX address over a
# locally trusted certificate with 2xx. TLS verification is never disabled and
# `curl -k` is never used, so an untrusted chain is a hard failure.
edge_tls_probe() {
  local host="$1" url="$2" raw exit_code=0
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --output /dev/null --write-out '%{http_code} %{remote_ip}' \
    --resolve "$host:443:$E2E_PUBLIC_IP" "$url")
  EDGE_EXIT=0
  EDGE_STATUS="000"
  EDGE_REMOTE_IP=""
  EDGE_ERROR=""
  # `if ! cmd` would make `$?` the status of the negation (always 0), so the real
  # exit code is captured in the else branch, where `$?` is the command's status.
  # The command inside an `if` condition stays exempt from errexit.
  if raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    exit_code=0
  else
    exit_code=$?
  fi
  EDGE_EXIT="$exit_code"
  if [ "$exit_code" -ne 0 ]; then
    EDGE_ERROR="$(tr '\r\n' ' ' <<< "$raw" | sed -E 's/[[:space:]]+/ /g')"
    return 1
  fi
  EDGE_STATUS="${raw%% *}"
  EDGE_REMOTE_IP="${raw##* }"
  return 0
}

# Edge token: the public name must be served by the TX address over a locally
# trusted certificate with 2xx. Verification is never disabled.
edge_tls_token() {
  local token="$1" host="$2" url="$3"
  if ! edge_tls_probe "$host" "$url"; then
    if [ "${EDGE_EXIT:-0}" = 60 ]; then
      e2e_emit "$token" 0 "the certificate for $host is not trusted (curl exit 60): Caddy has no valid public certificate"
    else
      e2e_emit "$token" 0 "curl failed for $host (exit $EDGE_EXIT: $EDGE_ERROR)"
    fi
    return 1
  fi
  if [ "$EDGE_REMOTE_IP" != "$E2E_PUBLIC_IP" ]; then
    e2e_emit "$token" 0 "$host was served by $EDGE_REMOTE_IP instead of the TX address $E2E_PUBLIC_IP"
    return 1
  fi
  if [[ "$EDGE_STATUS" =~ ^2[0-9]{2}$ ]]; then
    e2e_emit "$token" 1
    return 0
  fi
  e2e_emit "$token" 0 "$host served HTTP $EDGE_STATUS over trusted HTTPS (expected 2xx)"
  return 1
}

public_tls_check() {
  local failures=0
  edge_tls_token public-tls-web wotbtools.com "$E2E_WEB_URL" || failures=1
  edge_tls_token public-tls-auth auth.wotbtools.com "$E2E_AUTH_URL" || failures=1
  [ "$failures" -eq 0 ]
}

tx_runtime_check() {
  local source_root="${WOTB_SOURCE_ROOT:-}" compose_json health business_container
  local failures=0 provider
  DEPLOY_SERVICES=(keycloak-postgres business-postgres rabbitmq keycloak wotb-frontend business-api caddy)

  command -v docker >/dev/null 2>&1 || { echo "docker: FAIL (docker is required)" >&2; return 1; }
  command -v python3 >/dev/null 2>&1 || { echo "python3: FAIL (python3 is required)" >&2; return 1; }
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
assert "WOTB_REPLAY_EXECUTION_MODE" not in environment, "the retired replay execution-mode switch must not be set"
assert "WOTB_REPLAY_PROCESSING_JOB_REPOSITORY" not in environment, "the retired replay job-repository switch must not be set"
' <<< "$compose_json"; then
    echo "distributed-execution-plane: PASS"
  else
    echo "distributed-execution-plane: FAIL (business-api must not carry the retired replay execution-mode / job-repository switches)" >&2
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

  # Business PostgreSQL is authoritative business state, so TX_RUNTIME_READY
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

  if [ -n "$source_root" ] && [ -f "$source_root/infra/tofu/keycloak/realm.tf" ]; then
    echo "realm-client-source-of-truth: PASS (Keycloak OpenTofu root present)"
  fi
  # The TX deploy helper owns no DNS or Yecao retirement command; that boundary
  # is enforced statically by the TX runtime contract tests.

  # Real business chain: token -> control plane -> worker -> dataset consumers.
  # These tokens are the reason TX_RUNTIME_READY means "business works", not
  # "containers are up".
  business_e2e_check || failures=1
  # Public edge: both public hosts must be served by TX over trusted TLS with 2xx.
  public_tls_check || failures=1

  [ "$failures" -eq 0 ] && echo "QQ_IDP_STATUS=idp-qq=READY"
  if [ "$failures" -ne 0 ]; then
    echo "TX_RUNTIME_NOT_READY" >&2
    return 1
  fi
  echo "TX_RUNTIME_READY"
}

diagnostics() {
  echo "== TX DEPLOY DIAGNOSTICS =="
  echo "configSha=$CONFIG_SHA_VALUE"
  echo "image=$IMAGE_TAG_VALUE"
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
    caddy|caddy-*)
      echo "Caddy deployment or verification failed; keeping the gateway process available for diagnosis." >&2
      return 0
      ;;
  esac
  case "$service" in
    tx-business-api|business-api-app) service=business-api ;;
    frontend-static) service=wotb-frontend ;;
    caddy-ready) service=caddy ;;
  esac
  if ! is_selected "$service"; then
    echo "Not stopping unaffected TX health dependency: ${service:-unknown}" >&2
    return 0
  fi
  case "$service" in
    keycloak|wotb-frontend|business-api|caddy)
      echo "Stopping failed affected TX service: $service"
      docker compose -f "$LIVE_COMPOSE" stop "$service" || true
      ;;
    *) echo "Not stopping TX dependency after a failed health check: ${service:-unknown}" >&2 ;;
  esac
}

update_metadata() {
  is_image_service "$DEPLOY_SERVICES_RAW" || return 0
  local service="$DEPLOY_SERVICES_RAW"
  [ "$service" = wotb-frontend ] && service=frontend
  local -a args=(update --host tx --file "$METADATA_FILE" \
    --tx-prefix "$TX_IMAGE_REGISTRY_PREFIX_VALUE" --service "$service" \
    --config-sha "$CONFIG_SHA_VALUE")
  if [ -n "$IMAGE_TAG_VALUE" ]; then
    args+=(--image-tag "$IMAGE_TAG_VALUE" --image-commit-sha "$IMAGE_COMMIT_SHA_VALUE")
  fi
  python3 "$METADATA_TOOL" "${args[@]}"
}

acquire_deploy_lock() {
  command -v flock >/dev/null 2>&1 || die "flock is required to serialize TX deployments."
  if [ -n "${WOTB_DEPLOY_LOCK_FD:-}" ]; then
    [ "$WOTB_DEPLOY_LOCK_FD" = 9 ] || die "unsupported inherited TX deployment lock descriptor."
    { true >&9; } 2>/dev/null || die "inherited TX deployment lock descriptor is unavailable."
    flock -n 9 || die "another TX deployment is already running."
  else
    exec 9>"$WOTB_DIR/.deploy.lock"
    flock -n 9 || die "another TX deployment is already running."
  fi
}

apply_and_check() {
  apply_services || return 1
  blocking_health || return 1
}
main() {
  validate_inputs
  preflight_host
  command -v python3 >/dev/null 2>&1 || die "python3 is required for immutable image handling."
  [ -f "$METADATA_TOOL" ] || die "staged release metadata validator is missing."
  local -a metadata_args=(validate --host tx --file "$METADATA_FILE" --tx-prefix "$TX_IMAGE_REGISTRY_PREFIX_VALUE")
  if [ -n "$IMAGE_TAG_VALUE" ]; then
    local metadata_service="$DEPLOY_SERVICES_RAW"
    [ "$metadata_service" = wotb-frontend ] && metadata_service=frontend
    metadata_args+=(--service "$metadata_service" --image-tag "$IMAGE_TAG_VALUE" --image-commit-sha "$IMAGE_COMMIT_SHA_VALUE")
  fi
  python3 "$METADATA_TOOL" "${metadata_args[@]}" || die "production metadata or incoming image identity is invalid."
  require_tofu_provisioning
  mkdir -p "$WOTB_DIR" "$INCOMING_DIR"
  acquire_deploy_lock
  stage_and_validate
  pull_images || die "TX image pull failed; live TX deployment was not changed."
  promote_files || die "TX live-file promotion failed; prior TX files were restored when possible."
  if ! apply_and_check; then
    diagnostics
    stop_failed_service
    die "TX blocking health failed; no automatic recovery, DNS action, or Yecao action was attempted."
  fi
  if [ "$DEFER_RELEASE_METADATA" = 0 ]; then
    update_metadata
  else
    echo "TX release metadata update deferred until the Keycloak realm chain is verified."
  fi
  rm -f -- "$INCOMING_DIR/docker-compose.effective.yml"
  echo "TX deployment completed: config=$CONFIG_SHA_VALUE service=$DEPLOY_SERVICES_RAW image=$IMAGE_TAG_VALUE"
}

if [ "${TX_DEPLOY_LIBRARY_ONLY:-0}" != 1 ]; then
  main "$@"
fi
