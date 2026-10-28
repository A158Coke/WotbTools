#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/ci/check-repository-hygiene.sh"
ALLOWLIST="$ROOT/scripts/ci/large-file-allowlist.txt"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

expect_fail() {
  local label="$1"
  shift
  if "$@" >"$WORK/$label.log" 2>&1; then
    cat "$WORK/$label.log" >&2
    echo "expected repository hygiene failure: $label" >&2
    exit 1
  fi
}

expect_pass() {
  local label="$1"
  shift
  if ! "$@" >"$WORK/$label.log" 2>&1; then
    cat "$WORK/$label.log" >&2
    echo "expected repository hygiene success: $label" >&2
    exit 1
  fi
}

repo="$WORK/repo"
git init -q -b main "$repo"
cd "$repo"
git config user.name "repository-hygiene-test"
git config user.email "repository-hygiene-test@example.invalid"
printf 'baseline\n' > README.md
git add README.md
git commit -q -m baseline
base=$(git rev-parse HEAD)

# A small generated frontend bundle must fail even though it is well below the
# generic 5 MiB size limit.
git switch -q -c generated-dist "$base"
mkdir -p frontend/dist/assets
printf 'generated\n' > frontend/dist/assets/app.js
git add -f frontend/dist/assets/app.js
git commit -q -m 'add generated dist output'
head=$(git rev-parse HEAD)
expect_fail generated-dist env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# A large blob added in one commit and deleted in the next must still fail: it
# remains reachable from the PR commit history even though the final tree is clean.
git switch -q -C add-delete "$base"
python3 - <<'PY'
from pathlib import Path
Path("large.bin").write_bytes(b"x" * (6 * 1024 * 1024))
PY
git add large.bin
git commit -q -m 'add temporary large blob'
git rm -q large.bin
git commit -q -m 'remove temporary large blob'
head=$(git rev-parse HEAD)
expect_fail add-delete env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Git permits pathnames containing newlines. History inspection must remain
# NUL-safe so an oversized add-then-delete blob cannot hide behind line parsing.
git switch -q -C add-delete-special-path "$base"
special_path=$'\nlarge.bin'
python3 - "$special_path" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[1]).write_bytes(b"x" * (6 * 1024 * 1024))
PY
git add -- "$special_path"
git commit -q -m 'add temporary large blob with special path'
git rm -q -- "$special_path"
git commit -q -m 'remove temporary large blob with special path'
head=$(git rev-parse HEAD)
expect_fail add-delete-special-path env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Normal small source changes remain allowed.
git switch -q -C clean-change "$base"
mkdir -p src
printf 'ok\n' > src/example.txt
git add src/example.txt
git commit -q -m 'add small source file'
head=$(git rev-parse HEAD)
expect_pass clean-change env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

echo "repository hygiene regression tests: PASS"
