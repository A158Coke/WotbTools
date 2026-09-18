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
readonly BOOTSTRAP_KEYCLOAK="${WOTB_TX_BOOTSTRAP_KEYCLOAK:-0}"
readonly BACKEND_UPSTREAM_VALUE="${TX_BACKEND_UPSTREAM:-http://10.20.0.2:8087}"
readonly DEPLOY_SERVICES_RAW="${WOTB_DEPLOY_SERVICES:-}"
readonly DEPLOY_IMAGE_SERVICES_RAW="${WOTB_DEPLOY_IMAGE_SERVICES:-}"
readonly TAG_VALUE="${TAG:-}"
readonly RELEASE_SHA_VALUE="${RELEASE_SHA:-}"
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

is_image_service() {
  case "$1" in
    keycloak|wotb-frontend) return 0 ;;
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
  [ "$BACKEND_UPSTREAM_VALUE" = "http://10.20.0.2:8087" ] \
    || die "TX_BACKEND_UPSTREAM must remain the WireGuard-only backend URL http://10.20.0.2:8087."
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
      all|keycloak-postgres|keycloak|wotb-frontend|caddy) ;;
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
      keycloak|wotb-frontend) is_selected "$service" || die "TX image service is not selected: $service" ;;
      *) die "unsupported TX image service: $service" ;;
    esac
  done

  # Compose interpolation validates all runtime contracts before promotion.
  for required in KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD \
    KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD \
    WG_APPLICATION_ID CADDY_ACME_EMAIL; do
    require_env "$required"
  done
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
  tag="$(metadata_tag "$service")"
  [ -n "$tag" ] || tag="$(compose_tag "$service")"
  # The first TX step intentionally starts PostgreSQL before OpenTofu creates
  # the Keycloak database and role. No application image exists yet, so render
  # the incoming immutable tag without starting or recording that image.
  if [ -z "$tag" ] && is_selected keycloak-postgres && ! is_selected keycloak && ! is_selected wotb-frontend; then
    printf '%s\n' "$TAG_VALUE"
    return
  fi
  [[ "$tag" =~ ^sha-[0-9a-f]{12}$ ]] \
    || die "current immutable image identity is unavailable for $service; deploy both TX application images for first bootstrap."
  printf '%s\n' "$tag"
}

render_effective_compose() {
  local source="$1" target="$2" frontend_tag="$3" keycloak_tag="$4"
  FRONTEND_TAG="$frontend_tag" KEYCLOAK_TAG="$keycloak_tag" \
    python3 - "$source" "$target" <<'PY'
import os
import re
import sys

source, target = sys.argv[1:3]
tags = {"wotb-frontend": os.environ["FRONTEND_TAG"], "keycloak": os.environ["KEYCLOAK_TAG"]}
current = ""
seen = set()
output = []
for line in open(source, encoding="utf-8"):
    match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
    if match:
        current = match.group(1)
    if current in tags and re.match(r"^\s+image:\s+ghcr\.io/a158coke/wotbtools-[^:]+:", line):
        image = "ghcr.io/a158coke/wotbtools-keycloak" if current == "keycloak" else "ghcr.io/a158coke/wotbtools-frontend"
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
  local frontend_tag keycloak_tag
  frontend_tag="$(current_or_target_tag wotb-frontend)"
  keycloak_tag="$(current_or_target_tag keycloak)"
  render_effective_compose "$source" "$EFFECTIVE_COMPOSE" "$frontend_tag" "$keycloak_tag"
  export TX_RUNTIME_ROOT
  export TX_BACKEND_UPSTREAM="$BACKEND_UPSTREAM_VALUE"
  docker compose -f "$EFFECTIVE_COMPOSE" config >/dev/null \
    || die "staged TX compose config is invalid; live TX deployment was not changed."
}

pull_images() {
  local -a services=()
  if is_selected all || is_selected keycloak-postgres; then
    services+=(keycloak-postgres)
  fi
  if is_selected all || is_selected keycloak; then
    services+=(keycloak)
  fi
  if is_selected all || is_selected wotb-frontend; then
    services+=(wotb-frontend)
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
    printf '%s\n' keycloak-postgres keycloak wotb-frontend
  else
    printf '%s\n' "${DEPLOY_SERVICES[@]}"
  fi
}

apply_services() {
  mapfile -t APPLY_SERVICES < <(compose_service_list | awk 'NF && !seen[$0]++')
  [ "${#APPLY_SERVICES[@]}" -gt 0 ] || die "no TX runtime service selected."
  local service
  for service in "${APPLY_SERVICES[@]}"; do
    if ! docker compose -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate "$service"; then
      FAILED_SERVICE="$service"
      return 1
    fi
  done
  # Recreate Caddy when its staged configuration or a proxied application changes.
  if [ "$BOOTSTRAP_KEYCLOAK" != 1 ] && \
    (is_selected all || is_selected keycloak || is_selected wotb-frontend || is_selected caddy); then
    if ! docker compose -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate caddy; then
      FAILED_SERVICE="caddy"
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

blocking_health() {
  wait_for_database || return 1
  if is_selected all || is_selected keycloak || is_selected wotb-frontend; then
    if [ "$BOOTSTRAP_KEYCLOAK" = 1 ] && is_selected keycloak && ! is_selected wotb-frontend; then
      wait_for_probe keycloak http://keycloak:8080/realms/master/.well-known/openid-configuration || return 1
    else
      wait_for_probe keycloak http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration || return 1
    fi
  fi
  if is_selected all || is_selected wotb-frontend; then
    # This direct probe proves TX -> WireGuard -> Yecao's published backend
    # path independently of frontend nginx and Caddy routing.
    wait_for_probe wireguard-backend http://10.20.0.2:8087/api/health || return 1
    wait_for_probe frontend http://wotb-frontend/api/health 'Host: wotbtools.com' || return 1
    # The formal site address intentionally redirects HTTP to HTTPS. Probe
    # Caddy's TX-local readiness surface instead: it is 2xx-only, DNS/ACME
    # independent, and exercises the frontend and Keycloak proxy contracts.
    wait_for_probe caddy-ready http://172.29.0.2/_wotb/ready || return 1
    wait_for_probe caddy-frontend http://172.29.0.2/_wotb/frontend/api/health || return 1
    wait_for_probe caddy-keycloak http://172.29.0.2/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration || return 1
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

pre_cutover_check() {
  local source_root="${WOTB_SOURCE_ROOT:-}" compose_json health
  local yecao_compose="$source_root/deploy/docker-compose.prod.yml"
  local yecao_contract="$LIVE_DEPLOY_DIR/yecao-backend-contract.json"
  local failures=0 provider
  DEPLOY_SERVICES=(all)

  command -v docker >/dev/null 2>&1 || { echo "docker: FAIL (docker is required)" >&2; return 1; }
  command -v python3 >/dev/null 2>&1 || { echo "python3: FAIL (python3 is required)" >&2; return 1; }
  for required in KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD \
    KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD \
    WG_APPLICATION_ID CADDY_ACME_EMAIL; do
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
ports = [str(p) for p in data["services"]["keycloak"].get("ports", [])]
assert any("127.0.0.1" in p and "18080" in p and "8080" in p for p in ports), ports
assert not any("0.0.0.0" in p or p.startswith("8080:") or "::" in p for p in ports)
' <<< "$compose_json"; then
    echo "keycloak-admin-loopback: PASS"
  else
    echo "keycloak-admin-loopback: FAIL (Admin API must bind to 127.0.0.1:18080:8080 only)" >&2
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

  wait_for_probe keycloak http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration || failures=1
  wait_for_probe wireguard-backend http://10.20.0.2:8087/api/health || failures=1
  wait_for_probe frontend http://wotb-frontend/api/health 'Host: wotbtools.com' || failures=1
  wait_for_probe caddy-ready http://172.29.0.2/_wotb/ready || failures=1
  wait_for_probe caddy-frontend http://172.29.0.2/_wotb/frontend/api/health || failures=1
  wait_for_probe caddy-keycloak http://172.29.0.2/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration || failures=1
  probe_body_contains assetlinks http://172.29.0.2/.well-known/assetlinks.json 'com.wotbtools.app' || failures=1

  for provider in keycloak-juhe-qq-provider.jar keycloak-qq-provider.jar keycloak-wargaming-provider.jar; do
    if docker compose -f "$LIVE_COMPOSE" exec -T keycloak test -f "/opt/keycloak/providers/$provider"; then
      echo "keycloak-provider-$provider: PASS"
    else
      echo "keycloak-provider-$provider: FAIL" >&2
      failures=1
    fi
  done

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

  echo "QQ_IDP_STATUS=idp-qq=WAITING_EXTERNAL"
  echo "QQ_FALLBACK_STATUS=juhe-qq=NOT_CONFIGURED_IN_TX"
  if [ "$failures" -ne 0 ]; then
    echo "PRE_CUTOVER_NOT_READY" >&2
    return 1
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
    keycloak|wotb-frontend|caddy)
      echo "Stopping failed affected TX service: $service"
      docker compose -f "$LIVE_COMPOSE" stop "$service" || true
      ;;
    *) echo "Not stopping TX dependency after a failed health check: ${service:-unknown}" >&2 ;;
  esac
}

update_metadata() {
  local now metadata_tmp selected service
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  selected=""
  for service in keycloak wotb-frontend; do
    if is_selected all || is_selected "$service"; then
      selected+="$service,"
    fi
  done
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
  if ! apply_services || ! blocking_health; then
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
