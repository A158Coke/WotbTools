#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 17: Verify APK signature and signing certificate fingerprint).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
APK="android/app/build/outputs/apk/release/app-release.apk"
test -f "$APK" || { echo "::error::APK not found" >&2; exit 1; }
test -s "$APK" || { echo "::error::APK is empty" >&2; exit 1; }

APKSIGNER="$(find "$ANDROID_HOME/build-tools" -name apksigner | sort -V | tail -n 1)"
"$APKSIGNER" verify --verbose --print-certs "$APK"

# 提取 signer 证书 SHA-256（归一化为大写、去冒号）。指纹属公开证书信息，可输出。
CERT_FP="$( "$APKSIGNER" verify --print-certs "$APK" 2>/dev/null \
  | grep -i 'SHA-256 digest' \
  | head -n1 \
  | grep -oiE '[0-9a-fA-F]{64}' \
  | head -n1 \
  | tr 'a-f' 'A-F' )"
EXPECTED_FP="$(printf '%s' "$ANDROID_SIGNING_CERT_SHA256" | tr -d ':' | tr 'a-f' 'A-F')"

if [ -z "$EXPECTED_FP" ]; then
  echo "::error::ANDROID_SIGNING_CERT_SHA256 is not configured. Extract the fingerprint from the known production signing certificate and configure it as a GitHub Actions Variable." >&2
  exit 1
fi
if [ -z "$CERT_FP" ]; then
  echo "::error::Could not extract signing certificate SHA-256 fingerprint from APK." >&2
  exit 1
fi
if [ "$CERT_FP" != "$EXPECTED_FP" ]; then
  echo "::error::Android signing certificate mismatch: expected $ANDROID_SIGNING_CERT_SHA256, got $CERT_FP" >&2
  exit 1
fi
echo "Signing certificate SHA-256 verified (public fingerprint)."
