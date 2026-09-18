#!/usr/bin/env bash
set -euo pipefail

# Run one CI command with a small, fail-closed retry budget for transport-only
# failures. The command's original exit status is preserved for non-retryable
# failures and after the final retry.

network_retry_is_transport_failure() {
  local output="$1"

  grep -Eqi \
    '(HTTP[[:space:]]+(429|5[0-9][0-9])|status code:[[:space:]]*(429|5[0-9][0-9])|too many requests|toomanyrequests|bad gateway|service unavailable|gateway timeout|connection (reset|refused|timed out)|connection timeout|read timeout|connect timed out|TLS handshake timeout|i/o timeout|client\.timeout|could not (get|head) .* (https?://|artifact|repository)|failed to connect|network is unreachable|temporary failure|unexpected (end of stream|EOF)|remote host terminated)' \
    <<<"$output"
}

run_with_network_retry() {
  if (($# < 2)); then
    echo "usage: run_with_network_retry LABEL COMMAND [ARG ...]" >&2
    return 2
  fi

  local label="$1"
  shift
  local max_attempts="${NETWORK_RETRY_MAX_ATTEMPTS:-3}"
  local backoff_first="${NETWORK_RETRY_BACKOFF_FIRST_SECONDS:-5}"
  local backoff_later="${NETWORK_RETRY_BACKOFF_LATER_SECONDS:-15}"
  local attempt=1
  local output_file
  local output
  local status
  local backoff

  [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]] || {
    echo "ERROR: NETWORK_RETRY_MAX_ATTEMPTS must be a positive integer" >&2
    return 2
  }
  ((max_attempts <= 3)) || {
    echo "ERROR: NETWORK_RETRY_MAX_ATTEMPTS cannot exceed 3" >&2
    return 2
  }

  [[ "$backoff_first" =~ ^[0-9]+$ && "$backoff_later" =~ ^[0-9]+$ ]] || {
    echo "ERROR: network retry backoffs must be non-negative integers" >&2
    return 2
  }
  ((backoff_first <= 5 && backoff_later <= 15)) || {
    echo "ERROR: network retry backoffs cannot exceed 5s then 15s" >&2
    return 2
  }

  while ((attempt <= max_attempts)); do
    echo "Running $label (attempt $attempt/$max_attempts)"
    output_file="$(mktemp)"
    set +e
    "$@" >"$output_file" 2>&1
    status=$?
    set -e
    output="$(<"$output_file")"
    rm -f "$output_file"
    printf '%s\n' "$output"

    if ((status == 0)); then
      return 0
    fi

    if ((attempt >= max_attempts)) || ! network_retry_is_transport_failure "$output"; then
      return "$status"
    fi

    if ((attempt == 1)); then
      backoff="$backoff_first"
    else
      backoff="$backoff_later"
    fi
    echo "Transient transport failure detected for $label; retrying in ${backoff}s" >&2
    sleep "$backoff"
    ((attempt += 1))
  done

  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  run_with_network_retry "$@"
fi
