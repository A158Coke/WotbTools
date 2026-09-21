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
case "$1" in
  image)
    [ "$2" = inspect ] || exit 24
    [ "${DOCKER_MODE:-success}" != local-image-missing ] || exit 18
    ;;
  tag) ;;
  push)
    if [ "${DOCKER_MODE:-success}" = immutable-push-fail ] && [[ "$2" == *:sha-* ]]; then
      exit 20
    fi
    if [ "${DOCKER_MODE:-success}" = latest-push-fail ] && [[ "$2" == *:latest ]]; then
      exit 21
    fi
    ;;
  buildx)
    [ "$2" = imagetools ] || exit 24
    image="${@: -1}"
    if [ "${DOCKER_MODE:-success}" = target-digest-fail ]; then
      exit 23
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
  local mode="$1" label="$2"
  set +e
  PATH="$WORK/bin:$PATH" DOCKER_MODE="$mode" DOCKER_LOG="$WORK/$label.log" \
    GHCR_IMAGE_PREFIX="$GHCR_PREFIX" \
    TCR_PUSH_TIMEOUT_SECONDS=1 TAG_LOOKUP_TIMEOUT_SECONDS=1 KILL_AFTER_SECONDS=1 \
    bash "$HELPER" backend sha-aaaaaaaaaaaa > "$WORK/$label.out" 2> "$WORK/$label.err"
  local rc=$?
  set -e
  return "$rc"
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

for mode in local-image-missing immutable-push-fail target-digest-fail target-digest-invalid; do
  if run_helper "$mode" "$mode"; then
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
  || fail "immutable push failure retried publication"

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
