#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/deploy/check-flyway-immutability.sh"
MIGRATION_DIR="java/wotb-web/src/main/resources/db/migration"
WORK="$(mktemp -d)"
REPO="$WORK/repo"
trap 'rm -rf "$WORK"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

init_fixture() {
  rm -rf "$REPO"
  mkdir -p "$REPO/$MIGRATION_DIR"
  git -C "$REPO" init -q
  git -C "$REPO" config user.email ci@example.invalid
  git -C "$REPO" config user.name ci
  printf 'create table v18_fixture (id bigint primary key);\n' \
    > "$REPO/$MIGRATION_DIR/V18__fixture.sql"
  git -C "$REPO" add .
  git -C "$REPO" commit -qm base
  BASE="$(git -C "$REPO" rev-parse HEAD)"
}

commit_fixture() {
  git -C "$REPO" add .
  git -C "$REPO" commit -qm fixture
}

expect_fail() {
  local label="$1" expected="$2" output rc
  set +e
  output="$(cd "$REPO" && bash "$GUARD" "$BASE" 2>&1)"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "$label unexpectedly passed: $output"
  grep -q "$expected" <<<"$output" || fail "$label missing '$expected': $output"
}

# The production hotfix uses the one explicitly approved historical restore pair. It is
# reproduced hermetically: the pre-restore bytes are a hash-pinned fixture, because the
# commit they came from (`8d94a24c`) is no longer reachable on the remote after the history
# rewrite (release tags were re-pointed at the new commit graph), so no checkout — not even
# a full tag fetch — can resolve it. The real record is still asserted: the shipped V18 must
# be the authoritative historical blob, and the fixture must still be the drifted blob.
readonly V18_REL_PATH="$MIGRATION_DIR/V18__create_hundred_battle_submission.sql"
readonly V18_PRE_RESTORE_REL="deploy/fixtures/flyway/V18__create_hundred_battle_submission.pre_restore.sql"
readonly V18_DRIFTED_BLOB="212635ebf5c04198476af52f4913dbfd2a9f0e4e"
readonly V18_HISTORICAL_BLOB="a7941f0d2e4c545043e7b38f40c8e0cd0837ba6b"

[ "$(git -C "$ROOT" rev-parse "HEAD:$V18_REL_PATH")" = "$V18_HISTORICAL_BLOB" ] \
  || fail "shipped V18 is not the authoritative historical blob ($V18_HISTORICAL_BLOB)"
[ "$(git -C "$ROOT" rev-parse "HEAD:$V18_PRE_RESTORE_REL")" = "$V18_DRIFTED_BLOB" ] \
  || fail "pre-restore fixture is not the drifted blob ($V18_DRIFTED_BLOB)"

rm -rf "$REPO"
mkdir -p "$REPO/$MIGRATION_DIR"
git -C "$REPO" init -q
git -C "$REPO" config user.email ci@example.invalid
git -C "$REPO" config user.name ci
cp "$ROOT/$V18_PRE_RESTORE_REL" "$REPO/$V18_REL_PATH"
git -C "$REPO" add .
git -C "$REPO" commit -qm drifted
BASE="$(git -C "$REPO" rev-parse HEAD)"
[ "$(git -C "$REPO" rev-parse "HEAD:$V18_REL_PATH")" = "$V18_DRIFTED_BLOB" ] \
  || fail "restore fixture base is not the drifted blob"
cp "$ROOT/$V18_REL_PATH" "$REPO/$V18_REL_PATH"
git -C "$REPO" add .
git -C "$REPO" commit -qm restored
restore_output="$(cd "$REPO" && bash "$GUARD" "$BASE" 2>&1)" \
  || fail "approved V18 historical restore did not pass: $restore_output"
grep -q "one-time exception" <<<"$restore_output" \
  || fail "approved V18 historical restore missing allowlist token: $restore_output"

init_fixture
printf 'create table v18_fixture (id bigint primary key, changed boolean);\n' \
  > "$REPO/$MIGRATION_DIR/V18__fixture.sql"
commit_fixture
expect_fail "modified existing migration" "Existing Flyway versioned migrations are immutable"

init_fixture
rm "$REPO/$MIGRATION_DIR/V18__fixture.sql"
commit_fixture
expect_fail "deleted existing migration" "Existing Flyway versioned migrations are immutable"

init_fixture
mv "$REPO/$MIGRATION_DIR/V18__fixture.sql" "$REPO/$MIGRATION_DIR/V18__renamed.sql"
commit_fixture
expect_fail "renamed existing migration" "Existing Flyway versioned migrations are immutable"

init_fixture
printf 'create table v19_fixture (id bigint primary key);\n' \
  > "$REPO/$MIGRATION_DIR/V19__fixture.sql"
commit_fixture
(cd "$REPO" && bash "$GUARD" "$BASE" >/dev/null) \
  || fail "new higher migration version was rejected"

init_fixture
printf -- '-- explain why this index exists\ncreate table v19_fixture (id bigint primary key);\n' \
  > "$REPO/$MIGRATION_DIR/V19__fixture.sql"
commit_fixture
(cd "$REPO" && bash "$GUARD" "$BASE" >/dev/null) \
  || fail "new higher migration with a SQL comment was rejected"

init_fixture
printf 'create table v18_duplicate (id bigint primary key);\n' \
  > "$REPO/$MIGRATION_DIR/V18__duplicate.sql"
commit_fixture
expect_fail "duplicate migration version" "must be greater than base maximum"

init_fixture
printf 'ordinary change\n' > "$REPO/README.txt"
commit_fixture
(cd "$REPO" && bash "$GUARD" "$BASE" >/dev/null) \
  || fail "ordinary non-migration change was rejected"

echo "OK: Flyway immutability and new-migration version guard scenarios passed"
