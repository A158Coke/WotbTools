#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 35: Verify public Android delta).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
PATCH_NAME="$STEP_DELTA_PATCHNAME"
meta="$RUNNER_TEMP/delta-metadata.json"
bash deploy/assets/verify-android-download.sh --replica stable "$PATCH_NAME" \
  "$(jq -er '.patches[0].size' "$meta")" "$(jq -er '.patches[0].sha256' "$meta")"
