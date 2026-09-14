#!/usr/bin/env bash
# Explicit application recovery. It never restores or changes database state.
set -Eeuo pipefail

readonly WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
readonly LIVE_COMPOSE="$WOTB_DIR/docker-compose.yml"
readonly METADATA_FILE="$WOTB_DIR/production-release.json"
readonly RECOVERY_SERVICE="${WOTB_RECOVERY_SERVICE:-}"
readonly RECOVERY_MODE="${WOTB_RECOVERY_MODE:-}"
readonly REQUESTED_SHA="${WOTB_RECOVERY_SHA:-}"
readonly REQUESTED_TAG="${WOTB_RECOVERY_TAG:-}"
readonly RUN_NUMBER="${WOTB_RECOVERY_RUN_NUMBER:-1}"
TARGET_SHA=""
TARGET_TAG=""
TARGET_SCHEMA_MAX="${WOTB_TARGET_SCHEMA_MAX:-}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ "$RECOVERY_SERVICE" =~ ^(backend|frontend|keycloak)$ ]] || die "recovery service must be backend, frontend, or keycloak."
[[ "$RECOVERY_MODE" =~ ^(current|specific)$ ]] || die "recovery mode must be current or specific."
[[ "$RUN_NUMBER" =~ ^[1-9][0-9]*$ ]] || die "recovery run number must be positive."
[ -f "$LIVE_COMPOSE" ] || die "live compose is missing."
[ -f "$METADATA_FILE" ] || [ "$RECOVERY_MODE" = specific ] || die "production metadata is missing."

compose_service=""
case "$RECOVERY_SERVICE" in
  backend) compose_service=wotb-backend ;;
  frontend) compose_service=wotb-frontend ;;
  keycloak) compose_service=keycloak ;;
esac

if [ "$RECOVERY_MODE" = current ]; then
  readarray -t current_identity < <(python3 - "$METADATA_FILE" "$compose_service" <<'PY'
import json
import re
import sys

try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    entry = data.get("services", {}).get(sys.argv[2], {})
except (OSError, ValueError, TypeError):
    raise SystemExit("production metadata is invalid")
if not isinstance(entry, dict):
    raise SystemExit("production metadata service entry is invalid")
commit_sha = entry.get("commitSha", "")
image_tag = entry.get("imageTag", "")
migration_max = entry.get("migrationMaxVersion", "")
if not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
    raise SystemExit("metadata commitSha is not a full lowercase SHA")
if not re.fullmatch(r"sha-[0-9a-f]{12}", image_tag):
    raise SystemExit("metadata imageTag is not immutable")
print(commit_sha)
print(image_tag)
print(migration_max)
PY
  )
  [ "${#current_identity[@]}" -eq 3 ] || die "metadata current identity is incomplete."
  TARGET_SHA="${current_identity[0]}"
  TARGET_TAG="${current_identity[1]}"
  [ -n "$TARGET_SCHEMA_MAX" ] || TARGET_SCHEMA_MAX="${current_identity[2]}"
else
  [[ "$REQUESTED_SHA" =~ ^[0-9a-f]{40}$ ]] || die "specific recovery requires a full lowercase target SHA."
  TARGET_SHA="$REQUESTED_SHA"
  TARGET_TAG="sha-${TARGET_SHA:0:12}"
  [ -z "$REQUESTED_TAG" ] || [ "$REQUESTED_TAG" = "$TARGET_TAG" ] \
    || die "requested recovery tag does not match target SHA."
fi

[[ "$TARGET_TAG" =~ ^sha-[0-9a-f]{12}$ ]] || die "recovery target tag is not immutable."
if [ "$RECOVERY_SERVICE" != backend ] && [ -z "$TARGET_SCHEMA_MAX" ]; then
  TARGET_SCHEMA_MAX=0
fi
[[ "$TARGET_SCHEMA_MAX" =~ ^(0|[1-9][0-9]*)$ ]] || die "target migration max version is unavailable."

if [ "$RECOVERY_SERVICE" = backend ]; then
  live_schema="$(docker compose -f "$LIVE_COMPOSE" exec -T postgres psql -U wotb -d wotb -Atqc \
    "select coalesce((select version from flyway_schema_history where success = true order by installed_rank desc limit 1), '0');")" \
    || die "cannot read live Flyway schema; refusing backend recovery."
  live_schema="$(tr -d '[:space:]' <<< "$live_schema")"
  [[ "$live_schema" =~ ^(0|[1-9][0-9]*)$ ]] || die "live Flyway schema is invalid; refusing backend recovery."
  [ "$TARGET_SCHEMA_MAX" -ge "$live_schema" ] \
    || die "target backend migrations ($TARGET_SCHEMA_MAX) are older than live schema ($live_schema)."
fi

is_safe_path() {
  local path="$1"
  [ -n "$path" ] && [ "$path" != "/" ] && [ "$path" != "." ] && [[ "$path" != *$'\n'* ]]
}
is_safe_path "$WOTB_DIR" || die "unsafe WOTB_DIR."

command -v flock >/dev/null 2>&1 || die "flock is required to serialize application recovery."
mkdir -p "$WOTB_DIR"
exec 9>"$WOTB_DIR/.deploy.lock"
flock -n 9 || die "another production deployment or recovery is already running."

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_INCOMING_DIR="$WOTB_DIR/deploy.incoming.recovery.$$"
is_safe_path "$DEPLOY_INCOMING_DIR" || die "unsafe recovery staging directory."
rm -rf -- "$DEPLOY_INCOMING_DIR"
mkdir -p "$DEPLOY_INCOMING_DIR/deploy"
cp -a "$SCRIPT_DIR/." "$DEPLOY_INCOMING_DIR/deploy/"

export TAG="$TARGET_TAG"
export RELEASE_SHA="$TARGET_SHA"
export RELEASE_RUN_NUMBER="$RUN_NUMBER"
export WOTB_DEPLOY_SERVICES="$compose_service"
export WOTB_DEPLOY_IMAGE_SERVICES="$compose_service"
export WOTB_BACKEND_MIGRATION_MAX_VERSION="$TARGET_SCHEMA_MAX"
export WOTB_INCOMING_DIR="$DEPLOY_INCOMING_DIR"
export WOTB_DEPLOY_LOCK_FD=9
set +e
bash "$DEPLOY_INCOMING_DIR/deploy/deploy.sh"
status=$?
set -e
rm -rf -- "$DEPLOY_INCOMING_DIR"
exit "$status"
