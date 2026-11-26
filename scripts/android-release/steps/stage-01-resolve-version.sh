#!/usr/bin/env bash
set -euo pipefail
export WOTB_COMMIT="$(git rev-parse HEAD)"
bash scripts/android-release/resolve-version.sh >> "$GITHUB_OUTPUT"
