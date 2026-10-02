#!/usr/bin/env bash
# Fixtures for the two Komodo safety guards shared through `lib.sh`. Everything
# runs against a disposable directory: no host path, no root, no Docker, and no
# network. The guards `exit 1`, so each case runs in its own subshell and the
# assertion is the subshell status.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

marker_value=local-tofu-state-bootstrap-v1

# run <function> <path> -> guard status (stdout/stderr discarded)
run() {
  bash -c 'source "$1"; "$2" "$3"' _ "$ROOT/lib.sh" "$1" "$2" >/dev/null 2>&1
}

accepts() {
  run "$1" "$2" || {
    echo "safe Komodo case was rejected: $1 $2" >&2
    exit 1
  }
}

rejects() {
  if run "$1" "$2"; then
    echo "unsafe Komodo case was accepted: $1 $2" >&2
    exit 1
  fi
}

state_ok() {
  local dir="$1"
  printf '%s\n' '{"version":4}' > "$dir/terraform.tfstate"
  printf '%s\n' "$marker_value" > "$dir/bootstrap-complete"
}

# require_bootstrap_state -----------------------------------------------------
fresh="$work/state/fresh"
mkdir -p "$fresh"
accepts require_bootstrap_state "$fresh"

bootstrapped="$work/state/bootstrapped"
mkdir -p "$bootstrapped"
state_ok "$bootstrapped"
accepts require_bootstrap_state "$bootstrapped"

for case in state-without-marker marker-without-state; do
  dir="$work/state/$case"
  mkdir -p "$dir"
  if [[ "$case" == state-without-marker ]]; then
    printf '%s\n' '{"version":4}' > "$dir/terraform.tfstate"
  else
    printf '%s\n' "$marker_value" > "$dir/bootstrap-complete"
  fi
  rejects require_bootstrap_state "$dir"
done

empty_state="$work/state/empty-state"
mkdir -p "$empty_state"
: > "$empty_state/terraform.tfstate"
printf '%s\n' "$marker_value" > "$empty_state/bootstrap-complete"
rejects require_bootstrap_state "$empty_state"

empty_marker="$work/state/empty-marker"
mkdir -p "$empty_marker"
printf '%s\n' '{"version":4}' > "$empty_marker/terraform.tfstate"
: > "$empty_marker/bootstrap-complete"
rejects require_bootstrap_state "$empty_marker"

wrong_marker="$work/state/wrong-marker"
mkdir -p "$wrong_marker"
printf '%s\n' '{"version":4}' > "$wrong_marker/terraform.tfstate"
printf '%s\n' 'some-other-value' > "$wrong_marker/bootstrap-complete"
rejects require_bootstrap_state "$wrong_marker"

symlink_state="$work/state/symlink-state"
mkdir -p "$symlink_state"
printf '%s\n' '{"version":4}' > "$symlink_state/real.tfstate"
printf '%s\n' "$marker_value" > "$symlink_state/bootstrap-complete"
ln -s real.tfstate "$symlink_state/terraform.tfstate"
rejects require_bootstrap_state "$symlink_state"

symlink_marker="$work/state/symlink-marker"
mkdir -p "$symlink_marker"
printf '%s\n' '{"version":4}' > "$symlink_marker/terraform.tfstate"
printf '%s\n' "$marker_value" > "$symlink_marker/real-marker"
ln -s real-marker "$symlink_marker/bootstrap-complete"
rejects require_bootstrap_state "$symlink_marker"

dangling_marker="$work/state/dangling-marker"
mkdir -p "$dangling_marker"
printf '%s\n' '{"version":4}' > "$dangling_marker/terraform.tfstate"
ln -s absent "$dangling_marker/bootstrap-complete"
rejects require_bootstrap_state "$dangling_marker"

# require_real_dir ------------------------------------------------------------
created="$work/dir/created"
accepts require_real_dir "$created"
[[ -d "$created" && ! -L "$created" ]] || { echo 'require_real_dir did not create the directory' >&2; exit 1; }
[[ "$(stat -c '%a' "$created")" == 700 ]] || { echo 'require_real_dir created an unsafe mode' >&2; exit 1; }
accepts require_real_dir "$created"

real_dir="$work/dir/real"
mkdir -p "$real_dir"
accepts require_real_dir "$real_dir"

linked_dir="$work/dir/linked"
mkdir -p "$linked_dir"
ln -s "$real_dir" "$work/dir/symlink-dir"
rejects require_real_dir "$work/dir/symlink-dir"

ln -s "$work/dir/absent" "$work/dir/dangling-dir"
rejects require_real_dir "$work/dir/dangling-dir"

regular_file="$work/dir/regular-file"
: > "$regular_file"
rejects require_real_dir "$regular_file"

echo 'Komodo safety guard fixtures: PASS'
