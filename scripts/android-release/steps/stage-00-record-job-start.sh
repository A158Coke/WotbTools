#!/usr/bin/env bash
# Record the stage job start for release steps that share the job deadline.
set -euo pipefail
if [ -z "${GITHUB_ENV:-}" ]; then
  echo "::error::GITHUB_ENV is not set; cannot record JOB_START_EPOCH." >&2
  exit 1
fi
echo "JOB_START_EPOCH=$(date +%s)" >> "$GITHUB_ENV"
