#!/usr/bin/env bash
# Fail-closed input contract for the TX-local Keycloak OpenTofu runner.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT/deploy/tx/keycloak-tofu.sh"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
mkdir -p "$WORK/tofu-root"

run_expect_failure() {
  local label="$1" expected="$2"
  shift 2
  local output status
  set +e
  output="$(env -i PATH="$PATH" \
    KEYCLOAK_ADMIN_USERNAME=admin \
    KEYCLOAK_ADMIN_PASSWORD=not-real \
    KEYCLOAK_ADMIN_CLIENT_SECRET=not-real \
    KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION=1 \
    TX_QQ_CLIENT_ID=qq-client-id \
    TX_QQ_CLIENT_SECRET=qq-client-secret \
    TX_QQ_CLIENT_SECRET_VERSION=1 \
    "$@" bash "$RUNNER" "$WORK/tofu-root" 2>&1)"
  status=$?
  set -e
  [ "$status" -ne 0 ] || { echo "FAIL: $label must fail" >&2; exit 1; }
  grep -Fq "$expected" <<< "$output" \
    || { echo "FAIL: $label did not report $expected" >&2; exit 1; }
}

run_expect_failure "missing-client-id" 'TX_QQ_CLIENT_ID is required.' \
  env -u TX_QQ_CLIENT_ID
run_expect_failure "missing-client-secret" 'TX_QQ_CLIENT_SECRET is required.' \
  env -u TX_QQ_CLIENT_SECRET
run_expect_failure "missing-secret-version" 'TX_QQ_CLIENT_SECRET_VERSION is required.' \
  env -u TX_QQ_CLIENT_SECRET_VERSION
run_expect_failure "placeholder-client-id" 'TX_QQ_CLIENT_ID must be configured and must not be a placeholder.' \
  env TX_QQ_CLIENT_ID=bootstrap-not-configured
run_expect_failure "placeholder-client-secret" 'TX_QQ_CLIENT_SECRET must be configured and must not be a placeholder.' \
  env TX_QQ_CLIENT_SECRET=dummy
run_expect_failure "invalid-secret-version" 'TX_QQ_CLIENT_SECRET_VERSION must be a positive integer.' \
  env TX_QQ_CLIENT_SECRET_VERSION=0

echo "TX Keycloak OpenTofu QQ input contract OK"
