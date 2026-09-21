#!/usr/bin/env bash
# Publish the already-loaded, already-verified immutable TX application image to
# Tencent TCR. Docker reads TCR credentials only from this host's credential store.
#
# One canonical artifact identity: the loaded image is the release reference the
# Build workflow verified the authoritative digest for, and this helper only derives
# the TCR immutable name from it. The final fail-closed gate stays the TCR manifest
# digest, which must equal the digest the Build workflow recorded for its one build.
set -euo pipefail

readonly TCR_REGISTRY="ccr.ccs.tencentyun.com"
readonly TCR_NAMESPACE="wotbtools"
readonly TCR_PUSH_TIMEOUT_SECONDS="${TCR_PUSH_TIMEOUT_SECONDS:-600}"
readonly DIGEST_TIMEOUT_SECONDS="${DIGEST_TIMEOUT_SECONDS:-60}"
readonly KILL_AFTER_SECONDS="${KILL_AFTER_SECONDS:-30}"

component=""
image_tag=""
expected_digest=""
loaded_image=""
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
  printf 'usage: %s <backend|frontend|keycloak> <sha-12> <sha256:digest> <loaded-image-ref>\n' "$0" >&2
  exit 2
}

[ "$#" -eq 4 ] || usage
component="$1"
image_tag="$2"
expected_digest="$3"
loaded_image="$4"

case "$component" in
  backend|frontend|keycloak) ;;
  *) fail "unsupported TX image component" ;;
esac
[[ "$image_tag" =~ ^sha-[0-9a-f]{12}$ ]] || fail "immutable image tag must be sha-<12 lowercase hex>"
[[ "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "expected digest must be sha256:<64 lowercase hex>"
# The transferred identity is the canonical registry reference of the verified
# release. It is validated the same way the TX import validated it, so this helper
# can only ever publish the exact artifact that import proved.
[[ "$loaded_image" =~ ^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)+:[a-z0-9][a-z0-9._-]*$ ]] \
  || fail "loaded image reference must be a lowercase <registry>/<repository>:<tag> reference without a registry port"
[ "${loaded_image##*:}" = "$image_tag" ] \
  || fail "loaded image reference must carry the immutable release tag $image_tag"
for setting in TCR_PUSH_TIMEOUT_SECONDS DIGEST_TIMEOUT_SECONDS KILL_AFTER_SECONDS; do
  is_positive_integer "${!setting}" || fail "$setting must be a positive integer"
done
command -v docker >/dev/null 2>&1 || fail "docker is required on TX"
command -v timeout >/dev/null 2>&1 || fail "timeout is required on TX"

readonly target_image="$TCR_REGISTRY/$TCR_NAMESPACE/wotbtools-$component:$image_tag"
readonly latest_image="$TCR_REGISTRY/$TCR_NAMESPACE/wotbtools-$component:latest"
[ "${loaded_image%:*}" != "${target_image%:*}" ] \
  || fail "loaded image reference must be the transferred release identity, not the TCR target"

publication_started_epoch="$(date -u +%s)"
printf 'component=%s\nstage=publication-start\nloaded_image=%s\n' "$component" "$loaded_image"

docker image inspect "$loaded_image" >/dev/null \
  || fail "expected transferred image is not loaded: $loaded_image"

printf 'component=%s\nstage=tag-immutable\n' "$component"
docker tag "$loaded_image" "$target_image" || fail "cannot tag the loaded release image for Tencent TCR"

printf 'component=%s\nstage=push-immutable\n' "$component"
timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$target_image" \
  || fail "TCR push failure for immutable image"

printf 'component=%s\nstage=verify-immutable\n' "$component"
target_digest="$(timeout --kill-after="${KILL_AFTER_SECONDS}s" "${DIGEST_TIMEOUT_SECONDS}s" \
  docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$target_image")" \
  || fail "target digest lookup failure"
[[ "$target_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "target digest lookup returned an invalid digest"
[ "$target_digest" = "$expected_digest" ] \
  || fail "digest mismatch expected=$expected_digest target=$target_digest"
printf 'component=%s\nstage=verify-immutable\nresult=PASS\ndigest=%s\n' \
  "$component" "$expected_digest"

printf 'component=%s\nstage=update-latest\n' "$component"
docker tag "$loaded_image" "$latest_image" || fail "cannot tag latest image for Tencent TCR"
timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$latest_image" \
  || fail "TCR latest update failure"

finish PASS
