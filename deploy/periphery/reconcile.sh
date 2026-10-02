#!/usr/bin/env bash
# Komodo Periphery reconcile on Yecao (K3.1).
#
# Standalone owner: GitHub Actions owns the Periphery systemd lifecycle, Komodo
# Core owns only the Server relationship. This script never touches Core, Caddy,
# DNS, or the Komodo controller runtime.
#
# Order: preflight -> staging re-proof -> Yecao host lock -> install ->
# verification. The lock is held across the install AND the verification, so no
# other Yecao host mutation can interleave with it.
set -Eeuo pipefail
umask 077

SOURCE_SHA="${1:?usage: reconcile.sh <source-sha> <staged-root>}"
stage="${2:?usage: reconcile.sh <source-sha> <staged-root>}"
runtime="$stage/deploy/periphery"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/periphery/lib.sh
source "$script_dir/lib.sh"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid Komodo Periphery source SHA.'
assert_x86_64
[[ "$stage" == "$periphery_opt_root/incoming/$SOURCE_SHA" ]] \
  || fail "Unexpected Komodo Periphery staging root: $stage"
for command_name in sha256sum ss flock journalctl; do
  command -v "$command_name" >/dev/null || fail "$command_name is required."
done
command -v "$systemctl_bin" >/dev/null || fail "$systemctl_bin is required."

load_release_manifest "$runtime/periphery.release"
artifact="$stage/$PERIPHERY_ASSET"
for staged in "$runtime/lib.sh" "$runtime/staging-root.sh" "$runtime/install.sh" \
  "$runtime/verify.sh" "$runtime/periphery.config.toml" "$runtime/periphery.service" \
  "$artifact"; do
  [[ -f "$staged" && ! -L "$staged" ]] \
    || fail "Staged Komodo Periphery input is missing or unsafe: $staged"
done

# Re-prove the staging root the workflow handed over: the SHA directory and both
# of its parents must still be real directories, never symlinks.
bash "$runtime/staging-root.sh" verify "$SOURCE_SHA" "$periphery_opt_root"

# Take the Yecao host lock for the whole transaction and pass the descriptor down.
require_real_dir "$periphery_opt_root"
require_real_dir "$periphery_wotb_root"
exec 9>"$periphery_wotb_root/.deploy.lock"
flock -n 9 || fail 'Another Yecao host mutation is running.'
export PERIPHERY_DEPLOY_LOCK_FD=9

bash "$runtime/install.sh" "$SOURCE_SHA" "$runtime" "$artifact"
bash "$runtime/verify.sh" "$runtime"

echo "Komodo Periphery reconcile: PASS ($SOURCE_SHA)"
