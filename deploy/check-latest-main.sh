#!/usr/bin/env bash
# Run immediately before publishing an application image as latest.
set -euo pipefail

source_sha="${1:?source SHA is required}"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid source SHA.' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$source_sha" ]] || { echo 'Checkout no longer matches source SHA.' >&2; exit 1; }
git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
current_main="$(git rev-parse refs/remotes/origin/main)"
[[ "$source_sha" == "$current_main" ]] || {
  echo "Skipping latest publication: main advanced to $current_main." >&2
  exit 1
}
