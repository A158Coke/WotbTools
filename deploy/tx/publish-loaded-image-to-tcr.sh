#!/usr/bin/env bash
# Publish the already-loaded, already-verified immutable TX application image to
# Tencent TCR. Docker reads TCR credentials only from this host's credential store.
#
# Release identity is the immutable tag: this helper derives both the canonical GHCR
# reference the transfer loaded and the TCR reference it pushes from the component and
# `<sha-12>` tag it is given, so no identity value crosses the SSH boundary. The final
# gate is that the pushed TCR immutable tag exists; there is no image id, config digest
# or manifest digest comparison, because the archive SHA256 already proved the bytes and
# the immutable tag is what identifies the release.
set -euo pipefail

readonly GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:-ghcr.io/a158coke/wotbtools}"
readonly TCR_REGISTRY="ccr.ccs.tencentyun.com"
readonly TCR_NAMESPACE="wotbtools"
readonly TCR_PUSH_TIMEOUT_SECONDS="${TCR_PUSH_TIMEOUT_SECONDS:-600}"
readonly TAG_LOOKUP_TIMEOUT_SECONDS="${TAG_LOOKUP_TIMEOUT_SECONDS:-60}"
readonly KILL_AFTER_SECONDS="${KILL_AFTER_SECONDS:-30}"

component=""
image_tag=""
publication_started_epoch=""

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

finish() {
  local result="$1"
  local ended_epoch
  ended_epoch="$(date -u +%s)"
  printf 'component=%s\nstage=publication-end\nresult=%s\nelapsed_seconds=%s\n' \
    "$component" "$result" "$((ended_epoch - publication_started_epoch))"
}

fail() {
  local message="$1"
  if [ -n "$publication_started_epoch" ]; then
    finish FAIL >&2
  fi
  printf 'ERROR: component=%s %s\n' "${component:-unknown}" "$message" >&2
  exit 1
}

usage() {
  printf 'usage: %s <backend|frontend|keycloak> <sha-12>\n' "$0" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
component="$1"
image_tag="$2"

case "$component" in
  backend|frontend|keycloak) ;;
  *) fail "unsupported TX image component" ;;
esac
[[ "$image_tag" =~ ^sha-[0-9a-f]{12}$ ]] || fail "immutable image tag must be sha-<12 lowercase hex>"
for setting in TCR_PUSH_TIMEOUT_SECONDS TAG_LOOKUP_TIMEOUT_SECONDS KILL_AFTER_SECONDS; do
  is_positive_integer "${!setting}" || fail "$setting must be a positive integer"
done
command -v docker >/dev/null 2>&1 || fail "docker is required on TX"
command -v timeout >/dev/null 2>&1 || fail "timeout is required on TX"

# The loaded identity is the immutable reference the verified import brought in; the TCR
# names are the same immutable tag in the publication registry.
readonly loaded_image="$GHCR_IMAGE_PREFIX-$component:$image_tag"
readonly target_image="$TCR_REGISTRY/$TCR_NAMESPACE/wotbtools-$component:$image_tag"
readonly latest_image="$TCR_REGISTRY/$TCR_NAMESPACE/wotbtools-$component:latest"

publication_started_epoch="$(date -u +%s)"
printf 'component=%s\nstage=publication-start\nloaded_image=%s\n' "$component" "$loaded_image"

docker image inspect "$loaded_image" >/dev/null \
  || fail "expected transferred image is not loaded: $loaded_image"

printf 'component=%s\nstage=tag-immutable\n' "$component"
docker tag "$loaded_image" "$target_image" || fail "cannot tag the loaded release image for Tencent TCR"

printf 'component=%s\nstage=push-immutable\n' "$component"
timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$target_image" \
  || fail "TCR push failure for immutable image"

# The published immutable tag must be readable back from TCR. The lookup only has to
# resolve a well-formed manifest descriptor: the immutable tag is the release identity,
# so a missing or unreadable tag fails closed and `latest` is never advanced.
printf 'component=%s\nstage=verify-immutable\n' "$component"
target_digest="$(timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TAG_LOOKUP_TIMEOUT_SECONDS}s" \
  docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$target_image")" \
  || fail "the published TCR immutable tag is not readable: $target_image"
[[ "$target_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "target tag lookup returned an invalid manifest digest"
printf 'component=%s\nstage=verify-immutable\nresult=PASS\ntag=%s\n' \
  "$component" "$target_image"

printf 'component=%s\nstage=update-latest\n' "$component"
docker tag "$loaded_image" "$latest_image" || fail "cannot tag latest image for Tencent TCR"
timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$latest_image" \
  || fail "TCR latest update failure"

finish PASS
