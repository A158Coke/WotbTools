#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 4: Preflight classify production state (safe + idempotent)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
VERSION_CODE="$STEP_VERSION_VERSIONCODE"
VERSION_NAME="$STEP_VERSION_VERSIONNAME"
APK_NAME="$STEP_VERSION_APKNAME"
PROD_JSON="$RUNNER_TEMP/prod-version.json"
URL="https://wotbtools.com/download/android/version.json"
CODE="$(curl -s -o "$PROD_JSON" -w '%{http_code}' "$URL")"
. scripts/android-release/check-release-guards.sh
case "$CODE" in
  404)
    echo "First Android release: production version.json HTTP 404."
    PROD_STATE="prod_absent"
    ;;
  200)
    classify_prod "$PROD_JSON" "$VERSION_CODE" "$VERSION_NAME" "$APK_NAME" "$ANDROID_MIN_SUPPORTED_VERSION_CODE" "$STEP_VERSION_NATIVEBRIDGEVERSION" "$STEP_VERSION_COMMIT"
    ;;
  *)
    echo "::error::Unexpected HTTP $CODE fetching production version.json" >&2
    exit 1
    ;;
esac
guard_min_supported "$ANDROID_MIN_SUPPORTED_VERSION_CODE" "$VERSION_CODE"
guard_local_first_cutover "$ANDROID_MIN_SUPPORTED_VERSION_CODE" "$VERSION_CODE"

# 一个前端已不再支持的 bridge 版本必须靠 minSupportedVersionCode 强制更新：
# 否则发布出去的是一个「看起来兼容」的 manifest，而线上旧客户端继续用一个本
# 前端已经无法服务的 wire contract（version.json 的 nativeBridgeVersion 就是
# 线上客户端当前使用的 bridge 世代）。
PROD_BRIDGE=""
if [ -s "$PROD_JSON" ]; then
  PROD_BRIDGE="$(jq -r '.nativeBridgeVersion // empty' "$PROD_JSON" 2>/dev/null || true)"
fi
FE_VERSIONS="$(python3 - <<'PY'
import re
text = open('frontend/src/platform/nativeBridgeContract.js', encoding='utf-8').read()
match = re.search(r'SUPPORTED_NATIVE_BRIDGE_VERSIONS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)', text)
print(','.join(re.findall(r'\b[0-9]+\b', match.group(1))) if match else '')
PY
)"
guard_bridge_covered "$PROD_BRIDGE" "$STEP_VERSION_NATIVEBRIDGEVERSION" \
  "$FE_VERSIONS" "$ANDROID_MIN_SUPPORTED_VERSION_CODE" "$VERSION_CODE"
echo "Frontend-supported bridge versions: ${FE_VERSIONS:-none}; production bridge: ${PROD_BRIDGE:-none}"

# Reject an immutable release-tag conflict before expensive builds or any
# production APK mutation. A retry is allowed only when the tag is absent
# or already points at this exact source commit.
TAG="$STEP_VERSION_TAGNAME"
COMMIT_SHA="$STEP_VERSION_COMMIT"
REFS="$(git ls-remote --tags origin "refs/tags/$TAG")"
classify_tag "$REFS" "$TAG" "$COMMIT_SHA"
if [ "$TAG_STATE" = "tag_conflict" ]; then
  echo "::error::Release tag $TAG points to a different commit; refusing before build/upload." >&2
  exit 1
fi
echo "Release tag preflight: $TAG_STATE"

echo "Production state: $PROD_STATE"
case "$PROD_STATE" in
  prod_absent|prod_older)
    echo "No conflicting production version; proceeding to release."
    echo "releaseAction=publish" >> "$GITHUB_OUTPUT"
    ;;
  prod_equal_ok)
    # Same version & metadata coherent is NOT auto-success: verify the
    # already-published artifacts are still valid before no-op success.
    echo "Same version & metadata coherent; verifying existing release."
    PUBLISHED_SHA="$PROD_PUBLISHED_SHA"
    APK_URL="https://wotbtools.com/download/android/$APK_NAME"
    TMP_EXISTING="$RUNNER_TEMP/existing-release.apk"
    if ! curl -fsSL -o "$TMP_EXISTING" "$APK_URL" 2>/dev/null; then
      echo "::error::Existing release APK not reachable at apkUrl; refusing already-published." >&2
      exit 1
    fi
    test -s "$TMP_EXISTING" || { echo "::error::Existing release APK is empty; refusing already-published." >&2; exit 1; }
    ACTUAL_SHA="$(sha256sum "$TMP_EXISTING" | awk '{print $1}')"
    classify_prod_apk "$ACTUAL_SHA" "$PUBLISHED_SHA"
    case "$APK_STATE" in
      apk_equal)
        echo "Existing release APK SHA-256 matches published version.json."
        ;;
      apk_absent)
        echo "::error::Existing release APK missing; refusing already-published." >&2
        exit 1
        ;;
      apk_conflict)
        echo "::error::Existing release APK SHA-256 differs from published version.json; refusing already-published." >&2
        exit 1
        ;;
    esac
    TAG="$STEP_VERSION_TAGNAME"
    COMMIT_SHA="$STEP_VERSION_COMMIT"
    REFS="$(git ls-remote --tags origin "refs/tags/$TAG")"
    classify_tag "$REFS" "$TAG" "$COMMIT_SHA"
    if [ "$TAG_STATE" != "tag_equal" ]; then
      echo "::error::Existing release tag must exist and point to expected commit (got $TAG_STATE); refusing already-published." >&2
      exit 1
    fi
    echo "Existing release tag verified (points to expected commit)."
    echo "Existing release fully verified; safe success (no-op)."
    echo "releaseAction=already-published" >> "$GITHUB_OUTPUT"
    ;;
  prod_equal_conflict)
    echo "::error::Production version.json for the same versionCode does not match release metadata." >&2
    exit 1
    ;;
  prod_newer)
    echo "::error::Android release rollback rejected: production latestVersionCode is newer than this version." >&2
    exit 1
    ;;
esac
