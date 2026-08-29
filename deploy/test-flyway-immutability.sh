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
  output="$(cd "$REPO" && "$GUARD" "$BASE" 2>&1)"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "$label unexpectedly passed: $output"
  grep -q "$expected" <<<"$output" || fail "$label missing '$expected': $output"
}

# The production hotfix uses the one explicitly approved historical restore pair.
(cd "$ROOT" && "$GUARD" 8d94a24c >/dev/null) \
  || fail "approved V18 historical restore did not pass"

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
(cd "$REPO" && "$GUARD" "$BASE" >/dev/null) \
  || fail "new higher migration without comments was rejected"

init_fixture
printf -- '-- this comment is forbidden\ncreate table v19_fixture (id bigint primary key);\n' \
  > "$REPO/$MIGRATION_DIR/V19__fixture.sql"
commit_fixture
expect_fail "new migration with SQL comment" "must not contain SQL comments"

init_fixture
printf 'create table v19_fixture (id bigint primary key); -- trailing comment\n' \
  > "$REPO/$MIGRATION_DIR/V19__fixture.sql"
commit_fixture
expect_fail "new migration with inline line comment" "must not contain SQL comments"

init_fixture
printf '/* block comment */\ncreate table v19_fixture (id bigint primary key);\n' \
  > "$REPO/$MIGRATION_DIR/V19__fixture.sql"
commit_fixture
expect_fail "new migration with block comment" "must not contain SQL comments"

init_fixture
printf "create table v19_fixture (id bigint default 'x--y');\n" \
  > "$REPO/$MIGRATION_DIR/V19__fixture.sql"
commit_fixture
(cd "$REPO" && "$GUARD" "$BASE" >/dev/null) \
  || fail "new migration with '--' inside a string literal was rejected"

init_fixture
printf 'create table v18_duplicate (id bigint primary key);\n' \
  > "$REPO/$MIGRATION_DIR/V18__duplicate.sql"
commit_fixture
expect_fail "duplicate migration version" "must be greater than base maximum"

init_fixture
printf 'ordinary change\n' > "$REPO/README.txt"
commit_fixture
(cd "$REPO" && "$GUARD" "$BASE" >/dev/null) \
  || fail "ordinary non-migration change was rejected"

echo "OK: Flyway immutability and new-migration comment/version guard scenarios passed"
