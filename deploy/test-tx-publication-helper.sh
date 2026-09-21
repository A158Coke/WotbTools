#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/deploy/tx/publish-loaded-image-to-tcr.sh"
TRANSFER_HELPER="$ROOT/scripts/ci/transfer-oci-to-tx.sh"
WORK="$(mktemp -d)"
readonly EXPECTED_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
# The loaded identity is the canonical release reference the Build workflow verified
# the authoritative digest for; there is no TX-local image namespace any more.
readonly LOADED_IMAGE="ghcr.io/a158coke/wotbtools-backend:sha-aaaaaaaaaaaa"
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
    if [ "${DOCKER_MODE:-success}" = digest-mismatch ]; then
      printf '%s\n' sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
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
    TCR_PUSH_TIMEOUT_SECONDS=1 DIGEST_TIMEOUT_SECONDS=1 KILL_AFTER_SECONDS=1 \
    bash "$HELPER" backend sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" "$LOADED_IMAGE" > "$WORK/$label.out" 2> "$WORK/$label.err"
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
  || fail "target digest must be resolved before latest update"
! grep -Eq '^pull ' "$WORK/success.log" || fail "TX publication must never pull an image"
! grep -Eqi 'crane' "$WORK/success.log" || fail "TX publication must not use crane"

set +e
PATH="$WORK/bin:$PATH" bash "$HELPER" minio sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" "$LOADED_IMAGE" > /dev/null 2>&1
bad_component_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend latest "$EXPECTED_DIGEST" "$LOADED_IMAGE" > /dev/null 2>&1
bad_tag_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-aaaaaaaaaaaa sha256:bad "$LOADED_IMAGE" > /dev/null 2>&1
bad_digest_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" > /dev/null 2>&1
missing_ref_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" "ghcr.io/a158coke/wotbtools-backend:latest" > /dev/null 2>&1
mutable_ref_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" "$IMMUTABLE_TARGET" > /dev/null 2>&1
tcr_ref_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" "ghcr.io/a158coke/wotbtools-backend:sha-FFFFFFFFFFFF" > /dev/null 2>&1
uppercase_ref_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" "ghcr.io/a158coke/wotbtools-backend:sha-aaaaaaaaaaaa; rm -rf /" > /dev/null 2>&1
injected_ref_rc=$?
set -e
[ "$bad_component_rc" -ne 0 ] || fail "unsupported component was accepted"
[ "$bad_tag_rc" -ne 0 ] || fail "mutable tag was accepted"
[ "$bad_digest_rc" -ne 0 ] || fail "invalid expected digest was accepted"
[ "$missing_ref_rc" -ne 0 ] || fail "missing loaded image reference was accepted"
[ "$mutable_ref_rc" -ne 0 ] || fail "mutable loaded image reference was accepted"
[ "$tcr_ref_rc" -ne 0 ] || fail "the TCR target was accepted as the loaded image reference"
[ "$uppercase_ref_rc" -ne 0 ] || fail "a non-canonical loaded image reference was accepted"
[ "$injected_ref_rc" -ne 0 ] || fail "an injected loaded image reference was accepted"

for mode in local-image-missing immutable-push-fail digest-mismatch target-digest-fail; do
  if run_helper "$mode" "$mode"; then
    fail "$mode was accepted"
  fi
  ! grep -Fq ':latest' "$WORK/$mode.log" || fail "latest changed after $mode"
done
[ "$(grep -c '^push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-' "$WORK/digest-mismatch.log")" -eq 1 ] \
  || fail "digest mismatch retried immutable publication"
[ "$(grep -c '^buildx imagetools ' "$WORK/digest-mismatch.log")" -eq 1 ] \
  || fail "digest mismatch retried target digest lookup"
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
