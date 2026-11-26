#!/usr/bin/env bash
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
if [ -n "$INPUT_VERSION" ]; then
  echo "::notice::version input '$INPUT_VERSION' is ignored for mode=stage; staging uses the committed android/gradle.properties."
fi
