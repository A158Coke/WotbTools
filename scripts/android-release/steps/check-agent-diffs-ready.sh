#!/usr/bin/env bash
# Fail-closed gate for the bundled version-diff page (5.8.0+).
# The Android APK embeds the frontend bundle; `?view=agent-version-diff` reads the
# production asset origin's /diffs tree. Documentation is not a release gate, so this
# runs in the stage preflight (before any immutable candidate exists) and again in
# publish readiness. The actual checks live in check_agent_diffs_ready.py.
#
# Usage: check-agent-diffs-ready.sh <assetOrigin> <wotbVersion>
set -euo pipefail
ORIGIN="${1:?asset origin is required}"
VERSION="${2:?wotbVersion is required}"
exec python3 scripts/android-release/check_agent_diffs_ready.py "$ORIGIN" "$VERSION"