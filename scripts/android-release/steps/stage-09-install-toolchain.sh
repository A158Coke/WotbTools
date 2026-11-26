#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 13: Install pinned Android native toolchain).
# Behavior is preserved; edit this script, not the workflow YAML.
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
bash scripts/ci/run-with-network-retry.sh "Android native SDK installation" "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'ndk;27.3.13750724' 'cmake;3.22.1'
