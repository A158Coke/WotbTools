#!/usr/bin/env bash
set -euo pipefail

MAX_TRACKED_FILE_BYTES="${MAX_TRACKED_FILE_BYTES:-5242880}"
ALLOWLIST_FILE="${LARGE_FILE_ALLOWLIST_FILE:-scripts/ci/large-file-allowlist.txt}"
BASE_SHA="${BASE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-HEAD}"

if ! [[ "$MAX_TRACKED_FILE_BYTES" =~ ^[0-9]+$ ]]; then
  echo "MAX_TRACKED_FILE_BYTES must be an integer, got: $MAX_TRACKED_FILE_BYTES" >&2
  exit 2
fi

is_allowlisted() {
  local candidate="$1"
  [[ -f "$ALLOWLIST_FILE" ]] || return 1

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$candidate" == "$line" ]] && return 0
  done < "$ALLOWLIST_FILE"

  return 1
}

is_forbidden_path() {
  local path="$1"
  case "$path" in
    Python/*|.deepseek/*|common/assets/wasm/*|frontend/dist/*|frontend/dist-android/*|dist/*|dist-desktop/*|target/*|*/target/*|node_modules/*|*/node_modules/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

report_large_file() {
  local scope="$1"
  local path="$2"
  local size="$3"
  local mib limit_mib
  mib=$(awk -v bytes="$size" 'BEGIN { printf "%.2f", bytes / 1048576 }')
  limit_mib=$(awk -v bytes="$MAX_TRACKED_FILE_BYTES" 'BEGIN { printf "%.2f", bytes / 1048576 }')
  echo "ERROR: $scope exceeds ${limit_mib} MiB limit: $path (${mib} MiB)" >&2
  echo "       If this is a deliberate source-of-truth asset, add the exact path to $ALLOWLIST_FILE with PR justification." >&2
}

# PR CI initially checks out GitHub's synthetic merge ref. Resolve the actual
# base/head pair from the event payload so history checks cover the PR commits
# themselves, including blobs added and deleted before the final tree.
if [[ -z "$BASE_SHA" && "${GITHUB_EVENT_NAME:-}" == "pull_request" && -f "${GITHUB_EVENT_PATH:-}" ]]; then
  mapfile -t pr_range < <(
    python3 - "$GITHUB_EVENT_PATH" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    event = json.load(handle)
print(event["pull_request"]["base"]["sha"])
print(event["pull_request"]["head"]["sha"])
PY
  )
  BASE_SHA="${pr_range[0]:-}"
  HEAD_SHA="${pr_range[1]:-HEAD}"
fi

# workflow_dispatch and local full-history runs do not have a PR payload. When
# origin/main is available, use the merge-base as the comparison boundary.
if [[ -z "$BASE_SHA" ]] && git show-ref --verify --quiet refs/remotes/origin/main; then
  resolved_head=$(git rev-parse "$HEAD_SHA")
  BASE_SHA=$(git merge-base "$resolved_head" refs/remotes/origin/main)
  HEAD_SHA="$resolved_head"
fi

violations=0
checked=0

# Guard the final tracked tree. This catches generated paths even when every
# individual file is small enough to stay below the size threshold.
while IFS= read -r -d '' path; do
  [[ -f "$path" ]] || continue
  checked=$((checked + 1))

  if is_forbidden_path "$path"; then
    echo "ERROR: forbidden generated/runtime path is tracked: $path" >&2
    violations=$((violations + 1))
    continue
  fi

  size=$(wc -c < "$path")
  if (( size > MAX_TRACKED_FILE_BYTES )) && ! is_allowlisted "$path"; then
    report_large_file "tracked file" "$path" "$size"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z)

# Inspect every blob newly reachable from the PR head. A large blob committed in
# an intermediate commit remains in Git history even if a later commit deletes
# it, so final-tree-only checks are insufficient.
if [[ -n "$BASE_SHA" ]]; then
  git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || {
    echo "BASE_SHA is not an available commit: $BASE_SHA" >&2
    exit 2
  }
  git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null || {
    echo "HEAD_SHA is not an available commit: $HEAD_SHA" >&2
    exit 2
  }

  history_checked=0
  while IFS=' ' read -r oid type size path; do
    [[ "$type" == "blob" ]] || continue
    [[ -n "${path:-}" ]] || continue
    history_checked=$((history_checked + 1))

    if is_forbidden_path "$path"; then
      echo "ERROR: forbidden generated/runtime path entered PR history: $path" >&2
      violations=$((violations + 1))
      continue
    fi

    if (( size > MAX_TRACKED_FILE_BYTES )) && ! is_allowlisted "$path"; then
      report_large_file "new PR-history blob" "$path" "$size"
      violations=$((violations + 1))
    fi
  done < <(
    git rev-list --objects "${BASE_SHA}..${HEAD_SHA}" |
      git cat-file --batch-check='%(objectname) %(objecttype) %(objectsize) %(rest)'
  )

  echo "Repository history hygiene checked $history_checked newly reachable blob(s) in ${BASE_SHA}..${HEAD_SHA}."
fi

if (( violations > 0 )); then
  echo "Repository hygiene check failed with $violations violation(s)." >&2
  exit 1
fi

echo "Repository hygiene check passed: $checked tracked files checked; limit=$MAX_TRACKED_FILE_BYTES bytes."

# Keep the bypass scenarios executable in the same required CI path without
# recursing when the regression fixture invokes this checker in disposable repos.
if [[ "${CI:-}" == "true" && "${REPOSITORY_HYGIENE_TEST_CHILD:-0}" != "1" ]]; then
  bash scripts/ci/test-repository-hygiene.sh
fi
