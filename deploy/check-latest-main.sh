#!/usr/bin/env bash
# Run immediately before publishing an application image as latest.
#
# Exit codes (the caller decides what to do with them):
#   0  publish: source SHA is current main, or main advanced without touching this
#      service's PRODUCTION_INPUT_PATHS (the image would be byte-for-byte the same build).
#   10 superseded: main advanced AND changed this service's inputs. Skip latest/deploy
#      without failing — the newer commit touched these paths, so its own run publishes.
#   *  real error (bad SHA, checkout mismatch, fetch failure, ...).
set -euo pipefail

SUPERSEDED=10

source_sha="${1:?source SHA is required}"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid source SHA.' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$source_sha" ]] || { echo 'Checkout no longer matches source SHA.' >&2; exit 1; }
git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
current_main="$(git rev-parse refs/remotes/origin/main)"

if [[ "$source_sha" == "$current_main" ]]; then
  echo "Publishing latest: source $source_sha is current main."
  exit 0
fi

skip() {
  echo "::notice title=latest skipped::$1"
  echo "Skipping latest publication: $1"
  exit "$SUPERSEDED"
}

git merge-base --is-ancestor "$source_sha" "$current_main" \
  || skip "source $source_sha is not an ancestor of current main $current_main."

input_paths=${PRODUCTION_INPUT_PATHS:-}
[[ -n "$input_paths" ]] || skip "main advanced to $current_main and PRODUCTION_INPUT_PATHS is not set."

pathspecs=()
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  [[ "$path" != -* ]] || { echo 'Input paths must not begin with a dash.' >&2; exit 1; }
  case "$path" in
    *'*'*|*'?'*|*'['*) pathspecs+=(":(glob)$path") ;;
    *) pathspecs+=("$path") ;;
  esac
done <<< "$input_paths"

diff_status=0
git diff --quiet "$source_sha" "$current_main" -- "${pathspecs[@]}" || diff_status=$?
case "$diff_status" in
  0)
    echo "Publishing latest: main advanced to $current_main but this service's inputs are unchanged since $source_sha."
    exit 0
    ;;
  1) skip "main advanced to $current_main and changed this service's inputs; the newer run publishes latest." ;;
  *)
    echo "Could not compare production-owned inputs (git diff exit $diff_status)." >&2
    exit "$diff_status"
    ;;
esac
