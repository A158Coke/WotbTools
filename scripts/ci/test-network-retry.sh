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

echo "Network retry helper contract OK"
