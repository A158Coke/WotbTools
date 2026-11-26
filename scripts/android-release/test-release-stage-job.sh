#!/usr/bin/env bash
set -euo pipefail
source "$ROOT/scripts/android-release/test-release-common.sh"

SCRIPT="$ROOT/scripts/android-release/stage_job_conclusion.py"

expect_conclusion() {
  local expected="$1" payload="$2" actual
  actual="$(printf '%s' "$payload" | python3 "$SCRIPT")" || fail "expected stage resolver to accept: $payload"
  [ "$actual" = "$expected" ] || fail "stage resolver returned '$actual', expected '$expected' for: $payload"
}

expect_reject() {
  local payload="$1"
  if printf '%s' "$payload" | python3 "$SCRIPT" >/dev/null 2>&1; then
    fail "stage resolver accepted invalid jobs payload: $payload"
  fi
}

expect_conclusion success '{"jobs":[{"name":"stage","conclusion":"success"}]}'
expect_conclusion success '{"jobs":[{"name":"stage / stage","conclusion":"success"}]}'
expect_conclusion failure '{"jobs":[{"name":"stage / stage","conclusion":"failure"}]}'

expect_conclusion cancelled '{"jobs":[{"name":"stage","conclusion":"cancelled"}]}'

expect_reject '{"jobs":[{"name":"publish / stage","conclusion":"success"}]}'
expect_reject '{"jobs":[{"name":"stage / publish","conclusion":"success"}]}'
expect_reject '{"jobs":[{"name":"publish","conclusion":"success"}]}'
expect_reject '{"jobs":[{"name":"stage","conclusion":"success"},{"name":"stage / stage","conclusion":"success"}]}'
expect_reject '{"jobs":[{"name":"stage","conclusion":null}]}'
expect_reject '{"jobs":[]}'
expect_reject '{}'
expect_reject 'not-json'

old_source="$(mktemp -d)"
workflow_source="$(mktemp -d)"
trap 'rm -rf "$old_source" "$workflow_source"' EXIT
mkdir -p "$old_source/android" "$workflow_source/scripts/android-release"
printf 'wotbVersion=1.2.3\n' > "$old_source/android/gradle.properties"
cp "$SCRIPT" "$workflow_source/scripts/android-release/stage_job_conclusion.py"
actual="$(cd "$old_source" && printf '%s' '{"jobs":[{"name":"stage","conclusion":"success"}]}' \
  | python3 "$workflow_source/scripts/android-release/stage_job_conclusion.py")" \
  || fail "resolver from the workflow version failed while the staged source predates it"
[ "$actual" = success ] || fail "resolver from workflow version returned '$actual' for a legacy staged source"
[ ! -e "$old_source/scripts/android-release/stage_job_conclusion.py" ] \
  || fail "legacy staged source unexpectedly contains the resolver; fixture does not cover the regression"

echo "Android auto-publish stage identity: PASS"
