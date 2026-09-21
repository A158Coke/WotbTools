#!/usr/bin/env bash
# Contract and behaviour tests for scripts/ci/transfer-oci-to-tx.sh.
#
# The helper is exercised against fake `ssh`, `rsync`, `timeout` and remote `docker`
# binaries, so every claim below is observed behaviour instead of source text:
# resumable rsync retry, fail-closed SHA256 verification before `docker load`,
# exact-path cleanup, and rejection of unsupported components, mutable tags and
# invalid run ids.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="$ROOT/scripts/ci/transfer-oci-to-tx.sh"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

readonly COMPONENT="backend"
readonly TAG="sha-0f1e2d3c4b5a"
readonly RUN_ID="35630934506"
readonly BUILD_YML="$ROOT/.github/workflows/build.yml"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_rc_zero() {
  [ "$CASE_RC" -eq 0 ] || fail "$1: expected success, got rc=$CASE_RC: $(<"$CASE_DIR/stderr")"
}

assert_rc_nonzero() {
  [ "$CASE_RC" -ne 0 ] || fail "$1: expected failure, got rc=0"
}

assert_grep() {
  grep -Fq -- "$2" "$1" || fail "missing '$2' in $1"
}

assert_no_grep() {
  if grep -Fq -- "$2" "$1"; then
    fail "unexpected '$2' in $1"
  fi
}

assert_lines() {
  local actual
  actual="$(wc -l < "$1")"
  [ "$actual" -eq "$2" ] || fail "$1: expected $2 lines, got $actual"
}

# `docker load` invocations only; `docker image inspect` shares the same log.
assert_load_count() {
  local actual
  actual="$(grep -c '^load -i ' "$1" || true)"
  [ "$actual" -eq "$2" ] || fail "$1: expected $2 docker load calls, got $actual"
}

assert_equal() {
  [ "$1" = "$2" ] || fail "$3 (expected '$1', got '$2')"
}

mkdir -p "$WORK/bin" "$WORK/remote-bin" "$WORK/ssh"
: > "$WORK/ssh/config"
head -c 204800 /dev/urandom > "$WORK/image.oci.tar"
readonly LOCAL_SHA="$(sha256sum -- "$WORK/image.oci.tar" | cut -d' ' -f1)"

readonly REMOTE_DIR="/opt/wotb-tx/replication.incoming/$RUN_ID/$COMPONENT"
readonly REMOTE_ARCHIVE="$REMOTE_DIR/$COMPONENT-$TAG.oci.tar"
readonly REMOTE_PARTIAL="$REMOTE_ARCHIVE.part"
readonly LOCK_PATH="/opt/wotb-tx/replication.incoming/oci-transfer.lock"

# ---------------------------------------------------------------------------
# Fake runner-side binaries
# ---------------------------------------------------------------------------

cat > "$WORK/bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
while [[ "${1:-}" == --* || "${1:-}" == *s ]]; do
  shift
done
exec "$@"
EOF

cat > "$WORK/remote-bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$REMOTE_DOCKER_LOG"
case "${1:-}" in
  load)
    [ "${REMOTE_DOCKER_MODE:-success}" != load-fail ] || exit 21
    [ -f "${3:-}" ] || { printf 'docker: cannot read %s\n' "${3:-}" >&2; exit 21; }
    ;;
  image)
    [ "${2:-}" = inspect ] || exit 24
    [ "${REMOTE_DOCKER_MODE:-success}" != inspect-missing ] || exit 18
    printf 'sha256:%064d\n' 1
    ;;
  *)
    exit 24
    ;;
esac
EOF

cat > "$WORK/bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SSH_LOG"
# usage: ssh -F <config> tx-image-publication <remote command>
shift 2
shift
command="${1:-}"
mode="${SSH_MODE:-success}"
if [ "$mode" = transport-drop ]; then
  count="$(cat "$SSH_COUNT" 2>/dev/null || printf '0')"
  count=$((count + 1))
  printf '%s\n' "$count" > "$SSH_COUNT"
  if [ "$count" -lt 2 ]; then
    printf 'ssh: connect to host tx port 22: Connection reset by peer\n' >&2
    exit 255
  fi
fi
for tool in rsync docker sha256sum flock; do
  if [ "$mode" = "missing-$tool" ]; then
    case "$command" in
      "command -v $tool"*) exit 1 ;;
    esac
  fi
done
if [ "$mode" = remote-sha-mismatch ]; then
  case "$command" in
    sha256sum*) printf '%064d  %s\n' 0 "$command"; exit 0 ;;
  esac
fi
command="${command//\/opt\/wotb-tx/$REMOTE_ROOT\/opt\/wotb-tx}"
PATH="$REMOTE_BIN:$PATH" bash -c "$command"
EOF

cat > "$WORK/bin/rsync" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$RSYNC_LOG"
count="$(cat "$RSYNC_COUNT" 2>/dev/null || printf '0')"
count=$((count + 1))
printf '%s\n' "$count" > "$RSYNC_COUNT"

target="${!#}"
src="${@: -2:1}"
remote_path="${target#*:}"
remote_path="${remote_path//\/opt\/wotb-tx/$REMOTE_ROOT\/opt\/wotb-tx}"
mkdir -p "$(dirname "$remote_path")"

case "${RSYNC_MODE:-success}" in
  transient-resume)
    if [ "$count" -eq 1 ]; then
      head -c 4096 "$src" > "$remote_path"
      printf 'rsync: connection unexpectedly closed (4096 bytes received so far) [sender]\n' >&2
      exit 12
    fi
    resume_bytes="$(wc -c < "$remote_path")"
    printf '%s\n' "$resume_bytes" > "$RSYNC_RESUME_FILE"
    if ! cmp -s <(head -c "$resume_bytes" "$src") "$remote_path"; then
      printf 'rsync: append-verify prefix mismatch\n' >&2
      exit 23
    fi
    cp -- "$src" "$remote_path"
    ;;
  transient-always)
    head -c 1024 "$src" > "$remote_path"
    printf 'rsync error: error in rsync protocol data stream (code 12)\n' >&2
    exit 12
    ;;
  auth-fail)
    printf 'Permission denied (publickey).\nrsync: connection unexpectedly closed\n' >&2
    exit 255
    ;;
  hostkey-fail)
    printf 'Host key verification failed.\n' >&2
    exit 255
    ;;
  permission-fail)
    printf 'rsync: [receiver] mkstemp failed: Permission denied (13)\n' >&2
    exit 23
    ;;
  wrong-option)
    printf 'rsync: --append-verify: unknown option\n' >&2
    exit 1
    ;;
  *)
    cp -- "$src" "$remote_path"
    ;;
esac
EOF

chmod 700 "$WORK/bin/timeout" "$WORK/bin/ssh" "$WORK/bin/rsync" "$WORK/remote-bin/docker"

# ---------------------------------------------------------------------------
# Case harness: one job-scoped sandbox per label, shared by every mode of that
# label so a transfer can be followed by an import or a cleanup.
# ---------------------------------------------------------------------------

CASE_DIR=""
CASE_RC=0

reset_modes() {
  SSH_MODE=success
  RSYNC_MODE=success
  REMOTE_DOCKER_MODE=success
  TRANSFER_MAX_ATTEMPTS=""
}

run_case() {
  local label="$1"
  local mode="$2"
  local args=()

  CASE_DIR="$WORK/case-$label"
  if [ ! -d "$CASE_DIR" ]; then
    mkdir -p "$CASE_DIR/remote"
    : > "$CASE_DIR/ssh.log"
    : > "$CASE_DIR/rsync.log"
    : > "$CASE_DIR/docker.log"
    : > "$CASE_DIR/rsync.count"
    rm -f "$CASE_DIR/resume.bytes" "$CASE_DIR/ssh.count"
  fi

  case "$mode" in
    transfer)
      args=(transfer "$COMPONENT" "$TAG" "$RUN_ID" "$WORK/image.oci.tar")
      ;;
    import)
      args=(import "$COMPONENT" "$TAG" "$RUN_ID" "$WORK/image.oci.tar")
      ;;
    cleanup)
      args=(cleanup "$COMPONENT" "$TAG" "$RUN_ID")
      ;;
    *)
      fail "unknown case mode: $mode"
      ;;
  esac

  set +e
  PATH="$WORK/bin:$PATH" \
    TX_SSH_DIR="$WORK/ssh" \
    REMOTE_ROOT="$CASE_DIR/remote" \
    REMOTE_BIN="$WORK/remote-bin" \
    SSH_LOG="$CASE_DIR/ssh.log" \
    SSH_COUNT="$CASE_DIR/ssh.count" \
    RSYNC_LOG="$CASE_DIR/rsync.log" \
    RSYNC_COUNT="$CASE_DIR/rsync.count" \
    RSYNC_RESUME_FILE="$CASE_DIR/resume.bytes" \
    REMOTE_DOCKER_LOG="$CASE_DIR/docker.log" \
    SSH_MODE="$SSH_MODE" \
    RSYNC_MODE="$RSYNC_MODE" \
    REMOTE_DOCKER_MODE="$REMOTE_DOCKER_MODE" \
    TRANSFER_MAX_ATTEMPTS="$TRANSFER_MAX_ATTEMPTS" \
    TRANSFER_BACKOFF_FIRST_SECONDS=0 \
    TRANSFER_BACKOFF_LATER_SECONDS=0 \
    bash "$HELPER" "${args[@]}" >"$CASE_DIR/stdout" 2>"$CASE_DIR/stderr"
  CASE_RC=$?
  set -e
}

run_raw() {
  : > "$WORK/raw-ssh.log"
  : > "$WORK/raw-rsync.log"
  : > "$WORK/raw-ssh.count"
  : > "$WORK/raw-rsync.count"
  # RAW_SSH_DIR="" simulates a runner without the job-scoped SSH configuration.
  set +e
  PATH="$WORK/bin:$PATH" \
    TX_SSH_DIR="${RAW_SSH_DIR-$WORK/ssh}" \
    REMOTE_ROOT="$WORK/raw-remote" \
    REMOTE_BIN="$WORK/remote-bin" \
    SSH_LOG="$WORK/raw-ssh.log" \
    SSH_COUNT="$WORK/raw-ssh.count" \
    RSYNC_LOG="$WORK/raw-rsync.log" \
    RSYNC_COUNT="$WORK/raw-rsync.count" \
    RSYNC_RESUME_FILE="$WORK/raw-resume.bytes" \
    REMOTE_DOCKER_LOG="$WORK/raw-docker.log" \
    SSH_MODE="${SSH_MODE:-success}" \
    RSYNC_MODE="${RSYNC_MODE:-success}" \
    REMOTE_DOCKER_MODE="${REMOTE_DOCKER_MODE:-success}" \
    TRANSFER_MAX_ATTEMPTS="${TRANSFER_MAX_ATTEMPTS:-}" \
    TRANSFER_BACKOFF_FIRST_SECONDS=0 \
    TRANSFER_BACKOFF_LATER_SECONDS=0 \
    bash "$HELPER" "$@" >"$WORK/raw.out" 2>"$WORK/raw.err"
  CASE_RC=$?
  set -e
}

sandbox_dir() {
  printf '%s/remote%s' "$CASE_DIR" "$REMOTE_DIR"
}

sandbox_archive() {
  printf '%s/remote%s' "$CASE_DIR" "$REMOTE_ARCHIVE"
}

sandbox_partial() {
  printf '%s/remote%s' "$CASE_DIR" "$REMOTE_PARTIAL"
}

# ---------------------------------------------------------------------------
# Input validation (no remote work may happen for a rejected input)
# ---------------------------------------------------------------------------

for bad in "minio $TAG $RUN_ID" "backend latest $RUN_ID" "backend $TAG abc" "backend $TAG ../1" "backend $TAG 3563-09"; do
  # shellcheck disable=SC2086 # deliberate word splitting of the fixture triple
  run_raw transfer $bad "$WORK/image.oci.tar"
  [ "$CASE_RC" -ne 0 ] || fail "invalid transfer input was accepted: $bad"
  [ ! -s "$WORK/raw-ssh.log" ] || fail "invalid input '$bad' reached TX over SSH"
  [ ! -s "$WORK/raw-rsync.log" ] || fail "invalid input '$bad' started an rsync transfer"
done
run_raw transfer minio "$TAG" "$RUN_ID" "$WORK/image.oci.tar"
assert_grep "$WORK/raw.err" "unsupported TX image component"

run_raw transfer "$COMPONENT" "$TAG" "$RUN_ID" "$WORK/missing.oci.tar"
[ "$CASE_RC" -ne 0 ] || fail "missing local archive was accepted"
assert_grep "$WORK/raw.err" "local OCI archive is missing"
[ ! -s "$WORK/raw-ssh.log" ] || fail "missing local archive reached TX over SSH"
[ ! -s "$WORK/raw-rsync.log" ] || fail "missing local archive started an rsync transfer"

: > "$WORK/empty.oci.tar"
run_raw transfer "$COMPONENT" "$TAG" "$RUN_ID" "$WORK/empty.oci.tar"
[ "$CASE_RC" -ne 0 ] || fail "empty local archive was accepted"
[ ! -s "$WORK/raw-ssh.log" ] || fail "empty local archive reached TX over SSH"

run_raw transfer "$COMPONENT" "$TAG"
assert_equal "2" "$CASE_RC" "wrong argument count must print usage"
run_raw stream "$COMPONENT" "$TAG" "$RUN_ID" "$WORK/image.oci.tar"
assert_equal "2" "$CASE_RC" "the obsolete stream mode must not exist"

reset_modes
TRANSFER_MAX_ATTEMPTS=4 run_raw transfer "$COMPONENT" "$TAG" "$RUN_ID" "$WORK/image.oci.tar"
[ "$CASE_RC" -ne 0 ] || fail "TRANSFER_MAX_ATTEMPTS above the ceiling was accepted"
TRANSFER_MAX_ATTEMPTS=0 run_raw transfer "$COMPONENT" "$TAG" "$RUN_ID" "$WORK/image.oci.tar"
[ "$CASE_RC" -ne 0 ] || fail "TRANSFER_MAX_ATTEMPTS=0 was accepted"
TRANSFER_MAX_ATTEMPTS=""

RAW_SSH_DIR="" run_raw transfer "$COMPONENT" "$TAG" "$RUN_ID" "$WORK/image.oci.tar"
[ "$CASE_RC" -ne 0 ] || fail "missing TX_SSH_DIR was accepted"
RAW_SSH_DIR=""

# A wrong number of arguments must not be treated as a remote failure.
run_raw import "$COMPONENT" "$TAG"
assert_equal "2" "$CASE_RC" "import with missing arguments must print usage"

# ---------------------------------------------------------------------------
# Static contract: the fragile long-lived stream must be gone for good
# ---------------------------------------------------------------------------

HELPER_TEXT="$(tr -d '\r' < "$HELPER")"

assert_grep "$HELPER" "set -euo pipefail"
assert_grep "$HELPER" "--partial"
assert_grep "$HELPER" "--append-verify"
assert_grep "$HELPER" "rsync"
assert_grep "$HELPER" "sha256sum"
assert_grep "$HELPER" "docker load -i"
assert_grep "$HELPER" "flock -w"
assert_grep "$HELPER" "oci-transfer.lock"
assert_grep "$HELPER" 'STAGING_ROOT="/opt/wotb-tx/replication.incoming"'
assert_grep "$HELPER" 'remote_archive="$remote_dir/$component-$tag.oci.tar"'
assert_grep "$HELPER" "rm -f -- "
assert_grep "$HELPER" "rmdir --ignore-fail-on-non-empty"
assert_grep "$HELPER" 'ssh -F "$TX_SSH_DIR/config"'
assert_no_grep "$HELPER" "gzip -"
assert_no_grep "$HELPER" "bash -o pipefail -c"
assert_no_grep "$HELPER" "run-with-network-retry"
assert_no_grep "$HELPER" "publish-loaded-image-to-tcr"
assert_no_grep "$HELPER" "crane"
assert_no_grep "$HELPER" "ghcr.io"
assert_no_grep "$HELPER" "docker pull"
assert_no_grep "$HELPER" "docker system prune"
assert_no_grep "$HELPER" "docker image prune"
assert_no_grep "$HELPER" "volume prune"
assert_no_grep "$HELPER" "latest"
assert_no_grep "$HELPER" "StrictHostKeyChecking=no"
assert_no_grep "$HELPER" "eval "
assert_equal "1" "$(grep -c 'docker load -i' <<<"$HELPER_TEXT")" "docker load must have exactly one call site"
# No long-lived pipe into docker load: the pipe pattern and gzip are both gone.
if grep -Eq '\|[[:space:]]*docker[[:space:]]+load' <<<"$HELPER_TEXT"; then
  fail "docker load must not read from a pipe"
fi
# The archive is transferred as-is because every Build layer blob is already gzip.
assert_grep "$BUILD_YML" "oci-mediatypes=true"

[ ! -e "$ROOT/scripts/ci/stream-oci-to-tx.sh" ] || fail "obsolete stream helper still exists"
assert_no_grep "$BUILD_YML" "gzip"
assert_no_grep "$BUILD_YML" "docker load"
assert_no_grep "$BUILD_YML" "stream-oci-to-tx.sh"
assert_no_grep "$BUILD_YML" "oci-import.lock"

# Production surfaces must not mention the retired transport at all. Test scripts
# are excluded on purpose: their negative assertions legitimately name it.
for production_file in \
  "$ROOT/.github/workflows/build.yml" \
  "$ROOT/.github/workflows/ci.yml" \
  "$ROOT/scripts/ci/setup-tx-ssh.sh" \
  "$ROOT/scripts/ci/transfer-oci-to-tx.sh" \
  "$ROOT/deploy/tx/publish-loaded-image-to-tcr.sh" \
  "$ROOT/deploy/AGENTS.md" \
  "$ROOT/docs/DEVELOPER_GUIDE.md" \
  "$ROOT/docs/CHANGELOG.md"; do
  for pattern in "stream-oci-to-tx.sh" "gzip -c" "oci-import.lock" "replicate-image-to-tcr.sh"; do
    assert_no_grep "$production_file" "$pattern"
  done
done

# ---------------------------------------------------------------------------
# transfer: resumable upload, SHA256 verification, atomic promote
# ---------------------------------------------------------------------------

reset_modes
run_case transfer-success transfer
assert_rc_zero "transfer success"
assert_grep "$CASE_DIR/stdout" "stage=archive-sha256 result=PASS digest=$LOCAL_SHA"
assert_grep "$CASE_DIR/stdout" "stage=transfer result=PASS attempts=1"
assert_grep "$CASE_DIR/stdout" "stage=sha256-verify result=PASS digest=$LOCAL_SHA"
assert_grep "$CASE_DIR/stdout" "stage=transfer-complete archive=$REMOTE_ARCHIVE"
assert_grep "$CASE_DIR/ssh.log" "mkdir -p -- '$REMOTE_DIR'"
assert_grep "$CASE_DIR/ssh.log" "sha256sum -- '$REMOTE_PARTIAL'"
assert_grep "$CASE_DIR/ssh.log" "mv -f -- '$REMOTE_PARTIAL' '$REMOTE_ARCHIVE'"

assert_lines "$CASE_DIR/rsync.log" 1
assert_grep "$CASE_DIR/rsync.log" "--partial"
assert_grep "$CASE_DIR/rsync.log" "--append-verify"
# The archive payload is already gzip-compressed, so the upload must not spend CPU
# re-compressing it.
assert_no_grep "$CASE_DIR/rsync.log" "compress"
assert_grep "$CASE_DIR/rsync.log" "-e ssh -F $WORK/ssh/config"
assert_grep "$CASE_DIR/rsync.log" "-- $WORK/image.oci.tar tx-image-publication:$REMOTE_PARTIAL"
[ -f "$(sandbox_archive)" ] || fail "verified archive was not promoted to its final name"
[ ! -e "$(sandbox_partial)" ] || fail "partial archive survived the promote"
assert_equal "$LOCAL_SHA" "$(sha256sum -- "$(sandbox_archive)" | cut -d' ' -f1)" "promoted archive differs from the local archive"
assert_load_count "$CASE_DIR/docker.log" 0

# ---------------------------------------------------------------------------
# transfer: a checksum mismatch fails closed and never retransmits or loads
# ---------------------------------------------------------------------------

reset_modes
SSH_MODE=remote-sha-mismatch
run_case checksum-mismatch transfer
assert_rc_nonzero "checksum mismatch"
assert_grep "$CASE_DIR/stderr" "archive SHA256 mismatch"
assert_lines "$CASE_DIR/rsync.log" 1
assert_no_grep "$CASE_DIR/ssh.log" "mv -f --"
[ -e "$(sandbox_partial)" ] || fail "partial archive was dropped after a checksum mismatch"
[ ! -e "$(sandbox_archive)" ] || fail "unverified archive was promoted"
assert_load_count "$CASE_DIR/docker.log" 0

# ---------------------------------------------------------------------------
# transfer: transient transport failures resume from the partial file
# ---------------------------------------------------------------------------

reset_modes
RSYNC_MODE=transient-resume
run_case transient-resume transfer
assert_rc_zero "transient resume"
assert_lines "$CASE_DIR/rsync.log" 2
assert_equal "4096" "$(<"$CASE_DIR/resume.bytes")" "the retry did not resume from the retained partial bytes"
assert_equal "$(sed -n 1p "$CASE_DIR/rsync.log")" "$(sed -n 2p "$CASE_DIR/rsync.log")" \
  "both attempts must target the same partial file"
assert_grep "$CASE_DIR/stderr" "stage=transfer result=RETRY status=12"
assert_grep "$CASE_DIR/stdout" "stage=transfer result=PASS attempts=2"
assert_equal "$LOCAL_SHA" "$(sha256sum -- "$(sandbox_archive)" | cut -d' ' -f1)" "resumed archive differs from the local archive"

reset_modes
RSYNC_MODE=transient-always
run_case retry-exhausted transfer
assert_rc_nonzero "retry exhaustion"
assert_lines "$CASE_DIR/rsync.log" 3
assert_grep "$CASE_DIR/stderr" "rsync transport failure persisted after 3 attempts"

reset_modes
TRANSFER_MAX_ATTEMPTS=2
RSYNC_MODE=transient-always
run_case retry-budget transfer
assert_rc_nonzero "bounded retry budget"
assert_lines "$CASE_DIR/rsync.log" 2
TRANSFER_MAX_ATTEMPTS=""

# ---------------------------------------------------------------------------
# transfer: non-transport failures must not be retried
# ---------------------------------------------------------------------------

for mode in auth-fail hostkey-fail permission-fail wrong-option; do
  reset_modes
  RSYNC_MODE="$mode"
  run_case "non-transient-$mode" transfer
  assert_rc_nonzero "$mode"
  assert_lines "$CASE_DIR/rsync.log" 1
  assert_grep "$CASE_DIR/stderr" "non-transient status"
  assert_load_count "$CASE_DIR/docker.log" 0
done
reset_modes

# A dropped SSH connection outside the rsync upload is not an rsync transport
# failure either: directory creation fails closed on its first attempt.
reset_modes
SSH_MODE=transport-drop
run_case ssh-drop-mkdir transfer
assert_rc_nonzero "ssh drop during staging"
assert_lines "$CASE_DIR/ssh.log" 1
assert_lines "$CASE_DIR/rsync.log" 0

# ---------------------------------------------------------------------------
# import: verify the promoted archive, then docker load under the import lock
# ---------------------------------------------------------------------------

reset_modes
run_case import-success transfer
assert_rc_zero "import fixture transfer"
run_case import-success import
assert_rc_zero "import success"
assert_grep "$CASE_DIR/stdout" "stage=docker-load result=PASS image=wotb-transfer/$COMPONENT:$TAG"
assert_grep "$CASE_DIR/ssh.log" "command -v docker"
assert_grep "$CASE_DIR/ssh.log" "command -v sha256sum"
assert_grep "$CASE_DIR/ssh.log" "command -v flock"
assert_grep "$CASE_DIR/ssh.log" "sha256sum -- '$REMOTE_ARCHIVE'"
assert_grep "$CASE_DIR/ssh.log" "flock -w 1800 '$LOCK_PATH' docker load -i '$REMOTE_ARCHIVE'"
assert_grep "$CASE_DIR/ssh.log" "docker image inspect --format '{{.Id}}' 'wotb-transfer/$COMPONENT:$TAG'"
assert_load_count "$CASE_DIR/docker.log" 1
assert_grep "$CASE_DIR/docker.log" "load -i $(sandbox_archive)"

# The promoted archive must be verified before the load, and the loaded tag after it.
verify_line="$(grep -nF "sha256sum -- '$REMOTE_ARCHIVE'" "$CASE_DIR/ssh.log" | tail -n1 | cut -d: -f1)"
load_line="$(grep -nF "docker load -i '$REMOTE_ARCHIVE'" "$CASE_DIR/ssh.log" | tail -n1 | cut -d: -f1)"
inspect_line="$(grep -nF "docker image inspect" "$CASE_DIR/ssh.log" | tail -n1 | cut -d: -f1)"
promote_line="$(grep -nF "mv -f --" "$CASE_DIR/ssh.log" | tail -n1 | cut -d: -f1)"
[ "$promote_line" -lt "$verify_line" ] || fail "import must read the promoted archive"
[ "$verify_line" -lt "$load_line" ] || fail "docker load ran before the SHA256 verification"
[ "$load_line" -lt "$inspect_line" ] || fail "the loaded image tag must be validated after docker load"
[ "$(wc -l < "$CASE_DIR/rsync.log")" -eq 1 ] || fail "import must not transfer the archive again"

# A corrupted remote archive is rejected before docker load, with no retransmission.
reset_modes
run_case import-corrupt transfer
assert_rc_zero "corrupt fixture transfer"
printf 'tampered\n' >> "$(sandbox_archive)"
run_case import-corrupt import
assert_rc_nonzero "corrupted remote archive"
assert_grep "$CASE_DIR/stderr" "archive SHA256 mismatch"
assert_load_count "$CASE_DIR/docker.log" 0

# A missing remote archive is rejected before docker load.
reset_modes
run_case import-missing import
assert_rc_nonzero "missing remote archive"
assert_load_count "$CASE_DIR/docker.log" 0
assert_lines "$CASE_DIR/rsync.log" 0

# A failed or unverifiable load is never retried.
for mode in load-fail inspect-missing; do
  reset_modes
  REMOTE_DOCKER_MODE="$mode"
  run_case "import-$mode" transfer
  assert_rc_zero "import-$mode fixture transfer"
  run_case "import-$mode" import
  assert_rc_nonzero "$mode"
  assert_load_count "$CASE_DIR/docker.log" 1
  if [ "$mode" = inspect-missing ]; then
    assert_grep "$CASE_DIR/stderr" "expected TX image tag is not loaded"
  fi
done
reset_modes

# Missing TX prerequisites fail with the tool name instead of a bare SSH error.
for tool in docker sha256sum flock; do
  reset_modes
  SSH_MODE="missing-$tool"
  run_case "missing-tool-$tool" transfer
  assert_rc_zero "missing-tool-$tool fixture transfer"
  run_case "missing-tool-$tool" import
  assert_rc_nonzero "missing TX tool $tool"
  assert_grep "$CASE_DIR/stderr" "TX is missing a required tool: $tool"
  assert_load_count "$CASE_DIR/docker.log" 0
done

# rsync is required on both ends and is checked before any byte moves.
reset_modes
SSH_MODE=missing-rsync
run_case missing-tool-rsync transfer
assert_rc_nonzero "missing TX rsync"
assert_grep "$CASE_DIR/stderr" "TX is missing a required tool: rsync"
assert_lines "$CASE_DIR/rsync.log" 0
reset_modes

# ---------------------------------------------------------------------------
# cleanup: exact path only, partial files survive for the next attempt
# ---------------------------------------------------------------------------

reset_modes
run_case cleanup-exact transfer
assert_rc_zero "cleanup fixture transfer"
printf 'interrupted attempt\n' > "$(sandbox_dir)/$COMPONENT-$TAG.oci.tar.part.keep"
run_case cleanup-exact cleanup
assert_rc_zero "cleanup after publication"
assert_grep "$CASE_DIR/stdout" "stage=cleanup result=PASS archive=$REMOTE_ARCHIVE"
assert_grep "$CASE_DIR/ssh.log" "rm -f -- '$REMOTE_ARCHIVE'"
[ ! -e "$(sandbox_archive)" ] || fail "exact remote archive was not removed"
[ -e "$(sandbox_dir)/$COMPONENT-$TAG.oci.tar.part.keep" ] || fail "cleanup removed a file outside its exact path"
[ -d "$(sandbox_dir)" ] || fail "cleanup must keep the directory while a partial file remains"
assert_no_grep "$CASE_DIR/ssh.log" "prune"
assert_no_grep "$CASE_DIR/ssh.log" "rm -rf"

rm -f "$(sandbox_dir)/$COMPONENT-$TAG.oci.tar.part.keep"
run_case cleanup-exact cleanup
assert_rc_zero "cleanup of the empty job directory"
[ ! -d "$(sandbox_dir)" ] || fail "the empty job-scoped directory was not removed"

# ---------------------------------------------------------------------------
# The flags themselves must resume with real rsync, not only with the fake one
# ---------------------------------------------------------------------------

if command -v rsync >/dev/null 2>&1; then
  real="$WORK/real-rsync"
  mkdir -p "$real"
  head -c 300000 /dev/urandom > "$real/source.oci.tar"
  head -c 100000 "$real/source.oci.tar" > "$real/remote.oci.tar.part"
  literal_data="$(LC_ALL=C rsync --partial --append-verify --stats -- \
    "$real/source.oci.tar" "$real/remote.oci.tar.part" \
    | awk -F': ' '/^Literal data:/ {gsub(/[^0-9]/, "", $2); print $2}')"
  assert_equal "200000" "$literal_data" \
    "a resumed --partial --append-verify upload must only send the missing suffix"
  cmp -s "$real/source.oci.tar" "$real/remote.oci.tar.part" \
    || fail "the resumed remote file does not match the source archive"
fi

printf 'TX OCI transfer helper contract OK\n'
