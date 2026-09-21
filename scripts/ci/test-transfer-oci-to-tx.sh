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
# The canonical transferred identity the Build workflow verifies its registry digest
# for; the OCI archive `docker load` imports carries exactly this reference. There is
# deliberately no second, TX-local image namespace, and the release identity is the
# immutable tag - no image id or config digest is compared anywhere.
readonly CANONICAL_REF="ghcr.io/a158coke/wotbtools-$COMPONENT:$TAG"
# Some other reference an archive could carry instead of the verified release.
readonly OTHER_REF="ghcr.io/a158coke/wotbtools-$COMPONENT:sha-ffffffffffff"
# The image id the simulated daemon records for a loaded reference. Nothing reads it
# any more: a load that produced a different id under the same immutable tag is not
# observable to the presence-only import, which is exactly what this suite asserts.
readonly CANONICAL_ID="sha256:$(printf '%064d' 1)"

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

# Runner-side `timeout`: records the budget it was given and, for the serialized TX
# import, behaves like the real wrapper — a monitored operation that cannot fit in
# the budget is killed with 124.
cat > "$WORK/bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
budget=""
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --kill-after=*) shift ;;
    [0-9]*s) budget="${1%s}"; shift ;;
    *) args=("$@"); break ;;
  esac
done
printf 'budget=%s args=%s\n' "$budget" "${args[*]}" >> "$RUNNER_TIMEOUT_LOG"
if [ -n "$budget" ] && [ -n "${SIM_REMOTE_SECONDS:-}" ] && [[ "${args[*]}" == *"docker load"* ]]; then
  if [ "$SIM_REMOTE_SECONDS" -ge "$budget" ]; then
    printf 'timeout: the monitored command timed out\n' >&2
    exit 124
  fi
fi
exec "${args[@]}"
EOF

# Remote-side `timeout`: the inner budget around `docker load` on TX.
cat > "$WORK/remote-bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
budget=""
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --kill-after=*) shift ;;
    [0-9]*s) budget="${1%s}"; shift ;;
    *) args=("$@"); break ;;
  esac
done
printf 'budget=%s args=%s\n' "$budget" "${args[*]}" >> "$REMOTE_TIMEOUT_LOG"
if [ -n "$budget" ] && [ -n "${SIM_LOAD_SECONDS:-}" ] && [ "$SIM_LOAD_SECONDS" -ge "$budget" ]; then
  printf 'timeout: sending signal TERM to command docker\n' >&2
  exit 124
fi
exec "${args[@]}"
EOF

# Remote `docker`: a stateful stand-in for the TX daemon. `load` registers the
# reference the archive carries (BuildKit names it from the image-push tags), and
# `image inspect` answers exactly like dockerd - a reference that was never loaded
# fails with the daemon's "No such image" instead of a fabricated id.
cat > "$WORK/remote-bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$REMOTE_DOCKER_LOG"
state="${REMOTE_DOCKER_STATE:?}"
touch "$state"

state_has_ref() {
  awk -v ref="$1" '$2 == ref { found = 1 } END { exit found ? 0 : 1 }' "$state"
}

no_such_image() {
  printf 'Error response from daemon: No such image: %s\n' "$1" >&2
  exit 18
}

last_arg() {
  local arg
  for arg in "$@"; do :; done
  printf '%s' "$arg"
}

case "${1:-}" in
  load)
    [ "${REMOTE_DOCKER_MODE:-success}" != load-fail ] || exit 21
    [ -f "${3:-}" ] || { printf 'docker: cannot read %s\n' "${3:-}" >&2; exit 21; }
    if [ "${REMOTE_DOCKER_MODE:-success}" = load-omits-canonical ]; then
      printf 'Loaded image: %s\n' "${REMOTE_DOCKER_OTHER_REF:?}"
      printf '%s %s\n' "$REMOTE_DOCKER_IMAGE_ID" "$REMOTE_DOCKER_OTHER_REF" >> "$state"
    else
      # The archive carries the immutable reference this transfer was asked to
      # publish, which is all the import proves: presence, not image id equality.
      printf 'Loaded image: %s\n' "${EXPECTED_LOADED_REF:?}"
      printf '%s %s\n' "$REMOTE_DOCKER_IMAGE_ID" "$EXPECTED_LOADED_REF" >> "$state"
    fi
    ;;
  image)
    [ "${2:-}" = inspect ] || exit 24
    ref="$(last_arg "$@")"
    state_has_ref "$ref" || no_such_image "$ref"
    ;;
  *)
    # Anything else - including the retired TX-local `docker tag` and the retired
    # `--format '{{.Id}}'` identity read - is a contract violation, not a silent no-op.
    printf 'docker: unsupported fake command: %s\n' "${1:-}" >&2
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
for tool in rsync docker sha256sum flock timeout; do
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

chmod 700 "$WORK/bin/timeout" "$WORK/bin/ssh" "$WORK/bin/rsync" "$WORK/remote-bin/docker" "$WORK/remote-bin/timeout"

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
  SIM_REMOTE_SECONDS=""
  SIM_LOAD_SECONDS=""
}

# The simulated TX daemon only tracks which references exist; the import must prove
# presence, not compare an image id.
state_has_ref() {
  awk -v ref="$1" '$2 == ref { found = 1 } END { exit found ? 0 : 1 }' "$2"
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
    : > "$CASE_DIR/runner-timeout.log"
    : > "$CASE_DIR/remote-timeout.log"
    : > "$CASE_DIR/rsync.count"
    : > "$CASE_DIR/docker-state"
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
    RUNNER_TIMEOUT_LOG="$CASE_DIR/runner-timeout.log" \
    REMOTE_TIMEOUT_LOG="$CASE_DIR/remote-timeout.log" \
    SSH_MODE="$SSH_MODE" \
    RSYNC_MODE="$RSYNC_MODE" \
    REMOTE_DOCKER_MODE="$REMOTE_DOCKER_MODE" \
    SIM_REMOTE_SECONDS="$SIM_REMOTE_SECONDS" \
    SIM_LOAD_SECONDS="$SIM_LOAD_SECONDS" \
    TRANSFER_MAX_ATTEMPTS="$TRANSFER_MAX_ATTEMPTS" \
    EXPECTED_LOADED_REF="$CANONICAL_REF" \
    REMOTE_DOCKER_STATE="$CASE_DIR/docker-state" \
    REMOTE_DOCKER_IMAGE_ID="$CANONICAL_ID" \
    REMOTE_DOCKER_OTHER_REF="$OTHER_REF" \
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
  : > "$WORK/raw-docker-state"
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
    RUNNER_TIMEOUT_LOG="$WORK/raw-runner-timeout.log" \
    REMOTE_TIMEOUT_LOG="$WORK/raw-remote-timeout.log" \
    SSH_MODE="${SSH_MODE:-success}" \
    RSYNC_MODE="${RSYNC_MODE:-success}" \
    REMOTE_DOCKER_MODE="${REMOTE_DOCKER_MODE:-success}" \
    TRANSFER_MAX_ATTEMPTS="${TRANSFER_MAX_ATTEMPTS:-}" \
    EXPECTED_LOADED_REF="${EXPECTED_LOADED_REF-$CANONICAL_REF}" \
    REMOTE_DOCKER_STATE="$WORK/raw-docker-state" \
    REMOTE_DOCKER_IMAGE_ID="$CANONICAL_ID" \
    REMOTE_DOCKER_OTHER_REF="$OTHER_REF" \
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

# The import takes no identity value at all: the canonical loaded reference is derived
# from the validated component and immutable tag, so a stale EXPECTED_IMAGE_REF or
# EXPECTED_IMAGE_ID left in the environment must not change what is inspected (and the
# helper must not read them). The simulated daemon is keyed on the canonical reference,
# so an environment-derived reference would visibly change the outcome here.
reset_modes
REMOTE_DOCKER_MODE=load-omits-canonical
EXPECTED_IMAGE_REF="ghcr.io/a158coke/wotbtools-$COMPONENT:sha-ffffffffffff"
EXPECTED_IMAGE_ID="sha256:$(printf '%064d' 9)"
run_case import-env-ignored transfer
assert_rc_zero "import-env-ignored fixture transfer"
run_case import-env-ignored import
assert_rc_nonzero "import redirected by a stale identity environment variable"
assert_grep "$CASE_DIR/stderr" "did not load its canonical release identity: $CANONICAL_REF"
assert_equal "1" "$(grep -cF "docker image inspect '$CANONICAL_REF' >/dev/null" "$CASE_DIR/ssh.log")" \
  "the import must inspect the derived canonical reference exactly once"
assert_no_grep "$CASE_DIR/ssh.log" "sha-ffffffffffff"
assert_no_grep "$CASE_DIR/ssh.log" "$(printf '%064d' 9)"
unset EXPECTED_IMAGE_REF EXPECTED_IMAGE_ID
reset_modes
assert_no_grep "$HELPER" "EXPECTED_IMAGE_REF"
assert_no_grep "$HELPER" "EXPECTED_IMAGE_ID"
assert_no_grep "$BUILD_YML" "EXPECTED_IMAGE_REF"
assert_no_grep "$BUILD_YML" "EXPECTED_IMAGE_ID"
assert_no_grep "$BUILD_YML" "EXPECTED_DIGEST"

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
# The import derives the canonical loaded reference from its own registry prefix and the
# immutable tag; it never receives an identity value, and the reference it inspects is
# built from the validated component and tag rather than from any input string.
assert_grep "$HELPER" 'GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:-ghcr.io/a158coke/wotbtools}"'
assert_grep "$HELPER" 'canonical_image_ref="$GHCR_IMAGE_PREFIX-$component:$tag"'
assert_grep "$HELPER" "docker image inspect '\$canonical_image_ref' >/dev/null"
assert_no_grep "$HELPER" "--format"
assert_no_grep "$HELPER" '{{.Id}}'
assert_no_grep "$HELPER" "docker tag"
assert_no_grep "$HELPER" "docker pull"
assert_no_grep "$HELPER" "docker system prune"
assert_no_grep "$HELPER" "docker image prune"
assert_no_grep "$HELPER" "volume prune"
assert_no_grep "$HELPER" "latest"
assert_no_grep "$HELPER" "StrictHostKeyChecking=no"
assert_no_grep "$HELPER" "eval "
assert_equal "1" "$(grep -c 'docker load -i' <<<"$HELPER_TEXT")" "docker load must have exactly one call site"
# Import budgets: the outer SSH wrapper must outlive the lock wait *and* the load,
# while `docker load` keeps its own bounded remote timeout.
lock_wait="$(grep -oE '^readonly IMPORT_LOCK_WAIT_SECONDS=[0-9]+' "$HELPER" | cut -d= -f2)"
load_timeout="$(grep -oE '^readonly LOAD_TIMEOUT_SECONDS=[0-9]+' "$HELPER" | cut -d= -f2)"
total_expr="$(grep -oE '^readonly IMPORT_TOTAL_TIMEOUT_SECONDS=.*' "$HELPER" | cut -d= -f2-)"
[ -n "$lock_wait" ] && [ -n "$load_timeout" ] && [ -n "$total_expr" ] \
  || fail "the serialized import timeout constants are missing"
# Resolve the composed budget exactly as the helper writes it.
total_body="$(sed -e 's/^\$((//' -e 's/))$//' <<<"$total_expr")"
total_body="${total_body//IMPORT_LOCK_WAIT_SECONDS/$lock_wait}"
total_body="${total_body//LOAD_TIMEOUT_SECONDS/$load_timeout}"
import_total_timeout=$((total_body))
[ "$import_total_timeout" -gt "$((lock_wait + load_timeout))" ] \
  || fail "the outer import timeout ($import_total_timeout) must exceed lock wait ($lock_wait) + load budget ($load_timeout)"
assert_grep "$HELPER" 'timeout --kill-after="$KILL_AFTER" "${IMPORT_TOTAL_TIMEOUT_SECONDS}s"'
assert_grep "$HELPER" "flock -w \$IMPORT_LOCK_WAIT_SECONDS '\$IMPORT_LOCK' timeout --kill-after=\$KILL_AFTER \${LOAD_TIMEOUT_SECONDS}s docker load -i"
assert_grep "$HELPER" "for tool in docker sha256sum flock timeout; do"
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
assert_grep "$CASE_DIR/stdout" "stage=loaded-identity-verify result=PASS image=$CANONICAL_REF"
assert_grep "$CASE_DIR/stdout" "stage=docker-load result=PASS image=$CANONICAL_REF"
assert_grep "$CASE_DIR/ssh.log" "command -v docker"
assert_grep "$CASE_DIR/ssh.log" "command -v sha256sum"
assert_grep "$CASE_DIR/ssh.log" "command -v flock"
assert_grep "$CASE_DIR/ssh.log" "sha256sum -- '$REMOTE_ARCHIVE'"
assert_grep "$CASE_DIR/ssh.log" "flock -w $lock_wait '$LOCK_PATH' timeout --kill-after=30s ${load_timeout}s docker load -i '$REMOTE_ARCHIVE'"
# One canonical identity, and it is a presence check: the import only proves the
# immutable release reference the archive carries is loaded. It reads no image id and
# creates no TX-local alias.
assert_grep "$CASE_DIR/ssh.log" "docker image inspect '$CANONICAL_REF' >/dev/null"
assert_no_grep "$CASE_DIR/ssh.log" "--format"
assert_no_grep "$CASE_DIR/ssh.log" "{{.Id}}"
assert_no_grep "$CASE_DIR/ssh.log" "docker tag"
assert_no_grep "$CASE_DIR/ssh.log" "wotb-transfer"
assert_load_count "$CASE_DIR/docker.log" 1
assert_grep "$CASE_DIR/docker.log" "load -i $(sandbox_archive)"
state_has_ref "$CANONICAL_REF" "$CASE_DIR/docker-state" \
  || fail "the imported archive must have loaded the canonical release identity"
assert_no_grep "$CASE_DIR/stdout" "image_id="

# The promoted archive must be verified before the load, and the loaded identity after it.
verify_line="$(grep -nF "sha256sum -- '$REMOTE_ARCHIVE'" "$CASE_DIR/ssh.log" | tail -n1 | cut -d: -f1)"
load_line="$(grep -nF "docker load -i '$REMOTE_ARCHIVE'" "$CASE_DIR/ssh.log" | tail -n1 | cut -d: -f1)"
inspect_line="$(grep -nF "docker image inspect" "$CASE_DIR/ssh.log" | tail -n1 | cut -d: -f1)"
promote_line="$(grep -nF "mv -f --" "$CASE_DIR/ssh.log" | tail -n1 | cut -d: -f1)"
[ "$promote_line" -lt "$verify_line" ] || fail "import must read the promoted archive"
[ "$verify_line" -lt "$load_line" ] || fail "docker load ran before the SHA256 verification"
[ "$load_line" -lt "$inspect_line" ] || fail "the loaded release identity must be validated after docker load"
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

# Regression (Build run 35646876773): the archive carries the canonical GHCR immutable
# reference and no TX-local tag. An archive that loads some other reference must fail
# closed, because the release identity that must be present is the immutable tag.
reset_modes
REMOTE_DOCKER_MODE=load-omits-canonical
run_case import-unnamed-release transfer
assert_rc_zero "import-unnamed-release fixture transfer"
run_case import-unnamed-release import
assert_rc_nonzero "archive without the canonical release identity"
assert_grep "$CASE_DIR/stderr" "did not load its canonical release identity: $CANONICAL_REF"
assert_grep "$CASE_DIR/stdout" "stage=docker-load-start"
assert_no_grep "$CASE_DIR/stdout" "stage=docker-load result=PASS"
assert_load_count "$CASE_DIR/docker.log" 1
reset_modes

# A failed load is never retried, and a load that leaves the canonical reference
# absent is covered by the regression case above.
reset_modes
REMOTE_DOCKER_MODE=load-fail
run_case import-load-fail transfer
assert_rc_zero "import-load-fail fixture transfer"
run_case import-load-fail import
assert_rc_nonzero "load-fail"
assert_load_count "$CASE_DIR/docker.log" 1
reset_modes

# Missing TX prerequisites fail with the tool name instead of a bare SSH error.
for tool in docker sha256sum flock timeout; do
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
# import budgets: lock wait and load are bounded independently, and the outer
# wrapper outlives both (a waiter parked past the load budget must survive)
# ---------------------------------------------------------------------------

reset_modes
run_case import-budget transfer
assert_rc_zero "import budget fixture transfer"

# The simulated remote command parks on the lock for longer than the load budget:
# only the composed outer budget may cover that, and the lock policy must hold.
SIM_REMOTE_SECONDS=$((load_timeout + 100))
run_case import-budget import
assert_rc_zero "lock wait beyond the load budget"
assert_load_count "$CASE_DIR/docker.log" 1
outer_budget="$(grep -F 'docker load' "$CASE_DIR/runner-timeout.log" | tail -n1 \
  | sed -n 's/^budget=\([0-9]*\).*/\1/p')"
[ "$outer_budget" = "$import_total_timeout" ] \
  || fail "the outer import wrapper must use the composed budget ($import_total_timeout), got '$outer_budget'"
[ "$outer_budget" -gt "$lock_wait" ] \
  || fail "the outer import wrapper must outlive the ${lock_wait}s lock wait"
inner_budget="$(grep -F 'docker load' "$CASE_DIR/remote-timeout.log" | tail -n1 \
  | sed -n 's/^budget=\([0-9]*\).*/\1/p')"
[ "$inner_budget" = "$load_timeout" ] \
  || fail "docker load must keep its own ${load_timeout}s remote budget, got '$inner_budget'"
reset_modes

# Negative control: the simulated wrapper does kill a remote operation that cannot
# fit in the composed budget, so the positive lock-wait case above is meaningful
# and not a vacuous pass.
run_case import-budget-negative transfer
assert_rc_zero "negative-control fixture transfer"
SIM_REMOTE_SECONDS=$((import_total_timeout + 60))
run_case import-budget-negative import
assert_rc_nonzero "lock wait beyond the composed budget"
assert_load_count "$CASE_DIR/docker.log" 0
reset_modes

# The inner remote budget still bounds docker load itself, and tripping it fails
# the import without any retry.
run_case import-inner-timeout transfer
assert_rc_zero "inner timeout fixture transfer"
SIM_LOAD_SECONDS=$((load_timeout + 1))
run_case import-inner-timeout import
assert_rc_nonzero "docker load exceeding its own budget"
assert_grep "$CASE_DIR/stderr" "docker load of the verified TX archive failed"
assert_load_count "$CASE_DIR/docker.log" 0
assert_equal "1" "$(grep -cF "flock -w $lock_wait" "$CASE_DIR/ssh.log" || true)" \
  "a docker load that trips its own budget must not be retried"
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
