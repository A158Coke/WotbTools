#!/usr/bin/env bash
# Audited staging-root helper for the Komodo controller owner.
#
# GitHub Actions reaches the staging root before any other controller code exists
# on the host, so this file is fed to the remote as a script (`script_path` in
# `.github/workflows/komodo-controller.yml`) and is also staged with the rest of
# `deploy/komodo`. It is the single implementation of the staging path rule:
#
#   `/opt/komodo`, `/opt/komodo/incoming`, and
#   `/opt/komodo/incoming/<SOURCE_SHA>` must be real directories.
#
# A symlinked component (including a dangling one), a regular file, or any other
# path type fails closed. Without that rule SCP could write, and cleanup could
# delete, outside the controller root.
#
# Arguments may be positional (staged invocation) or environment-driven (the
# pre-SCP `script_path` invocation passes no argv):
#
#   staging-root.sh <prepare|verify|cleanup> <source-sha> [root]
#   KOMODO_STAGING_ACTION=... SOURCE_SHA=... [KOMODO_STAGING_ROOT=...] staging-root.sh
set -Eeuo pipefail
umask 077

action="${1:-${KOMODO_STAGING_ACTION:-}}"
SOURCE_SHA="${2:-${SOURCE_SHA:-}}"
root="${3:-${KOMODO_STAGING_ROOT:-/opt/komodo}}"
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
  [[ -d "$path" && ! -L "$path" ]] || { echo "Refusing unsafe Komodo staging path: $path" >&2; exit 1; }
}

require_real_dir "$root"
require_real_dir "$root/incoming"

case "$action" in
  prepare)
    require_real_dir "$staging"
    echo "Komodo staging root ready: $staging"
    ;;
  verify)
    [[ -d "$staging" && ! -L "$staging" ]] || {
      echo "Komodo staging directory is missing or unsafe: $staging" >&2
      exit 1
    }
    echo "Komodo staging root verified: $staging"
    ;;
  cleanup)
    # Only the SHA-scoped directory is ever removed, and only after both parents
    # were proven to be real directories. A missing staging directory is a no-op;
    # an unsafe one is never followed or deleted.
    if [[ -e "$staging" || -L "$staging" ]]; then
      [[ -d "$staging" && ! -L "$staging" ]] || {
        echo "Refusing to remove unsafe Komodo staging path: $staging" >&2
        exit 1
      }
      rm -rf -- "$staging"
    fi
    echo "Komodo staging root cleaned: $staging"
    ;;
esac
