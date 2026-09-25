#!/usr/bin/env bash
# TX Business PostgreSQL backup. The business database is authoritative state:
# this script only reads it, validates the archive, and records a SHA-256 sidecar.
# It never drops, truncates, or deletes the source database or its rows.
set -Eeuo pipefail

umask 077

readonly COMPOSE_FILE_DEFAULT="/opt/wotb-tx/deploy/docker-compose.yml"
readonly COMPOSE_SERVICE_DEFAULT="business-postgres"
readonly BACKUP_ROOT_DEFAULT="/opt/wotb-tx/backups/business-postgres"
readonly SOURCE_DATABASE="wotb"

compose_file="${WOTB_TX_BUSINESS_POSTGRES_COMPOSE_FILE:-$COMPOSE_FILE_DEFAULT}"
compose_service="${WOTB_TX_BUSINESS_POSTGRES_COMPOSE_SERVICE:-$COMPOSE_SERVICE_DEFAULT}"
project_name="${WOTB_TX_BUSINESS_POSTGRES_COMPOSE_PROJECT:-wotb-tx-business-postgres}"
# Optional container override. The disposable CI smoke uses this to drive the
# real script against a throwaway container without starting a Compose project.
container_override="${WOTB_TX_BUSINESS_POSTGRES_CONTAINER:-}"
backup_root="${WOTB_TX_BUSINESS_POSTGRES_BACKUP_ROOT:-$BACKUP_ROOT_DEFAULT}"
retention_minutes="${WOTB_TX_BUSINESS_POSTGRES_BACKUP_RETENTION_MINUTES:-10080}"
admin_user="${TX_BUSINESS_POSTGRES_ADMIN_USER:-wotb}"
database="${TX_BUSINESS_DB_NAME:-$SOURCE_DATABASE}"
skip_retention="false"
temporary_file=""

usage() {
  cat >&2 <<'EOF'
Usage: business-postgres-backup.sh [--compose-file PATH] [--backup-root DIR]
                                   [--retention-minutes N] [--skip-retention]

Environment:
  TX_BUSINESS_POSTGRES_ADMIN_USER      bootstrap administrator (default wotb)
  TX_BUSINESS_DB_NAME                  source database (default wotb)
  WOTB_TX_BUSINESS_POSTGRES_CONTAINER  target container instead of Compose

The backup is written to <backup-root>/<database>-<UTC timestamp>.dump with a
.dump.sha256 sidecar. The source database is never deleted or modified.
EOF
}

cleanup() {
  if [ -n "$temporary_file" ] && [ -f "$temporary_file" ]; then
    rm -f -- "$temporary_file"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --compose-file)
      [ $# -ge 2 ] || { usage; exit 2; }
      compose_file="$2"
      shift 2
      ;;
    --backup-root)
      [ $# -ge 2 ] || { usage; exit 2; }
      backup_root="$2"
      shift 2
      ;;
    --retention-minutes)
      [ $# -ge 2 ] || { usage; exit 2; }
      retention_minutes="$2"
      shift 2
      ;;
    --skip-retention)
      skip_retention="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[[ "$retention_minutes" =~ ^[1-9][0-9]*$ ]] \
  || { echo "Retention minutes must be a positive integer." >&2; exit 2; }
[[ "$database" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
  || { echo "Unsupported database name: $database" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "docker is required." >&2; exit 1; }
command -v flock >/dev/null 2>&1 || { echo "flock is required for a safe backup lock." >&2; exit 1; }
if [ -z "$container_override" ]; then
  [ -f "$compose_file" ] || { echo "Missing compose file: $compose_file" >&2; exit 1; }
fi

# TX root-only storage. `install -m 700` is the Linux production path; the
# mkdir fallback keeps the script runnable from a POSIX-emulation shell without
# POSIX chmod support.
install -d -m 700 "$backup_root" 2>/dev/null || mkdir -p "$backup_root"
exec 9>"$backup_root/.maintenance.lock"
flock -n 9 || { echo "Another Business PostgreSQL backup or restore is running." >&2; exit 1; }
trap cleanup EXIT

# stdin is forwarded so pg_dump/pg_restore streams work from the host.
db_exec() {
  if [ -n "$container_override" ]; then
    docker exec -i "$container_override" "$@"
  else
    docker compose -p "$project_name" -f "$compose_file" exec -T "$compose_service" "$@"
  fi
}

if [ -n "$container_override" ]; then
  docker inspect "$container_override" >/dev/null 2>&1 \
    || { echo "Container is not available: $container_override" >&2; exit 1; }
else
  docker compose -p "$project_name" -f "$compose_file" up -d "$compose_service" >/dev/null
fi

ready="false"
for _ in $(seq 1 30); do
  if db_exec pg_isready -U "$admin_user" -d "$database" >/dev/null 2>&1; then
    ready="true"
    break
  fi
  sleep 2
done
[ "$ready" = "true" ] || { echo "Business PostgreSQL did not become ready: $database" >&2; exit 1; }

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_file="$backup_root/${database}-${timestamp}.dump"
if [ -e "$backup_file" ]; then
  echo "Refusing to overwrite an existing backup: $backup_file" >&2
  exit 1
fi
temporary_file="${backup_file}.tmp.$$"

db_exec pg_dump -U "$admin_user" -d "$database" --format=custom --no-owner --no-privileges \
  > "$temporary_file"
[ -s "$temporary_file" ] || { echo "Backup archive is empty: $temporary_file" >&2; exit 1; }

# Validate the catalog and every compressed data block without connecting to or
# changing any database, then record the archive hash for restore verification.
db_exec pg_restore --list < "$temporary_file" >/dev/null
db_exec pg_restore --file=/dev/null < "$temporary_file"
sha256sum "$temporary_file" | awk '{print $1}' > "${temporary_file}.sha256"
[ -s "${temporary_file}.sha256" ] || { echo "SHA-256 sidecar is empty." >&2; exit 1; }

chmod 600 -- "$temporary_file" 2>/dev/null || true
mv -- "$temporary_file" "$backup_file"
mv -- "${temporary_file}.sha256" "${backup_file}.sha256"
chmod 600 -- "${backup_file}.sha256" 2>/dev/null || true
temporary_file=""

if [ "$skip_retention" != "true" ]; then
  find "$backup_root" -type f -name '*.dump' ! -path "$backup_file" \
    -mmin "+$retention_minutes" -delete
fi
echo "Business PostgreSQL backup created and verified: $backup_file"
echo "SHA-256: $(cat "${backup_file}.sha256")"
