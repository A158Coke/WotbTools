#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/deploy/tx/publish-loaded-image-to-tcr.sh"
TRANSFER_HELPER="$ROOT/scripts/ci/transfer-oci-to-tx.sh"
WORK="$(mktemp -d)"
readonly EXPECTED_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
    bash "$HELPER" backend sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" > "$WORK/$label.out" 2> "$WORK/$label.err"
  local rc=$?
  set -e
  return "$rc"
}

run_helper success success || fail "success fixture failed: $(<"$WORK/success.err")"
grep -Fx 'image inspect wotb-transfer/backend:sha-aaaaaaaaaaaa' "$WORK/success.log" >/dev/null || fail "loaded image check missing"
grep -Fx 'push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-aaaaaaaaaaaa' "$WORK/success.log" >/dev/null || fail "TCR immutable push missing"
grep -Fx 'push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:latest' "$WORK/success.log" >/dev/null || fail "TCR latest push missing"
target_digest_line='buildx imagetools inspect --format {{.Manifest.Digest}} ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-aaaaaaaaaaaa'
latest_push_line='push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:latest'
[ "$(grep -nFx "$target_digest_line" "$WORK/success.log" | cut -d: -f1)" -lt "$(grep -nFx "$latest_push_line" "$WORK/success.log" | cut -d: -f1)" ] \
  || fail "target digest must be resolved before latest update"
! grep -Eqi 'pull|ghcr|crane' "$WORK/success.log" || fail "TX publication must not pull GHCR or use crane"

set +e
PATH="$WORK/bin:$PATH" bash "$HELPER" minio sha-aaaaaaaaaaaa "$EXPECTED_DIGEST" > /dev/null 2>&1
bad_component_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend latest "$EXPECTED_DIGEST" > /dev/null 2>&1
bad_tag_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend sha-aaaaaaaaaaaa sha256:bad > /dev/null 2>&1
bad_digest_rc=$?
set -e
[ "$bad_component_rc" -ne 0 ] || fail "unsupported component was accepted"
[ "$bad_tag_rc" -ne 0 ] || fail "mutable tag was accepted"
[ "$bad_digest_rc" -ne 0 ] || fail "invalid expected digest was accepted"

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
for forbidden in rsync gzip "docker load" "transfer-oci-to-tx.sh" "run-with-network-retry"; do
  case "$helper_source" in
    *"$forbidden"*) fail "TX publication must not contain '$forbidden'" ;;
  esac
done
case "$helper_source" in
  *"docker system prune"*|*"docker image prune"*|*"volume prune"*) fail "TX publication must not prune Docker state" ;;
esac
case "$transfer_source" in
  *"publish-loaded-image-to-tcr.sh"*) fail "the TX transfer helper must not call TX publication" ;;
esac

printf 'TX loaded-image publication helper contract OK\n'
