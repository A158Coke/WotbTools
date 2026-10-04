#!/usr/bin/env bash
# Audited staging-root helper for the production-worker owner (K7A).
#
# GitHub Actions reaches the staging root before any other worker code exists on the
# host, so this file is fed to the remote as a script (`script_path` in
# `.github/workflows/production-worker.yml`) and is also staged with the rest of
# `deploy/production-worker`. It is the single implementation of the staging path
# rule, with the target's root passed in (TX2 `/opt/wotb-tx2/production-worker`):
#
#   <root>, <root>/incoming, and <root>/incoming/<SOURCE_SHA> must all be real
#   directories, created mode 700.
#
# A symlinked component (including a dangling one), a regular file, or any other
# path type fails closed. Without that rule SCP could write, and cleanup could
# delete, outside the worker staging root.
#
# The root's parent belongs to the host's deploy owner, so the non-root TX2 SSH
# account can stage under it without a privileged write under /opt.
#
# Arguments may be positional (staged invocation) or environment-driven (the
# pre-SCP `script_path` invocation passes no argv):
#
#   staging-root.sh <prepare|verify|cleanup> <source-sha> [root]
#   WORKER_STAGING_ACTION=... SOURCE_SHA=... WORKER_STAGING_ROOT=... staging-root.sh
set -Eeuo pipefail
umask 077

action="${1:-${WORKER_STAGING_ACTION:-}}"
SOURCE_SHA="${2:-${SOURCE_SHA:-}}"
root="${3:-${WORKER_STAGING_ROOT:-}}"
[[ -n "$root" ]] || { echo 'A production-worker staging root is required.' >&2; exit 2; }
staging="$root/incoming/$SOURCE_SHA"

case "$action" in
  prepare|verify|cleanup) ;;
  *) echo "Unknown staging-root action: '${action}'." >&2; exit 2 ;;
esac
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Staging SHA must be a full lowercase 40-character commit SHA.' >&2
  exit 2
}
# The root is fixed in production and only overridden by local fixtures.
[[ "$root" == /* && "$root" != *..* ]] || { echo "Refusing unsafe staging root: $root" >&2; exit 2; }

# Create the component, or refuse to continue. An existing component must be a
# real directory: never a symlink (dangling included), never a regular file.
require_real_dir() {
  local path="$1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    install -d -m 700 "$path"
    return 0
  fi
  [[ -d "$path" && ! -L "$path" ]] || { echo "Refusing unsafe production-worker staging path: $path" >&2; exit 1; }
}

require_real_dir "$root"
require_real_dir "$root/incoming"

case "$action" in
  prepare)
    require_real_dir "$staging"
    echo "Production-worker staging root ready: $staging"
    ;;
  verify)
    [[ -d "$staging" && ! -L "$staging" ]] || {
      echo "Production-worker staging directory is missing or unsafe: $staging" >&2
      exit 1
    }
    echo "Production-worker staging root verified: $staging"
    ;;
  cleanup)
    # Only the SHA-scoped directory is ever removed, and only after both parents
    # were proven to be real directories. A missing staging directory is a no-op;
    # an unsafe one is never followed or deleted.
    if [[ -e "$staging" || -L "$staging" ]]; then
      [[ -d "$staging" && ! -L "$staging" ]] || {
        echo "Refusing to remove unsafe production-worker staging path: $staging" >&2
        exit 1
      }
      rm -rf -- "$staging"
    fi
    echo "Production-worker staging root cleaned: $staging"
    ;;
esac
