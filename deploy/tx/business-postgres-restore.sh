#!/usr/bin/env bash
# TX Business PostgreSQL restore verification. The authoritative business
# database is never dropped, truncated, or deleted here: this script restores a
# validated archive into an explicitly named disposable/scratch database so the
# archive's integrity and identity/sequence state can be verified in isolation.
set -Eeuo pipefail

umask 077

readonly COMPOSE_FILE_DEFAULT="/opt/wotb-tx/deploy/docker-compose.yml"
readonly COMPOSE_SERVICE_DEFAULT="business-postgres"
readonly SOURCE_DATABASE="wotb"

compose_file="${WOTB_TX_BUSINESS_POSTGRES_COMPOSE_FILE:-$COMPOSE_FILE_DEFAULT}"
compose_service="${WOTB_TX_BUSINESS_POSTGRES_COMPOSE_SERVICE:-$COMPOSE_SERVICE_DEFAULT}"
project_name="${WOTB_TX_BUSINESS_POSTGRES_COMPOSE_PROJECT:-wotb-tx-business-postgres}"
# Optional container override, used by the disposable CI smoke.
container_override="${WOTB_TX_BUSINESS_POSTGRES_CONTAINER:-}"
admin_user="${TX_BUSINESS_POSTGRES_ADMIN_USER:-wotb}"
source_database="${TX_BUSINESS_DB_NAME:-$SOURCE_DATABASE}"
backup_file=""
target_database=""
confirmation=""
verify_only="false"

usage() {
  cat >&2 <<'EOF'
Usage:
  business-postgres-restore.sh --file <archive.dump> --database <scratch> \
    --confirm RESTORE-<scratch>

Options:
  --file PATH         backup archive created by business-postgres-backup.sh
  --database NAME     disposable/scratch target database (never the source)
  --confirm TOKEN     exact opt-in token RESTORE-<scratch>
  --verify-only       only validate the archive and its SHA-256 sidecar
  --compose-file PATH TX Compose file (default /opt/wotb-tx/deploy/docker-compose.yml)

The script refuses to target the authoritative source database and prints the
verification SQL an operator must run before declaring the archive restorable.
EOF
}

db_exec() {
  if [ -n "$container_override" ]; then
    docker exec -i "$container_override" "$@"
  else
    docker compose -p "$project_name" -f "$compose_file" exec -T "$compose_service" "$@"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --file)
      [ $# -ge 2 ] || { usage; exit 2; }
      backup_file="$2"
      shift 2
      ;;
    --database)
      [ $# -ge 2 ] || { usage; exit 2; }
      target_database="$2"
      shift 2
      ;;
    --confirm)
      [ $# -ge 2 ] || { usage; exit 2; }
      confirmation="$2"
      shift 2
      ;;
    --verify-only)
      verify_only="true"
      shift
      ;;
    --compose-file)
      [ $# -ge 2 ] || { usage; exit 2; }
      compose_file="$2"
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

[ -n "$backup_file" ] && [ -f "$backup_file" ] && [ ! -L "$backup_file" ] \
  || { echo "Backup archive does not exist or is not a regular file." >&2; exit 1; }
[ -f "${backup_file}.sha256" ] \
  || { echo "Backup SHA-256 sidecar is missing: ${backup_file}.sha256" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required." >&2; exit 1; }
if [ -z "$container_override" ]; then
  [ -f "$compose_file" ] || { echo "Missing compose file: $compose_file" >&2; exit 1; }
fi

expected_sha="$(tr -d '[:space:]' < "${backup_file}.sha256")"
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] \
  || { echo "Backup SHA-256 sidecar is not a lowercase hex digest." >&2; exit 1; }
actual_sha="$(sha256sum "$backup_file" | awk '{print $1}')"
[ "$actual_sha" = "$expected_sha" ] \
  || { echo "Backup archive SHA-256 mismatch; refusing to restore." >&2; exit 1; }
echo "Backup SHA-256 verified."

if [ -z "$container_override" ]; then
  docker compose -p "$project_name" -f "$compose_file" up -d "$compose_service" >/dev/null
fi
db_exec pg_restore --list < "$backup_file" >/dev/null
db_exec pg_restore --file=/dev/null < "$backup_file"
echo "Backup catalog and data blocks verified without changing any database."

if [ "$verify_only" = "true" ]; then
  echo "Verify-only: no database was created, modified, or deleted."
  exit 0
fi

[ -n "$target_database" ] || { usage; exit 2; }
[[ "$target_database" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
  || { echo "Unsupported target database name." >&2; exit 2; }
if [ "$target_database" = "$source_database" ]; then
  echo "Refusing to restore into the authoritative source database $source_database." >&2
  exit 2
fi
[ "$confirmation" = "RESTORE-$target_database" ] \
  || { echo "Restore refused. Pass --confirm RESTORE-$target_database explicitly." >&2; exit 2; }

db_exec psql -U "$admin_user" -d postgres -v ON_ERROR_STOP=1 <<SQL
select pg_terminate_backend(pid)
from pg_stat_activity
where datname = '$target_database' and pid <> pg_backend_pid();
drop database if exists "$target_database";
create database "$target_database" owner "$admin_user";
SQL

db_exec pg_restore -U "$admin_user" -d "$target_database" --exit-on-error --no-owner --no-privileges \
  < "$backup_file"

echo "Restored $backup_file into disposable database $target_database."
echo "The authoritative source database $source_database was not modified or deleted."
cat <<EOF

Verify before declaring the archive restorable (identity and sequence handling):
  select count(*) from hall_of_fame_record;
  select min(id), max(id) from hall_of_fame_record;
  select pg_get_serial_sequence('hall_of_fame_record', 'id') as identity_sequence;
  select last_value, is_called
    from pg_sequences
   where schemaname = 'public' and sequencename like 'hall_of_fame_record%';
  select arena_id, account_id, count(*) from hall_of_fame_record
   group by 1, 2 having count(*) > 1;
  select count(*) from hall_of_fame_record where replay_uploaded_by is not null;
Explicit ids and literal replay_uploaded_by values (historical Keycloak UUIDs)
must survive unchanged, and the identity sequence must be at or above max(id).
EOF
