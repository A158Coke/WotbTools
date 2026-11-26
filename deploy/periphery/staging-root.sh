#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

action="${1:-${PERIPHERY_STAGING_ACTION:-}}"
SOURCE_SHA="${2:-${SOURCE_SHA:-}}"
root="${3:-${PERIPHERY_STAGING_ROOT:-}}"
[[ -n "$root" ]] || { echo 'A Komodo Periphery staging root is required.' >&2; exit 2; }
staging="$root/incoming/$SOURCE_SHA"

case "$action" in
  prepare|verify|cleanup) ;;
  *) echo "Unknown staging-root action: '${action}'." >&2; exit 2 ;;
esac
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Staging SHA must be a full lowercase 40-character commit SHA.' >&2
  exit 2
}
[[ "$root" == /* && "$root" != *..* ]] || { echo "Refusing unsafe staging root: $root" >&2; exit 2; }

require_real_dir() {
  local path="$1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    install -d -m 700 "$path"
    return 0
  fi
  [[ -d "$path" && ! -L "$path" ]] || { echo "Refusing unsafe Komodo Periphery staging path: $path" >&2; exit 1; }
}

require_real_dir "$root"
require_real_dir "$root/incoming"

case "$action" in
  prepare)
    require_real_dir "$staging"
    echo "Komodo Periphery staging root ready: $staging"
    ;;
  verify)
    [[ -d "$staging" && ! -L "$staging" ]] || {
      echo "Komodo Periphery staging directory is missing or unsafe: $staging" >&2
      exit 1
    }
    echo "Komodo Periphery staging root verified: $staging"
    ;;
  cleanup)
    if [[ -e "$staging" || -L "$staging" ]]; then
      [[ -d "$staging" && ! -L "$staging" ]] || {
        echo "Refusing to remove unsafe Komodo Periphery staging path: $staging" >&2
        exit 1
      }
      rm -rf -- "$staging"
    fi
    echo "Komodo Periphery staging root cleaned: $staging"
    ;;
esac
