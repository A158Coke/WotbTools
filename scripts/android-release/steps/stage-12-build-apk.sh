#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 16: Build signed release APK).
# Behavior is preserved; edit this script, not the workflow YAML.
gradle assembleRelease \
  -PwotbKeystorePath="$RUNNER_TEMP/keystore.jks" \
  -PwotbKeystoreStorePass="$ANDROID_KEYSTORE_PASSWORD" \
  -PwotbKeyAlias="$ANDROID_KEY_ALIAS" \
  -PwotbKeyPass="$ANDROID_KEY_PASSWORD"
