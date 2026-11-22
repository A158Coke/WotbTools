#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 1: Resolve release metadata).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
export WOTB_COMMIT="$(git rev-parse HEAD)"
bash scripts/android-release/resolve-version.sh >> "$GITHUB_OUTPUT"
