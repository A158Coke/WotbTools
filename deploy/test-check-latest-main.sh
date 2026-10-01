#!/usr/bin/env bash
# latest publication: publish from current main, or from an older main whose
# service inputs are unchanged; otherwise report "superseded" (exit 10) instead of failing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git init --quiet --bare "$WORK/origin.git"
git clone --quiet "$WORK/origin.git" "$WORK/work" 2>/dev/null
cd "$WORK/work"
git config user.name CI
git config user.email ci@example.invalid
git checkout -q -b main
mkdir -p service other
printf 'a\n' > service/input
printf 'a\n' > other/file
git add .
git commit -qm first
old="$(git rev-parse HEAD)"
git push -q origin main
export PRODUCTION_INPUT_PATHS=$'service/**\n'

expect() {
  local want=$1 label=$2 status=0
  bash "$ROOT/deploy/check-latest-main.sh" "$old" >"$WORK/output" 2>&1 || status=$?
  [[ "$status" == "$want" ]] || { echo "$label: expected exit $want, got $status" >&2; cat "$WORK/output" >&2; exit 1; }
}

expect 0 'current main'

# main advances without touching this service → still publish
printf 'b\n' > other/file
git commit -qam unrelated
git push -q origin main
git checkout -q "$old"
expect 0 'main advanced, inputs unchanged'
grep -Fq "inputs are unchanged" "$WORK/output"

# main advances and changes this service's inputs → superseded, not a failure
git checkout -q main
printf 'b\n' > service/input
git commit -qam related
git push -q origin main
git checkout -q "$old"
expect 10 'main advanced, inputs changed'
grep -Fq 'Skipping latest publication' "$WORK/output"

# without declared inputs any advance counts as superseded
PRODUCTION_INPUT_PATHS='' expect 10 'no input paths declared'

echo 'latest publication publishes fresh inputs and skips superseded builds: PASS'
