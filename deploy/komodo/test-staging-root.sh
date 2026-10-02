#!/usr/bin/env bash
# Fixtures for the audited staging-root helper. Everything runs against a
# disposable root: no host path, no root, no SSH, and no network. The helper
# `exit 1`/`exit 2` on every unsafe case, so the assertion is the process status
# plus the on-disk effect of a refused cleanup.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

sha=0123456789abcdef0123456789abcdef01234567
other_sha=fedcba9876543210fedcba9876543210fedcba98

# run <action> <sha> <root> -> helper status (output discarded)
run() {
  bash "$ROOT/staging-root.sh" "$1" "$2" "$3" >/dev/null 2>&1
}

# run_env <action> <sha> <root> -> same, through the environment-only invocation
# the workflow uses with `script_path` (no argv).
run_env() {
  env KOMODO_STAGING_ACTION="$1" SOURCE_SHA="$2" KOMODO_STAGING_ROOT="$3" \
    bash "$ROOT/staging-root.sh" >/dev/null 2>&1
}

accepts() {
  run "$1" "$2" "$3" || { echo "safe staging case was rejected: $1 $2 $3" >&2; exit 1; }
}

rejects() {
  if run "$1" "$2" "$3"; then
    echo "unsafe staging case was accepted: $1 $2 $3" >&2
    exit 1
  fi
}

is_real_dir_mode_700() {
  [[ -d "$1" && ! -L "$1" && "$(stat -c '%a' "$1")" == 700 ]]
}

# --- argument validation -----------------------------------------------------
if bash "$ROOT/staging-root.sh" destroy "$sha" "$work/x" >/dev/null 2>&1; then
  echo 'an unknown staging-root action was accepted' >&2
  exit 1
fi
if bash "$ROOT/staging-root.sh" prepare not-a-sha "$work/x" >/dev/null 2>&1; then
  echo 'a malformed staging SHA was accepted' >&2
  exit 1
fi
if bash "$ROOT/staging-root.sh" prepare "" "$work/x" >/dev/null 2>&1; then
  echo 'a missing staging SHA was accepted' >&2
  exit 1
fi
for bad_root in relative/path /tmp/../etc; do
  if bash "$ROOT/staging-root.sh" prepare "$sha" "$bad_root" >/dev/null 2>&1; then
    echo "an unsafe staging root was accepted: $bad_root" >&2
    exit 1
  fi
done

# --- fresh root --------------------------------------------------------------
fresh="$work/fresh"
accepts prepare "$sha" "$fresh"
is_real_dir_mode_700 "$fresh" || { echo 'prepare did not create a safe root' >&2; exit 1; }
is_real_dir_mode_700 "$fresh/incoming" || { echo 'prepare did not create a safe incoming dir' >&2; exit 1; }
is_real_dir_mode_700 "$fresh/incoming/$sha" || { echo 'prepare did not create a safe staging dir' >&2; exit 1; }
accepts verify "$sha" "$fresh"
# The environment-only invocation the workflow uses must work too.
run_env prepare "$sha" "$fresh" || { echo 'environment-driven prepare failed' >&2; exit 1; }

# --- existing safe root ------------------------------------------------------
accepts prepare "$sha" "$fresh"
printf '%s\n' 'staged' > "$fresh/incoming/$sha/deploy-marker"
accepts cleanup "$sha" "$fresh"
[[ ! -e "$fresh/incoming/$sha" ]] || { echo 'cleanup did not remove the staging directory' >&2; exit 1; }
is_real_dir_mode_700 "$fresh" || { echo 'cleanup damaged the staging root' >&2; exit 1; }
is_real_dir_mode_700 "$fresh/incoming" || { echo 'cleanup damaged the incoming directory' >&2; exit 1; }
# A missing staging directory is a no-op, not a failure.
accepts cleanup "$other_sha" "$fresh"
run_env cleanup "$sha" "$fresh" || { echo 'environment-driven cleanup failed' >&2; exit 1; }
run_env cleanup "$other_sha" "$fresh" || { echo 'environment-driven no-op cleanup failed' >&2; exit 1; }

# --- unsafe component types --------------------------------------------------
# Built once, then every action must refuse each of them.
symlink_root="$work/symlink-root"
mkdir -p "$work/real-root/incoming"
ln -s "$work/real-root" "$symlink_root"

symlink_incoming="$work/symlink-incoming"
mkdir -p "$symlink_incoming" "$work/real-incoming/$sha"
ln -s "$work/real-incoming" "$symlink_incoming/incoming"

dangling_root="$work/dangling-root"
ln -s "$work/absent-root" "$dangling_root"

dangling_incoming="$work/dangling-incoming"
mkdir -p "$dangling_incoming"
ln -s "$work/absent-incoming" "$dangling_incoming/incoming"

file_root="$work/file-root"
: > "$file_root"

file_incoming="$work/file-incoming"
mkdir -p "$file_incoming"
: > "$file_incoming/incoming"

dangling_staging="$work/dangling-staging"
mkdir -p "$dangling_staging/incoming"
ln -s "$work/absent-staging" "$dangling_staging/incoming/$sha"

for action in prepare verify cleanup; do
  for unsafe_root in \
    "$symlink_root" "$symlink_incoming" "$dangling_root" "$dangling_incoming" \
    "$file_root" "$file_incoming" "$dangling_staging"; do
    rejects "$action" "$sha" "$unsafe_root"
  done
  # Nothing behind a refused component may be touched.
  [[ -d "$work/real-root" ]] || { echo 'a symlinked root was followed' >&2; exit 1; }
  [[ -d "$work/real-incoming/$sha" ]] || { echo 'a symlinked incoming dir was followed' >&2; exit 1; }
done

# A symlinked staging directory must never be followed, and cleanup must leave
# whatever it points at untouched.
victim="$work/victim"
symlink_staging="$work/symlink-staging"
mkdir -p "$victim" "$symlink_staging/incoming"
printf '%s\n' 'must survive' > "$victim/precious"
ln -s "$victim" "$symlink_staging/incoming/$sha"
rejects prepare "$sha" "$symlink_staging"
rejects verify "$sha" "$symlink_staging"
rejects cleanup "$sha" "$symlink_staging"
[[ -f "$victim/precious" ]] || { echo 'cleanup followed a symlinked staging directory' >&2; exit 1; }

# A regular file where the staging directory belongs is refused, not replaced.
file_staging="$work/file-staging"
mkdir -p "$file_staging/incoming"
: > "$file_staging/incoming/$sha"
rejects prepare "$sha" "$file_staging"
rejects verify "$sha" "$file_staging"
rejects cleanup "$sha" "$file_staging"
[[ -f "$file_staging/incoming/$sha" ]] || { echo 'a staged regular file was deleted' >&2; exit 1; }

# --- unsafe roots are never created -----------------------------------------
absent_root="$work/never-created"
rejects prepare "$sha" "$absent_root/../never-created"
[[ ! -e "$work/never-created" ]] || { echo 'an unsafe root was created' >&2; exit 1; }

echo 'Komodo staging-root guard fixtures: PASS'
