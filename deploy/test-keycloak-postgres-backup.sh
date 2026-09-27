#!/usr/bin/env bash
# Execute the production Keycloak backup script against disposable PostgreSQL.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="wotb-keycloak-backup-$RANDOM-$$"
WORK="$(mktemp -d)"
BACKUP_ROOT="$WORK/backups"
ADMIN_USER="backup_smoke"
ADMIN_PASSWORD="backup-smoke-password"
STARTED=0

fail() {
  echo "KEYCLOAK POSTGRES BACKUP SMOKE FAIL: $*" >&2
  [ "$STARTED" -eq 1 ] && docker logs --tail 80 "$NAME" >&2 || true
  exit 1
}

cleanup() {
  [ "$STARTED" -eq 0 ] || docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker is required"
docker run -d --name "$NAME" \
  -e POSTGRES_USER="$ADMIN_USER" \
  -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
  -e POSTGRES_DB=postgres postgres:18-alpine >/dev/null
STARTED=1

ready=false
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U "$ADMIN_USER" -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[ "$ready" = true ] || fail "disposable PostgreSQL did not become ready"

mkdir -p "$BACKUP_ROOT"
old_dump="$BACKUP_ROOT/keycloak-20000101T000000Z.dump"
old_checksum="${old_dump}.sha256"
other_file="$BACKUP_ROOT/other-database.dump"
old_directory="$BACKUP_ROOT/keycloak-19990101T000000Z.dump"
printf old > "$old_dump"
printf old > "$old_checksum"
printf keep > "$other_file"
mkdir "$old_directory"
touch -d '2 minutes ago' "$old_dump" "$old_checksum"
database_created=false
for _ in $(seq 1 30); do
  if docker exec "$NAME" createdb -U "$ADMIN_USER" keycloak >/dev/null 2>&1; then
    database_created=true
    break
  fi
  sleep 1
done
[ "$database_created" = true ] || fail "disposable keycloak database could not be created"
docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U "$ADMIN_USER" -d keycloak <<'SQL'
CREATE TABLE backup_smoke (id integer PRIMARY KEY, value text NOT NULL);
INSERT INTO backup_smoke VALUES (1, 'sentinel survives backup');
SQL

WOTB_TX_KEYCLOAK_POSTGRES_CONTAINER="$NAME" \
KC_POSTGRES_ADMIN_USER="$ADMIN_USER" \
KC_DB_NAME=keycloak \
WOTB_TX_KEYCLOAK_POSTGRES_BACKUP_ROOT="$BACKUP_ROOT" \
WOTB_TX_KEYCLOAK_POSTGRES_BACKUP_RETENTION_MINUTES=1 \
  bash "$ROOT/deploy/tx/keycloak-postgres-backup.sh"

mapfile -t dumps < <(find "$BACKUP_ROOT" -maxdepth 1 -type f \
  -regextype posix-extended -regex '.*/keycloak-[0-9]{8}T[0-9]{6}Z\.dump')
mapfile -t checksums < <(find "$BACKUP_ROOT" -maxdepth 1 -type f \
  -regextype posix-extended -regex '.*/keycloak-[0-9]{8}T[0-9]{6}Z\.dump\.sha256')
[ "${#dumps[@]}" -eq 1 ] || fail "expected one regular backup dump, found ${#dumps[@]}"
[ "${#checksums[@]}" -eq 1 ] || fail "expected one regular checksum, found ${#checksums[@]}"
backup="${dumps[0]}"
test -f "$backup" && test ! -d "$backup" || fail "dump is not a regular file"
test -f "${backup}.sha256" || fail "checksum is not a regular file"
expected="$(cat "${backup}.sha256")"
actual="$(sha256sum "$backup" | awk '{print $1}')"
test "$expected" = "$actual" || fail "checksum does not match"
docker exec -i "$NAME" pg_restore --list < "$backup" >/dev/null \
  || fail "pg_restore could not list the archive"
sentinel="$(docker exec "$NAME" psql -At -U "$ADMIN_USER" -d keycloak \
  -c "SELECT value FROM backup_smoke WHERE id = 1")"
test "$sentinel" = "sentinel survives backup" || fail "source sentinel changed"
test ! -e "$old_dump" && test ! -e "$old_checksum" || fail "expired canonical backups were retained"
test -f "$other_file" || fail "retention removed an unrelated file"
test -d "$old_directory" || fail "retention removed a directory"
test -f "$BACKUP_ROOT/.maintenance.lock" || fail "maintenance lock was removed"

echo "KEYCLOAK POSTGRES BACKUP SMOKE PASS: regular dump, checksum, archive, and source sentinel verified"
