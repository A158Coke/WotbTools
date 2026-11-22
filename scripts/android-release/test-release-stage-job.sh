#!/usr/bin/env bash
# Android auto-publish 只续跑成功的 stage：既接受拆分前的裸 job 名 'stage'，
# 也接受 reusable workflow 的 'stage / stage'；缺失、重复或非 success 一律拒绝。
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

# 既有旧格式（拆分前 run）
expect_conclusion success '{"jobs":[{"name":"stage","conclusion":"success"}]}'
# 拆分后的 reusable job 前缀
expect_conclusion success '{"jobs":[{"name":"stage / stage","conclusion":"success"}]}'
expect_conclusion failure '{"jobs":[{"name":"stage / stage","conclusion":"failure"}]}'

# 未成功的 stage 只能被上层继续拒绝，解析器必须忠实返回原结论。
expect_conclusion cancelled '{"jobs":[{"name":"stage","conclusion":"cancelled"}]}'

# 只有完全相同的 job 名才是 stage；别的前缀、缺失、重复、空结论都 fail closed。
expect_reject '{"jobs":[{"name":"publish / stage","conclusion":"success"}]}'
expect_reject '{"jobs":[{"name":"stage / publish","conclusion":"success"}]}'
expect_reject '{"jobs":[{"name":"publish","conclusion":"success"}]}'
expect_reject '{"jobs":[{"name":"stage","conclusion":"success"},{"name":"stage / stage","conclusion":"success"}]}'
expect_reject '{"jobs":[{"name":"stage","conclusion":null}]}'
expect_reject '{"jobs":[]}'
expect_reject '{}'
expect_reject 'not-json'

# auto-publish 从「执行中的工作流版本」运行解析器，候选则来自触发 stage 的旧提交。
# 旧提交可能早于解析器存在（拆分前的 run），所以 staged source 目录里没有脚本是合法的。
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
