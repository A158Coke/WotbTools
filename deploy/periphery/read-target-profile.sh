#!/usr/bin/env bash
# Read a Komodo Periphery target profile and expose it to the workflow (K3.2).
#
# The reviewed host parameters are repository data
# (`targets/<target>/target.env`), never inline YAML. This helper runs the same
# `load_target_profile` validation the host scripts use, so a profile cannot be
# valid in CI and invalid on the host.
#
#   read-target-profile.sh <target> [output-file]
#
# Writes `connect_as`, `lock_root`, `staging_root`, and `privilege` as
# `key=value` lines (GitHub step outputs when given "$GITHUB_OUTPUT").
set -Eeuo pipefail

TARGET="${1:?usage: read-target-profile.sh <target> [output-file]}"
output="${2:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/periphery/lib.sh
source "$script_dir/lib.sh"

load_target_profile "$TARGET" "$script_dir"

if [[ -n "$output" ]]; then
  {
    echo "connect_as=$periphery_connect_as"
    echo "lock_root=$periphery_lock_root"
    echo "staging_root=$periphery_staging_root"
    echo "privilege=$periphery_privilege"
  } >> "$output"
fi
echo "target profile $periphery_target: connect_as=$periphery_connect_as lock=$periphery_lock_file staging=$periphery_staging_root privilege=$periphery_privilege"
