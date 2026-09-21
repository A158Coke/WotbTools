#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/deploy/tx/publish-loaded-image-to-tcr.sh"
TRANSFER_HELPER="$ROOT/scripts/ci/transfer-oci-to-tx.sh"
WORK="$(mktemp -d)"
# One release identity: the immutable tag. The helper derives both the loaded GHCR
# reference and the TCR target from it; there is no TX-local image namespace and no
# digest is passed in or compared.
readonly GHCR_PREFIX="ghcr.io/a158coke/wotbtools"
readonly LOADED_IMAGE="$GHCR_PREFIX-backend:sha-aaaaaaaaaaaa"
readonly IMMUTABLE_TARGET="ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-aaaaaaaaaaaa"
readonly LATEST_TARGET="ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:latest"
trap 'rm -rf -- "$WORK"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

mkdir -p "$WORK/bin"
cat > "$WORK/bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
while [[ "$1" == --* || "$1" == *s ]]; do
  shift
done
exec "$@"
EOF
cat > "$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_LOG"
# Per-target attempt counters let a fixture fail the first attempt(s) and then succeed,
# while every invocation is still appended to the docker log above.
mkdir -p "$DOCKER_ATTEMPTS"
attempt_file="$DOCKER_ATTEMPTS/$(printf '%s' "$2" | tr -c 'a-zA-Z0-9' '_')"
current_attempt() {
  local seen=0
  [ ! -f "$attempt_file" ] || seen="$(<"$attempt_file")"
  seen=$((seen + 1))
  printf '%s\n' "$seen" > "$attempt_file"
  printf '%s\n' "$seen"
}
# The observed production failure: TCR accepts some layers and then the blob upload
# exceeds the response-header deadline.
transient_push_failure() {
  printf '%s\n' \
    "failed to copy: unexpected status from POST request to https://ccr.ccs.tencentyun.com/v2/wotbtools/wotbtools-backend/blobs/uploads/: 502 Bad Gateway" >&2
  exit 20
}
transient_lookup_failure() {
  printf '%s\n' \
    "ERROR: failed to do request: Head \"https://ccr.ccs.tencentyun.com/v2/wotbtools/wotbtools-backend/manifests/sha-aaaaaaaaaaaa\": net/http: timeout awaiting response headers" >&2
  exit 23
}
case "$1" in
  image)
    [ "$2" = inspect ] || exit 24
    [ "${DOCKER_MODE:-success}" != local-image-missing ] || exit 18
    ;;
  tag) ;;
  push)
    # Each guard is an explicit `if`: a bare `[[ ... ]] && exit` would itself fail the
    # fixture's `set -e` whenever the guard is false.
    case "${DOCKER_MODE:-success}" in
      immutable-push-fail)
        if [[ "$2" == *:sha-* ]]; then
          exit 20
        fi
        ;;
      immutable-push-permanent-fail)
        if [[ "$2" == *:sha-* ]]; then
          printf '%s\n' "denied: requested access to the resource is denied: 401 Unauthorized" >&2
          exit 20
        fi
        ;;
      transient-then-success)
        if [[ "$2" == *:sha-* ]] && [ "$(current_attempt)" -eq 1 ]; then
          transient_push_failure
        fi
        ;;
      transient-push-fail)
        if [[ "$2" == *:sha-* ]]; then
          transient_push_failure
        fi
        ;;
      push-timeout)
        if [[ "$2" == *:sha-* ]]; then
          printf '%s\n' "docker push timed out after 600s" >&2
          exit 124
        fi
        ;;
      latest-push-fail)
        if [[ "$2" == *:latest ]]; then
          exit 21
        fi
        ;;
    esac
    ;;
  buildx)
    [ "$2" = imagetools ] || exit 24
    image="${@: -1}"
    if [[ "$image" == *:sha-* ]]; then
      case "${DOCKER_MODE:-success}" in
        target-digest-fail) exit 23 ;;
        # A transient read-back that recovers on the second attempt, and one that never
        # does, so the bounded verification retry is observable in both directions.
        target-digest-transient-fail)
          if [ "$(current_attempt)" -eq 1 ]; then
            transient_lookup_failure
          fi
          ;;
        target-digest-transient-persist) transient_lookup_failure ;;
      esac
    fi
    if [ "${DOCKER_MODE:-success}" = target-digest-invalid ]; then
      printf '%s\n' not-a-manifest-digest
    else
      printf '%s\n' sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    fi
    ;;
  *) exit 24 ;;
esac
EOF
chmod 700 "$WORK/bin/timeout" "$WORK/bin/docker"

run_helper() {
  local mode="$1" label="$2" extra_env="${3:-}"
  local -a env_assignments=(
    PATH="$WORK/bin:$PATH"
    DOCKER_MODE="$mode"
    DOCKER_LOG="$WORK/$label.log"
    DOCKER_ATTEMPTS="$WORK/attempts.$label"
    GHCR_IMAGE_PREFIX="$GHCR_PREFIX"
    TCR_PUSH_TIMEOUT_SECONDS=1
    TAG_LOOKUP_TIMEOUT_SECONDS=1
    KILL_AFTER_SECONDS=1
  )
  # `local VAR=value` is already an assignment, so the payload of the caller-supplied
  # override list is appended as extra assignments for the helper invocation.
  local extra_assignment
  for extra_assignment in $extra_env; do
    env_assignments+=("$extra_assignment")
  done
  set +e
  env "${env_assignments[@]}" bash "$HELPER" backend sha-aaaaaaaaaaaa \
    > "$WORK/$label.out" 2> "$WORK/$label.err"
  local rc=$?
  set -e
  return "$rc"
}

# The retry decision lines are the log contract: component, stage, attempt and result must
# stay machine-readable for the Actions log, and a retried attempt must never be silent.
# A stage's PASS line is stdout and its RETRY/FAIL lines are stderr, so the helper's two
# streams are concatenated in order before the decision lines are inspected.
combined_log() {
  cat "$WORK/$1.out" "$WORK/$1.err"
}

assert_attempt_line() {
  local label="$1" stage="$2" attempt="$3" max="$4"
  grep -Fx "component=backend" "$WORK/$label.out" >/dev/null \
    || fail "$label lost the component line"
  # `if` keeps the awk status authoritative instead of the pipeline's last command.
  if combined_log "$label" | awk -v stage="$stage" -v attempt="$attempt" -v max="$max" '
    $0 == "stage=" stage { in_stage = 1; next }
    $0 ~ /^stage=/ { in_stage = 0 }
    in_stage && $0 == "attempt=" attempt "/" max { found = 1 }
    END { exit(found ? 0 : 1) }
  '; then
    return 0
  fi
  fail "$label is missing stage=$stage attempt=$attempt/$max"
}

assert_stage_result() {
  local label="$1" stage="$2" result="$3"
  if combined_log "$label" | awk -v stage="$stage" -v result="$result" '
    $0 == "stage=" stage { in_stage = 1; next }
    $0 ~ /^stage=/ { in_stage = 0 }
    in_stage && $0 == "result=" result { found = 1 }
    END { exit(found ? 0 : 1) }
  '; then
    return 0
  fi
  fail "$label is missing stage=$stage result=$result"
}

immutable_push_attempts() {
  local label="$1"
  grep -c "^push $IMMUTABLE_TARGET" "$WORK/$label.log" || true
}

run_helper success success || fail "success fixture failed: $(<"$WORK/success.err")"
grep -Fx "image inspect $LOADED_IMAGE" "$WORK/success.log" >/dev/null || fail "loaded image check missing"
grep -Fx "tag $LOADED_IMAGE $IMMUTABLE_TARGET" "$WORK/success.log" >/dev/null || fail "TCR immutable tag missing"
grep -Fx "push $IMMUTABLE_TARGET" "$WORK/success.log" >/dev/null || fail "TCR immutable push missing"
grep -Fx "tag $LOADED_IMAGE $LATEST_TARGET" "$WORK/success.log" >/dev/null || fail "TCR latest tag missing"
grep -Fx "push $LATEST_TARGET" "$WORK/success.log" >/dev/null || fail "TCR latest push missing"
[ "$(grep -c '^push ' "$WORK/success.log")" -eq 2 ] \
  || fail "TX publication must push exactly the TCR immutable and latest names"
target_digest_line="buildx imagetools inspect --format {{.Manifest.Digest}} $IMMUTABLE_TARGET"
latest_push_line="push $LATEST_TARGET"
[ "$(grep -nFx "$target_digest_line" "$WORK/success.log" | cut -d: -f1)" -lt "$(grep -nFx "$latest_push_line" "$WORK/success.log" | cut -d: -f1)" ] \
  || fail "the published TCR tag must be read back before latest update"
! grep -Eq '^pull ' "$WORK/success.log" || fail "TX publication must never pull an image"
! grep -Eqi 'crane' "$WORK/success.log" || fail "TX publication must not use crane"
# A healthy first attempt is not retried and needs no retry decision line.
[ "$(immutable_push_attempts success)" -eq 1 ] || fail "a successful immutable push was retried"
assert_stage_result success push-immutable PASS
assert_stage_result success verify-immutable PASS
[ "$(grep -c '^buildx imagetools ' "$WORK/success.log")" -eq 1 ] \
  || fail "the immutable tag read-back must run exactly once on success"
! grep -Fq 'result=RETRY' "$WORK/success.err" || fail "a successful publication logged a retry"

section_line() {
  local label="$1" section="$2"
  combined_log "$label" | grep -nFx "$section" | head -n 1 | cut -d: -f1
}

# The retried fixtures shorten only the backoff wait: the decision lines and
# `backoff_seconds=` still report the configured values, and attempts stay bounded at 3.
readonly FAST_RETRY="RETRY_BACKOFF_FIRST_SECONDS=0 RETRY_BACKOFF_LATER_SECONDS=0"

# A transient TCR failure (the production `timeout awaiting response headers` /
# 502 class) is retried in place: the helper never rebuilds, repushes to GHCR,
# re-transfers the OCI archive or reloads the image to get past it.
run_helper transient-then-success transient-then-success "$FAST_RETRY" \
  || fail "a transient immutable push failure was not retried: $(<"$WORK/transient-then-success.err")"
[ "$(immutable_push_attempts transient-then-success)" -eq 2 ] \
  || fail "a transient immutable push failure must be retried exactly once here"
[ "$(grep -c "^push $LATEST_TARGET" "$WORK/transient-then-success.log")" -eq 1 ] \
  || fail "latest must be pushed once after the retried immutable push succeeded"
assert_attempt_line transient-then-success push-immutable 1 3
assert_attempt_line transient-then-success push-immutable 2 3
assert_stage_result transient-then-success push-immutable PASS
assert_stage_result transient-then-success verify-immutable PASS
[ "$(grep -c '^buildx imagetools ' "$WORK/transient-then-success.log")" -eq 1 ] \
  || fail "the immutable verification must run after a retried push succeeded"
[ "$(section_line transient-then-success 'result=RETRY')" -gt \
  "$(section_line transient-then-success 'attempt=1/3')" ] \
  || fail "the retry decision must be logged for the failed attempt"
! grep -Eq '^(pull|load) ' "$WORK/transient-then-success.log" \
  || fail "the retry path must not pull or load any image"
[ "$(grep -c "^tag $LOADED_IMAGE" "$WORK/transient-then-success.log")" -eq 2 ] \
  || fail "the retry path must reuse the already-loaded image, not re-tag new material"

# A transient failure that persists must stop at the bounded budget and fail closed:
# no verification, no `latest`, and no unbounded repetition.
if run_helper transient-push-fail transient-push-fail "$FAST_RETRY"; then
  fail "transient-push-fail was accepted"
fi
[ "$(immutable_push_attempts transient-push-fail)" -eq 3 ] \
  || fail "a persisting transient immutable push failure must stop at 3 attempts"
[ "$(grep -c "^push $LATEST_TARGET" "$WORK/transient-push-fail.log")" -eq 0 ] \
  || fail "latest advanced after transient-push-fail"
assert_attempt_line transient-push-fail push-immutable 3 3
assert_stage_result transient-push-fail push-immutable FAIL
! combined_log transient-push-fail | grep -Fq 'result=PASS' \
  || fail "exhausted retries must not report a passing stage"
! combined_log transient-push-fail | grep -Fq 'stage=verify-immutable' \
  || fail "immutable verification ran after the immutable push failed"
! combined_log transient-push-fail | grep -Fq 'stage=update-latest' \
  || fail "latest update ran after the immutable push failed"
! grep -Fq ':latest' "$WORK/transient-push-fail.log" \
  || fail "latest was touched after an exhausted immutable push retry"
[ "$(grep -c '^push ' "$WORK/transient-push-fail.log")" -eq 3 ] \
  || fail "an exhausted retry must only ever push the immutable tag"

# A deterministic failure is not a transient boundary: a permanent registry rejection
# and a local timeout kill both fail on the first attempt.
for mode in immutable-push-permanent-fail push-timeout; do
  if run_helper "$mode" "$mode"; then
    fail "$mode was accepted"
  fi
  [ "$(immutable_push_attempts "$mode")" -eq 1 ] || fail "$mode must not be retried"
  [ "$(grep -c '^push ' "$WORK/$mode.log")" -eq 1 ] || fail "$mode pushed more than once"
  ! grep -Fq ':latest' "$WORK/$mode.log" || fail "latest changed after $mode"
  assert_stage_result "$mode" push-immutable FAIL
done

# The read-back shares the same transient network boundary and carries the same bounded
# retry, but only after the immutable tag was successfully published. A read-back that
# recovers on the second attempt still runs `latest`; one that never recovers fails closed
# after 3 attempts without touching `latest`, and without republishing the immutable tag.
run_helper target-digest-transient-fail target-digest-transient-fail "$FAST_RETRY" \
  || fail "a transient immutable read-back failure was not retried"
[ "$(grep -c '^buildx imagetools ' "$WORK/target-digest-transient-fail.log")" -eq 2 ] \
  || fail "a recoverable immutable read-back must stop retrying once it succeeds"
[ "$(immutable_push_attempts target-digest-transient-fail)" -eq 1 ] \
  || fail "a read-back retry must not republish the immutable tag"
[ "$(grep -c "^push $LATEST_TARGET" "$WORK/target-digest-transient-fail.log")" -eq 1 ] \
  || fail "latest must be pushed after the read-back eventually succeeded"
assert_attempt_line target-digest-transient-fail verify-immutable 1 3
assert_attempt_line target-digest-transient-fail verify-immutable 2 3
assert_stage_result target-digest-transient-fail verify-immutable PASS

if run_helper target-digest-transient-persist target-digest-transient-persist "$FAST_RETRY"; then
  fail "a persisting transient read-back failure was accepted"
fi
[ "$(grep -c '^buildx imagetools ' "$WORK/target-digest-transient-persist.log")" -eq 3 ] \
  || fail "the immutable read-back must stop at 3 attempts"
[ "$(immutable_push_attempts target-digest-transient-persist)" -eq 1 ] \
  || fail "a failed immutable read-back must not republish the immutable tag"
[ "$(grep -c "^push $LATEST_TARGET" "$WORK/target-digest-transient-persist.log")" -eq 0 ] \
  || fail "latest advanced after the immutable read-back failed"
assert_attempt_line target-digest-transient-persist verify-immutable 3 3
assert_stage_result target-digest-transient-persist verify-immutable FAIL
! combined_log target-digest-transient-persist | grep -Fq 'stage=update-latest' \
  || fail "latest update ran after the immutable read-back failed"

# Only the component and the immutable tag are accepted: an extra identity argument is
# not silently ignored, so no digest can creep back into this helper.
set +e
PATH="$WORK/bin:$PATH" bash "$HELPER" minio sha-aaaaaaaaaaaa > /dev/null 2>&1
bad_component_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend latest > /dev/null 2>&1
bad_tag_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-AAAAAAAAAAAA > /dev/null 2>&1
uppercase_tag_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend > /dev/null 2>&1
missing_tag_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-aaaaaaaaaaaa \
  sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > /dev/null 2>&1
extra_identity_rc=$?
set -e
[ "$bad_component_rc" -ne 0 ] || fail "unsupported component was accepted"
[ "$bad_tag_rc" -ne 0 ] || fail "mutable tag was accepted"
[ "$uppercase_tag_rc" -ne 0 ] || fail "a non-canonical immutable tag was accepted"
[ "$missing_tag_rc" -ne 0 ] || fail "a missing immutable tag was accepted"
[ "$extra_identity_rc" -ne 0 ] || fail "an extra identity argument was accepted"

for mode in local-image-missing immutable-push-fail target-digest-fail target-digest-invalid; do  if run_helper "$mode" "$mode"; then
    fail "$mode was accepted"
  fi
  ! grep -Fq ':latest' "$WORK/$mode.log" || fail "latest changed after $mode"
done
[ "$(grep -c '^push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-' "$WORK/target-digest-fail.log")" -eq 1 ] \
  || fail "a failed TCR tag read-back retried immutable publication"
[ "$(grep -c '^buildx imagetools ' "$WORK/target-digest-fail.log")" -eq 1 ] \
  || fail "a failed TCR tag read-back retried the tag lookup"
[ "$(grep -c '^push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-' "$WORK/target-digest-invalid.log")" -eq 1 ] \
  || fail "an unreadable TCR tag retried immutable publication"
[ "$(grep -c '^image inspect ' "$WORK/local-image-missing.log")" -eq 1 ] \
  || fail "loaded-image validation retried"
[ "$(grep -c '^push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-' "$WORK/immutable-push-fail.log")" -eq 1 ] \
  || fail "an undiagnosed immutable push failure must not be retried"

if run_helper latest-push-fail latest-push-fail; then
  fail "latest update failure was accepted"
fi
grep -Fx "$latest_push_line" "$WORK/latest-push-fail.log" >/dev/null || fail "latest push was not attempted"

# Publication is the last step and owns no transport: it neither transfers nor
# imports the OCI archive, so a publication failure can never retransmit it and no
# generic retry wrapper may sit around it.
helper_source="$(tr -d '\r' < "$HELPER")"
transfer_source="$(tr -d '\r' < "$TRANSFER_HELPER")"
for forbidden in rsync gzip "docker load" "transfer-oci-to-tx.sh" "run-with-network-retry" wotb-transfer; do
  case "$helper_source" in
    *"$forbidden"*) fail "TX publication must not contain '$forbidden'" ;;
  esac
done
# The published immutable tag is the only gate, so no image-id or expected-digest
# comparison may exist here either.
for forbidden in "{{.Id}}" expected_digest; do
  case "$helper_source" in
    *"$forbidden"*) fail "TX publication must not compare '$forbidden'" ;;
  esac
done
case "$transfer_source" in
  *"wotb-transfer"*) fail "the TX transfer helper must not keep a TX-local image namespace" ;;
esac
case "$helper_source" in
  *"docker system prune"*|*"docker image prune"*|*"volume prune"*) fail "TX publication must not prune Docker state" ;;
esac
case "$transfer_source" in
  *"publish-loaded-image-to-tcr.sh"*) fail "the TX transfer helper must not call TX publication" ;;
esac

printf 'TX loaded-image publication helper contract OK\n'
