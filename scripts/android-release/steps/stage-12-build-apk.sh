#!/usr/bin/env bash
gradle assembleRelease \
  -PwotbKeystorePath="$RUNNER_TEMP/keystore.jks" \
  -PwotbKeystoreStorePass="$ANDROID_KEYSTORE_PASSWORD" \
  -PwotbKeyAlias="$ANDROID_KEY_ALIAS" \
  -PwotbKeyPass="$ANDROID_KEY_PASSWORD"
