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

# --- Source LOC budget gate (#820) ---
# First-party production frontend sources are capped at MAX_SOURCE_LINES
# (default 1500). The fixture allowlist is written at the default path inside
# the disposable repo so the gate exercises its real resolution logic.
write_lines() {
  python3 - "$1" "$2" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[1]).write_text("line\n" * int(sys.argv[2]), encoding="utf-8")
PY
}

# 1499 and 1500 lines pass.
git switch -q -C loc-boundary "$base"
mkdir -p frontend/src/utils
write_lines frontend/src/utils/small.js 1499
write_lines frontend/src/utils/exact.vue 1500
git add frontend/src/utils
git commit -q -m 'add boundary-sized production sources'
head=$(git rev-parse HEAD)
expect_pass loc-boundary env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# 1501 lines in a new production file fails.
git switch -q -C loc-over "$base"
mkdir -p frontend/src/utils
write_lines frontend/src/utils/big.js 1501
git add frontend/src/utils/big.js
git commit -q -m 'add oversized production source'
head=$(git rev-parse HEAD)
expect_fail_msg loc-over "source budget" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# The same budget covers .vue sources.
git switch -q -C loc-over-vue "$base"
mkdir -p frontend/src/components
write_lines frontend/src/components/Big.vue 1501
git add frontend/src/components/Big.vue
git commit -q -m 'add oversized production vue source'
head=$(git rev-parse HEAD)
expect_fail_msg loc-over-vue "source budget" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Tests, ambient declarations and contract-generated artifacts are out of scope.
git switch -q -C loc-non-production "$base"
mkdir -p frontend/src/api/generated
write_lines frontend/src/api/big.test.ts 1600
write_lines frontend/src/api/generated/contract.js 1600
write_lines frontend/src/types.d.ts 1600
git add frontend/src
git commit -q -m 'add oversized non-production files'
head=$(git rev-parse HEAD)
expect_pass loc-non-production env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# A legacy file pinned at its audited baseline passes; one more line fails.
git switch -q -C loc-legacy-pin "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/legacy.js 1601
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/legacy.js 1601
EOF
git add frontend/src/scene/legacy.js scripts/ci/source-loc-allowlist.txt
git commit -q -m 'pin legacy file at its audited baseline'
head=$(git rev-parse HEAD)
expect_pass loc-legacy-pin env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

git switch -q -C loc-legacy-growth "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/legacy.js 1602
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/legacy.js 1601
EOF
git add frontend/src/scene/legacy.js scripts/ci/source-loc-allowlist.txt
git commit -q -m 'grow legacy file past its pinned baseline'
head=$(git rev-parse HEAD)
expect_fail_msg loc-legacy-growth "pinned baseline" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# An allowlist entry is an exact path: it must not shield any other file.
git switch -q -C loc-allowlist-borrow "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/legacy.js 1601
write_lines frontend/src/scene/other.js 1700
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/legacy.js 1601
EOF
git add frontend/src/scene scripts/ci/source-loc-allowlist.txt
git commit -q -m 'attempt to borrow another file allowlist entry'
head=$(git rev-parse HEAD)
expect_fail_msg loc-allowlist-borrow "source budget" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# A stale entry whose file has become compliant must be removed in the same PR.
git switch -q -C loc-stale-allowlist "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/split.js 1500
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/split.js 2000
EOF
git add frontend/src/scene/split.js scripts/ci/source-loc-allowlist.txt
git commit -q -m 'leave stale allowlist entry for a compliant file'
head=$(git rev-parse HEAD)
expect_fail_msg loc-stale-allowlist "remove it from" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Invalid allowlist content fails closed (exit 2), never as a clean tree.
git switch -q -C loc-invalid-allowlist "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/legacy.js 1601
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/legacy.js
EOF
git add frontend/src/scene/legacy.js scripts/ci/source-loc-allowlist.txt
git commit -q -m 'commit malformed allowlist entry'
head=$(git rev-parse HEAD)
expect_fail_msg loc-invalid-allowlist "invalid line" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# An oversized blob added and deleted inside the event range must still fail.
git switch -q -C loc-add-delete "$base"
mkdir -p frontend/src/utils
write_lines frontend/src/utils/transient.js 1501
git add frontend/src/utils/transient.js
git commit -q -m 'add temporary oversized source'
git rm -q frontend/src/utils/transient.js
git commit -q -m 'remove temporary oversized source'
head=$(git rev-parse HEAD)
expect_fail_msg loc-add-delete "source budget" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Renaming an oversized file does not escape the gate: the new path has no
# entry of its own, and a stale entry on the old path shields nothing.
git switch -q -C loc-rename "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/legacy.js 1601
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/old-name.js 1601
EOF
git add frontend/src/scene/legacy.js scripts/ci/source-loc-allowlist.txt
git commit -q -m 'add oversized source under a renamed path'
head=$(git rev-parse HEAD)
expect_fail_msg loc-rename "source budget" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# The normal split flow must pass: the legacy file and its entry exist at the
# base, later commits shrink the file and drop the entry. The history gate must
# judge each commit against the base/HEAD allowlist union, not force the final
# allowlist onto earlier commits.
git switch -q -C loc-split-in-range "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/legacy.js 1601
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/legacy.js 1601
EOF
git add frontend/src/scene/legacy.js scripts/ci/source-loc-allowlist.txt
git commit -q -m 'base: pinned legacy file'
range_base=$(git rev-parse HEAD)
write_lines frontend/src/scene/legacy.js 1500
git rm -q scripts/ci/source-loc-allowlist.txt
git add frontend/src/scene/legacy.js
git commit -q -m 'split legacy file below the budget and drop its entry'
head=$(git rev-parse HEAD)
expect_pass loc-split-in-range env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$range_base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# Deleting a legacy file without removing its entry must fail: the stale entry
# would otherwise shield a future re-created file at the same path.
git switch -q -C loc-entry-deleted-file "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/legacy.js 1601
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/legacy.js 1601
EOF
git add frontend/src/scene/legacy.js scripts/ci/source-loc-allowlist.txt
git commit -q -m 'base: pinned legacy file'
range_base=$(git rev-parse HEAD)
git rm -q frontend/src/scene/legacy.js
git commit -q -m 'delete the legacy file but keep its allowlist entry'
head=$(git rev-parse HEAD)
expect_fail_msg loc-entry-deleted-file "no longer matches a tracked in-scope source file" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$range_base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

# An oversized blob committed together with a temporary allowlist entry that is
# removed later must still fail: entries that exist neither at the base nor at
# HEAD legitimize nothing in the history gate.
git switch -q -C loc-evasion-temporary-entry "$base"
mkdir -p scripts/ci frontend/src/scene
write_lines frontend/src/scene/flash.js 1501
mkdir -p scripts/ci
cat > scripts/ci/source-loc-allowlist.txt <<'EOF'
frontend/src/scene/flash.js 1501
EOF
git add frontend/src/scene/flash.js scripts/ci/source-loc-allowlist.txt
git commit -q -m 'temporarily shield an oversized blob with a new entry'
write_lines frontend/src/scene/flash.js 1500
git rm -q scripts/ci/source-loc-allowlist.txt
git add frontend/src/scene/flash.js
git commit -q -m 'shrink the file and remove the temporary entry'
head=$(git rev-parse HEAD)
expect_fail_msg loc-evasion-temporary-entry "source budget" env REPOSITORY_HYGIENE_TEST_CHILD=1 BASE_SHA="$base" HEAD_SHA="$head" LARGE_FILE_ALLOWLIST_FILE="$ALLOWLIST" bash "$CHECK"

echo "repository hygiene regression tests: PASS"
