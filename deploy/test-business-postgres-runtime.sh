#!/usr/bin/env bash
# Disposable Business PostgreSQL runtime smoke. It proves three contracts on a
# throwaway postgres:18-alpine container and never contacts TX:
#   1. the Compose definition ships the expected service, image, volume, port,
#      healthcheck, and restart policy;
#   2. the OpenTofu root declares only the authoritative database, the
#      application role, and its grant, with a mirror-only provider and a
#      non-destructive plan policy;
#   3. the real cyrilgdn/postgresql provider applies against a real PostgreSQL 18
#      instance, the application role is a non-superuser that can create tables,
#      and the follow-up plan is completely clean;
#   4. backup -> SHA-256 -> pg_restore catalog validation -> restore into a
#      disposable database preserves explicit ids, the unique key, literal
#      historical Keycloak UUIDs, and the identity sequence.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/deploy/tx/docker-compose.yml"
TOFU_ROOT="$ROOT/infra/tofu/postgres-business"
TOFU="${TOFU_BIN:-tofu}"
TAG="sha-0123456789ab"
NAME="wotb-business-postgres-$RANDOM-$$"
PROJECT="wotb-business-postgres-$RANDOM-$$"
PORT="25432"
ADMIN_USER="wotb"
ADMIN_PASSWORD="ci-business-admin-password"
APP_ROLE="control_api"
APP_PASSWORD="ci-control-api-password"
DB_NAME="wotb"
SCRATCH_DB="wotb_restore_scratch"
KEEP=0
[ "${WOTB_BUSINESS_POSTGRES_KEEP:-0}" = "1" ] && KEEP=1

WORK="$(mktemp -d)"
CONTAINER_STARTED=0

fail() {
  echo "BUSINESS POSTGRES SMOKE FAIL: $*" >&2
  [ "$CONTAINER_STARTED" -eq 1 ] && docker logs --tail 120 "$NAME" >&2 || true
  exit 1
}

cleanup() {
  [ "$KEEP" -eq 1 ] || docker rm -f "$NAME" >/dev/null 2>&1 || true
  [ "$KEEP" -eq 1 ] || rm -rf -- "$WORK"
  [ "$KEEP" -eq 1 ] && echo "KEEP=1: container $NAME, work dir $WORK, port $PORT"
  return 0
}
trap cleanup EXIT

for command_name in docker python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done
command -v "$TOFU" >/dev/null 2>&1 || fail "$TOFU is required"
[ -f "$COMPOSE" ] || fail "TX Compose file is missing"
[ -d "$TOFU_ROOT" ] || fail "Business PostgreSQL OpenTofu root is missing"
docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "== Compose runtime contract =="
export TAG
export TX_RUNTIME_ROOT="$WORK/runtime"
mkdir -p "$TX_RUNTIME_ROOT"
export TX_BUSINESS_POSTGRES_ADMIN_USER="$ADMIN_USER"
export TX_BUSINESS_POSTGRES_ADMIN_PASSWORD="$ADMIN_PASSWORD"
KC_POSTGRES_ADMIN_USER=not-configured KC_POSTGRES_ADMIN_PASSWORD=not-configured \
KC_BOOTSTRAP_ADMIN_PASSWORD=not-configured KC_DB_USERNAME=not-configured \
KC_DB_PASSWORD=not-configured WG_APPLICATION_ID=not-configured \
CADDY_ACME_EMAIL=not-configured@example.invalid \
TX_RABBITMQ_ADMIN_USER=not-configured TX_RABBITMQ_ADMIN_PASSWORD=not-configured \
  docker compose -f "$COMPOSE" config --format json > "$WORK/compose.json"
python3 - "$WORK/compose.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    document = json.load(handle)
services = document["services"]
assert "business-postgres" in services, sorted(services)
service = services["business-postgres"]
assert service["image"] == "postgres:18-alpine", service["image"]
ports = [str(port) for port in service.get("ports", [])]
assert any("127.0.0.1" in port and "25432" in port and "5432" in port for port in ports), ports
assert not any("0.0.0.0" in port or "::" in port for port in ports), ports
assert not any("10.20.0.1" in port for port in ports), ports
assert service.get("healthcheck"), "business-postgres healthcheck is required"
assert service.get("restart") == "unless-stopped", service.get("restart")
assert str(service.get("mem_limit")) in {"512m", "536870912"}, service.get("mem_limit")
volumes = [str(volume) for volume in service.get("volumes", [])]
assert any("business_postgres_data" in volume and "/var/lib/postgresql" in volume for volume in volumes), volumes
environment = service.get("environment") or {}
assert set(environment) == {"POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"}, sorted(environment)
assert environment["POSTGRES_DB"] == "postgres", environment["POSTGRES_DB"]
assert "business_postgres_data" in document["volumes"], sorted(document["volumes"])
assert "keycloak_postgres_data" in document["volumes"], sorted(document["volumes"])
print("business-postgres Compose service/port/volume contract OK")
PY

echo "== OpenTofu root ownership guard =="
python3 - "$TOFU_ROOT" "$ROOT/deploy/tx/business-postgres.tofurc" <<'PY'
import sys
from pathlib import Path

root = Path(sys.argv[1])
tofurc = Path(sys.argv[2])
text = "\n".join(path.read_text(encoding="utf-8") for path in sorted(root.glob("*.tf")))
for address in ("postgresql_role.control_api", "postgresql_database.wotb", "postgresql_grant.control_api_database_access"):
    assert f'"{address.split(".")[1]}"' in text, address
for forbidden in ("postgresql_table", "postgresql_schema", "postgresql_extension", "postgresql_function", "postgresql_sequence"):
    assert forbidden not in text, f"OpenTofu must never own application objects: {forbidden}"
assert text.count('resource "postgresql_role"') == 1
assert text.count('resource "postgresql_database"') == 1
assert text.count('resource "postgresql_grant"') == 1
assert text.count("prevent_destroy = true") == 3
assert "password_wo" in text and "password_wo_version" in text
assert 'path = "/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate"' in text
assert 'version = "1.27.0"' in text
guard = (root / "validate-plan.sh").read_text(encoding="utf-8")
for address in ("postgresql_database.wotb", "postgresql_role.control_api", "postgresql_grant.control_api_database_access"):
    assert address in guard, address
assert '"delete" in actions' in guard
assert "rotatable" in guard
assert "require_no_changes" in guard
mirror = tofurc.read_text(encoding="utf-8")
assert "filesystem_mirror" in mirror
assert 'include = ["registry.opentofu.org/cyrilgdn/postgresql"]' in mirror
assert 'exclude = ["registry.opentofu.org/cyrilgdn/postgresql"]' in mirror
print("business-postgres OpenTofu ownership, mirror, and plan-policy contract OK")
PY

echo "== Disposable PostgreSQL 18 runtime =="
docker run -d --name "$NAME" \
  -e POSTGRES_USER="$ADMIN_USER" \
  -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
  -e POSTGRES_DB=postgres \
  -p "127.0.0.1:$PORT:5432" \
  postgres:18-alpine >/dev/null
CONTAINER_STARTED=1
ready="false"
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U "$ADMIN_USER" -d postgres >/dev/null 2>&1; then
    ready="true"
    break
  fi
  sleep 1
done
[ "$ready" = "true" ] || fail "disposable PostgreSQL did not become ready"
echo "disposable PostgreSQL 18 ready on 127.0.0.1:$PORT"

echo "== Business PostgreSQL OpenTofu apply =="
export TF_VAR_postgresql_port="$PORT"
export TF_VAR_postgresql_admin_username="$ADMIN_USER"
export TF_VAR_postgresql_admin_password="$ADMIN_PASSWORD"
export TF_VAR_business_role_password="$APP_PASSWORD"
export TF_VAR_business_role_password_version="1"
export TF_IN_AUTOMATION="true"
export CHECKPOINT_DISABLE="1"

MIRROR="$WORK/provider-mirror"
mkdir -p "$MIRROR"
"$TOFU" -chdir="$TOFU_ROOT" providers mirror "$MIRROR" >/dev/null
# The OpenTofu CLI config must carry a path in the host OS convention; Git Bash
# on Windows would otherwise write a POSIX path the Windows binary cannot open.
if command -v cygpath >/dev/null 2>&1; then
  MIRROR_FOR_CLI="$(cygpath -m "$MIRROR")"
else
  MIRROR_FOR_CLI="$MIRROR"
fi
sed "s|/opt/wotb-tx/tofu-provider-mirror|$MIRROR_FOR_CLI|" "$ROOT/deploy/tx/business-postgres.tofurc" > "$WORK/tofurc"
export TF_CLI_CONFIG_FILE="$WORK/tofurc"
export TF_DATA_DIR="$WORK/tofu-data"
"$TOFU" -chdir="$TOFU_ROOT" init -reconfigure -input=false -lockfile=readonly \
  -backend-config="path=$WORK/terraform.tfstate" >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" validate >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" plan -input=false -no-color -out="$WORK/plan.tfplan" >/dev/null
(
  cd "$TOFU_ROOT"
  bash ./validate-plan.sh "$WORK/plan.tfplan"
)
"$TOFU" -chdir="$TOFU_ROOT" apply -input=false -auto-approve "$WORK/plan.tfplan" >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" plan -input=false -no-color -out="$WORK/second-plan.tfplan" >/dev/null
(
  cd "$TOFU_ROOT"
  bash ./validate-plan.sh "$WORK/second-plan.tfplan" --require-no-changes
)

docker exec -i "$NAME" psql -U "$ADMIN_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  if exists (
    select 1 from pg_roles
     where rolname = '$APP_ROLE'
       and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception 'application role must be a non-privileged login role';
  end if;
  if not exists (select 1 from pg_roles where rolname = '$APP_ROLE' and rolcanlogin) then
    raise exception 'application role must be able to log in';
  end if;
  if not has_database_privilege('$APP_ROLE', '$DB_NAME', 'CONNECT')
     or not has_database_privilege('$APP_ROLE', '$DB_NAME', 'CREATE') then
    raise exception 'application role must hold CONNECT and CREATE on the business database';
  end if;
end \$\$;
create table flyway_owned_probe (id bigint generated by default as identity primary key);
insert into flyway_owned_probe default values;
drop table flyway_owned_probe;
SQL
echo "application role is non-privileged, can create application tables, and the second plan is clean"

echo "== Business database shape used for the restore smoke =="
docker exec -i "$NAME" psql -U "$ADMIN_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
create table hall_of_fame_record (
    id                 bigint generated by default as identity primary key,
    arena_id           varchar(32)  not null,
    tank_id            bigint       not null,
    tank_name          varchar(100) not null,
    account_id         bigint       not null,
    nickname           varchar(100) not null,
    damage_dealt       integer      not null,
    map_name           varchar(100),
    created_at         timestamp with time zone not null default now(),
    replay_uploaded_by varchar(64),
    constraint uk_hall_of_fame_record_arena_player unique (arena_id, account_id)
);
select setval(
  pg_get_serial_sequence('hall_of_fame_record', 'id'),
  355,
  true
);
insert into hall_of_fame_record
  (id, arena_id, tank_id, tank_name, account_id, nickname, damage_dealt, map_name, replay_uploaded_by)
overriding system value
values
  (1, 'arena-1', 6481, 'FV4005', 111, 'LegacyPlayer', 5000, 'rockfield', '3f1a4b2c-0000-4000-8000-000000000001'),
  (7, 'arena-2', 6481, 'FV4005', 222, 'OldPlayer', 3000, 'rockfield', null),
  (128, 'arena-3', 10001, 'T-62A', 333, 'MidPlayer', 4100, 'himmelsdorf', '9c2e6d70-0000-4000-8000-000000000002'),
  (355, 'arena-4', 10001, 'T-62A', 444, 'NewPlayer', 3900, 'himmelsdorf', null);
SQL

echo "== Backup, SHA-256, and restore smoke =="
export WOTB_TX_BUSINESS_POSTGRES_CONTAINER="$NAME"
export WOTB_TX_BUSINESS_POSTGRES_BACKUP_ROOT="$WORK/backups"
export TX_BUSINESS_DB_NAME="$DB_NAME"

backup_output="$(bash "$ROOT/deploy/tx/business-postgres-backup.sh")"
printf '%s\n' "$backup_output"
backup_file="$(find "$WORK/backups" -type f -name '*.dump' | head -n1)"
[ -n "$backup_file" ] || fail "backup script did not produce an archive"
[ -f "${backup_file}.sha256" ] || fail "backup script did not produce a SHA-256 sidecar"
[ "$(sha256sum "$backup_file" | awk '{print $1}')" = "$(tr -d '[:space:]' < "${backup_file}.sha256")" ] \
  || fail "recorded SHA-256 does not match the archive"

bash "$ROOT/deploy/tx/business-postgres-restore.sh" --file "$backup_file" --verify-only >/dev/null

set +e
same_database_output="$(bash "$ROOT/deploy/tx/business-postgres-restore.sh" \
  --file "$backup_file" --database "$DB_NAME" --confirm "RESTORE-$DB_NAME" 2>&1)"
same_database_rc=$?
set -e
[ "$same_database_rc" -ne 0 ] || fail "restore into the authoritative source database must be refused"
grep -Fq "Refusing to restore into the authoritative source database" <<< "$same_database_output" \
  || fail "restore must explain the source-database refusal"

bash "$ROOT/deploy/tx/business-postgres-restore.sh" \
  --file "$backup_file" --database "$SCRATCH_DB" --confirm "RESTORE-$SCRATCH_DB" >/dev/null

docker exec -i "$NAME" psql -U "$ADMIN_USER" -d "$SCRATCH_DB" -v ON_ERROR_STOP=1 <<SQL
do \$\$
declare
  rows          bigint;
  min_id        bigint;
  max_id        bigint;
  duplicate_keys bigint;
  uuid_rows     bigint;
  last_id       bigint;
  is_called     boolean;
begin
  select count(*), min(id), max(id),
         count(*) filter (where replay_uploaded_by is not null)
    into rows, min_id, max_id, uuid_rows
    from hall_of_fame_record;
  if rows <> 4 then raise exception 'expected 4 restored rows, found %', rows; end if;
  if min_id <> 1 or max_id <> 355 then
    raise exception 'explicit ids were not preserved: min=% max=%', min_id, max_id;
  end if;
  if uuid_rows <> 2 then
    raise exception 'literal replay_uploaded_by values were not preserved: %', uuid_rows;
  end if;

  select count(*) into duplicate_keys from (
    select arena_id, account_id from hall_of_fame_record group by 1, 2 having count(*) > 1
  ) duplicates;
  if duplicate_keys <> 0 then raise exception 'unique (arena_id, account_id) was violated'; end if;

  select last_value, is_called into last_id, is_called
    from pg_sequences
   where schemaname = 'public' and sequencename like 'hall_of_fame_record%';
  if last_id is null or last_id < max_id then
    raise exception 'identity sequence is behind max(id): last_value=% max_id=%', last_id, max_id;
  end if;

  -- The restored schema must accept new rows without an explicit id and must
  -- continue past the preserved maximum.
  insert into hall_of_fame_record
    (arena_id, tank_id, tank_name, account_id, nickname, damage_dealt, map_name)
  values ('arena-5', 10001, 'T-62A', 555, 'AfterRestore', 1200, 'himmelsdorf');
  if (select max(id) from hall_of_fame_record) <= max_id then
    raise exception 'identity sequence did not advance past the restored maximum';
  end if;
end \$\$;
SQL

if docker exec "$NAME" psql -U "$ADMIN_USER" -d "$SCRATCH_DB" -tAc \
  "select to_regclass('hall_of_fame_record') is not null" | grep -q '^t$'; then
  echo "restore verification: rows, explicit ids, unique key, literal UUIDs, and identity sequence OK"
else
  fail "restored schema is missing hall_of_fame_record"
fi

# The source database must still hold exactly its original rows.
source_rows="$(docker exec "$NAME" psql -U "$ADMIN_USER" -d "$DB_NAME" -tAc 'select count(*) from hall_of_fame_record')"
[ "$source_rows" = "4" ] || fail "source database was modified by backup/restore: $source_rows rows"

echo "BUSINESS_POSTGRES_SMOKE_PASS"
