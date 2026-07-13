#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly COMPOSE_DIR="${WOTB_COMPOSE_DIR:-/opt/wotb}"
readonly BACKUP_ROOT="${WOTB_BACKUP_ROOT:-/opt/wotb/backups}"

database=""
backup_file=""
confirmation=""

usage() {
  cat >&2 <<'EOF'
Usage:
  postgres-restore.sh --database wotb|keycloak --file <archive.dump> --confirm RESTORE-<database>

Example:
  postgres-restore.sh --database wotb \
    --file /opt/wotb/backups/wotb/wotb-20260712T030000Z.dump \
    --confirm RESTORE-wotb
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      database="$2"
      shift 2
      ;;
    --file)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      backup_file="$2"
      shift 2
      ;;
    --confirm)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      confirmation="$2"
      shift 2
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
  wotb)
    dependent_service="wotb-backend"
    ;;
  keycloak)
    dependent_service="keycloak"
    ;;
  *)
    usage
    exit 2
    ;;
esac

expected_confirmation="RESTORE-$database"
if [[ "$confirmation" != "$expected_confirmation" ]]; then
  echo "Restore refused. Pass --confirm $expected_confirmation explicitly." >&2
  exit 2
fi

database_backup_root="$BACKUP_ROOT/$database"
if [[ ! -d "$database_backup_root" || ! -f "$backup_file" || -L "$backup_file" ]]; then
  echo "Backup archive does not exist or is not a regular file: $backup_file" >&2
  exit 1
fi

backup_root_real="$(realpath -e -- "$database_backup_root")"
backup_file_real="$(realpath -e -- "$backup_file")"
case "$backup_file_real" in
  "$backup_root_real"/*) ;;
  *)
    echo "Backup archive must be inside $database_backup_root" >&2
    exit 1
    ;;
esac

if [[ ! -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
  echo "Missing compose file: $COMPOSE_DIR/docker-compose.yml" >&2
  exit 1
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"
docker compose up -d postgres >/dev/null

# Reject catalog or compressed-data corruption before creating the safety backup or
# stopping services. Emitting SQL to /dev/null never changes a database.
docker compose exec -T postgres pg_restore --list < "$backup_file_real" >/dev/null
docker compose exec -T postgres pg_restore --file=/dev/null < "$backup_file_real"

"$script_directory/postgres-backup.sh" --database "$database" --skip-retention

if ! command -v flock >/dev/null 2>&1; then
  echo "The flock command is required for safe restore locking." >&2
  exit 1
fi
exec 9>"$BACKUP_ROOT/.maintenance.lock"
if ! flock -n 9; then
  echo "Another database backup or restore started; restore aborted before changing data." >&2
  exit 1
fi

# Keep the validated archive open before stopping services or changing the database.
exec 8<"$backup_file_real"

docker compose stop "$dependent_service"

cat <<EOF
Restoring $database from:
  $backup_file_real
The dependent service remains stopped if restore fails.
EOF

docker compose exec -T postgres psql -U wotb -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '$database' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$database";
CREATE DATABASE "$database" OWNER wotb;
SQL

docker compose exec -T postgres \
  pg_restore -U wotb -d "$database" --exit-on-error --no-owner --no-privileges \
  <&8

docker compose up -d "$dependent_service"
echo "Restore completed: $database"
