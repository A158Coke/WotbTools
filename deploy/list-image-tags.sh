#!/usr/bin/env bash
# List the tags of one application image repository for the "reuse the immutable
# image" release gate.
#
# A repository that does not exist yet is NOT a registry failure: the first
# publish of a brand-new application repository must fall through to
# build + push. Every other failure (401/403/5xx/network/DNS) stays fatal so a
# broken or unauthorised registry can never be mistaken for an empty repository.
set -euo pipefail

REPOSITORY="${1:?usage: list-image-tags.sh <registry-repository>}"
command -v crane >/dev/null 2>&1 || { echo 'ERROR: crane is required to list registry tags.' >&2; exit 1; }

error_file="$(mktemp)"
trap 'rm -f -- "$error_file"' EXIT

status=0
tags="$(crane ls "$REPOSITORY" 2>"$error_file")" || status=$?
if [ "$status" -eq 0 ]; then
  if [ -n "$tags" ]; then
    printf '%s\n' "$tags"
  fi
  exit 0
fi

if grep -Fq 'NAME_UNKNOWN' "$error_file"; then
  # The registry explicitly reports the repository as unknown, so this is the
  # first publish. Emit nothing; the caller takes the build path.
  exit 0
fi

cat "$error_file" >&2
echo "ERROR: could not list tags for $REPOSITORY (crane exited $status)." >&2
exit 1
