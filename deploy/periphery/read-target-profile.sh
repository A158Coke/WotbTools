#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="${1:?usage: read-target-profile.sh <target> [output-file]}"
output="${2:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
