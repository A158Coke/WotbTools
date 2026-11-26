#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TARGET="${1:?usage: read-target-profile.sh <target> <github-output-file>}"
output="${2:?usage: read-target-profile.sh <target> <github-output-file>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
