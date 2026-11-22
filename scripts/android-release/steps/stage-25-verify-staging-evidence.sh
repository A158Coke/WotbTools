#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 44: Verify production staging evidence (HTTP 200 + content)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
bash scripts/android-release/staging-evidence.sh collect-required "$STEP_STAGING_STAGINGNAME" "$RUNNER_TEMP/staging-origins.json" >/dev/null
cmp "$RUNNER_TEMP/staging-origins.json" "release-staging/$STEP_STAGING_STAGINGNAME"
URL="https://wotbtools.com/download/android/$STEP_STAGING_STAGINGNAME"
TMP_STAGING="$RUNNER_TEMP/prod-staging-verify.json"
curl -fsSL -o "$TMP_STAGING" "$URL"
cmp "$TMP_STAGING" "release-staging/$STEP_STAGING_STAGINGNAME" || {
  echo "::error::Production staging evidence differs from the verified immutable APK identity" >&2
  exit 1
}
echo "Staging evidence verified: the publish phase can prove this exact APK identity."
