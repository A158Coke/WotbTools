#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
LOCK="$ROOT/deploy.lock"
HELD="$ROOT/held"
WRAPPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tx/with-deploy-lock.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -x "$WRAPPER" ] || fail "TX deploy lock wrapper must be executable"

bash -c '
  set +e
  set +u
  set +o pipefail
  source "$1" >/dev/null 2>&1
  status=$?
  [ "$status" -eq 2 ] || exit 10
  case "$-" in
    *e*|*u*) exit 11 ;;
  esac
  set -o | grep -Eq "^pipefail[[:space:]]+off$"
' _ "$WRAPPER" || fail "sourcing the wrapper changed caller shell options"

WOTB_TX_DEPLOY_LOCK_FILE="$LOCK" bash "$WRAPPER" bash -c '
  test "${WOTB_DEPLOY_LOCK_FD:-}" = 9
  flock -n 9
'

flock -n "$LOCK" -c true || fail "wrapper leaked the TX deploy lock after command exit"

(
  exec 8>"$LOCK"
  flock 8
  : > "$HELD"
  sleep 2
) &
holder=$!

for _ in $(seq 1 100); do
  [ -f "$HELD" ] && break
  sleep 0.01
done
[ -f "$HELD" ] || fail "fixture holder did not acquire the lock"

set +e
output="$(WOTB_TX_DEPLOY_LOCK_FILE="$LOCK" WOTB_TX_DEPLOY_LOCK_WAIT_SEC=1 bash "$WRAPPER" true 2>&1)"
status=$?
set -e

[ "$status" -ne 0 ] || fail "wrapper entered while another process held the lock"
[[ "$output" == *"Another TX production deployment is running"* ]] || fail "contention diagnostic is missing"
[[ "$output" == *"waited 1s"* ]] || fail "bounded-wait timeout is not reported"

wait "$holder"
flock -n "$LOCK" -c true || fail "fixture lock did not release"

rm -f "$HELD"
(
  exec 8>"$LOCK"
  flock 8
  : > "$HELD"
  sleep 2
) &
short_holder=$!

for _ in $(seq 1 100); do
  [ -f "$HELD" ] && break
  sleep 0.01
done
[ -f "$HELD" ] || fail "short-lived fixture holder did not acquire the lock"

set +e
output="$(WOTB_TX_DEPLOY_LOCK_FILE="$LOCK" WOTB_TX_DEPLOY_LOCK_WAIT_SEC=30 bash "$WRAPPER" true 2>&1)"
status=$?
set -e

[ "$status" -eq 0 ] || fail "wrapper did not ride out a short-lived host lock holder: $output"

wait "$short_holder"
flock -n "$LOCK" -c true || fail "fixture lock did not release"

echo "TX deploy lock wrapper: PASS"
