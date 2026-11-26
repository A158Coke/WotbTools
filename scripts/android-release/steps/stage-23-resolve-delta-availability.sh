#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 36: Resolve optional Android delta availability).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
if [[ $DELTA_RESULTS =~ ^success(,success){8}$ ]]; then exit 0; fi
if [ "$EXISTING_EVIDENCE" = 200 ]; then
  echo "::error::Existing immutable delta cannot be verified or restored" >&2
  exit 1
fi
echo "::notice::Optional delta unavailable; stage the full APK only. Orphaned content-addressed files are retained."
jq '.patches = []' "$RUNNER_TEMP/delta-metadata.json" > "$RUNNER_TEMP/delta-metadata.json.tmp"
mv "$RUNNER_TEMP/delta-metadata.json.tmp" "$RUNNER_TEMP/delta-metadata.json"
