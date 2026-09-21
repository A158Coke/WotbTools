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
#
# TCR is the only network boundary this helper owns, and production run 35663436097 showed
# `net/http: timeout awaiting response headers` failing an otherwise healthy publication
# after several layers had already been reported as pushed. The immutable push and its
# read-back therefore carry a small bounded retry for diagnosed transient failures only. A
# retried `docker push` reuses the layers TCR already accepted because the registry is
# content-addressed, so a retry is a re-upload of the remaining blobs - never a rebuild, a
# GHCR repush, an OCI retransmission or a reload. Every other step here is local and
# deterministic, has no retry, and nothing but the immutable tag can advance `latest`.
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
  printf 'usage: %s <backend|frontend|keycloak> <sha-12>\n' "$0" >&2
  exit 2
}

# Only a diagnosed transient registry/transport failure may be retried. An unknown or empty
# diagnostic, an authorization failure, a malformed request or a timeout kill all fail closed:
# a deterministic failure cannot be fixed by repeating it.
is_transient_tcr_failure() {
  grep -Eqi \
    '(timeout awaiting response headers|tls handshake timeout|i/o timeout|read timeout|write timeout|connection (reset|refused|timed out|timeout)|connection reset by peer|broken pipe|unexpected (end of stream|EOF)|remote host terminated|network is unreachable|temporary failure|server misbehaving|no such host|too many requests|toomanyrequests|(http|status code)[:= ]+(429|5[0-9][0-9])|(429|5[0-9][0-9])[[:space:]]+(too many requests|internal server error|bad gateway|service unavailable|gateway time-?out)|internal server error|bad gateway|service unavailable|gateway time-?out|received unexpected http status)' \
    <<<"$1"
}

# stage <name> <command...> - bounded retry for one TCR network boundary. Each attempt prints
# its own `attempt=n/max` line, a retried attempt adds `result=RETRY`, and the stage ends with a
# terminal `result=PASS` or `result=FAIL`, so GitHub Actions logs show the whole decision.
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
    # The command's status is this stage's decision, so it is captured in a condition
    # instead of toggling errexit for the whole shell.
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
  backend|frontend|keycloak) ;;
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

# The immutable push is the only retried publication boundary: TCR blob uploads time out
# under load, and the registry reuses every layer a previous attempt already accepted.
run_tcr_stage push-immutable \
  timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$target_image" \
  || fail "TCR push failure for immutable image after $RETRY_MAX_ATTEMPTS attempt(s)"

# The published immutable tag must be readable back from TCR. The lookup only has to
# resolve a well-formed manifest descriptor: the immutable tag is the release identity,
# so a missing or unreadable tag fails closed and `latest` is never advanced. The read-back
# crosses the same TCR network boundary as the push, so it carries the same bounded retry -
# kept as its own independently observable stage rather than merged with publication into
# one state machine.
target_digest=""
verify_immutable() {
  target_digest="$(timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TAG_LOOKUP_TIMEOUT_SECONDS}s" \
    docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$target_image")" \
    || return 1
  # A well-formed descriptor is part of the gate, so an invalid read-back is a failed
  # verification and not a value that may be carried forward.
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
