#!/usr/bin/env bash
# Read-only TX pre-cutover gate. It loads the existing TX deploy helpers and
# never stages, promotes, recreates, stops, deletes, or changes DNS.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SH="$SCRIPT_DIR/deploy.sh"
[ -f "$DEPLOY_SH" ] || {
  echo "PRE_CUTOVER_NOT_READY: sibling deploy.sh is missing from $SCRIPT_DIR" >&2
  exit 1
}

# Keep an explicitly supplied source root. Otherwise only infer the repository
# root when its Yecao compose and realm files prove that this is a checkout;
# promoted TX runtime layouts intentionally leave the source root unset and use
# the deployed Yecao bind contract next to docker-compose.yml.
if [ -z "${WOTB_SOURCE_ROOT:-}" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  if [ -f "$REPO_ROOT/deploy/docker-compose.prod.yml" ] \
    && [ -f "$REPO_ROOT/docker/keycloak/wotbtools-realm.json" ]; then
    export WOTB_SOURCE_ROOT="$REPO_ROOT"
  else
    unset WOTB_SOURCE_ROOT
  fi
fi
if [ -z "${WOTB_TX_DIR:-}" ] \
  && [ -f "$SCRIPT_DIR/docker-compose.yml" ] \
  && [ -f "$SCRIPT_DIR/yecao-backend-contract.json" ]; then
  export WOTB_TX_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
export TX_DEPLOY_LIBRARY_ONLY=1

# shellcheck disable=SC1091
source "$DEPLOY_SH"
pre_cutover_check
