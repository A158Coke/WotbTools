#!/usr/bin/env bash
# Explicit Yecao MinIO runtime reconcile. OpenTofu topology belongs to Tofu Apply.
set -Eeuo pipefail

ROOT="${1:-}"
WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
COMPOSE_FILE="$ROOT/deploy/docker-compose.minio.yml"
die() { echo "ERROR: $*" >&2; exit 1; }
require_env() { [ -n "${!1:-}" ] || die "$1 is required."; }

[ -n "$ROOT" ] && [ "$ROOT" != / ] && [ "$ROOT" != . ] || die "safe staged root is required."
[ "${WOTB_DEPLOY_SERVICE:-}" = minio ] || die "MinIO deploy requires WOTB_DEPLOY_SERVICE=minio."
require_env YECAO_MINIO_ROOT_USER
require_env YECAO_MINIO_ROOT_PASSWORD
[ -f "$COMPOSE_FILE" ] || die "MinIO compose file is missing."
command -v docker >/dev/null 2>&1 || die "docker is required."
command -v flock >/dev/null 2>&1 || die "flock is required."
command -v python3 >/dev/null 2>&1 || die "python3 is required."

mkdir -p "$WOTB_DIR"
if [ -n "${WOTB_DEPLOY_LOCK_FD:-}" ]; then
  [ "$WOTB_DEPLOY_LOCK_FD" = 9 ] || die "unsupported inherited deployment lock descriptor."
  { true >&9; } 2>/dev/null || die "inherited deployment lock descriptor is unavailable."
  flock -n 9 || die "another Yecao deployment is already running."
else
  exec 9>"$WOTB_DIR/.deploy.lock"
  flock -n 9 || die "another Yecao deployment is already running."
fi

# The MinIO data volume is authoritative; Compose must never create a new empty one.
volume=wotb_yecao_minio_data
docker compose -f "$COMPOSE_FILE" config --format json | python3 -c '
import json
import sys
data = json.load(sys.stdin)
assert data.get("name") == "wotb-yecao-minio"
assert data.get("volumes", {}).get("minio_data", {}).get("name") == "wotb_yecao_minio_data"
assert data.get("networks", {}).get("default", {}).get("name") == "wotb_internal"
assert data["networks"]["default"].get("external") is True
assert any(m.get("type") == "volume" and m.get("source") == "minio_data" and m.get("target") == "/data"
           for m in data["services"]["minio"].get("volumes", []))
' || die 'MinIO Compose persistence identity is invalid.'
docker volume inspect "$volume" >/dev/null 2>&1 || die "MinIO data volume is missing: $volume"
project="$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$volume")"
key="$(docker volume inspect --format '{{ index .Labels "com.docker.compose.volume" }}' "$volume")"
[ "$project" = wotb-yecao-minio ] && [ "$key" = minio_data ] || die 'MinIO data volume identity differs from the owner Compose project.'
docker network inspect wotb_internal >/dev/null 2>&1 || die 'Yecao runtime network is missing.'
container_id="$(docker compose -f "$COMPOSE_FILE" ps -aq minio)"
if [ -n "$container_id" ]; then
  mounted="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$container_id")"
  [ "$mounted" = "$volume" ] || die 'Running MinIO uses a different data volume.'
fi

docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" pull minio
docker compose -f "$COMPOSE_FILE" up -d --wait --no-deps minio \
  || die "MinIO failed readiness; runtime failed."

echo "MinIO runtime ready: image=latest"
