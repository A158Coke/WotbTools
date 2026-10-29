#!/usr/bin/env bash
set -euo pipefail

# Decide whether an automatically staged Android candidate is still the current
# main release candidate. The normal CD path is latest-main-wins: historical
# staged candidates remain publishable only through the explicit manual recovery
# entrypoint.

STAGED_SHA="${1:-}"
MAIN_SHA="${2:-}"

if ! printf '%s' "$STAGED_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "invalid staged SHA: ${STAGED_SHA:-<empty>}" >&2
  exit 2
fi
if ! printf '%s' "$MAIN_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "invalid main SHA: ${MAIN_SHA:-<empty>}" >&2
  exit 2
fi

if [ "$STAGED_SHA" = "$MAIN_SHA" ]; then
  echo publish
else
  echo skip
fi
