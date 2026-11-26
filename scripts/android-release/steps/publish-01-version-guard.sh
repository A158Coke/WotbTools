#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 1: Guard: publish requires an explicit staged version).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
if [ -z "${REQUESTED_VERSION// /}" ]; then
  echo "::error::mode=publish requires an explicit version input (the immutable staged version, e.g. 2.0.1). Refusing to derive the publish candidate from current main." >&2
  exit 1
fi
if ! printf '%s' "$REQUESTED_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "::error::version input must be X.Y.Z (got '$REQUESTED_VERSION')." >&2
  exit 1
fi
echo "Publish candidate version: $REQUESTED_VERSION"
