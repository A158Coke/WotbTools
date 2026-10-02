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

  require_env KEYCLOAK_ADMIN_CLIENT_SECRET
  run_protocol_probe business-api wotb_tx_internal --env KEYCLOAK_ADMIN_CLIENT_SECRET
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
  *) die "usage: dependency-readiness.sh business-api|keycloak" ;;
esac
