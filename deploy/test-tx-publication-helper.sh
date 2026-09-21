#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/deploy/tx/publish-loaded-image-to-tcr.sh"
STREAM_HELPER="$ROOT/scripts/ci/stream-oci-to-tx.sh"
NETWORK_RETRY_HELPER="$ROOT/scripts/ci/run-with-network-retry.sh"
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
cat > "$WORK/bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null
printf 'ssh %s\n' "$*" >> "$SSH_LOG"
if [ "${SSH_MODE:-success}" = transport-retry ]; then
  count="$(cat "$SSH_COUNT" 2>/dev/null || printf '0')"
  count=$((count + 1))
  printf '%s\n' "$count" > "$SSH_COUNT"
  if [ "$count" -lt 2 ]; then
    printf 'connection reset by peer\n' >&2
    exit 255
  fi
fi
EOF
chmod 700 "$WORK/bin/ssh"

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

mkdir -p "$WORK/ssh"
: > "$WORK/ssh/config"
printf 'oci archive fixture\n' > "$WORK/image.oci.tar"
tr -d '\r' < "$NETWORK_RETRY_HELPER" > "$WORK/run-with-network-retry.sh"
chmod 700 "$WORK/run-with-network-retry.sh"

run_import() {
  local mode="$1" label="$2"
  set +e
  PATH="$WORK/bin:$PATH" SSH_MODE="$mode" SSH_LOG="$WORK/$label.ssh.log" \
    SSH_COUNT="$WORK/$label.ssh.count" TX_SSH_DIR="$WORK/ssh" NETWORK_RETRY_MAX_ATTEMPTS=2 \
    bash "$WORK/run-with-network-retry.sh" 'stream OCI fixture' bash "$STREAM_HELPER" "$WORK/image.oci.tar" \
    > "$WORK/$label.import.out" 2> "$WORK/$label.import.err"
  local rc=$?
  set -e
  return "$rc"
}

run_import transport-retry transport-retry || fail "transport retry fixture failed: $(<"$WORK/transport-retry.import.err") $(<"$WORK/transport-retry.import.out")"
[ "$(wc -l < "$WORK/transport-retry.ssh.log")" -eq 2 ] || fail "SSH transport failure did not use its bounded retry"

run_import success publication-once || fail "OCI import fixture failed"
if run_helper immutable-push-fail publication-push-fail; then
  fail "deterministic TCR push failure was accepted"
fi
[ "$(wc -l < "$WORK/publication-once.ssh.log")" -eq 1 ] \
  || fail "deterministic publication failure retransmitted the OCI archive"

set +e
PATH="$WORK/bin:$PATH" SSH_LOG="$WORK/missing-archive.ssh.log" TX_SSH_DIR="$WORK/ssh" NETWORK_RETRY_MAX_ATTEMPTS=2 \
  bash "$WORK/run-with-network-retry.sh" 'stream missing OCI fixture' bash "$STREAM_HELPER" "$WORK/missing.oci.tar" \
  > "$WORK/missing-archive.out" 2> "$WORK/missing-archive.err"
missing_archive_rc=$?
set -e
[ "$missing_archive_rc" -ne 0 ] || fail "missing OCI archive was accepted"
[ ! -e "$WORK/missing-archive.ssh.log" ] || fail "local validation failure attempted SSH retry"

printf 'TX loaded-image publication helper contract OK\n'
