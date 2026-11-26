#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 25: Verify production APK (HTTP 200 + non-empty + SHA matches)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
APK_NAME="$STEP_ARTIFACT_APKNAME"
EXPECTED_SHA="$STEP_ARTIFACT_SHA256"
size=$(stat -c %s "release-staging/$APK_NAME")
for attempt in 1 2 3 4 5; do
  if bash deploy/assets/verify-android-download.sh --replica stable "$APK_NAME" "$size" "$EXPECTED_SHA"; then exit 0; fi
  if [[ $attempt != 5 ]]; then sleep 5; fi
done
echo "::error::Stable download verification failed for $APK_NAME" >&2
exit 1
