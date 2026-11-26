#!/usr/bin/env bash
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
bash scripts/ci/run-with-network-retry.sh "Android native SDK installation" "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'ndk;27.3.13750724' 'cmake;3.22.1'
