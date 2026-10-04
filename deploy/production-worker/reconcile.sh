#!/usr/bin/env bash
# Production-worker reconcile for one reviewed target (K7A).
#
# Standalone owner: GitHub Actions owns host prerequisites for future Komodo
# workloads. This script never touches Komodo Core, its declarative resources,
# Caddy, DNS, the TX1 production plane, Periphery's lifecycle, or WireGuard.
#
# Order: target profile -> privilege -> preflight -> staging re-proof -> host lock
# -> install -> verification. The lock is held across the install AND the
# verification, so no other mutation of this host can interleave with it, and the
# readiness token in the output is produced under the same lock.
#
# Privilege model, from the target profile:
#   root -> the SSH account already is root; this runs in place.
#   sudo -> the SSH account is not root; this re-executes itself through
#           non-interactive sudo, preserving ONLY the registry credential this
#           phase owns (through the environment, never through argv, disk, or a log).
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
  # Fail closed when privilege escalation needs a human: a workflow cannot type a
  # password, and a half-privileged run is worse than no run.
  sudo -n true >/dev/null 2>&1 \
    || fail "non-interactive (passwordless) sudo is required to reconcile target $WORKER_TARGET."
  sudo_args=(-n)
  # The outer reconcile is the first privilege boundary in production, so it
  # must hand the complete reviewed registry contract to the root transaction.
  # install.sh cannot recover values that were already dropped here.
  preserve=()
  for name in TCR_REGISTRY TCR_NAMESPACE TCR_CREDENTIAL_VERSION TCR_USERNAME TCR_PASSWORD; do
    if [[ -n "${!name:-}" ]]; then preserve+=("$name"); fi
  done
  if (( ${#preserve[@]} > 0 )); then
    sudo_args+=(--preserve-env="$(IFS=,; echo "${preserve[*]}")")
  fi
  # A deterministic PATH for the privileged half, independent of sudoers/sshd.
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

# Re-prove the staging root the workflow handed over: the SHA directory and both
# of its parents must still be real directories, never symlinks.
bash "$runtime/staging-root.sh" verify "$SOURCE_SHA" "$WORKER_STAGING_ROOT"

# Take this host's mutation lock for the whole transaction and pass the descriptor
# down. The lock and its root belong to the host's deploy owner: this owner never
# creates them, and it never introduces a second, worker-only lock.
require_host_lock
exec 9>"$WORKER_LOCK_ROOT/.deploy.lock"
flock -n 9 || fail "Another $WORKER_TARGET host mutation is running."
export WORKER_DEPLOY_LOCK_FD=9

bash "$runtime/install.sh" "$TARGET" "$SOURCE_SHA" "$stage"
# The verification runs last and its readiness token is the final line of this
# transaction: a partially prepared host can never end with the token.
bash "$runtime/verify.sh" "$TARGET" "$stage"
