#!/usr/bin/env bash
set -euo pipefail

ROOT="${WOTB_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STAGED_PROPERTIES="${WOTB_STAGED_PROPERTIES:-}"
REQUESTED="${WOTB_REQUESTED_VERSION:-}"

if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ "${GITHUB_JOB:-}" = "publish" ]; then
  mkdir -p "${GITHUB_WORKSPACE:-$ROOT}/release-staging"
fi

if [ -z "$STAGED_PROPERTIES" ]; then
  echo "::error::WOTB_STAGED_PROPERTIES is required (export it with: git archive <ref> -- android/gradle.properties | tar -x -C \"\$dir\")" >&2
  exit 1
fi
if [ ! -f "$STAGED_PROPERTIES" ]; then
  echo "::error::WOTB_STAGED_PROPERTIES=$STAGED_PROPERTIES does not exist (the tag target must contain android/gradle.properties)" >&2
  exit 1
fi
if [ -z "$REQUESTED" ]; then
  echo "::error::WOTB_REQUESTED_VERSION is required (publish must name the staged version explicitly)" >&2
  exit 1
fi

WOTB_ROOT="$ROOT" WOTB_TRIGGER=workflow_dispatch WOTB_TAG_NAME="" \
  WOTB_COMMIT="${WOTB_STAGED_REF:-}" WOTB_STAGED_REF="${WOTB_STAGED_REF:-}" \
  WOTB_STAGED_PROPERTIES="$STAGED_PROPERTIES" \
  WOTB_REQUESTED_VERSION="$REQUESTED" \
  bash "$ROOT/scripts/android-release/resolve-version.sh"
