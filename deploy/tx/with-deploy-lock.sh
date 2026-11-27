#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "with-deploy-lock.sh must be executed, not sourced; sourcing could leak the production lock into an interactive shell." >&2
  return 2
fi

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

command -v flock >/dev/null 2>&1 || {
  echo "flock is required to serialize TX production mutations." >&2
  exit 2
}

lock_file="${WOTB_TX_DEPLOY_LOCK_FILE:-/opt/wotb-tx/.deploy.lock}"
lock_wait="${WOTB_TX_DEPLOY_LOCK_WAIT_SEC:-900}"
exec 9>"$lock_file"

if ! flock -w "$lock_wait" 9; then
  echo "Another TX production deployment is running; lock: $lock_file (waited ${lock_wait}s)" >&2
  if command -v lsof >/dev/null 2>&1; then
    echo "Current lock file holders:" >&2
    lsof "$lock_file" >&2 || true
  elif command -v fuser >/dev/null 2>&1; then
    echo "Current lock file holders:" >&2
    fuser -v "$lock_file" >&2 || true
  fi
  exit 1
fi

export WOTB_DEPLOY_LOCK_FD=9
exec "$@"
