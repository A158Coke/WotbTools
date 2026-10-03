#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PYTHON_PROBE_IMAGE="${WOTB_DEPENDENCY_PROBE_IMAGE:-python:3.13.7-alpine3.22}"
readonly POSTGRES_PROBE_IMAGE="${WOTB_POSTGRES_PROBE_IMAGE:-postgres:18-alpine}"
# The canonical fail-closed logical endpoint validators live in the TX deploy
# helper. This read-only probe loads that file as a library instead of keeping a
# second allowlist that could drift from the one guarding the deployment.
readonly TX_DEPLOY_LIBRARY="$SCRIPT_DIR/tx/deploy.sh"
[ -f "$TX_DEPLOY_LIBRARY" ] \
  || { echo "ERROR: the TX deploy helper is missing: $TX_DEPLOY_LIBRARY" >&2; exit 1; }
# shellcheck disable=SC1090
TX_DEPLOY_LIBRARY_ONLY=1 source "$TX_DEPLOY_LIBRARY"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || die "$name is required for read-only dependency readiness."
  export "$name"
}

# Both probes carry a secret to a network endpoint: the PostgreSQL probe sends
# PGPASSWORD/TX_BUSINESS_DB_PASSWORD and the protocol probe sends
# KEYCLOAK_ADMIN_CLIENT_SECRET. The endpoints are therefore resolved and
# validated *before* any container starts, so a public or unreviewed placement
# can never receive a credential first and be rejected later by deploy.sh.
resolve_logical_endpoints() {
  export TX_BUSINESS_DB_HOST="${TX_BUSINESS_DB_HOST:-business-postgres}"
  export TX_BUSINESS_DB_PORT="${TX_BUSINESS_DB_PORT:-5432}"
  export TX_KEYCLOAK_ADMIN_SERVER_URL="${TX_KEYCLOAK_ADMIN_SERVER_URL:-http://keycloak:8080}"
  export TX_KEYCLOAK_DB_HOST="${TX_KEYCLOAK_DB_HOST:-keycloak-postgres}"
  export TX_KEYCLOAK_DB_PORT="${TX_KEYCLOAK_DB_PORT:-5432}"
}

validate_logical_endpoints() {
  local mode="$1"
  case "$mode" in
    business-api)
      validate_database_endpoint TX_BUSINESS_DB "$TX_BUSINESS_DB_HOST" "$TX_BUSINESS_DB_PORT" \
        business-postgres 5432 25432
      validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL "$TX_KEYCLOAK_ADMIN_SERVER_URL" \
        http://keycloak:8080 8080
      ;;
    keycloak)
      validate_database_endpoint TX_KEYCLOAK_DB "$TX_KEYCLOAK_DB_HOST" "$TX_KEYCLOAK_DB_PORT" \
        keycloak-postgres 5432 15432
      ;;
    *) die "unsupported dependency readiness mode: $mode" ;;
  esac
  echo "logical-endpoints: PASS ($mode)"
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
    --host "$TX_BUSINESS_DB_HOST" --port "$TX_BUSINESS_DB_PORT" --username "$TX_BUSINESS_DB_USERNAME" \
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
  # The probe never invents an endpoint: it only ever receives the value this
  # script validated above, and refuses to run without an explicit one.
  run_protocol_probe business-api wotb_tx_internal \
    --env KEYCLOAK_ADMIN_CLIENT_SECRET --env TX_KEYCLOAK_ADMIN_SERVER_URL
}

check_keycloak_postgres() {
  docker network inspect wotb_tx_internal >/dev/null 2>&1 \
    || die "TX application network wotb_tx_internal is unavailable."
  if ! timeout --foreground 60s docker run --rm --network wotb_tx_internal \
    --entrypoint pg_isready "$POSTGRES_PROBE_IMAGE" \
    --host "$TX_KEYCLOAK_DB_HOST" --port "$TX_KEYCLOAK_DB_PORT" --timeout 8; then
    die "keycloak-postgres: FAIL (readiness check did not connect within 8 seconds)"
  fi
  echo "keycloak-postgres: PASS"
}

case "${1:-}" in
  business-api)
    resolve_logical_endpoints
    validate_logical_endpoints business-api
    check_business_api
    ;;
  keycloak)
    resolve_logical_endpoints
    validate_logical_endpoints keycloak
    check_keycloak_postgres
    ;;
  *) die "usage: dependency-readiness.sh business-api|keycloak" ;;
esac
