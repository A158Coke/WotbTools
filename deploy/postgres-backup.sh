#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly COMPOSE_DIR="${WOTB_COMPOSE_DIR:-/opt/wotb}"
readonly BACKUP_ROOT="${WOTB_BACKUP_ROOT:-/opt/wotb/backups}"
readonly RETENTION_MINUTES="${WOTB_BACKUP_RETENTION_MINUTES:-10080}"

database="wotb"
temporary_file=""
skip_retention="false"

usage() {
  echo "Usage: $0 [--database wotb|keycloak] [--skip-retention]" >&2
}

cleanup() {
  if [[ -n "$temporary_file" && -f "$temporary_file" ]]; then
    rm -f -- "$temporary_file"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      database="$2"
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

case "$database" in
  wotb|keycloak) ;;
  *)
    echo "Unsupported database: $database" >&2
    exit 2
    ;;
esac

if [[ ! "$RETENTION_MINUTES" =~ ^[1-9][0-9]*$ ]]; then
  echo "WOTB_BACKUP_RETENTION_MINUTES must be a positive integer." >&2
  exit 2
fi

if [[ ! -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
  echo "Missing compose file: $COMPOSE_DIR/docker-compose.yml" >&2
  exit 1
fi

mkdir -p -- "$BACKUP_ROOT/$database"
chmod 700 -- "$BACKUP_ROOT" "$BACKUP_ROOT/$database"
if ! command -v flock >/dev/null 2>&1; then
  echo "The flock command is required for safe backup locking." >&2
  exit 1
fi
exec 9>"$BACKUP_ROOT/.maintenance.lock"
if ! flock -n 9; then
  echo "Another database backup or restore is already running." >&2
  exit 1
fi
trap cleanup EXIT

cd "$COMPOSE_DIR"
docker compose up -d postgres >/dev/null

database_ready="false"
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U wotb -d "$database" >/dev/null 2>&1; then
    database_ready="true"
    break
  fi
  sleep 2
done

if [[ "$database_ready" != "true" ]]; then
  echo "Database did not become ready: $database" >&2
  exit 1
fi

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_file="$BACKUP_ROOT/$database/${database}-${timestamp}.dump"
if [[ -e "$backup_file" ]]; then
  echo "Refusing to overwrite an existing backup: $backup_file" >&2
  exit 1
fi
temporary_file="${backup_file}.tmp.$$"

docker compose exec -T postgres \
  pg_dump -U wotb -d "$database" --format=custom --no-owner --no-privileges \
  > "$temporary_file"

if [[ ! -s "$temporary_file" ]]; then
  echo "Backup archive is empty: $temporary_file" >&2
  exit 1
fi

# Validate both the archive catalog and every compressed data block without connecting
# to or changing a database.
docker compose exec -T postgres pg_restore --list < "$temporary_file" >/dev/null
docker compose exec -T postgres pg_restore --file=/dev/null < "$temporary_file"

chmod 600 -- "$temporary_file"
mv -- "$temporary_file" "$backup_file"
temporary_file=""

if [[ "$skip_retention" != "true" ]]; then
  find "$BACKUP_ROOT/$database" -type f -name '*.dump' ! -path "$backup_file" \
    -mmin "+$RETENTION_MINUTES" -delete
fi
echo "Backup created and verified: $backup_file"
