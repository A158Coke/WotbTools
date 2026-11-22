#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/ci/check-repository-hygiene.sh"
SOURCE_LINES_CHECK="$ROOT/scripts/ci/check-source-lines.py"
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

# Guard regression fixtures against Python double-escaped "\\n": a supposed
# 601-line failure sample accidentally becoming one physical line is a false
# positive/negative in the source-line budget tests.
expect_fixture_lines() {
  local path="$1" expected="$2" actual
  actual=$(awk 'END { print NR }' "$path")
  if [[ "$actual" != "$expected" ]]; then
    echo "fixture physical-line mismatch: $path expected=$expected actual=$actual" >&2
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

# Source-line budget (#820): an unlisted first-party production file over 500
# physical lines must fail, and the failure must come from this gate.
git switch -q -C source-line-unlisted "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.js").write_text("// line\n" * 501)
PY
git add frontend/src/oversized.js
git commit -q -m 'add oversized first-party source file'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-unlisted "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# Exactly at the budget passes: the limit is inclusive.
git switch -q -C source-line-at-limit "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/at-limit.ts").write_text("// line\n" * 500)
PY
git add frontend/src/at-limit.ts
git commit -q -m 'add source file exactly at the line budget'
head=$(git rev-parse HEAD)
expect_pass source-line-at-limit python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# Strict full-tree enforcement: no grandfathering. An over-limit production
# file fails even when it is byte-for-byte identical to the base commit, and a
# modification cannot rescue it either.
git switch -q -C source-line-preexisting-unchanged "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/old-large.js").write_text("// existing\n" * 601)
PY
git add frontend/src/old-large.js
git commit -q -m 'baseline with a pre-existing large source file'
legacy_base=$(git rev-parse HEAD)
printf 'unrelated\n' > unrelated.txt
git add unrelated.txt
git commit -q -m 'unrelated source-free edit'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-preexisting-unchanged "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$legacy_base" --head "$head"
printf '// changed\n' >> frontend/src/old-large.js
git add frontend/src/old-large.js
git commit -q -m 'modify a still oversized legacy source file'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-preexisting-modified "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$legacy_base" --head "$head"


# Backend Java production code follows the same limit as frontend code.
git switch -q -C source-line-backend-over-limit "$base"
mkdir -p java/wotb-web/src/main/java/com/wotb/web
python3 - <<'PY'
from pathlib import Path
Path("java/wotb-web/src/main/java/com/wotb/web/BigService.java").write_text("// java\n" * 501)
PY
git add java/wotb-web/src/main/java/com/wotb/web/BigService.java
git commit -q -m 'add over-budget Java backend source'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-backend-over-limit "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

git switch -q -C source-line-backend-at-limit "$base"
mkdir -p java/wotb-core/src/main/java/com/wotb/core
python3 - <<'PY'
from pathlib import Path
Path("java/wotb-core/src/main/java/com/wotb/core/AtLimit.java").write_text("// java\n" * 500)
PY
git add java/wotb-core/src/main/java/com/wotb/core/AtLimit.java
git commit -q -m 'add Java backend source exactly at the budget'
head=$(git rev-parse HEAD)
expect_pass source-line-backend-at-limit python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# Backend Keycloak providers and the Android native client are production code.
git switch -q -C source-line-keycloak-over-limit "$base"
mkdir -p keycloak-wargaming-provider/src/main/java/com/wotb
python3 - <<'PY'
from pathlib import Path
Path("keycloak-wargaming-provider/src/main/java/com/wotb/BigProvider.java").write_text("// java\n" * 501)
PY
git add keycloak-wargaming-provider
git commit -q -m 'add over-budget Keycloak provider source'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-keycloak-over-limit "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

git switch -q -C source-line-android-over-limit "$base"
mkdir -p android/app/src/main/java/com/wotbtools/app
python3 - <<'PY'
from pathlib import Path
Path("android/app/src/main/java/com/wotbtools/app/BigController.kt").write_text("// kotlin\n" * 501)
PY
git add android/app/src/main/java
git commit -q -m 'add over-budget Android Kotlin source'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-android-over-limit "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# Tests and generated transport are not production source and stay out of
# scope even when they are large.
git switch -q -C source-line-exempt "$base"
mkdir -p frontend/src/api/generated
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.test.js").write_text("// test\n" * 1500)
Path("frontend/src/api/generated/oversized.ts").write_text("// generated\n" * 1600)
PY
git add frontend/src
git commit -q -m 'add large test and generated files'
head=$(git rev-parse HEAD)
expect_pass source-line-exempt python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# A hand-written declaration file is maintained type source, not generated
# output: an oversized *.d.ts must fail the production budget.
git switch -q -C source-line-declaration-over-limit "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.d.ts").write_text("// types\n" * 1600)
PY
git add frontend/src/oversized.d.ts
git commit -q -m 'add over-budget hand-written declaration file'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-declaration-over-limit "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# The allowlist mechanism is deleted. Recreating the file must not shield an
# over-budget production file: the head tree alone decides, no exceptions.
git switch -q -C source-line-allowlist-recreated "$base"
mkdir -p frontend/src scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/oversized.js").write_text("// line\n" * 501)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/oversized.js\n")
PY
git add frontend/src/oversized.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'attempt to shield an oversized file via a recreated allowlist'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-allowlist-recreated "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# --- Source-line gate strict full-tree semantics ---
# Splitting a legacy over-budget file inside one PR passes: the final head tree
# is at or below the budget, which is all the strict gate judges.
git switch -q -C source-line-split-in-range "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 601)
PY
git add frontend/src/legacy.js
git commit -q -m 'base: pinned legacy file'
split_base=$(git rev-parse HEAD)
printf 'more\n' >> README.md
git add README.md
git commit -q -m 'intermediate commit that still carries the over-budget blob'
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 500)
PY
git add frontend/src/legacy.js
git commit -q -m 'shrink the legacy file below the budget'
head=$(git rev-parse HEAD)
expect_pass source-line-split-in-range python3 "$SOURCE_LINES_CHECK" --base "$split_base" --head "$head"

# A branch forked before main split a legacy file, then merged the newer main:
# the merged head tree is clean, so the strict gate passes even though early
# commits carried the over-budget blob.
git switch -q -C source-line-merged-newer-main "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 601)
PY
git add frontend/src/legacy.js
git commit -q -m 'old main: pinned legacy file'
old_main=$(git rev-parse HEAD)
git switch -q -c source-line-merged-newer-main-feature
printf 'feature\n' > feature.txt
git add feature.txt
git commit -q -m 'feature commit made before main split the file'
git switch -q source-line-merged-newer-main
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// line\n" * 500)
PY
git add frontend/src/legacy.js
git commit -q -m 'new main: split the legacy file'
new_main=$(git rev-parse HEAD)
git switch -q source-line-merged-newer-main-feature
git merge -q --no-edit "$new_main"
head=$(git rev-parse HEAD)
expect_pass source-line-merged-newer-main python3 "$SOURCE_LINES_CHECK" --base "$new_main" --head "$head"

# Regression for implicit grandfathering: unlike the explicit allowlist case
# above, the old 601-line source was never on an allowlist. An unrelated branch
# predating main's split must not fail due to its untouched historical blob.
git switch -q -C source-line-merged-newer-main-implicit "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// legacy\n" * 601)
PY
expect_fixture_lines frontend/src/legacy.js 601
git add frontend/src/legacy.js
git commit -q -m 'old main: grandfathered source with no explicit allowlist'
implicit_old_main=$(git rev-parse HEAD)
git switch -q -c source-line-merged-newer-main-implicit-feature
printf 'feature\n' > unrelated.txt
git add unrelated.txt
git commit -q -m 'unrelated feature before legacy split'
git switch -q source-line-merged-newer-main-implicit
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// legacy\n" * 500)
PY
expect_fixture_lines frontend/src/legacy.js 500
git add frontend/src/legacy.js
git commit -q -m 'new main: split formerly grandfathered source'
implicit_new_main=$(git rev-parse HEAD)
git switch -q source-line-merged-newer-main-implicit-feature
git merge -q --no-edit "$implicit_new_main"
head=$(git rev-parse HEAD)
expect_pass source-line-merged-newer-main-implicit python3 "$SOURCE_LINES_CHECK" --base "$implicit_new_main" --head "$head"

# A branch edit to that same legacy path must still fail if it survives the
# merge: the merged head tree then carries an over-budget legacy.js, which the
# strict gate rejects regardless of any historical approval. -X ours keeps the
# feature's 602-line blob in the merge result on purpose.
git switch -q -C source-line-merged-newer-main-implicit-edited "$implicit_old_main"
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/legacy.js").write_text("// edited\n" * 602)
PY
expect_fixture_lines frontend/src/legacy.js 602
git add frontend/src/legacy.js
git commit -q -m 'feature edits oversized legacy source and keeps the edit'
git merge -q --no-edit -X ours "$implicit_new_main"
head=$(git rev-parse HEAD)
expect_fail_msg source-line-merged-newer-main-implicit-edited "frontend/src/legacy.js" python3 "$SOURCE_LINES_CHECK" --base "$implicit_new_main" --head "$head"


# A branch-only, self-made exception no longer shields anything: the allowlist
# mechanism is gone, so a feature branch that merges an over-budget blob fails
# on the merged head tree regardless of any entry it wrote for itself.
git switch -q -C source-line-fork-evasion "$old_main"
mkdir -p scripts/ci
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/flash.js").write_text("// line\n" * 501)
Path("scripts/ci/source-line-allowlist.txt").write_text("frontend/src/flash.js\n")
PY
git add frontend/src/flash.js scripts/ci/source-line-allowlist.txt
git commit -q -m 'branch-only temporary entry'
git merge -q --no-edit "$new_main"
head=$(git rev-parse HEAD)
expect_fail_msg source-line-fork-evasion "frontend/src/flash.js" python3 "$SOURCE_LINES_CHECK" --base "$new_main" --head "$head"

# An oversized blob that is committed and then shrunk later in the same PR
# passes: the strict gate judges the final head tree, not intermediate states.
# But a blob that remains over budget in the head tree always fails.
git switch -q -C source-line-history-evasion "$base"
mkdir -p frontend/src
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/flash.js").write_text("// line\n" * 501)
PY
git add frontend/src/flash.js
git commit -q -m 'add an oversized blob and shrink it later'
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/flash.js").write_text("// line\n" * 500)
PY
git add frontend/src/flash.js
git commit -q -m 'shrink the file below the budget'
head=$(git rev-parse HEAD)
expect_pass source-line-history-evasion python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"
python3 - <<'PY'
from pathlib import Path
Path("frontend/src/flash.js").write_text("// line\n" * 501)
PY
git add frontend/src/flash.js
git commit -q -m 'regrow the file above the budget'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-history-evasion-over "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# Applied Flyway migrations are immutable history, classified structurally by
# path convention: any size passes inside java/**/src/main/resources/db/migration/.
git switch -q -C source-line-flyway-immutable "$base"
mkdir -p java/wotb-web/src/main/resources/db/migration
python3 - <<'PY'
from pathlib import Path
Path("java/wotb-web/src/main/resources/db/migration/V1000__huge_applied_migration.sql").write_text("-- applied\n" * 20000)
PY
git add java/wotb-web/src/main/resources/db/migration
git commit -q -m 'add a large applied Flyway migration'
head=$(git rev-parse HEAD)
expect_pass source-line-flyway-immutable python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

# The Flyway exclusion is path-convention only: a plural "migrations" directory
# is not the convention, and maintained code there stays in the production budget.
git switch -q -C source-line-flyway-lookalike "$base"
mkdir -p java/wotb-web/src/main/resources/db/migrations
python3 - <<'PY'
from pathlib import Path
Path("java/wotb-web/src/main/resources/db/migrations/seed.sql").write_text("-- seed\n" * 501)
PY
git add java/wotb-web/src/main/resources/db/migrations
git commit -q -m 'maintained seed outside the migration convention'
head=$(git rev-parse HEAD)
expect_fail_msg source-line-flyway-lookalike "physical lines (limit 500, production)" python3 "$SOURCE_LINES_CHECK" --base "$base" --head "$head"

echo "repository hygiene regression tests: PASS"
