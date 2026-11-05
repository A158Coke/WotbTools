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

# Same as expect_fail, but also proves the failure came from the intended gate
# rather than any unrelated error: the log must contain the expected message.
expect_fail_msg() {
  local label="$1"
  local pattern="$2"
  shift 2
  expect_fail "$label" "$@"
  grep -q -e "$pattern" "$WORK/$label.log" || {
    echo "expected failure message not found for $label: $pattern" >&2
    cat "$WORK/$label.log" >&2
    exit 1
  }
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
cp "$ROOT/.gitignore" .gitignore
git add README.md .gitignore
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

# Generated/local-only paths declared by .gitignore are policy too. Many small
# files must not bypass the generic per-file size limit when force-added.
git switch -q -C ignored-many-small "$base"
mkdir -p common/assets/map-3d-local
python3 - <<'PY'
from pathlib import Path
root = Path("common/assets/map-3d-local")
for index in range(8):
    (root / f"tile-{index}.bin").write_bytes(b"x" * (1024 * 1024))
PY
git add -f common/assets/map-3d-local
git commit -q -m 'force add ignored generated map assets'
head=$(git rev-parse HEAD)
expect_fail ignored-many-small env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Explicit .gitignore negations remain valid source-of-truth exceptions. Replay
# fixtures intentionally tracked by the repository must still pass.
git switch -q -C ignored-exception "$base"
mkdir -p common/fixtures/replays
printf 'fixture\n' > common/fixtures/replays/allowed.wotbreplay
git add common/fixtures/replays/allowed.wotbreplay
git commit -q -m 'add allowed replay fixture'
head=$(git rev-parse HEAD)
expect_pass ignored-exception env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

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

# Lifecycle governance: history-parking directories are banned outright in the
# tracked tree.
git switch -q -C archive-dir "$base"
mkdir -p archive
printf 'stale\n' > archive/notes.md
git add archive/notes.md
git commit -q -m 'add archive directory'
head=$(git rev-parse HEAD)
expect_fail_msg archive-dir "history-parking directory" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# A parking-directory blob added and deleted inside the range must still fail:
# it entered the commit trees the event introduces.
git switch -q -C parking-dir-transient "$base"
mkdir -p old
printf 'stale\n' > old/notes.md
git add old/notes.md
git commit -q -m 'add old directory'
git rm -q old/notes.md
git commit -q -m 'remove old directory'
head=$(git rev-parse HEAD)
expect_fail_msg parking-dir-transient "history-parking directory" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Permanent source must not cite the ephemeral planning artifact as authority.
git switch -q -C plan-reference "$base"
mkdir -p src
printf 'split plan: see docs/current-plan.md\n' > src/notes.js
git add src/notes.js
git commit -q -m 'add source citing the planning artifact'
head=$(git rev-parse HEAD)
expect_fail_msg plan-reference "ephemeral planning artifact" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# A root-level file whose name parses as a grep option must not bypass the
# reference gate: the checker must pass `--` to grep and treat a grep execution
# error as fatal (fail closed), never as a clean file.
git switch -q -C plan-reference-dash "$base"
printf 'split plan: see docs/current-plan.md\n' > ./-plan-ref.md
git add ./-plan-ref.md
git commit -q -m 'cite planning artifact from a dash-prefixed filename'
head=$(git rev-parse HEAD)
expect_fail_msg plan-reference-dash "ephemeral planning artifact" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Lifecycle skill/playbook files own the plan-carrier mechanism and stay allowed.
git switch -q -C plan-reference-allowlist "$base"
mkdir -p .agents/skills
printf '唯一执行载体 docs/current-plan.md\n' > .agents/skills/example.md
git add .agents/skills/example.md
git commit -q -m 'add allowlisted lifecycle doc citing the plan carrier'
head=$(git rev-parse HEAD)
expect_pass plan-reference-allowlist env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Source-line budget (#820): an unlisted first-party production file over 1500
# physical lines must fail, and the failure must come from this gate.
git switch -q -C source-line-unlisted "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.js").write_text("// line\n" * 1501)
PY
git add frontend/src/oversized.js
git commit -q -m 'add oversized first-party source file'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-unlisted "first-party frontend source exceeds" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Exactly at the budget passes: the limit is inclusive.
git switch -q -C source-line-at-limit "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/at-limit.ts").write_text("// line\n" * 1500)
PY
git add frontend/src/at-limit.ts
git commit -q -m 'add source file exactly at the line budget'
head=$(git rev-parse HEAD)
expect_pass source-line-at-limit env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Tests, declaration files and generated transport are not production source
# and stay out of scope even when they are large.
git switch -q -C source-line-exempt "$base"
mkdir -p frontend/src/api/generated
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.test.js").write_text("// test\n" * 1600)
Path("frontend/src/oversized.d.ts").write_text("// types\n" * 1600)
Path("frontend/src/api/generated/oversized.ts").write_text("// generated\n" * 1600)
PY
git add frontend/src
git commit -q -m 'add large test, declaration and generated files'
head=$(git rev-parse HEAD)
expect_pass source-line-exempt env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# An exact allowlist entry admits an existing over-budget file.
git switch -q -C source-line-allowlisted "$base"
mkdir -p frontend/src scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.js").write_text("// line\n" * 1501)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/oversized.js\n")
PY
git add frontend/src/oversized.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'add allowlisted oversized source file'
head=$(git rev-parse HEAD)
expect_pass source-line-allowlisted env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# The allowlist is a one-way ratchet: a new entry added in the event range fails
# even when every individual file is allowlisted in the head tree.
git switch -q -C source-line-allowlist-growth "$base"
mkdir -p frontend/src scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/existing.js").write_text("// line\n" * 1501)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/existing.js\n")
PY
git add frontend/src/existing.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'seed the source-line allowlist'
growth_base=$(git rev-parse HEAD)
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/new.js").write_text("// line\n" * 1501)
Path("scripts/ci/source-line-allowlist.txt").write_text(
    "frontend/src/existing.js\nfrontend/src/new.js\n"
)
PY
git add frontend/src/new.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'grow the source-line allowlist'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-allowlist-growth "source-line allowlist must not grow" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$growth_base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Once the gate exists, retiring the last exception (deleting the allowlist)
# must not reset the ratchet: a later change that recreates the file with a new
# entry is growth from zero, not a first-time introduction.
git switch -q -C source-line-allowlist-recreated "$base"
mkdir -p frontend/src scripts/ci
cp "$CHECK" scripts/ci/check-repository-hygiene.sh
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/existing.js").write_text("// line\n" * 1501)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/existing.js\n")
PY
git add scripts/ci/check-repository-hygiene.sh frontend/src/existing.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'seed the source-line gate and its allowlist'
git rm -q frontend/src/existing.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'retire the last source-line exception'
recreated_base=$(git rev-parse HEAD)
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/new.js").write_text("// line\n" * 1501)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/new.js\n")
PY
git add frontend/src/new.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'recreate the deleted source-line allowlist'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-allowlist-recreated "source-line allowlist must not grow" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$recreated_base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# A limit that Bash would parse as octal must abort the gate, not disable the
# comparison. The 1501-line file proves the gate did not silently pass.
git switch -q -C source-line-invalid-limit "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.js").write_text("// line\n" * 1501)
PY
git add frontend/src/oversized.js
git commit -q -m 'add oversized file for an invalid-limit fixture'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-invalid-limit "MAX_SOURCE_LINES must be a non-negative decimal integer without leading zeros" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" MAX_SOURCE_LINES=08 bash "$CHECK"

# --- Source-line gate increments (PR #889 on top of #883) ---
# The normal split flow must pass even though early commits still hold the
# over-budget blob: base pins the legacy file, an intermediate commit only
# touches a README, and the final commit shrinks the file and retires the entry.
git switch -q -C source-line-split-in-range "$base"
mkdir -p frontend/src scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 1601)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/legacy.js\n")
PY
git add frontend/src/legacy.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'base: pinned legacy file'
split_base=$(git rev-parse HEAD)
printf 'more\n' >> README.md
git add README.md
git commit -q -m 'intermediate commit that still carries the over-budget blob'
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 1500)
PY
git rm -q scripts/ci/source-line-allowlist.txt
git add frontend/src/legacy.js
git commit -q -m 'shrink the legacy file and retire its entry'
head=$(git rev-parse HEAD)
expect_pass source-line-split-in-range env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$split_base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# An oversized blob committed together with a temporary allowlist entry that is
# removed later must still fail: entries that exist neither at the base nor at
# HEAD legitimize nothing in the history gate.
git switch -q -C source-line-history-evasion "$base"
mkdir -p frontend/src scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/flash.js").write_text("// line\n" * 1501)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/flash.js\n")
PY
git add frontend/src/flash.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'temporarily shield an oversized blob with a new entry'
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/flash.js").write_text("// line\n" * 1500)
PY
git rm -q scripts/ci/source-line-allowlist.txt
git add frontend/src/flash.js
git commit -q -m 'shrink the file and remove the temporary entry'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-history-evasion "first-party frontend source exceeds" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Deleting a legacy file without retiring its entry leaves a dead exception
# that could shield a future re-created file at the same path.
git switch -q -C source-line-entry-deleted "$base"
mkdir -p frontend/src scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 1601)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/legacy.js\n")
PY
git add frontend/src/legacy.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'base: pinned legacy file'
deleted_base=$(git rev-parse HEAD)
git rm -q frontend/src/legacy.js
git commit -q -m 'delete the legacy file but keep its allowlist entry'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-entry-deleted "no longer points at an over-budget tracked first-party source" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$deleted_base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# The same dead-entry rule covers a file that was shrunk below the budget
# without retiring its entry.
git switch -q -C source-line-entry-shrunk "$base"
mkdir -p frontend/src scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 1601)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/legacy.js\n")
PY
git add frontend/src/legacy.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'base: pinned legacy file'
shrunk_base=$(git rev-parse HEAD)
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 1500)
PY
git add frontend/src/legacy.js
git commit -q -m 'shrink the legacy file below the budget but keep its entry'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-entry-shrunk "no longer points at an over-budget tracked first-party source" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$shrunk_base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# A duplicated allowlist entry silently inflates the entry count the ratchet
# compares, so duplicates must abort the gate (exit 2), never pass.
git switch -q -C source-line-allowlist-duplicate "$base"
mkdir -p frontend/src scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 1601)
Path("scripts/ci/source-line-allowlist.txt").write_text(
    "frontend/src/legacy.js\nfrontend/src/legacy.js\n"
)
PY
git add frontend/src/legacy.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'duplicate the same allowlist entry'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-allowlist-duplicate "duplicate source-line allowlist entry" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# User-configurable numeric values that Bash would misread (octal, negative,
# non-numeric) or that overflow intmax_t must abort the gate, never disable it.
git switch -q -C source-line-invalid-limit-forms "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.js").write_text("// line\n" * 1501)
PY
git add frontend/src/oversized.js
git commit -q -m 'add oversized file for invalid numeric limit fixtures'
head=$(git rev-parse HEAD)
for bad_limit in 01609 1912345678901234567 -1 15o0; do
  expect_fail_msg "source-line-invalid-limit-forms-${bad_limit}" "MAX_SOURCE_LINES" \
    env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" \
    LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" MAX_SOURCE_LINES="$bad_limit" bash "$CHECK"
done

echo "repository hygiene regression tests: PASS"
