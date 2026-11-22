#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source deploy/periphery/periphery.release
[[ "$PERIPHERY_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid PERIPHERY_VERSION.' >&2; exit 1; }
[[ "$PERIPHERY_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid PERIPHERY_SHA256.' >&2; exit 1; }
[[ "$PERIPHERY_ASSET" == periphery-x86_64 ]] || { echo "Unsupported PERIPHERY_ASSET: $PERIPHERY_ASSET" >&2; exit 1; }
[[ "$PERIPHERY_RELEASE_TAG" == "v$PERIPHERY_VERSION" ]] || { echo 'PERIPHERY_RELEASE_TAG must be v${PERIPHERY_VERSION}.' >&2; exit 1; }
[[ "$PERIPHERY_URL" == "https://github.com/moghtech/komodo/releases/download/$PERIPHERY_RELEASE_TAG/$PERIPHERY_ASSET" ]] \
  || { echo 'PERIPHERY_URL does not match the pinned tag and asset.' >&2; exit 1; }
{
  echo "version=$PERIPHERY_VERSION"
  echo "asset=$PERIPHERY_ASSET"
  echo "sha256=$PERIPHERY_SHA256"
  echo "url=$PERIPHERY_URL"
} >> "$GITHUB_OUTPUT"
