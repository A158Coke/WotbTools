#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo 'Usage: check-production-freshness.sh SOURCE_SHA EVENT_NAME EVENT_REF EVENT_SHA' >&2
  exit 2
fi

source_sha=$1
event_name=$2
event_ref=$3
event_sha=$4
input_paths=${PRODUCTION_INPUT_PATHS:-}
[[ -n "$input_paths" ]] || { echo 'PRODUCTION_INPUT_PATHS is required.' >&2; exit 1; }

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Source SHA must be a full lowercase commit SHA.' >&2; exit 1; }
[[ "$event_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Event SHA must be a full lowercase commit SHA.' >&2; exit 1; }
[[ "$source_sha" == "$event_sha" ]] || { echo 'Source SHA differs from the triggering event SHA.' >&2; exit 1; }
[[ "$event_ref" == refs/heads/main ]] || { echo 'Production workflows require the main ref.' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$source_sha" ]] || { echo 'Checkout SHA differs from the event SHA.' >&2; exit 1; }

case "$event_name" in
  push|workflow_dispatch) ;;
  *) echo "Unsupported production workflow event: $event_name" >&2; exit 1 ;;
esac

pathspecs=()
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  [[ "$path" != -* ]] || { echo 'Input paths must not begin with a dash.' >&2; exit 1; }
  case "$path" in
    *'*'*|*'?'*|*'['*) pathspecs+=(":(glob)$path") ;;
    *) pathspecs+=("$path") ;;
  esac
done <<< "$input_paths"
[[ ${#pathspecs[@]} -gt 0 ]] || { echo 'At least one production input path is required.' >&2; exit 1; }

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
git cat-file -e "${source_sha}^{commit}"
git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
current_main="$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')"
[[ "$current_main" =~ ^[0-9a-f]{40}$ ]] || { echo 'Fetched main SHA is invalid.' >&2; exit 1; }

if [[ "$event_name" == workflow_dispatch && "$event_sha" != "$current_main" ]]; then
  echo 'Manual deployment must use the exact current main SHA.' >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$source_sha" "$current_main"; then
  echo 'Source SHA is not an ancestor of current main.' >&2
  exit 1
fi

diff_status=0
git diff --quiet "$source_sha" "$current_main" -- "${pathspecs[@]}" || diff_status=$?
case "$diff_status" in
  0) ;;
  1)
    echo 'Production-owned inputs changed after the workflow source SHA.' >&2
    exit 1
    ;;
  *)
    echo "Could not compare production-owned inputs (git diff exit $diff_status)." >&2
    exit "$diff_status"
    ;;
esac

echo "Production inputs are fresh for source $source_sha against current main $current_main."
