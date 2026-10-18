#!/usr/bin/env bash
# One-time bridge for a host that completed Komodo onboarding before the
# repository-owned Periphery lifecycle was attached to it.
#
# This script never onboards a host and never accepts a bootstrap credential. It
# only commits the lifecycle's durable onboarding marker after independently
# proving that the *currently running* Periphery process already uses the reviewed
# Server identity/Core route, is connected to that reviewed peer, has persistent
# identity/trust files, exposes no inbound 8120, and has no runtime environment
# override that can change effective Periphery configuration.
#
# On a fresh/rebuilt host with no active established agent this is a no-op; the
# normal install.sh state machine remains responsible for bootstrap (using the
# optional workflow onboarding secret) and commits the same marker itself.
set -Eeuo pipefail
umask 077

TARGET="${1:?usage: adopt-existing.sh <target>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/periphery/lib.sh
source "$script_dir/lib.sh"

[[ "$(id -u)" == 0 ]] || fail 'Existing Periphery adoption must run as root.'
load_target_profile "$TARGET" "$script_dir"

# Adoption writes the durable marker, so it shares the host mutation lock with
# every normal reconcile instead of creating an uncoordinated bootstrap mutation.
require_existing_real_dir "$periphery_lock_root" "the $periphery_target host mutation lock root"
require_existing_lock_file "$periphery_lock_file"
exec 9>"$periphery_lock_file"
flock -n 9 || fail "Another $periphery_target host mutation is running."

marker_state="$(periphery_marker_state)"
case "$marker_state" in
  valid)
    echo "Komodo Periphery lifecycle marker already committed on $periphery_target."
    exit 0
    ;;
  absent) ;;
  *) fail 'Refusing existing-agent adoption because the onboarding marker is corrupt or unsafe.' ;;
esac

# A fresh/rebuilt host is not an adoption candidate. Leave it untouched so the
# normal reconcile may bootstrap it if a reviewed onboarding key is available.
if ! service_active; then
  echo "No active existing Periphery service on $periphery_target; leaving onboarding to the normal lifecycle."
  exit 0
fi

pid="$(main_pid 2>/dev/null || true)"
[[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 0 ]] \
  || fail 'Active Periphery service has no valid MainPID; refusing adoption.'
periphery_identity_present \
  || fail 'Active Periphery service has no safe persistent identity; refusing adoption.'
periphery_core_pub_present \
  || fail 'Active Periphery service has no pinned Core public key; refusing adoption.'
[[ ! -e "$periphery_bootstrap_env" && ! -L "$periphery_bootstrap_env" ]] \
  || fail 'Transient Periphery bootstrap environment still exists; refusing adoption.'

process_env_state=0
process_env_is_clean "$pid" || process_env_state=$?
[[ "$process_env_state" == 0 ]] \
  || fail "Refusing adoption: $(process_env_state_label "$process_env_state")."

# Komodo v2.3.3 applies PERIPHERY_* environment variables on top of TOML,
# including *_FILE credential/identity sources and boolean/string aliases such as
# CONNECT_AS, ROOT_DIRECTORY, PRIVATE_KEY, CORE_ADDRESSES and TLS flags. The
# repository-owned unit deliberately needs none of those during steady state.
# Therefore adoption is fail-closed on *any* PERIPHERY_* entry in the live
# process environment: otherwise validating only the TOML could certify an
# identity/Core route that the running process is not actually using.
process_environ="$periphery_proc_root/$pid/environ"
[[ -r "$process_environ" && -f "$process_environ" ]] \
  || fail 'Refusing adoption because the live Periphery environment cannot be inspected.'
if tr '\0' '\n' < "$process_environ" | grep -Eq '^PERIPHERY_[A-Za-z0-9_]+='; then
  fail 'Refusing adoption because the live Periphery process has a PERIPHERY_* environment override.'
fi

[[ -f "$periphery_config" && ! -L "$periphery_config" ]] \
  || fail 'Installed Periphery config is missing or unsafe; refusing adoption.'
if grep -Eq '^[[:space:]]*onboarding_key[[:space:]]*=' "$periphery_config"; then
  fail 'Installed Periphery config still contains an onboarding key; refusing adoption.'
fi

# The manually installed host can use Komodo's legacy singular `core_address`
# while the reviewed target uses `core_addresses`. Parse TOML and normalize only
# representation/default differences that are semantically identical; every
# effective identity/Core/operator setting must otherwise match the reviewed target.
validator="$script_dir/validate-adoption-config.py"
require_real_file "$validator" 'Periphery adoption config validator'
python3 "$validator" "$periphery_config" "$periphery_config_source" "$periphery_connect_as" \
  || fail 'Installed Periphery identity/Core config does not match the reviewed target.'

[[ -n "$(established_core_connections "$pid")" ]] \
  || fail "Active Periphery process has no established connection to reviewed Core peer $periphery_core_peer_match."
[[ -z "$(listener_on_8120)" ]] \
  || fail 'Periphery inbound port 8120 is listening; refusing outbound-only adoption.'

incoming="$periphery_marker.incoming"
[[ ! -e "$incoming" && ! -L "$incoming" ]] \
  || fail "Refusing to replace unexpected marker staging path: $incoming"
printf '%s\n' "$periphery_marker_content" > "$incoming"
chmod 600 "$incoming"
chown root:root "$incoming"
mv -- "$incoming" "$periphery_marker"
[[ "$(periphery_marker_state)" == valid ]] \
  || fail 'Failed to commit a valid Komodo Periphery onboarding marker.'

echo "Adopted already-onboarded Periphery lifecycle on $periphery_target without a bootstrap credential."
