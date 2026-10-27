#!/usr/bin/env bash
set -euo pipefail

MAX_TRACKED_FILE_BYTES="${MAX_TRACKED_FILE_BYTES:-5242880}"
ALLOWLIST_FILE="${LARGE_FILE_ALLOWLIST_FILE:-scripts/ci/large-file-allowlist.txt}"

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
    Python/*|.deepseek/*|common/assets/wasm/*|frontend/dist-android/*|dist/*|dist-desktop/*|target/*|*/target/*|node_modules/*|*/node_modules/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

violations=0
checked=0

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
    mib=$(awk -v bytes="$size" 'BEGIN { printf "%.2f", bytes / 1048576 }')
    limit_mib=$(awk -v bytes="$MAX_TRACKED_FILE_BYTES" 'BEGIN { printf "%.2f", bytes / 1048576 }')
    echo "ERROR: tracked file exceeds ${limit_mib} MiB limit: $path (${mib} MiB)" >&2
    echo "       If this is a deliberate source-of-truth asset, add the exact path to $ALLOWLIST_FILE with PR justification." >&2
    violations=$((violations + 1))
  fi
done < <(git ls-files -z)

if (( violations > 0 )); then
  echo "Repository hygiene check failed with $violations violation(s)." >&2
  exit 1
fi

echo "Repository hygiene check passed: $checked tracked files checked; limit=$MAX_TRACKED_FILE_BYTES bytes."
