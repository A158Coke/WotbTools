#!/usr/bin/env bash
# TX Keycloak PostgreSQL backup. The Keycloak database is authoritative identity
# state. This script only reads it, validates the archive, and records a SHA-256
# sidecar; it never drops, truncates, or deletes the source database or rows.
set -Eeuo pipefail

umask 077

readonly COMPOSE_FILE_DEFAULT="/opt/wotb-tx/deploy/docker-compose.yml"
readonly COMPOSE_SERVICE_DEFAULT="keycloak-postgres"
readonly BACKUP_ROOT_DEFAULT="/opt/wotb-tx/backups/keycloak-postgres"
readonly SOURCE_DATABASE="keycloak"

compose_file="${WOTB_TX_KEYCLOAK_POSTGRES_COMPOSE_FILE:-$COMPOSE_FILE_DEFAULT}"
compose_service="${WOTB_TX_KEYCLOAK_POSTGRES_COMPOSE_SERVICE:-$COMPOSE_SERVICE_DEFAULT}"
project_name="${WOTB_TX_KEYCLOAK_POSTGRES_COMPOSE_PROJECT:-deploy}"
container_override="${WOTB_TX_KEYCLOAK_POSTGRES_CONTAINER:-}"
backup_root="${WOTB_TX_KEYCLOAK_POSTGRES_BACKUP_ROOT:-$BACKUP_ROOT_DEFAULT}"
retention_minutes="${WOTB_TX_KEYCLOAK_POSTGRES_BACKUP_RETENTION_MINUTES:-10080}"
admin_user="${KC_POSTGRES_ADMIN_USER:-kc_admin}"
database="${KC_DB_NAME:-$SOURCE_DATABASE}"
skip_retention="false"
temporary_file=""
backup_stage=""

usage() {
  cat >&2 <<'EOF'
Usage: keycloak-postgres-backup.sh [--compose-file PATH] [--backup-root DIR]
                                  [--retention-minutes N] [--skip-retention]

Environment:
  KC_POSTGRES_ADMIN_USER                 bootstrap administrator (default kc_admin)
  KC_DB_NAME                             source database (default keycloak)
  WOTB_TX_KEYCLOAK_POSTGRES_CONTAINER    target container instead of Compose

The backup is written to <backup-root>/keycloak-<UTC timestamp>.dump with a
.dump.sha256 sidecar. The source database is never modified.
EOF
}

cleanup() {
  if [ -n "$temporary_file" ] && [ -f "$temporary_file" ]; then
    rm -f -- "$temporary_file"
  fi
  if [ -n "$temporary_file" ] && [ -f "${temporary_file}.sha256" ]; then
    rm -f -- "${temporary_file}.sha256"
  fi
  if [ -n "$backup_stage" ] && [ -d "$backup_stage" ]; then
    rm -rf -- "$backup_stage"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --compose-file) [ $# -ge 2 ] || { usage; exit 2; }; compose_file="$2"; shift 2 ;;
    --backup-root) [ $# -ge 2 ] || { usage; exit 2; }; backup_root="$2"; shift 2 ;;
    --retention-minutes) [ $# -ge 2 ] || { usage; exit 2; }; retention_minutes="$2"; shift 2 ;;
    --skip-retention) skip_retention="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[[ "$retention_minutes" =~ ^[1-9][0-9]*$ ]] || { echo 'Retention minutes must be a positive integer.' >&2; exit 2; }
[[ "$database" == "$SOURCE_DATABASE" ]] || { echo "Refusing to back up unexpected database: $database" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo 'docker is required.' >&2; exit 1; }
command -v flock >/dev/null 2>&1 || { echo 'flock is required for a safe backup lock.' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo 'sha256sum is required.' >&2; exit 1; }
if [ -z "$container_override" ]; then
  [ -f "$compose_file" ] || { echo "Missing compose file: $compose_file" >&2; exit 1; }
fi

install -d -m 700 "$backup_root" 2>/dev/null || mkdir -p "$backup_root"
exec 9>"$backup_root/.maintenance.lock"
flock -n 9 || { echo 'Another Keycloak PostgreSQL backup is running.' >&2; exit 1; }
trap cleanup EXIT

db_exec() {
  if [ -n "$container_override" ]; then
    docker exec -i "$container_override" "$@"
  else
    docker compose -p "$project_name" -f "$compose_file" exec -T "$compose_service" "$@"
  fi
}

if [ -n "$container_override" ]; then
  docker inspect "$container_override" >/dev/null 2>&1 || { echo "Container is not available: $container_override" >&2; exit 1; }
else
  docker compose -p "$project_name" -f "$compose_file" ps --status running "$compose_service" | grep -q "$compose_service" \
    || { echo "Keycloak PostgreSQL runtime is not running: $compose_service" >&2; exit 1; }
fi

ready=false
for _ in $(seq 1 30); do
  if db_exec pg_isready -U "$admin_user" -d "$database" >/dev/null 2>&1; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ] || { echo "Keycloak PostgreSQL did not become ready: $database" >&2; exit 1; }

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_file="$backup_root/keycloak-${timestamp}.dump"
[ ! -e "$backup_file" ] && [ ! -e "${backup_file}.sha256" ] \
  || { echo "Refusing to overwrite an existing backup: $backup_file" >&2; exit 1; }
backup_stage="$(mktemp -d "$backup_root/.staging-${database}-${timestamp}.XXXXXX")"
chmod 700 "$backup_stage"
temporary_file="$backup_stage/${database}-${timestamp}.dump"

db_exec pg_dump -U "$admin_user" -d "$database" --format=custom --no-owner --no-privileges > "$temporary_file"
[ -s "$temporary_file" ] || { echo "Backup archive is empty: $temporary_file" >&2; exit 1; }
db_exec pg_restore --list < "$temporary_file" >/dev/null
db_exec pg_restore --file=/dev/null < "$temporary_file"
sha256sum "$temporary_file" | awk '{print $1}' > "${temporary_file}.sha256"
[ -s "${temporary_file}.sha256" ] || { echo 'SHA-256 sidecar is empty.' >&2; exit 1; }
chmod 600 -- "$temporary_file" "${temporary_file}.sha256"
mv -- "$temporary_file" "$backup_stage/$(basename "$backup_file")"
mv -- "${temporary_file}.sha256" "$backup_stage/$(basename "${backup_file}.sha256")"
mv -T -- "$backup_stage" "$backup_file"
backup_stage=""
temporary_file=""

if [ "$skip_retention" != true ]; then
  find "$backup_root" -maxdepth 1 -type f -regextype posix-extended \
    -regex '.*/keycloak-[0-9]{8}T[0-9]{6}Z\.dump' \
    ! -path "$backup_file" -mmin "+$retention_minutes" -delete
  find "$backup_root" -maxdepth 1 -type f -regextype posix-extended \
    -regex '.*/keycloak-[0-9]{8}T[0-9]{6}Z\.dump\.sha256' \
    ! -path "${backup_file}.sha256" -mmin "+$retention_minutes" -delete
fi

echo "Keycloak PostgreSQL backup created and verified: $backup_file"
echo "SHA-256: $(cat "${backup_file}.sha256")"
