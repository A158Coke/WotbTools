#!/usr/bin/env bash
# Read one reviewed production-worker target profile for the workflow (K7A).
#
# The workflow never inlines host parameters: it reads them from
# `deploy/production-worker/targets/<target>/target.env` through the same
# `load_target_profile` validation the host-side scripts use, so a profile that the
# host would reject can never be staged in the first place.
#
# Usage: read-target-profile.sh <target> <github-output-file>
set -Eeuo pipefail
umask 077

TARGET="${1:?usage: read-target-profile.sh <target> <github-output-file>}"
output="${2:?usage: read-target-profile.sh <target> <github-output-file>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/production-worker/lib.sh
source "$script_dir/lib.sh"

load_target_profile "$TARGET" "$script_dir"

{
  echo "target=$WORKER_TARGET"
  echo "lock_root=$WORKER_LOCK_ROOT"
  echo "staging_root=$WORKER_STAGING_ROOT"
  echo "compose_package=$WORKER_COMPOSE_PACKAGE"
  echo "docker_hub_mirror=$WORKER_DOCKER_HUB_MIRROR"
  echo "verify_image_repository=$WORKER_VERIFY_IMAGE_REPOSITORY"
  echo "verify_image_tag=$WORKER_VERIFY_IMAGE_TAG"
  echo "wireguard_address=$WORKER_WIREGUARD_ADDRESS"
  echo "required_endpoints=$WORKER_REQUIRED_ENDPOINTS"
  echo "ready_token=$WORKER_READY_TOKEN"
} >> "$output"

echo "Production-worker target profile ready: $WORKER_TARGET"
