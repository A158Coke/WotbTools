#!/usr/bin/env bash
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
  sudo -n true >/dev/null 2>&1 \
    || fail "non-interactive (passwordless) sudo is required to reconcile target $periphery_target."
  sudo_args=(-n)
  if [[ -n "${KOMODO_PERIPHERY_ONBOARDING_KEY:-}" ]]; then
    sudo_args+=(--preserve-env=KOMODO_PERIPHERY_ONBOARDING_KEY)
  fi
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

bash "$runtime/staging-root.sh" verify "$SOURCE_SHA" "$periphery_staging_root"

require_existing_real_dir "$periphery_lock_root" "the $periphery_target host mutation lock root"
require_existing_lock_file "$periphery_lock_file"
exec 9>"$periphery_lock_file"
periphery_lock_wait="${PERIPHERY_LOCK_WAIT_SEC:-900}"
if ! flock -w "$periphery_lock_wait" 9; then
  echo "Another $periphery_target host mutation is running (waited ${periphery_lock_wait}s)." >&2
  if command -v lsof >/dev/null 2>&1; then
    echo "Current lock file holders:" >&2
    lsof "$periphery_lock_file" >&2 || true
  elif command -v fuser >/dev/null 2>&1; then
    echo "Current lock file holders:" >&2
    fuser -v "$periphery_lock_file" >&2 || true
  fi
  fail "the $periphery_target host mutation lock was not released within ${periphery_lock_wait}s."
fi
export PERIPHERY_DEPLOY_LOCK_FD=9

bash "$runtime/install.sh" "$TARGET" "$SOURCE_SHA" "$runtime" "$artifact"
bash "$runtime/verify.sh" "$TARGET" "$runtime"

echo "Komodo Periphery reconcile: PASS (target $periphery_target, $SOURCE_SHA)"
