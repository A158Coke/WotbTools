#!/usr/bin/env bash
# Read-only TX pre-cutover gate. It loads the existing TX deploy helpers and
# never stages, promotes, recreates, stops, deletes, or changes DNS.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export WOTB_SOURCE_ROOT="${WOTB_SOURCE_ROOT:-$ROOT}"
export TX_DEPLOY_LIBRARY_ONLY=1

# shellcheck disable=SC1091
source "$ROOT/deploy/tx/deploy.sh"
pre_cutover_check
