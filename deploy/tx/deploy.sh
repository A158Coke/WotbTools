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
  [ -f "$INCOMING_DIR/business-postgres.compose.yml" ] \
    || die "staged TX deployment tree is missing business-postgres.compose.yml."
  [ -f "$INCOMING_DIR/keycloak-postgres.compose.yml" ] \
    || die "staged TX deployment tree is missing keycloak-postgres.compose.yml."
  [ -f "$INCOMING_DIR/runtime-check.sh" ] || die "staged TX deployment tree is missing runtime-check.sh."
  [ -f "$INCOMING_DIR/runtime-check-lib.sh" ] || die "staged TX deployment tree is missing runtime-check-lib.sh."
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

assert_stateful_volume_identity() {
  local service="$DEPLOY_SERVICES_RAW" fragment volume_key volume_name container_id mounted_volume volume_project
  case "$service" in
    business-postgres)
      fragment="$INCOMING_DIR/business-postgres.compose.yml"
      volume_key=business_postgres_data
      volume_name=deploy_business_postgres_data
      ;;
    keycloak-postgres)
      fragment="$INCOMING_DIR/keycloak-postgres.compose.yml"
      volume_key=keycloak_postgres_data
      volume_name=deploy_keycloak_postgres_data
      ;;
    *) return 0 ;;
  esac

  if ! docker compose -p deploy -f "$fragment" config --format json | python3 -c '
import json
import sys

service, volume_key, volume_name = sys.argv[1:]
data = json.load(sys.stdin)
valid = (
    data.get("name") == "deploy"
    and (data.get("volumes", {}).get(volume_key) or {}).get("name") == volume_name
    and (data.get("networks", {}).get("default") or {}).get("name") == "wotb_tx_internal"
    and any(
        mount.get("type") == "volume"
        and mount.get("source") == volume_key
        and mount.get("target") == "/var/lib/postgresql"
        for mount in data["services"][service].get("volumes", [])
    )
)
if not valid:
    raise SystemExit(1)
' "$service" "$volume_key" "$volume_name"; then
    die "$service Compose project, network, or persistent volume identity is invalid."
  fi
  docker volume inspect "$volume_name" >/dev/null 2>&1 \
    || die "authoritative PostgreSQL volume is missing: $volume_name"
  volume_project="$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$volume_name")" \
    || die "could not inspect PostgreSQL volume ownership: $volume_name"
  local actual_volume_key
  actual_volume_key="$(docker volume inspect --format '{{ index .Labels "com.docker.compose.volume" }}' "$volume_name")" \
    || die "could not inspect PostgreSQL volume key: $volume_name"
  [ "$volume_project" = deploy ] && [ "$actual_volume_key" = "$volume_key" ] \
    || die "PostgreSQL volume ownership differs from the expected Compose identity: $volume_name"
  docker network inspect wotb_tx_internal >/dev/null 2>&1 \
    || die "TX runtime network is missing; refusing to create a separate network for $service."
  container_id="$(docker compose -p deploy -f "$fragment" ps -aq "$service")" \
    || die "could not inspect the current $service container."
  if [ -n "$container_id" ]; then
    mounted_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' "$container_id")" \
      || die "could not inspect the current $service volume mount."
    [ "$mounted_volume" = "$volume_name" ] \
      || die "$service is attached to a different data volume; refusing recreation."
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
    cp -f "$INCOMING_DIR/runtime-check.sh" "$LIVE_DEPLOY_DIR/runtime-check.sh" || return 1
    cp -f "$INCOMING_DIR/runtime-check-lib.sh" "$LIVE_DEPLOY_DIR/runtime-check-lib.sh" || return 1
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
  [ -f "$INCOMING_DIR/business-postgres.compose.yml" ] || die "staged Business PostgreSQL compose fragment is missing."
  [ -f "$INCOMING_DIR/keycloak-postgres.compose.yml" ] || die "staged Keycloak PostgreSQL compose fragment is missing."
  [ -f "$INCOMING_DIR/runtime-check.sh" ] || die "staged TX runtime check is missing."
  [ -f "$INCOMING_DIR/runtime-check-lib.sh" ] || die "staged TX runtime check library is missing."
  [ -f "$INCOMING_DIR/docker-compose.yml" ] || die "staged TX compose file is missing."
  cp -f "$INCOMING_DIR/deploy.sh" "$next_deploy/deploy.sh" || return 1
  cp -f "$INCOMING_DIR/runtime-check.sh" "$next_deploy/runtime-check.sh" || return 1
  cp -f "$INCOMING_DIR/runtime-check-lib.sh" "$next_deploy/runtime-check-lib.sh" || return 1
  cp -f "$METADATA_TOOL" "$next_deploy/release-metadata.py" || return 1
  cp -f "$EFFECTIVE_COMPOSE" "$next_deploy/docker-compose.yml" || return 1
  if [ "$DEPLOY_SERVICES_RAW" = business-postgres ] || [ ! -f "$next_deploy/business-postgres.compose.yml" ]; then
    cp -f "$INCOMING_DIR/business-postgres.compose.yml" "$next_deploy/business-postgres.compose.yml" || return 1
  fi
  if [ "$DEPLOY_SERVICES_RAW" = keycloak-postgres ] || [ ! -f "$next_deploy/keycloak-postgres.compose.yml" ]; then
    cp -f "$INCOMING_DIR/keycloak-postgres.compose.yml" "$next_deploy/keycloak-postgres.compose.yml" || return 1
  fi
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
  assert_stateful_volume_identity
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
