#!/usr/bin/env bash
set -Eeuo pipefail

bootstrap_marker_value=local-tofu-state-bootstrap-v1

require_real_dir() {
  local path="$1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    install -d -m 700 "$path"
    return 0
  fi
  [[ -d "$path" && ! -L "$path" ]] || { echo "Refusing unsafe Komodo path: $path" >&2; exit 1; }
}

require_bootstrap_state() {
  local state_dir="$1"
  require_real_dir "$state_dir"
  local state_file="$state_dir/terraform.tfstate"
  local state_marker="$state_dir/bootstrap-complete"
  if [[ -e "$state_marker" || -L "$state_marker" ]]; then
    [[ -f "$state_marker" && -s "$state_marker" && ! -L "$state_marker" ]] &&
      grep -qx "$bootstrap_marker_value" "$state_marker" ||
      { echo 'Komodo OpenTofu bootstrap marker is unsafe.' >&2; exit 1; }
    [[ -f "$state_file" && -s "$state_file" && ! -L "$state_file" ]] ||
      { echo 'Local OpenTofu state is not bootstrapped or unsafe for Komodo.' >&2; exit 1; }
  elif [[ -e "$state_file" || -L "$state_file" ]]; then
    echo 'Komodo OpenTofu state exists without a completed bootstrap marker; manual recovery is required.' >&2
    exit 1
  fi
}
