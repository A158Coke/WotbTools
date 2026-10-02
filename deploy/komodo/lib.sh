#!/usr/bin/env bash
# Shared Komodo controller helper, sourced by `deploy.sh` and `reconcile.sh`.
#
# Every `/opt/komodo` path is created only when it does not exist at all. An
# existing path must be a real directory: a symlinked owner root, state
# directory, or backup directory would let a later promotion or cleanup escape
# the controller root, so it fails closed instead of following the link.
set -Eeuo pipefail

require_real_dir() {
  local path="$1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    install -d -m 700 "$path"
    return 0
  fi
  [[ -d "$path" && ! -L "$path" ]] || { echo "Refusing unsafe Komodo path: $path" >&2; exit 1; }
}
