#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 3: Validate source is main (workflow_dispatch)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
BUILD_SHA="$STEP_VERSION_COMMIT"
echo "Release source:"
echo "branch=main"
echo "commit=$BUILD_SHA"
echo "version=$STEP_VERSION_VERSIONNAME"
echo "versionCode=$STEP_VERSION_VERSIONCODE"
echo "tag=$STEP_VERSION_TAGNAME"
echo "apk=$STEP_VERSION_APKNAME"
git fetch origin main
ORIGIN_MAIN="$(git rev-parse origin/main)"
if [ "$BUILD_SHA" != "$ORIGIN_MAIN" ]; then
  echo "::error::Release must run from origin/main HEAD (checked out $BUILD_SHA != origin/main $ORIGIN_MAIN)." >&2
  exit 1
fi
# mode=stage 的版本权威永远是当前 main 的 android/gradle.properties：
# version 输入只在 mode=publish 有意义，这里显式忽略（重复 dispatch 时不会静默改变行为）。
if [ -n "$INPUT_VERSION" ]; then
  echo "::notice::version input '$INPUT_VERSION' is ignored for mode=stage; staging uses the committed android/gradle.properties."
fi
