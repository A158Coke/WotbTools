#!/usr/bin/env bash
# Android release pre-flight guards. Pure, no secrets, testable.
# Source this file in a bash step, then call the guard functions.
# A guard returns 0 on "ok", non-zero on violation (and prints ::error::).
set -euo pipefail

# --- pure predicates -----------------------------------------------------

# guard_monotonic <prod_latest_code> <new_code>
# Empty prod_latest means first release (no production version yet) -> allow.
guard_monotonic() {
  local prod_latest="$1" new_code="$2"
  if [ -z "$prod_latest" ] || [ "$new_code" -gt "$prod_latest" ]; then
    return 0
  fi
  echo "::error::Android version rollback rejected: production latestVersionCode=$prod_latest, new versionCode=$new_code" >&2
  return 1
}

# guard_min_supported <min_supported_code> <new_code>
guard_min_supported() {
  local min_supported="$1" new_code="$2"
  if [ "$new_code" -ge "$min_supported" ]; then
    return 0
  fi
  echo "::error::versionCode $new_code is below ANDROID_MIN_SUPPORTED_VERSION_CODE=$min_supported" >&2
  return 1
}

# guard_tag_absent <refs_text> <tag_name>
# refs_text is the output of `git ls-remote --tags origin refs/tags/<tag>`.
guard_tag_absent() {
  local refs="$1" tag="$2"
  if printf '%s\n' "$refs" | grep -Fxq "refs/tags/$tag"; then
    echo "::error::Release tag already exists: $tag" >&2
    return 1
  fi
  return 0
}

# --- thin wrappers (resolve external state, then pure predicate) ----------

# guard_prod_monotonic_file <path_to_prod_version_json> <new_code>
# Reads latestVersionCode from a downloaded production version.json (non-empty).
guard_prod_monotonic_file() {
  local json_file="$1" new_code="$2"
  local prod_latest
  prod_latest="$(jq -r '.latestVersionCode // empty' "$json_file" 2>/dev/null)" \
    || { echo "::error::Cannot parse production version.json" >&2; return 1; }
  if [ -z "$prod_latest" ]; then
    echo "::error::Production version.json is missing latestVersionCode" >&2
    return 1
  fi
  guard_monotonic "$prod_latest" "$new_code"
}
