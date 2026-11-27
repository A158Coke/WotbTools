#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TARGET="${1:?usage: reconcile.sh <target> <source-sha> <staged-root>}"
SOURCE_SHA="${2:?usage: reconcile.sh <target> <source-sha> <staged-root>}"
stage="${3:?usage: reconcile.sh <target> <source-sha> <staged-root>}"
runtime="$stage/deploy/production-worker"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/production-worker/lib.sh
source "$script_dir/lib.sh"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid production-worker source SHA.'
load_target_profile "$TARGET" "$runtime"

if [[ "$WORKER_PRIVILEGE" == sudo && "$(id -u)" != 0 ]]; then
  command -v sudo >/dev/null 2>&1 \
    || fail "sudo is required to reconcile target $WORKER_TARGET from a non-root account."
  sudo -n true >/dev/null 2>&1 \
    || fail "non-interactive (passwordless) sudo is required to reconcile target $WORKER_TARGET."
  sudo_args=(-n)
  preserve=()
  for name in TCR_REGISTRY TCR_NAMESPACE TCR_CREDENTIAL_VERSION TCR_USERNAME TCR_PASSWORD WORKER_LOCK_WAIT_SEC; do
    if [[ -n "${!name:-}" ]]; then preserve+=("$name"); fi
  done
  if (( ${#preserve[@]} > 0 )); then
    sudo_args+=(--preserve-env="$(IFS=,; echo "${preserve[*]}")")
  fi
  exec sudo "${sudo_args[@]}" env \
    PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
    bash "$0" "$@"
fi
[[ "$(id -u)" == 0 ]] \
  || fail "Production-worker reconcile must run as root (target $WORKER_TARGET)."
[[ "$stage" == "$WORKER_STAGING_ROOT/incoming/$SOURCE_SHA" ]] \
  || fail "Unexpected production-worker staging root for $WORKER_TARGET: $stage"
for command_name in "$docker_bin" flock python3; do
  command -v "$command_name" >/dev/null || fail "$command_name is required."
done

for staged in "$runtime/lib.sh" "$runtime/staging-root.sh" "$runtime/install.sh" \
  "$runtime/verify.sh" "$runtime/targets/$TARGET/target.env"; do
  [[ -f "$staged" && ! -L "$staged" ]] \
    || fail "Staged production-worker input is missing or unsafe: $staged"
done

bash "$runtime/staging-root.sh" verify "$SOURCE_SHA" "$WORKER_STAGING_ROOT"

require_host_lock
exec 9>"$WORKER_LOCK_ROOT/.deploy.lock"
worker_lock_wait="${WORKER_LOCK_WAIT_SEC:-900}"
if ! flock -w "$worker_lock_wait" 9; then
  echo "Another $WORKER_TARGET host mutation is running (waited ${worker_lock_wait}s)." >&2
  if command -v lsof >/dev/null 2>&1; then
    echo "Current lock file holders:" >&2
    lsof "$WORKER_LOCK_ROOT/.deploy.lock" >&2 || true
  elif command -v fuser >/dev/null 2>&1; then
    echo "Current lock file holders:" >&2
    fuser -v "$WORKER_LOCK_ROOT/.deploy.lock" >&2 || true
  fi
  fail "the $WORKER_TARGET host mutation lock was not released within ${worker_lock_wait}s."
fi
export WORKER_DEPLOY_LOCK_FD=9

bash "$runtime/install.sh" "$TARGET" "$SOURCE_SHA" "$stage"
bash "$runtime/verify.sh" "$TARGET" "$stage"
