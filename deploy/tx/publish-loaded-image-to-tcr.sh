#!/usr/bin/env bash
set -euo pipefail

readonly GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:-ghcr.io/a158coke/wotbtools}"
readonly TCR_REGISTRY="ccr.ccs.tencentyun.com"
readonly TCR_NAMESPACE="wotbtools"
readonly TCR_PUSH_TIMEOUT_SECONDS="${TCR_PUSH_TIMEOUT_SECONDS:-600}"
readonly TAG_LOOKUP_TIMEOUT_SECONDS="${TAG_LOOKUP_TIMEOUT_SECONDS:-60}"
readonly KILL_AFTER_SECONDS="${KILL_AFTER_SECONDS:-30}"
readonly RETRY_MAX_ATTEMPTS="${RETRY_MAX_ATTEMPTS:-3}"
readonly RETRY_BACKOFF_FIRST_SECONDS="${RETRY_BACKOFF_FIRST_SECONDS:-5}"
readonly RETRY_BACKOFF_LATER_SECONDS="${RETRY_BACKOFF_LATER_SECONDS:-15}"

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
  printf 'usage: %s <backend|keycloak> <sha-12>\n' "$0" >&2
  exit 2
}

is_transient_tcr_failure() {
  grep -Eqi \
    '(timeout awaiting response headers|tls handshake timeout|i/o timeout|read timeout|write timeout|connection (reset|refused|timed out|timeout)|connection reset by peer|broken pipe|unexpected (end of stream|EOF)|remote host terminated|network is unreachable|temporary failure|server misbehaving|no such host|too many requests|toomanyrequests|(http|status code)[:= ]+(429|5[0-9][0-9])|(429|5[0-9][0-9])[[:space:]]+(too many requests|internal server error|bad gateway|service unavailable|gateway time-?out)|internal server error|bad gateway|service unavailable|gateway time-?out|received unexpected http status)' \
    <<<"$1"
}

run_tcr_stage() {
  local stage_name="$1"
  local attempt=1
  local backoff
  local output_file
  local output

  while :; do
    printf 'component=%s\nstage=%s\nattempt=%s/%s\n' \
      "$component" "$stage_name" "$attempt" "$RETRY_MAX_ATTEMPTS"
    output_file="$(mktemp)"
    if "${@:2}" >"$output_file" 2>&1; then
      rm -f "$output_file"
      printf 'component=%s\nstage=%s\nresult=PASS\nattempts=%s\n' "$component" "$stage_name" "$attempt"
      return 0
    fi
    output="$(<"$output_file")"
    rm -f "$output_file"
    printf '%s\n' "$output" >&2
    if [ "$attempt" -ge "$RETRY_MAX_ATTEMPTS" ] \
      || ! is_transient_tcr_failure "$output"; then
      printf 'component=%s\nstage=%s\nresult=FAIL\nattempts=%s\n' "$component" "$stage_name" "$attempt" >&2
      return 1
    fi
    if [ "$attempt" -eq 1 ]; then
      backoff="$RETRY_BACKOFF_FIRST_SECONDS"
    else
      backoff="$RETRY_BACKOFF_LATER_SECONDS"
    fi
    printf 'component=%s\nstage=%s\nresult=RETRY\nattempt=%s/%s\nbackoff_seconds=%s\n' \
      "$component" "$stage_name" "$attempt" "$RETRY_MAX_ATTEMPTS" "$backoff" >&2
    sleep "$backoff"
    attempt=$((attempt + 1))
  done
}

[ "$#" -eq 2 ] || usage
component="$1"
image_tag="$2"

case "$component" in
  backend|keycloak) ;;
  *) fail "unsupported TX image component" ;;
esac
[[ "$image_tag" =~ ^sha-[0-9a-f]{12}$ ]] || fail "immutable image tag must be sha-<12 lowercase hex>"
for setting in TCR_PUSH_TIMEOUT_SECONDS TAG_LOOKUP_TIMEOUT_SECONDS KILL_AFTER_SECONDS; do
  is_positive_integer "${!setting}" || fail "$setting must be a positive integer"
done
is_positive_integer "$RETRY_MAX_ATTEMPTS" || fail "RETRY_MAX_ATTEMPTS must be a positive integer"
[ "$RETRY_MAX_ATTEMPTS" -le 3 ] || fail "RETRY_MAX_ATTEMPTS cannot exceed 3"
for setting in RETRY_BACKOFF_FIRST_SECONDS RETRY_BACKOFF_LATER_SECONDS; do
  [[ "${!setting}" =~ ^[0-9]+$ ]] || fail "$setting must be a non-negative integer"
done
command -v docker >/dev/null 2>&1 || fail "docker is required on TX"
command -v timeout >/dev/null 2>&1 || fail "timeout is required on TX"

readonly loaded_image="$GHCR_IMAGE_PREFIX-$component:$image_tag"
readonly target_image="$TCR_REGISTRY/$TCR_NAMESPACE/wotbtools-$component:$image_tag"
readonly latest_image="$TCR_REGISTRY/$TCR_NAMESPACE/wotbtools-$component:latest"

publication_started_epoch="$(date -u +%s)"
printf 'component=%s\nstage=publication-start\nloaded_image=%s\n' "$component" "$loaded_image"

docker image inspect "$loaded_image" >/dev/null \
  || fail "expected transferred image is not loaded: $loaded_image"

printf 'component=%s\nstage=tag-immutable\n' "$component"
docker tag "$loaded_image" "$target_image" || fail "cannot tag the loaded release image for Tencent TCR"

run_tcr_stage push-immutable \
  timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$target_image" \
  || fail "TCR push failure for immutable image after $RETRY_MAX_ATTEMPTS attempt(s)"

target_digest=""
verify_immutable() {
  target_digest="$(timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TAG_LOOKUP_TIMEOUT_SECONDS}s" \
    docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$target_image")" \
    || return 1
  [[ "$target_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
}

run_tcr_stage verify-immutable verify_immutable \
  || fail "the published TCR immutable tag is not readable: $target_image"
printf 'component=%s\nstage=verify-immutable\nresult=PASS\ntag=%s\n' \
  "$component" "$target_image"

printf 'component=%s\nstage=update-latest\n' "$component"
docker tag "$loaded_image" "$latest_image" || fail "cannot tag latest image for Tencent TCR"
timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$latest_image" \
  || fail "TCR latest update failure"

finish PASS
