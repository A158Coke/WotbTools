#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 15: Validate signing config and restore keystore (fail-fast; secrets 不出现在日志)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail

# 1. 必需 secret 非空（在真正 Gradle build 前 fail-fast，避免跑到签名处才报错）
for v in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "::error::Missing required secret: $v"
    exit 1
  fi
done

# 2. 解码 keystore。用 printf（非 echo），避免换行/转义污染 base64。
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$RUNNER_TEMP"/keystore.jks

# 3. 解码后 keystore 必须非空。
if [ ! -s "$RUNNER_TEMP"/keystore.jks ]; then
  echo "::error::Decoded keystore is empty"
  exit 1
fi

# 4. keytool 用配置的 store password 找到配置的 alias（fail-fast）。不输出 keystore 内容。
if ! keytool -list -keystore "$RUNNER_TEMP"/keystore.jks \
    -storepass "$ANDROID_KEYSTORE_PASSWORD" \
    -alias "$ANDROID_KEY_ALIAS" >/dev/null 2>&1; then
  echo "::error::Signing key validation failed: keytool could not open keystore with alias '$ANDROID_KEY_ALIAS' using the configured store password. Check ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS."
  exit 1
fi

echo "Signing config validated (alias present)."
