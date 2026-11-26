#!/usr/bin/env bash
set -euo pipefail
PATCH_NAME="$STEP_DELTA_PATCHNAME"
curl -fsSL --retry 3 --connect-timeout 10 --max-time 300 -o "$RUNNER_TEMP/delta-public.vcdiff" "https://wotbtools.com/download/android/$PATCH_NAME"
test "$(sha256sum "$RUNNER_TEMP/delta-public.vcdiff" | awk '{print $1}')" = "$(jq -r '.patches[0].sha256' "$RUNNER_TEMP/delta-metadata.json")"
test "$(wc -c < "$RUNNER_TEMP/delta-public.vcdiff")" -eq "$(jq -r '.patches[0].size' "$RUNNER_TEMP/delta-metadata.json")"
