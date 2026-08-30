#!/usr/bin/env bash
# Android release pre-flight / idempotency guards. Pure, no secrets, testable.
# Source this file in a bash step, then call the classifiers.
# A classifier sets a *_STATE variable and returns 0 for every known state;
# it returns non-zero only on an input/parse error (and prints ::error::).
# guard_min_supported returns non-zero on a guard violation.
set -euo pipefail

# guard_min_supported <min_supported_code> <new_code>
guard_min_supported() {
  local min_supported="$1" new_code="$2"
  if [ "$new_code" -ge "$min_supported" ]; then
    return 0
  fi
  echo "::error::versionCode $new_code is below ANDROID_MIN_SUPPORTED_VERSION_CODE=$min_supported" >&2
  return 1
}

# classify_prod <path_to_prod_version.json> <version_code> <version_name> <apk_name> <min_supported>
# Sets PROD_STATE:
#   prod_older            prod latestVersionCode < new    -> proceed to publish
#   prod_equal_ok         prod latest == new AND full metadata coherent -> already published (safe success)
#   prod_equal_conflict   prod latest == new AND metadata incoherent     -> fail
#   prod_newer            prod latestVersionCode > new    -> rollback -> fail
# Also sets PROD_PUBLISHED_SHA to the sha256 recorded in production version.json
# (used later to verify the already-published APK still matches).
classify_prod() {
  local json="$1" code="$2" name="$3" apk="$4" min="$5"
  local latest latest_name apk_url sha min_pub schema
  PROD_STATE=""
  PROD_PUBLISHED_SHA=""
  latest="$(jq -r '.latestVersionCode // empty' "$json" 2>/dev/null)" \
    || { echo "::error::Cannot parse production version.json" >&2; return 1; }
  if [ -z "$latest" ]; then
    echo "::error::Production version.json is missing latestVersionCode" >&2
    return 1
  fi
  if [ "$latest" -gt "$code" ]; then
    PROD_STATE="prod_newer"; return 0
  fi
  if [ "$latest" -lt "$code" ]; then
    PROD_STATE="prod_older"; return 0
  fi
  # latest == new: verify full metadata coherence before declaring "already published".
  latest_name="$(jq -r '.latestVersionName // empty' "$json" 2>/dev/null)"
  apk_url="$(jq -r '.apkUrl // empty' "$json" 2>/dev/null)"
  sha="$(jq -r '.sha256 // empty' "$json" 2>/dev/null)"
  PROD_PUBLISHED_SHA="$sha"
  min_pub="$(jq -r '.minSupportedVersionCode // empty' "$json" 2>/dev/null)"
  schema="$(jq -r '.schemaVersion // empty' "$json" 2>/dev/null)"
  local expected_url="https://wotbtools.com/download/android/$apk"
  if [ "$latest_name" = "$name" ] \
     && [ "$apk_url" = "$expected_url" ] \
     && [ -n "$sha" ] \
     && [ "$min_pub" = "$min" ] \
     && [ "$schema" = "1" ]; then
    PROD_STATE="prod_equal_ok"
  else
    PROD_STATE="prod_equal_conflict"
  fi
  return 0
}

# classify_prod_apk <prod_apk_sha> <build_sha>
# Sets APK_STATE:
#   apk_absent      no production APK            -> upload
#   apk_equal       prod APK SHA == build SHA    -> skip upload (resume)
#   apk_conflict    prod APK exists w/ diff SHA  -> immutable conflict -> fail
classify_prod_apk() {
  local prod_sha="$1" build_sha="$2"
  APK_STATE=""
  if [ -z "$prod_sha" ]; then
    APK_STATE="apk_absent"; return 0
  fi
  if [ "$prod_sha" = "$build_sha" ]; then
    APK_STATE="apk_equal"; return 0
  fi
  APK_STATE="apk_conflict"
  echo "::error::Production APK exists but SHA-256 differs from this build; immutable release conflict." >&2
  return 0
}

# classify_tag <refs_text> <tag_name> <target_commit>
# refs_text is the output of `git ls-remote --tags origin refs/tags/<tag>`,
# i.e. lines "<sha>\trefs/tags/<tag>" (plus an optional "<peeled>\trefs/tags/<tag>^{}").
# For an annotated tag the ^{} line carries the resolved COMMIT SHA; the plain
# "<sha>\trefs/tags/<tag>" line is the tag OBJECT SHA, which we must not compare.
# Sets TAG_STATE:
#   tag_absent      tag does not exist                        -> create
#   tag_equal       tag exists and points to the target commit -> resume
#   tag_conflict    tag exists but points elsewhere            -> fail (never repoint)
classify_tag() {
  local refs="$1" tag="$2" target="$3"
  local want="refs/tags/$tag"
  local sha
  TAG_STATE=""
  # Prefer the peeled ^{} COMMIT SHA (annotated tag); fall back to the tag ref
  # SHA for a lightweight tag (which points directly at a commit).
  sha="$(printf '%s\n' "$refs" | awk -F'\t' -v want="$want" '
    $2 == want       { obj = $1 }
    $2 == want "^{}" { peeled = $1 }
    END              { if (peeled != "") print peeled; else print obj }
  ')"
  if [ -z "$sha" ]; then
    TAG_STATE="tag_absent"; return 0
  fi
  if [ "$sha" = "$target" ]; then
    TAG_STATE="tag_equal"; return 0
  fi
  TAG_STATE="tag_conflict"
  echo "::error::Release tag $tag already exists but points to commit $sha (expected $target); refusing to repoint." >&2
  return 0
}
