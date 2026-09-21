#!/usr/bin/env bash
# Transfer one BuildKit OCI archive to TX with resumable native rsync, verify that
# the runner and TX see the same SHA256, import the verified archive with
# `docker load`, and confirm the loaded image carries the canonical immutable
# release reference before any publication step may consume it.
#
# Release identity is the immutable tag (`sha-<12>`), nothing else. The archive is
# named by BuildKit from the image-push tags, so `docker load` brings in exactly
# `<GHCR prefix>-<component>:<sha-12>` - the reference this script derives from its
# own validated component and tag, because the Build workflow pushed and verified
# that immutable tag for the one build the archive was exported from. TX never pulls
# that reference: it is already local after the verified import. There is
# deliberately no second, TX-local image namespace, and no image-id/config-digest
# comparison: the archive SHA256 below is the only byte-level proof.
#
# Three deterministic modes. Every mode builds the remote path inside this script
# from validated inputs, so no workflow input can select a remote path:
#
#   transfer <component> <sha-12> <run-id> <archive>   resumable upload + verify
#   import   <component> <sha-12> <run-id> <archive>   re-verify + docker load +
#                                                      confirm canonical ref loaded
#   cleanup  <component> <sha-12> <run-id>             remove the exact archive
#
# Retry boundary: only the rsync upload is retried, and only for transport
# failures. The staging directory, the SHA256 checks, `docker load` and TCR
# publication are never retried; publication stays in the deployment-owned TX
# helper and outside this file.
set -euo pipefail

readonly SSH_TARGET="tx-image-publication"
readonly STAGING_ROOT="/opt/wotb-tx/replication.incoming"
# The registry prefix of the one build this archive was exported from; the import
# derives the canonical loaded reference from it instead of receiving an identity
# value over the workflow environment.
readonly GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:-ghcr.io/a158coke/wotbtools}"
# One lock for every component: parallel Build jobs must not run three simultaneous
# multi-gigabyte `docker load`s against the same TX disk and Docker daemon.
readonly IMPORT_LOCK="$STAGING_ROOT/oci-transfer.lock"
# Per-attempt budgets stay well inside the 80 minute Build job even when a transfer
# burns its full retry budget.
readonly ATTEMPT_TIMEOUT_SECONDS=900
readonly REMOTE_COMMAND_TIMEOUT_SECONDS=120
readonly KILL_AFTER="30s"
# Serialized import has two independent budgets: waiting for the shared import lock
# and the load itself. The outer SSH wrapper must outlive both, otherwise a valid
# waiter would be killed by the wrapper long before `flock -w` could ever expire.
readonly IMPORT_LOCK_WAIT_SECONDS=1800
readonly LOAD_TIMEOUT_SECONDS=900
readonly IMPORT_TOTAL_TIMEOUT_SECONDS=$((IMPORT_LOCK_WAIT_SECONDS + LOAD_TIMEOUT_SECONDS + 60))
readonly MAX_ATTEMPTS_CEILING=3
readonly MAX_BACKOFF_SECONDS=120
# rsync's own transport failures (see rsync_failure_is_transient).
readonly -a RSYNC_TRANSPORT_CODES=(10 12 14 30 35)
readonly -a RSYNC_AMBIGUOUS_CODES=(23 24 255)

mode=""
component=""
tag=""
run_id=""
archive=""
stage="start"
rsync_output=""

fail() {
  printf 'ERROR: component=%s stage=%s %s\n' "${component:-unknown}" "$stage" "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
usage:
  transfer-oci-to-tx.sh transfer <backend|frontend|keycloak> <sha-12> <run-id> <archive>
  transfer-oci-to-tx.sh import   <backend|frontend|keycloak> <sha-12> <run-id> <archive>
  transfer-oci-to-tx.sh cleanup  <backend|frontend|keycloak> <sha-12> <run-id>

Every mode takes the release identity as the immutable `sha-<12>` tag only: the
canonical loaded reference is derived from it and the registry prefix owned by this
script, so no identity value crosses the workflow environment.
EOF
  exit 2
}

case "${1:-}" in
  transfer|import)
    [ "$#" -eq 5 ] || usage
    mode="$1"
    component="$2"
    tag="$3"
    run_id="$4"
    archive="$5"
    ;;
  cleanup)
    [ "$#" -eq 4 ] || usage
    mode="$1"
    component="$2"
    tag="$3"
    run_id="$4"
    ;;
  *)
    usage
    ;;
esac

case "$component" in
  backend|frontend|keycloak) ;;
  *) fail "unsupported TX image component (expected backend, frontend or keycloak)" ;;
esac
[[ "$tag" =~ ^sha-[0-9a-f]{12}$ ]] || fail "immutable tag must be sha-<12 lowercase hex>"
[[ "$run_id" =~ ^[0-9]+$ ]] || fail "GitHub run id must contain digits only"
[ -n "${TX_SSH_DIR:-}" ] || fail "TX_SSH_DIR is required"
# rsync word-splits its `-e` remote shell, so the OpenSSH config path must stay
# whitespace free (the job-scoped RUNNER_TEMP path always is).
case "$TX_SSH_DIR" in
  *[[:space:]]*) fail "TX_SSH_DIR must not contain whitespace" ;;
esac
[ -f "$TX_SSH_DIR/config" ] || fail "native TX SSH configuration is missing: $TX_SSH_DIR/config"

# The one release identity this script works with: the immutable tag it was given,
# resolved against the canonical registry prefix of the build the archive came from.
readonly canonical_image_ref="$GHCR_IMAGE_PREFIX-$component:$tag"

max_attempts="${TRANSFER_MAX_ATTEMPTS:-3}"
backoff_first="${TRANSFER_BACKOFF_FIRST_SECONDS:-5}"
backoff_later="${TRANSFER_BACKOFF_LATER_SECONDS:-15}"
[[ "$max_attempts" =~ ^[1-9][0-9]*$ ]] || fail "TRANSFER_MAX_ATTEMPTS must be a positive integer"
((max_attempts <= MAX_ATTEMPTS_CEILING)) || fail "TRANSFER_MAX_ATTEMPTS cannot exceed $MAX_ATTEMPTS_CEILING"
[[ "$backoff_first" =~ ^[0-9]+$ && "$backoff_later" =~ ^[0-9]+$ ]] \
  || fail "transfer backoffs must be non-negative integers"
((backoff_first <= MAX_BACKOFF_SECONDS && backoff_later <= MAX_BACKOFF_SECONDS)) \
  || fail "transfer backoffs cannot exceed ${MAX_BACKOFF_SECONDS}s"

readonly remote_dir="$STAGING_ROOT/$run_id/$component"
# The immutable tag is part of the file name, so a new release can never append to
# or promote an archive left behind by an older one.
readonly remote_archive="$remote_dir/$component-$tag.oci.tar"
readonly remote_partial="$remote_archive.part"

for tool in ssh sha256sum timeout; do
  command -v "$tool" >/dev/null 2>&1 || fail "runner is missing required tool: $tool"
done

# Every remote invocation is one fully quoted argument string built only from the
# validated identifiers above and from constants owned by this script.
remote_command() {
  timeout --kill-after="$KILL_AFTER" "${REMOTE_COMMAND_TIMEOUT_SECONDS}s" \
    ssh -F "$TX_SSH_DIR/config" "$SSH_TARGET" "$1"
}

compute_local_sha256() {
  local digest
  [ -f "$archive" ] || fail "local OCI archive is missing: $archive"
  [ -s "$archive" ] || fail "local OCI archive is empty: $archive"
  digest="$(sha256sum -- "$archive")" || fail "cannot read the local OCI archive: $archive"
  digest="${digest%% *}"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || fail "local SHA256 computation returned an invalid digest"
  printf '%s' "$digest"
}

read_remote_sha256() {
  local target="$1"
  local output
  local digest
  output="$(remote_command "sha256sum -- '$target'")" \
    || fail "cannot compute the TX SHA256 for $target"
  digest="${output%% *}"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] \
    || fail "TX SHA256 computation returned an invalid digest for $target"
  printf '%s' "$digest"
}

# Fail immediately, and never load or promote, on a mismatch: size, rsync's exit
# status and mtime are not evidence that the bytes arrived intact.
verify_remote_sha256() {
  local target="$1"
  local local_digest="$2"
  local remote_digest
  printf 'component=%s stage=sha256-verify-start target=%s\n' "$component" "$target"
  remote_digest="$(read_remote_sha256 "$target")"
  [ "$remote_digest" = "$local_digest" ] \
    || fail "archive SHA256 mismatch (runner=$local_digest tx=$remote_digest); refusing to continue"
  printf 'component=%s stage=sha256-verify result=PASS digest=%s\n' "$component" "$local_digest"
}

# Only unambiguous transport codes are retried. Codes 23/24 (partial transfer) and
# 255 are also used for authentication, host-key, configuration and path failures,
# so they need positive transport evidence and must not carry a fatal marker.
rsync_failure_is_transient() {
  local status="$1"
  local output="$2"
  local code
  local ambiguous=0

  # 124/137 is `timeout` killing a hung transfer; the partial file survives and the
  # next attempt resumes it.
  if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
    return 0
  fi
  for code in "${RSYNC_TRANSPORT_CODES[@]}"; do
    if [ "$status" -eq "$code" ]; then
      return 0
    fi
  done
  for code in "${RSYNC_AMBIGUOUS_CODES[@]}"; do
    if [ "$status" -eq "$code" ]; then
      ambiguous=1
    fi
  done
  if [ "$ambiguous" -ne 1 ]; then
    return 1
  fi
  if grep -Eqi \
    '(permission denied|host key verification failed|authentication failed|too many authentication failures|no such file or directory|could not resolve hostname|unknown option|invalid argument)' \
    <<<"$output"; then
    return 1
  fi
  grep -Eqi \
    '(connection (reset|refused|timed out|unexpectedly closed|closed by remote host)|broken pipe|packet_write_wait|connection timeout|remote host terminated|rsync protocol data stream|timeout in data send/receive|network is unreachable|temporary failure in name resolution|kex_exchange_identification|unexpected (end of stream|EOF))' \
    <<<"$output"
}

run_rsync_attempt() {
  local output_file
  local status
  output_file="$(mktemp)"
  # rsync's status is the caller's decision, so it is captured in a condition instead
  # of toggling errexit for the whole shell.
  if timeout --kill-after="$KILL_AFTER" "${ATTEMPT_TIMEOUT_SECONDS}s" \
    rsync --partial --append-verify --stats --human-readable \
    -e "ssh -F $TX_SSH_DIR/config" \
    -- "$archive" "$SSH_TARGET:$remote_partial" >"$output_file" 2>&1; then
    status=0
  else
    status=$?
  fi
  rsync_output="$(<"$output_file")"
  rm -f "$output_file"
  printf '%s\n' "$rsync_output"
  return "$status"
}

transfer_archive() {
  local attempt=1
  local status
  local backoff
  command -v rsync >/dev/null 2>&1 || fail "runner is missing required tool: rsync"

  while :; do
    printf 'component=%s stage=transfer-start attempt=%s/%s target=%s\n' \
      "$component" "$attempt" "$max_attempts" "$remote_partial"
    # --partial keeps the bytes of an interrupted attempt and --append-verify resumes
    # from them, checksumming the existing prefix before appending: a reconnect never
    # restarts from byte zero and never appends onto foreign data. rsync compression
    # is deliberately not requested because Build exports this archive with
    # `oci-mediatypes=true`, so every layer blob is already `+gzip`.
    if run_rsync_attempt; then
      status=0
    else
      status=$?
    fi
    if [ "$status" -eq 0 ]; then
      printf 'component=%s stage=transfer result=PASS attempts=%s\n' "$component" "$attempt"
      return 0
    fi
    if ! rsync_failure_is_transient "$status" "$rsync_output"; then
      fail "rsync failed with non-transient status $status; not retrying"
    fi
    if [ "$attempt" -ge "$max_attempts" ]; then
      fail "rsync transport failure persisted after $max_attempts attempts (last status $status)"
    fi
    if [ "$attempt" -eq 1 ]; then
      backoff="$backoff_first"
    else
      backoff="$backoff_later"
    fi
    printf 'component=%s stage=transfer result=RETRY status=%s backoff_seconds=%s\n' \
      "$component" "$status" "$backoff" >&2
    sleep "$backoff"
    attempt=$((attempt + 1))
  done
}

run_transfer() {
  local local_digest
  local_digest="$(compute_local_sha256)"
  printf 'component=%s stage=archive-sha256 result=PASS digest=%s\n' "$component" "$local_digest"

  stage="tx-preflight"
  # rsync needs its peer on TX as well; fail with the tool name instead of an opaque
  # remote-shell error.
  remote_command "command -v rsync >/dev/null 2>&1" \
    || fail "TX is missing a required tool: rsync"

  stage="staging-directory"
  remote_command "mkdir -p -- '$remote_dir'" || fail "cannot create the TX staging directory"

  stage="transfer"
  transfer_archive

  stage="sha256-verify"
  verify_remote_sha256 "$remote_partial" "$local_digest"

  stage="promote"
  # rsync only ever writes the `.part` name; the final name appears exactly once the
  # uploaded bytes are proven equal to the local archive, so a half-uploaded archive
  # can never be mistaken for a complete one.
  remote_command "mv -f -- '$remote_partial' '$remote_archive'" \
    || fail "cannot promote the verified archive on TX"
  printf 'component=%s stage=transfer-complete archive=%s\n' "$component" "$remote_archive"
}

run_import() {
  local local_digest
  local tool

  # Re-verify at the point of use as well as at upload time: `docker load` must only
  # ever see bytes whose SHA256 matches the runner's archive.
  local_digest="$(compute_local_sha256)"

  stage="tx-preflight"
  # `timeout` is required on TX because the load runs under its own remote budget.
  for tool in docker sha256sum flock timeout; do
    remote_command "command -v $tool >/dev/null 2>&1" \
      || fail "TX is missing a required tool: $tool"
  done

  stage="sha256-verify"
  verify_remote_sha256 "$remote_archive" "$local_digest"

  stage="docker-load"
  printf 'component=%s stage=docker-load-start archive=%s\n' "$component" "$remote_archive"
  # `docker load` reads a verified local file under the single TX import lock and is
  # never retried: the input is already deterministic and verified, so a second
  # attempt would only repeat multi-gigabyte work.
  #
  # The budgets are composed, not conflated: `flock -w` bounds the lock wait, the
  # inner remote `timeout` bounds the load, and the outer wrapper covers both plus a
  # margin so an honest waiter can use its full lock budget.
  timeout --kill-after="$KILL_AFTER" "${IMPORT_TOTAL_TIMEOUT_SECONDS}s" \
    ssh -F "$TX_SSH_DIR/config" "$SSH_TARGET" \
    "flock -w $IMPORT_LOCK_WAIT_SECONDS '$IMPORT_LOCK' timeout --kill-after=$KILL_AFTER ${LOAD_TIMEOUT_SECONDS}s docker load -i '$remote_archive'" \
    || fail "docker load of the verified TX archive failed (lock wait ${IMPORT_LOCK_WAIT_SECONDS}s, load budget ${LOAD_TIMEOUT_SECONDS}s)"

  # `docker load` imports whatever reference the archive carries, and BuildKit names an
  # OCI archive from the image-push tags, so the release identity that must be present
  # is the canonical immutable reference derived from this component and tag. If the
  # archive did not bring that reference in, it was not the release this transfer was
  # asked to publish, so the run fails closed before anything can be published.
  #
  # This is a presence check, not an identity comparison: the immutable tag *is* the
  # release identity, the archived bytes are already proven by the SHA256 above, and
  # no image id or config digest participates in the decision.
  stage="loaded-identity-verify"
  remote_command "docker image inspect '$canonical_image_ref' >/dev/null" \
    || fail "the verified archive did not load its canonical release identity: $canonical_image_ref"
  printf 'component=%s stage=loaded-identity-verify result=PASS image=%s\n' \
    "$component" "$canonical_image_ref"
  printf 'component=%s stage=docker-load result=PASS image=%s\n' \
    "$component" "$canonical_image_ref"
}

run_cleanup() {
  stage="cleanup"
  remote_command "rm -f -- '$remote_archive'" || fail "cannot remove the TX transfer archive"
  # Best effort, exact path only: the job-scoped directory disappears only when it is
  # empty, so a leftover `.part` from a failed attempt keeps its resumable bytes.
  if ! remote_command "rmdir --ignore-fail-on-non-empty -- '$remote_dir' >/dev/null 2>&1"; then
    printf 'component=%s stage=cleanup note=staging-directory-retained\n' "$component" >&2
  fi
  printf 'component=%s stage=cleanup result=PASS archive=%s\n' "$component" "$remote_archive"
}

case "$mode" in
  transfer)
    run_transfer
    ;;
  import)
    run_import
    ;;
  cleanup)
    run_cleanup
    ;;
esac
