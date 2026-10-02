#!/usr/bin/env bash
# Shared Komodo controller helpers, sourced by `deploy.sh`, `reconcile.sh`, and
# the local guard fixtures. Keeping them here means the two safety rules below
# have exactly one audited implementation.
set -Eeuo pipefail

# The only accepted content of `tofu-state/bootstrap-complete`.
bootstrap_marker_value=local-tofu-state-bootstrap-v1

# require_real_dir <path>
#
# Create the directory or refuse to continue. An existing path must be a real
# directory: a symlinked owner root, state directory, or backup directory would
# let a later promotion or cleanup escape the controller root, so it fails closed
# instead of following the link.
require_real_dir() {
  local path="$1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    install -d -m 700 "$path"
    return 0
  fi
  [[ -d "$path" && ! -L "$path" ]] || { echo "Refusing unsafe Komodo path: $path" >&2; exit 1; }
}

# require_bootstrap_state <state_dir>
#
# Production state is owner-host local and its bootstrap is irreversible. Either
# a state file without a completed marker, or a marker without its state, an
# empty file, or any symlink is corruption: fail closed instead of silently
# initializing empty production state. Only a completely absent pair is a
# legitimate first bootstrap.
require_bootstrap_state() {
  local state_dir="$1"
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
