#!/usr/bin/env bash
set -euo pipefail
if [ "$DELTA_RESULTS" = 'success,success,success,success,success,success,success,success' ]; then exit 0; fi
if [ "$EXISTING_EVIDENCE" = 200 ]; then
  echo "::error::Existing immutable delta cannot be verified or restored" >&2
  exit 1
fi
echo "::notice::Optional delta unavailable; stage the full APK only. Orphaned content-addressed files are retained."
jq '.patches = []' "$RUNNER_TEMP/delta-metadata.json" > "$RUNNER_TEMP/delta-metadata.json.tmp"
mv "$RUNNER_TEMP/delta-metadata.json.tmp" "$RUNNER_TEMP/delta-metadata.json"
