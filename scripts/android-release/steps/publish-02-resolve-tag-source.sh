#!/usr/bin/env bash
set -euo pipefail
TAG="android-v$REQUESTED_VERSION"
git fetch origin main --tags --force
REFS="$(git ls-remote --tags origin "refs/tags/$TAG")"
TAG_TARGET="$(printf '%s\n' "$REFS" | awk -F'\t' -v want="refs/tags/$TAG" '
  $2 == want       { obj = $1 }
  $2 == want "^{}" { peeled = $1 }
  END              { if (peeled != "") print peeled; else print obj }
')"
if [ -z "$TAG_TARGET" ]; then
  echo "::error::Release tag $TAG does not exist. Stage version $REQUESTED_VERSION before publishing it." >&2
  exit 1
fi
git cat-file -e "$TAG_TARGET^{commit}"
echo "tagName=$TAG" >> "$GITHUB_OUTPUT"
echo "apkName=wotbtools-android-v$REQUESTED_VERSION.apk" >> "$GITHUB_OUTPUT"
echo "stagingName=wotbtools-android-v$REQUESTED_VERSION.staging.json" >> "$GITHUB_OUTPUT"
echo "tagTarget=$TAG_TARGET" >> "$GITHUB_OUTPUT"

git archive "$TAG_TARGET" -- \
  android/gradle.properties \
  contracts/android-native-bridge.json \
  deploy/agent/source.json \
  android/app/src/main/java/com/wotbtools/app/AgentAssetProxy.kt \
  frontend/src/platform \
  android/app/src/main/java/com/wotbtools/app/NativeBridge.kt \
  android/app/src/main/java/com/wotbtools/app/MainActivity.kt \
  android/app/src/main/java/com/wotbtools/app/ReplayIntentHandler.kt \
  | tar -x -C "$RUNNER_TEMP"

WOTB_ROOT="$GITHUB_WORKSPACE" WOTB_TRIGGER=workflow_dispatch WOTB_TAG_NAME="" \
  WOTB_COMMIT="$TAG_TARGET" \
  WOTB_STAGED_REF="$TAG_TARGET" \
  WOTB_STAGED_PROPERTIES="$RUNNER_TEMP/android/gradle.properties" \
  WOTB_REQUESTED_VERSION="$REQUESTED_VERSION" \
  bash scripts/android-release/resolve-staged-version.sh >> "$GITHUB_OUTPUT"
grep -Fxq "tagName=$TAG" "$GITHUB_OUTPUT" || {
  echo "::error::Staged source resolved a tag that differs from the requested version $REQUESTED_VERSION" >&2
  exit 1
}
echo "Resolved $TAG -> $TAG_TARGET"
