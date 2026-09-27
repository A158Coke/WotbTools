#!/usr/bin/env bash
# A build from an older main must stop before its latest tag can be published.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git init --quiet --bare "$WORK/origin.git"
git clone --quiet "$WORK/origin.git" "$WORK/work"
cd "$WORK/work"
git config user.name CI
git config user.email ci@example.invalid
git checkout -q -b main
printf 'a\n' > input
git add input
git commit -qm first
old="$(git rev-parse HEAD)"
git push -q origin main
bash "$ROOT/deploy/check-latest-main.sh" "$old"
printf 'b\n' > input
git commit -qam second
git push -q origin main
git checkout -q "$old"
if bash "$ROOT/deploy/check-latest-main.sh" "$old" >"$WORK/output" 2>&1; then
  echo 'Older main was allowed to publish latest.' >&2
  exit 1
fi
grep -Fq 'Skipping latest publication: main advanced' "$WORK/output"
echo 'latest publication rejects older main: PASS'
