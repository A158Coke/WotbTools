#!/usr/bin/env bash
set -Eeuo pipefail

readonly COMPOSE_DIR="${WOTB_COMPOSE_DIR:-/opt/wotb}"
readonly BACKUP_ROOT="${WOTB_BACKUP_ROOT:-/opt/wotb/backups}"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /opt/wotb/backups/<database>/<archive>.dump" >&2
  exit 2
fi

if [[ ! -d "$BACKUP_ROOT" || ! -f "$1" || -L "$1" ]]; then
  echo "Backup archive does not exist or is not a regular file: $1" >&2
  exit 1
fi

backup_root_real="$(realpath -e -- "$BACKUP_ROOT")"
backup_file_real="$(realpath -e -- "$1")"
case "$backup_file_real" in
  "$backup_root_real"/*) ;;
  *)
    echo "Backup archive must be inside $BACKUP_ROOT" >&2
    exit 1
    ;;
esac

if [[ ! -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
  echo "Missing compose file: $COMPOSE_DIR/docker-compose.yml" >&2
  exit 1
fi

cd "$COMPOSE_DIR"
docker compose up -d postgres >/dev/null

# Fully read/decompress the archive before printing its catalog. Neither command
# connects to or changes a database.
docker compose exec -T postgres pg_restore --file=/dev/null < "$backup_file_real"
docker compose exec -T postgres pg_restore --list < "$backup_file_real"
