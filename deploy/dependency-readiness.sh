#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PYTHON_PROBE_IMAGE="${WOTB_DEPENDENCY_PROBE_IMAGE:-python:3.13.7-alpine3.22}"
readonly POSTGRES_PROBE_IMAGE="${WOTB_POSTGRES_PROBE_IMAGE:-postgres:18-alpine}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || die "$name is required for read-only dependency readiness."
  export "$name"
}

run_protocol_probe() {
  local mode="$1" network="$2"
  shift 2
  timeout --foreground 180s docker run --rm --network "$network" \
    --volume "$SCRIPT_DIR/dependency-readiness.py:/probe.py:ro" \
    "$@" \
    "$PYTHON_PROBE_IMAGE" python3 /probe.py "$mode"
}

check_business_postgres() {
  require_env TX_BUSINESS_DB_NAME
  require_env TX_BUSINESS_DB_USERNAME
  require_env TX_BUSINESS_DB_PASSWORD
  local result
  if ! result="$(PGPASSWORD="$TX_BUSINESS_DB_PASSWORD" PGCONNECT_TIMEOUT=8 \
    timeout --foreground 60s docker run --rm \
    --network wotb_tx_internal --env PGPASSWORD --env PGCONNECT_TIMEOUT \
    --entrypoint psql "$POSTGRES_PROBE_IMAGE" \
    --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align \
    --host business-postgres --port 5432 --username "$TX_BUSINESS_DB_USERNAME" \
    --dbname "$TX_BUSINESS_DB_NAME" --command 'SELECT 1')"; then
    die "business-postgres: FAIL (application database credentials or query failed)"
  fi
  [ "$result" = 1 ] || die "business-postgres: FAIL (unexpected read-only query result)"
  echo "business-postgres-app-credentials: PASS"
}

check_business_api() {
  docker network inspect wotb_tx_internal >/dev/null 2>&1 \
    || die "TX application network wotb_tx_internal is unavailable."

  check_business_postgres

  export TX_RABBITMQ_HOST="${TX_RABBITMQ_HOST:-rabbitmq}"
  export TX_RABBITMQ_PORT="${TX_RABBITMQ_PORT:-5672}"
  export TX_RABBITMQ_VHOST="${TX_RABBITMQ_VHOST:-/wotbtools}"
  export TX_RABBITMQ_CONTROL_API_USER="${TX_RABBITMQ_CONTROL_API_USER:-control-api}"
  require_env TX_RABBITMQ_CONTROL_API_PASSWORD
  require_env YECAO_MINIO_CONTROL_API_ACCESS_KEY
  require_env YECAO_MINIO_CONTROL_API_SECRET_KEY
  require_env KEYCLOAK_ADMIN_CLIENT_SECRET
  export YECAO_MINIO_ENDPOINT="${YECAO_MINIO_ENDPOINT:-10.20.0.2:9000}"
  export YECAO_MINIO_BUCKET="${YECAO_MINIO_BUCKET:-wotbtools-temp}"
  run_protocol_probe business-api wotb_tx_internal \
    --env TX_RABBITMQ_HOST --env TX_RABBITMQ_PORT --env TX_RABBITMQ_VHOST \
    --env TX_RABBITMQ_CONTROL_API_USER --env TX_RABBITMQ_CONTROL_API_PASSWORD \
    --env YECAO_MINIO_ENDPOINT --env YECAO_MINIO_BUCKET \
    --env YECAO_MINIO_CONTROL_API_ACCESS_KEY --env YECAO_MINIO_CONTROL_API_SECRET_KEY \
    --env KEYCLOAK_ADMIN_CLIENT_SECRET
}

check_parser_worker() {
  docker network inspect wotb_internal >/dev/null 2>&1 \
    || die "Yecao application network wotb_internal is unavailable."

  export PARSER_WORKER_RABBITMQ_HOST="${PARSER_WORKER_RABBITMQ_HOST:-10.20.0.1}"
  export PARSER_WORKER_RABBITMQ_PORT="${PARSER_WORKER_RABBITMQ_PORT:-5672}"
  export PARSER_WORKER_RABBITMQ_VHOST="${PARSER_WORKER_RABBITMQ_VHOST:-/wotbtools}"
  export PARSER_WORKER_RABBITMQ_USERNAME="${PARSER_WORKER_RABBITMQ_USERNAME:-parser-worker}"
  export PARSER_WORKER_MINIO_ENDPOINT="${PARSER_WORKER_MINIO_ENDPOINT:-minio:9000}"
  export PARSER_WORKER_MINIO_BUCKET="${PARSER_WORKER_MINIO_BUCKET:-wotbtools-temp}"
  require_env TX_RABBITMQ_PARSER_WORKER_PASSWORD
  require_env YECAO_MINIO_WORKER_ACCESS_KEY
  require_env YECAO_MINIO_WORKER_SECRET_KEY
  run_protocol_probe parser-worker wotb_internal \
    --env PARSER_WORKER_RABBITMQ_HOST --env PARSER_WORKER_RABBITMQ_PORT \
    --env PARSER_WORKER_RABBITMQ_VHOST --env PARSER_WORKER_RABBITMQ_USERNAME \
    --env TX_RABBITMQ_PARSER_WORKER_PASSWORD \
    --env PARSER_WORKER_MINIO_ENDPOINT --env PARSER_WORKER_MINIO_BUCKET \
    --env YECAO_MINIO_WORKER_ACCESS_KEY --env YECAO_MINIO_WORKER_SECRET_KEY
}

check_keycloak_postgres() {
  docker network inspect wotb_tx_internal >/dev/null 2>&1 \
    || die "TX application network wotb_tx_internal is unavailable."
  if ! timeout --foreground 60s docker run --rm --network wotb_tx_internal \
    --entrypoint pg_isready "$POSTGRES_PROBE_IMAGE" \
    --host keycloak-postgres --port 5432 --timeout 8; then
    die "keycloak-postgres: FAIL (readiness check did not connect within 8 seconds)"
  fi
  echo "keycloak-postgres: PASS"
}

case "${1:-}" in
  business-api) check_business_api ;;
  keycloak) check_keycloak_postgres ;;
  parser-worker) check_parser_worker ;;
  *) die "usage: dependency-readiness.sh business-api|keycloak|parser-worker" ;;
esac
