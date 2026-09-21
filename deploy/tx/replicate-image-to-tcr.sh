#!/usr/bin/env bash
# Replicate one immutable TX application image on the TX host.  Docker reads
# both GHCR and Tencent TCR credentials only from this host's credential store.
set -euo pipefail

readonly GHCR_REGISTRY="ghcr.io/a158coke"
readonly GHCR_REPOSITORY_PREFIX="wotbtools"
readonly TCR_REGISTRY="ccr.ccs.tencentyun.com"
readonly TCR_NAMESPACE="wotbtools"
readonly GHCR_PULL_ATTEMPTS="${GHCR_PULL_ATTEMPTS:-3}"
readonly GHCR_PULL_TIMEOUT_SECONDS="${GHCR_PULL_TIMEOUT_SECONDS:-240}"
readonly TCR_PUSH_TIMEOUT_SECONDS="${TCR_PUSH_TIMEOUT_SECONDS:-600}"
readonly DIGEST_TIMEOUT_SECONDS="${DIGEST_TIMEOUT_SECONDS:-60}"
readonly KILL_AFTER_SECONDS="${KILL_AFTER_SECONDS:-30}"

component=""
image_tag=""
replication_started_at=""
replication_started_epoch=""

timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

finish() {
  local result="$1"
  local ended_epoch
  ended_epoch="$(date -u +%s)"
  printf 'component=%s\nstage=replication-end\nresult=%s\nelapsed_seconds=%s\n' \
    "$component" "$result" "$((ended_epoch - replication_started_epoch))"
}

fail() {
  local message="$1"
  if [ -n "$replication_started_epoch" ]; then
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
for setting in GHCR_PULL_ATTEMPTS GHCR_PULL_TIMEOUT_SECONDS TCR_PUSH_TIMEOUT_SECONDS DIGEST_TIMEOUT_SECONDS KILL_AFTER_SECONDS; do
  is_positive_integer "${!setting}" || fail "$setting must be a positive integer"
done
command -v docker >/dev/null 2>&1 || fail "docker is required on TX"
command -v timeout >/dev/null 2>&1 || fail "timeout is required on TX"

readonly source_image="$GHCR_REGISTRY/$GHCR_REPOSITORY_PREFIX-$component:$image_tag"
readonly target_image="$TCR_REGISTRY/$TCR_NAMESPACE/wotbtools-$component:$image_tag"
readonly latest_image="$TCR_REGISTRY/$TCR_NAMESPACE/wotbtools-$component:latest"

replication_started_at="$(timestamp)"
replication_started_epoch="$(date -u +%s)"
printf 'component=%s\nstage=replication-start\nstarted_at=%s\n' "$component" "$replication_started_at"

pull_source_with_retry() {
  local attempt rc
  for ((attempt = 1; attempt <= GHCR_PULL_ATTEMPTS; attempt++)); do
    printf 'component=%s\nstage=pull-source\nattempt=%s\n' "$component" "$attempt"
    if timeout --kill-after="${KILL_AFTER_SECONDS}s" "${GHCR_PULL_TIMEOUT_SECONDS}s" docker pull "$source_image"; then
      return 0
    fi
    rc=$?
    printf 'component=%s\nstage=pull-source\nresult=FAIL\nattempt=%s\nexit_code=%s\n' \
      "$component" "$attempt" "$rc" >&2
    if [ "$attempt" -lt "$GHCR_PULL_ATTEMPTS" ]; then
      sleep "$attempt"
    fi
  done
  return 1
}

resolve_registry_digest() {
  local image="$1" digest
  digest="$(timeout --kill-after="${KILL_AFTER_SECONDS}s" "${DIGEST_TIMEOUT_SECONDS}s" \
    docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$image")" || return 1
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$digest"
}

pull_source_with_retry || fail "GHCR pull failure after ${GHCR_PULL_ATTEMPTS} attempts"

printf 'component=%s\nstage=push-immutable\n' "$component"
docker tag "$source_image" "$target_image" || fail "cannot tag immutable image for Tencent TCR"
timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$target_image" \
  || fail "TCR push failure for immutable image"

printf 'component=%s\nstage=verify-immutable\n' "$component"
source_digest="$(resolve_registry_digest "$source_image")" \
  || fail "source digest lookup failure"
target_digest="$(resolve_registry_digest "$target_image")" \
  || fail "target digest lookup failure"
[ "$source_digest" = "$target_digest" ] \
  || fail "digest mismatch source=$source_digest target=$target_digest"
printf 'component=%s\nstage=verify-immutable\nresult=PASS\ndigest=%s\n' "$component" "$source_digest"

printf 'component=%s\nstage=update-latest\n' "$component"
docker tag "$target_image" "$latest_image" || fail "cannot tag latest image for Tencent TCR"
timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$latest_image" \
  || fail "TCR latest update failure"

finish PASS
