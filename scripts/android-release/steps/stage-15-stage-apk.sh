#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 20: Compute SHA-256 and stage APK).
# Behavior is preserved; edit this script, not the workflow YAML.
APK="android/app/build/outputs/apk/release/app-release.apk"
APK_NAME="$STEP_VERSION_APKNAME"
cp "$APK" "release-staging/$APK_NAME"
SHA256="$(sha256sum "release-staging/$APK_NAME" | awk '{print $1}')"
echo "sha256=$SHA256" >> "$GITHUB_OUTPUT"
echo "apkName=$APK_NAME" >> "$GITHUB_OUTPUT"
