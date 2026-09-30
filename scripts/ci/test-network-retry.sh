#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/ci/run-with-network-retry.sh"

NETWORK_RETRY_BACKOFF_FIRST_SECONDS=0
NETWORK_RETRY_BACKOFF_LATER_SECONDS=0
NETWORK_RETRY_MAX_ATTEMPTS=3

attempts=0
retry_after_429() {
  ((attempts += 1))
  if ((attempts < 3)); then
    echo "HTTP 429 Too Many Requests" >&2
    return 7
  fi
}

run_with_network_retry "429 fixture" retry_after_429
[[ "$attempts" == 3 ]]

attempts=0
retry_after_timeout() {
  ((attempts += 1))
  if ((attempts == 1)); then
    echo 'Client.Timeout exceeded while awaiting headers' >&2
    return 8
  fi
}

run_with_network_retry "timeout fixture" retry_after_timeout
[[ "$attempts" == 2 ]]

attempts=0
non_transport_failure() {
  ((attempts += 1))
  echo "Compilation error: failed test assertion" >&2
  return 9
}

if run_with_network_retry "compile fixture" non_transport_failure; then
  echo "expected non-transport failure" >&2
  exit 1
fi
[[ "$attempts" == 1 ]]

attempts=0
always_transport_failure() {
  ((attempts += 1))
  echo "HTTP 502 Bad Gateway" >&2
  return 10
}

if run_with_network_retry "bounded fixture" always_transport_failure; then
  echo "expected bounded failure" >&2
  exit 1
fi
[[ "$attempts" == 3 ]]

# Per-attempt bound (NETWORK_RETRY_TIMEOUT_SECONDS). The bound only exists when the
# caller asks for it, so the fixtures above already prove the default path still runs
# shell functions without a `timeout` wrapper. The cases below use real executables,
# because `timeout` cannot execute a shell function.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat > "$work/flaky" <<'FLAKY'
#!/usr/bin/env bash
set -euo pipefail
counter="$1"
attempts=0
[[ -f "$counter" ]] && attempts="$(<"$counter")"
attempts=$((attempts + 1))
printf '%s' "$attempts" > "$counter"
if ((attempts == 1)); then
  # Far beyond the 1s per-attempt bound: the first attempt must be killed as 124
  # and reported as a retryable transport failure even without any error text.
  sleep 30
fi
echo "external fixture finished on attempt $attempts"
FLAKY
chmod +x "$work/flaky"

counter="$work/counter"
NETWORK_RETRY_TIMEOUT_SECONDS=1 run_with_network_retry "per-attempt timeout fixture" "$work/flaky" "$counter"
[[ "$(<"$counter")" == 2 ]]

status=0
NETWORK_RETRY_TIMEOUT_SECONDS=1 run_with_network_retry "always timing out fixture" sleep 30 || status=$?
[[ "$status" == 124 ]]

# With a per-attempt bound the command must be an executable (a shell function cannot be
# wrapped by `timeout`), and a non-transport failure must still fail on the first attempt.
cat > "$work/compile-error" <<'COMPILE'
#!/usr/bin/env bash
set -euo pipefail
counter="$1"
attempts=0
[[ -f "$counter" ]] && attempts="$(<"$counter")"
printf '%s' "$((attempts + 1))" > "$counter"
echo "Compilation error: failed test assertion" >&2
exit 9
COMPILE
chmod +x "$work/compile-error"

counter="$work/compile-counter"
status=0
NETWORK_RETRY_TIMEOUT_SECONDS=5 run_with_network_retry "bounded compile fixture" "$work/compile-error" "$counter" || status=$?
[[ "$(<"$counter")" == 1 && "$status" == 9 ]]

status=0
NETWORK_RETRY_TIMEOUT_SECONDS=abc run_with_network_retry "invalid timeout fixture" true || status=$?
[[ "$status" == 2 ]]

status=0
NETWORK_RETRY_TIMEOUT_SECONDS=5 NETWORK_RETRY_KILL_AFTER_SECONDS=0 \
  run_with_network_retry "invalid kill-after fixture" true || status=$?
[[ "$status" == 2 ]]

# Regression guard for the unbounded callers: without a per-attempt bound a 124 exit is
# not ours to retry, so it must stay fail-closed on the first attempt exactly as before.
unset NETWORK_RETRY_TIMEOUT_SECONDS
cat > "$work/exits-124" <<'E124'
#!/usr/bin/env bash
set -euo pipefail
counter="$1"
attempts=0
[[ -f "$counter" ]] && attempts="$(<"$counter")"
printf '%s' "$((attempts + 1))" > "$counter"
exit 124
E124
chmod +x "$work/exits-124"

counter="$work/unbounded-124-counter"
status=0
run_with_network_retry "unbounded 124 fixture" "$work/exits-124" "$counter" || status=$?
[[ "$(<"$counter")" == 1 && "$status" == 124 ]]

echo "Network retry helper contract OK"
