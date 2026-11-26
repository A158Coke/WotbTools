#!/usr/bin/env bash
set -euo pipefail

for v in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "::error::Missing required secret: $v"
    exit 1
  fi
done

printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$RUNNER_TEMP"/keystore.jks

if [ ! -s "$RUNNER_TEMP"/keystore.jks ]; then
  echo "::error::Decoded keystore is empty"
  exit 1
fi

if ! keytool -list -keystore "$RUNNER_TEMP"/keystore.jks \
    -storepass "$ANDROID_KEYSTORE_PASSWORD" \
    -alias "$ANDROID_KEY_ALIAS" >/dev/null 2>&1; then
  echo "::error::Signing key validation failed: keytool could not open keystore with alias '$ANDROID_KEY_ALIAS' using the configured store password. Check ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS."
  exit 1
fi

echo "Signing config validated (alias present)."
