#!/usr/bin/env bash
# Komodo Periphery reconcile for one reviewed target (K3.2).
#
# Standalone owner: GitHub Actions owns the Periphery systemd lifecycle, Komodo
# Core owns only the Server relationship. This script never touches Core, Caddy,
# DNS, or the Komodo controller runtime.
#
# Order: target profile -> privilege -> preflight -> staging re-proof -> host lock
# -> install -> verification. The lock is held across the install AND the
# verification, so no other mutation of this host can interleave with it.
#
# Privilege model, from the target profile:
#   root -> the SSH account already is root; this runs in place.
#   sudo -> the SSH account is not root; this re-executes itself through
#           non-interactive sudo, preserving ONLY the generic onboarding variable
#           (through the environment, never through argv, disk, or a log).
set -Eeuo pipefail
umask 077

TARGET="${1:?usage: reconcile.sh <target> <source-sha> <staged-root>}"
SOURCE_SHA="${2:?usage: reconcile.sh <target> <source-sha> <staged-root>}"
stage="${3:?usage: reconcile.sh <target> <source-sha> <staged-root>}"
runtime="$stage/deploy/periphery"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/periphery/lib.sh
source "$script_dir/lib.sh"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid Komodo Periphery source SHA.'
assert_x86_64
load_target_profile "$TARGET" "$runtime"

if [[ "$periphery_privilege" == sudo && "$(id -u)" != 0 ]]; then
  command -v sudo >/dev/null 2>&1 \
    || fail "sudo is required to reconcile target $periphery_target from a non-root account."
  # Fail closed when privilege escalation needs a human: a workflow cannot type a
  # password, and a half-privileged run is worse than no run.
  sudo -n true >/dev/null 2>&1 \
    || fail "non-interactive (passwordless) sudo is required to reconcile target $periphery_target."
  sudo_args=(-n)
  # Preserve only the generic bootstrap credential, and only when it is present.
  # --preserve-env hands it over in the environment; it never appears in argv.
  if [[ -n "${KOMODO_PERIPHERY_ONBOARDING_KEY:-}" ]]; then
    sudo_args+=(--preserve-env=KOMODO_PERIPHERY_ONBOARDING_KEY)
  fi
  # A deterministic PATH for the privileged half, independent of sudoers/sshd.
  exec sudo "${sudo_args[@]}" env \
    PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
    bash "$0" "$@"
fi
[[ "$(id -u)" == 0 ]] \
  || fail "Komodo Periphery reconcile must run as root to install the systemd unit and key material (target $periphery_target)."
[[ "$stage" == "$periphery_staging_root/incoming/$SOURCE_SHA" ]] \
  || fail "Unexpected Komodo Periphery staging root for $periphery_target: $stage"
for command_name in sha256sum ss flock journalctl; do
  command -v "$command_name" >/dev/null || fail "$command_name is required."
done
command -v "$systemctl_bin" >/dev/null || fail "$systemctl_bin is required."

load_release_manifest "$runtime/periphery.release"
artifact="$stage/$PERIPHERY_ASSET"
for staged in "$runtime/lib.sh" "$runtime/staging-root.sh" "$runtime/install.sh" \
  "$runtime/verify.sh" "$runtime/periphery.release" "$runtime/periphery.service" \
  "$runtime/targets/$TARGET/target.env" "$runtime/targets/$TARGET/periphery.config.toml" \
  "$artifact"; do
  [[ -f "$staged" && ! -L "$staged" ]] \
    || fail "Staged Komodo Periphery input is missing or unsafe: $staged"
done

# Re-prove the staging root the workflow handed over: the SHA directory and both
# of its parents must still be real directories, never symlinks.
bash "$runtime/staging-root.sh" verify "$SOURCE_SHA" "$periphery_staging_root"

# Take this host's mutation lock for the whole transaction and pass the descriptor
# down. The lock and its root belong to the host's deploy owner.
require_existing_real_dir "$periphery_lock_root" "the $periphery_target host mutation lock root"
require_existing_lock_file "$periphery_lock_file"
exec 9>"$periphery_lock_file"
flock -n 9 || fail "Another $periphery_target host mutation is running."
export PERIPHERY_DEPLOY_LOCK_FD=9

bash "$runtime/install.sh" "$TARGET" "$SOURCE_SHA" "$runtime" "$artifact"
bash "$runtime/verify.sh" "$TARGET" "$runtime"

echo "Komodo Periphery reconcile: PASS (target $periphery_target, $SOURCE_SHA)"
