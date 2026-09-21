#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/deploy/tx/replicate-image-to-tcr.sh"
WORK="$(mktemp -d)"
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
  pull)
    if [ "${DOCKER_MODE:-success}" = pull-fail ]; then
      exit 19
    fi
    if [ "${DOCKER_MODE:-success}" = pull-retry-success ]; then
      count="$(cat "$PULL_COUNT" 2>/dev/null || printf '0')"
      count=$((count + 1))
      printf '%s\n' "$count" > "$PULL_COUNT"
      if [ "$count" -lt 3 ]; then
        exit 19
      fi
    fi
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
    image="${@: -1}"
    if [ "${DOCKER_MODE:-success}" = source-digest-fail ] && [[ "$image" == ghcr.io/* ]]; then
      exit 22
    fi
    if [ "${DOCKER_MODE:-success}" = target-digest-fail ] && [[ "$image" == ccr.ccs.tencentyun.com/* ]]; then
      exit 23
    fi
    if [ "${DOCKER_MODE:-success}" = digest-mismatch ] && [[ "$image" == ccr.ccs.tencentyun.com/* ]]; then
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
    PULL_COUNT="$WORK/$label.pull-count" GHCR_PULL_ATTEMPTS=3 GHCR_PULL_TIMEOUT_SECONDS=1 \
    TCR_PUSH_TIMEOUT_SECONDS=1 DIGEST_TIMEOUT_SECONDS=1 KILL_AFTER_SECONDS=1 \
    bash "$HELPER" backend sha-aaaaaaaaaaaa > "$WORK/$label.out" 2> "$WORK/$label.err"
  local rc=$?
  set -e
  return "$rc"
}

run_helper success success || fail "success fixture failed: $(<"$WORK/success.err")"
grep -Fx 'component=backend' "$WORK/success.out" >/dev/null || fail "component log missing"
grep -Fx 'stage=replication-start' "$WORK/success.out" >/dev/null || fail "start log missing"
grep -Fx 'stage=replication-end' "$WORK/success.out" >/dev/null || fail "end log missing"
grep -Fx 'result=PASS' "$WORK/success.out" >/dev/null || fail "pass result missing"
grep -Fx 'pull ghcr.io/a158coke/wotbtools-backend:sha-aaaaaaaaaaaa' "$WORK/success.log" >/dev/null || fail "GHCR immutable pull missing"
grep -Fx 'push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-aaaaaaaaaaaa' "$WORK/success.log" >/dev/null || fail "TCR immutable push missing"
grep -Fx 'push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:latest' "$WORK/success.log" >/dev/null || fail "TCR latest push missing"
source_digest_line='buildx imagetools inspect --format {{.Digest}} ghcr.io/a158coke/wotbtools-backend:sha-aaaaaaaaaaaa'
target_digest_line='buildx imagetools inspect --format {{.Digest}} ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:sha-aaaaaaaaaaaa'
latest_push_line='push ccr.ccs.tencentyun.com/wotbtools/wotbtools-backend:latest'
[ "$(grep -nFx "$source_digest_line" "$WORK/success.log" | cut -d: -f1)" -lt "$(grep -nFx "$latest_push_line" "$WORK/success.log" | cut -d: -f1)" ] \
  || fail "source digest must be resolved before latest update"
[ "$(grep -nFx "$target_digest_line" "$WORK/success.log" | cut -d: -f1)" -lt "$(grep -nFx "$latest_push_line" "$WORK/success.log" | cut -d: -f1)" ] \
  || fail "target digest must be resolved before latest update"

set +e
PATH="$WORK/bin:$PATH" bash "$HELPER" minio sha-aaaaaaaaaaaa > /dev/null 2>&1
bad_component_rc=$?
PATH="$WORK/bin:$PATH" bash "$HELPER" backend latest > /dev/null 2>&1
bad_tag_rc=$?
set -e
[ "$bad_component_rc" -ne 0 ] || fail "unsupported component was accepted"
[ "$bad_tag_rc" -ne 0 ] || fail "mutable tag was accepted"

if run_helper pull-fail pull-fail; then
  fail "GHCR pull failure was accepted"
fi
[ "$(grep -c '^pull ' "$WORK/pull-fail.log")" -eq 3 ] || fail "GHCR pull must use bounded retries"
! grep -Fq ':latest' "$WORK/pull-fail.log" || fail "latest changed after pull failure"

run_helper pull-retry-success pull-retry || fail "transient GHCR pull did not recover"
[ "$(grep -c '^pull ' "$WORK/pull-retry.log")" -eq 3 ] || fail "retry success must report each pull attempt"

for mode in immutable-push-fail digest-mismatch source-digest-fail target-digest-fail; do
  if run_helper "$mode" "$mode"; then
    fail "$mode was accepted"
  fi
  ! grep -Fq ':latest' "$WORK/$mode.log" || fail "latest changed after $mode"
done

if run_helper latest-push-fail latest-push-fail; then
  fail "latest update failure was accepted"
fi
grep -Fx "$latest_push_line" "$WORK/latest-push-fail.log" >/dev/null || fail "latest push was not attempted"

printf 'TX replication helper contract OK\n'
