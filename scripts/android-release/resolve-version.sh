#!/usr/bin/env bash
# Resolve Android release metadata from either a workflow_dispatch input or a
# android-vX.Y.Z tag. Pure logic (no secrets). Emits key=value lines on stdout,
# suitable for appending to $GITHUB_OUTPUT.
#
# Env inputs:
#   WOTB_TRIGGER        github.event_name ('workflow_dispatch' or 'push')
#   WOTB_INPUT_VERSION  dispatch -> 'X.Y.Z'; tag push -> github.ref_name 'android-vX.Y.Z'
#   WOTB_COMMIT         (optional) commit SHA to attach to the tag
set -euo pipefail

TRIGGER="${WOTB_TRIGGER:-}"
INPUT="${WOTB_INPUT_VERSION:-}"

die() { echo "::error::$*" >&2; exit 1; }

if [ -z "$TRIGGER" ]; then
  die "WOTB_TRIGGER is required"
fi

if [ "$TRIGGER" = "workflow_dispatch" ]; then
  VERSION="$INPUT"
elif [ "$TRIGGER" = "push" ]; then
  case "$INPUT" in
    android-v*) VERSION="${INPUT#android-v}" ;;
    *) die "Invalid Android release tag: expected android-vX.Y.Z, got '$INPUT'" ;;
  esac
else
  die "Unsupported trigger: $TRIGGER"
fi

# Strict canonical form: each segment is 0 or a non-zero-prefixed integer.
# Rejects 1, 1.0, v1.0.2, 1.0.2-rc1, 1.0.02, 01.0.2, 1.0.2.3.
if ! printf '%s' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  die "Invalid Android version: expected X.Y.Z (got '$VERSION')"
fi

# No leading zeros by construction, so arithmetic is decimal (never octal).
IFS=. read -r MAJOR MINOR PATCH <<< "$VERSION"

# versionCode = major*1_000_000 + minor*1_000 + patch.
# Keep the mapping injective (no collisions) by bounding minor/patch to one 3-digit
# slot each, and keep the final versionCode inside the Android/Play Store range.
# Bound segment widths first so bash integer compare never overflows for absurd input.
if [ "${#MAJOR}" -gt 4 ] || [ "${#MINOR}" -gt 3 ] || [ "${#PATCH}" -gt 3 ]; then
  die "Invalid Android version: major<=4 digits, minor/patch<=3 digits (got '$VERSION')"
fi
if [ "$MINOR" -gt 999 ] || [ "$PATCH" -gt 999 ]; then
  die "Invalid Android version: minor and patch must be 0..999 (got '$VERSION')"
fi

VERSION_CODE=$(( MAJOR * 1000000 + MINOR * 1000 + PATCH ))
if [ "$VERSION_CODE" -lt 1 ] || [ "$VERSION_CODE" -gt 2100000000 ]; then
  die "Invalid Android version: versionCode $VERSION_CODE out of range [1, 2100000000] (got '$VERSION')"
fi

TAG_NAME="android-v${VERSION}"
APK_NAME="wotbtools-android-v${VERSION}.apk"

echo "versionName=$VERSION"
echo "versionCode=$VERSION_CODE"
echo "tagName=$TAG_NAME"
echo "apkName=$APK_NAME"
printf 'commit=%s\n' "${WOTB_COMMIT:-}"
