#!/usr/bin/env bash
APK="android/app/build/outputs/apk/release/app-release.apk"
APK_NAME="$STEP_VERSION_APKNAME"
cp "$APK" "release-staging/$APK_NAME"
SHA256="$(sha256sum "release-staging/$APK_NAME" | awk '{print $1}')"
echo "sha256=$SHA256" >> "$GITHUB_OUTPUT"
echo "apkName=$APK_NAME" >> "$GITHUB_OUTPUT"
