#!/usr/bin/env bash
set -euo pipefail
source "$ROOT/scripts/android-release/test-release-common.sh"

# --- 用 fixture 真正执行 publish staged identity 脚本的头部（set -u 下验证 $expected 回归）---
# 为什么必须执行而不是只读 YAML：`expected` 只是 Python 进程内的局部变量，静态检查很容易漏掉
# 「shell 引用 Python 局部变量」这类错误 —— 它在 `set -euo pipefail` 下会让真实 publish 直接
# `expected: unbound variable`。
#
# 端口范围：从 step 起头到 badging 校验的 heredoc 结束，再接一行与 workflow 完全一致的
# `echo "versionCode=$STAGED_VERSION_CODE" >> "$GITHUB_OUTPUT"`（它必须与该 step 的 echo 逐字相同，
# 由下面的断言保证）。之后的 `android_contract.py bundle` 需要真实 APK bundle 字节，由本文件上面的
# schema2 roundtrip 用例覆盖；这里只证明「脚本头部 + 版本号输出」在 set -u 下可运行且 fail closed。
if [ "${WOTB_SKIP_PUBLISH_SIMULATION:-0}" = "1" ]; then
  echo "publish simulation skipped (WOTB_SKIP_PUBLISH_SIMULATION=1)"
else
  SIM="$TMP/publish-sim"
  BIN="$SIM/bin"
  RUNNER_TEMP="$SIM/runner"
  SIM_WORK="$SIM/work"
  # 用已提交的版本，这样「tag target 的 gradle.properties」与 repo 现状一致；升版本号不用改本用例。
  SIM_VERSION="$COMMITTED_VERSION"
  SIM_VERSION_CODE="$EXPECTED_CODE"
  SIM_TAG_TARGET="$REAL_HEAD"
  mkdir -p "$BIN" "$RUNNER_TEMP/android" "$SIM_WORK/release-staging"

  # stub：aapt 输出 fixture badging；jq 从 fixture contract 里取 bridge（真实 jq 行为单一，够用）。
  cat > "$BIN/aapt" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cat "${WOTB_FAKE_BADGING:?}"
SH
  cat > "$BIN/jq" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
# 只服务 `jq -r '.bridgeVersion' <file>`：按 filter 里唯一的字段名从 JSON 取值。
field=""
while [ $# -gt 0 ]; do
  case "$1" in
    -r) field="$2"; shift 2 ;;
    -*) shift ;;
    *) file="$1"; shift ;;
  esac
done
name="$(printf '%s' "$field" | sed -e "s/^\.//" -e "s/['\"]//g")"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))[sys.argv[2]])' "$file" "$name"
SH
  cat > "$BIN/sha256sum" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  $1"
SH
  cat > "$BIN/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cmd="${1:-}"; shift || true
case "$cmd" in
  # `git show <ref>:<path>` 委托给真实 git（必须用绝对路径，否则会再次命中本 stub）。
  show) exec "${WOTB_SIM_REAL_GIT:?}" --no-pager -C "${WOTB_SIM_REPO:?}" show "$@" ;;
  *) echo "unexpected git invocation in publish simulation: $cmd $*" >&2; exit 1 ;;
esac
SH
  # curl：只服务本用例的两次下载（staging evidence / staged APK）。
  cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "${url:-}" in
  *.staging.json) cp "$WOTB_SIM_STAGING" "$out" ;;
  *.apk) cp "$WOTB_SIM_APK" "$out" ;;
  *) echo "unexpected curl url: ${url:-}" >&2; exit 1 ;;
esac
SH
  chmod +x "$BIN/aapt" "$BIN/jq" "$BIN/sha256sum" "$BIN/git" "$BIN/curl"
  # 让 `. scripts/android-release/check-release-guards.sh` 之类相对路径按 repo 解析。
  ln -s "$ROOT/scripts" "$SIM_WORK/scripts"
  # 让 `find "$ANDROID_HOME/build-tools" -name aapt` 命中 stub。
  mkdir -p "$SIM/android-home/build-tools/34.0.0"
  cp "$BIN/aapt" "$SIM/android-home/build-tools/34.0.0/aapt"

  # 受控 gradle.properties（tag target 的副本）、contract、evidence 与 fake APK。
  printf 'wotbVersion=%s\nwotbNativeBridgeVersion=%s\n' "$SIM_VERSION" "$EXPECTED_BRIDGE" > "$RUNNER_TEMP/android/gradle.properties"
  cp "$ROOT/contracts/android-native-bridge.json" "$RUNNER_TEMP/staged-contract.json"
  cp "$ROOT/deploy/agent/source.json" "$RUNNER_TEMP/staged-agent.json"
  printf '{"sourceSha":"%s","sha256":"%s"}' "$SIM_TAG_TARGET" \
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" > "$SIM/staging.json"
  printf 'staged apk bytes' > "$SIM/staged.apk"
  printf "package: name='com.wotbtools.app' versionCode='%s' versionName='%s'\n" \
    "$SIM_VERSION_CODE" "$SIM_VERSION" > "$SIM/badging-ok.txt"
  printf "package: name='com.wotbtools.app' versionCode='%s' versionName='%s'\n" \
    "$((SIM_VERSION_CODE + 1))" "$SIM_VERSION" > "$SIM/badging-mismatch.txt"

  python3 - "$ROOT" "$SIM" <<'PY'
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]) / "scripts/android-release"))
import workflow_model

workflow = workflow_model.load(Path(sys.argv[1]))
sim = Path(sys.argv[2])
step = next(s for s in workflow["jobs"]["publish"]["steps"] if s.get("id") == "staged")
run = step["run"]
# The origin collector has its own locked-host integration test; this fixture supplies
# identical origin bytes so the staged identity test remains independent of SSH.
collector = 'bash scripts/android-release/staging-evidence.sh collect-required "$STAGING_NAME" "$RUNNER_TEMP/staging-origins.json" >/dev/null'
assert collector in run
run = run.replace(collector, 'cp "$WOTB_SIM_STAGING" "$RUNNER_TEMP/staging-origins.json"')
# 拆分后的 step 把 GitHub expression 移到 env；模拟 runner 渲染时只展开本用例读取的身份变量，
# 其余表达式用中性字面量吃掉（下游命令都被 stub 掉，值不影响本用例）。
for expression, value in {
    "${{ steps.stagedref.outputs.apkName }}": "wotbtools-android-vSTAGED.apk",
    "${{ steps.stagedref.outputs.stagingName }}": "wotbtools-android-vSTAGED.staging.json",
}.items():
    run = run.replace(expression, value)
run = run.replace("$STEP_STAGEDREF_APKNAME", "wotbtools-android-vSTAGED.apk")
run = run.replace("$STEP_STAGEDREF_STAGINGNAME", "wotbtools-android-vSTAGED.staging.json")
run = run.replace("$STEP_STAGEDREF_TAGNAME", "sim")
run = re.sub(r"\$\{\{[^}]*\}\}", "sim", run)
# heredoc 去缩进（补偿 YAML `run: |` 的公共缩进）。
body = "\n".join(line[10:] if line.startswith(" " * 10) else line for line in run.splitlines())
lines = body.splitlines()

# badging 校验块 = `python3 - ... <<'PY'` … 顶格 `PY`；这是脚本头部唯一以 heredoc 结尾的块。
badging_start = next(i for i, line in enumerate(lines) if "apk-badging.txt" in line and "python3 -" in line)
badging_end = next(i for i in range(badging_start + 1, len(lines)) if lines[i].startswith("PY"))
(sim / "badging-check.sh").write_text("\n".join(lines[badging_start:badging_end + 1]) + "\n", encoding="utf-8")

# 版本号输出行必须与该 step 的真实输出逐字一致（用真实行，而不是测试里另写一份）。
version_echo = next(line for line in lines if line.startswith('echo "versionCode='))
assert version_echo == 'echo "versionCode=$STAGED_VERSION_CODE" >> "$GITHUB_OUTPUT"', version_echo
(sim / "staged-step-head.sh").write_text(
    "\n".join(["set -euo pipefail"] + lines[:badging_end + 1] + [version_echo]) + "\n",
    encoding="utf-8",
)
print("simulation fixtures written")
PY

  run_staged_step_head() {
    local badging_file="$1" expected_code="$2"
    (
      cd "$SIM_WORK"
      PATH="$BIN:$PATH" \
      ANDROID_HOME="$SIM/android-home" \
      RUNNER_TEMP="$RUNNER_TEMP" \
      GITHUB_OUTPUT="$SIM/github-output.txt" \
      GITHUB_WORKSPACE="$SIM_WORK" \
      REQUESTED_VERSION="$SIM_VERSION" \
      TAG_TARGET="$SIM_TAG_TARGET" \
      STAGED_VERSION_CODE="$expected_code" \
      WOTB_FAKE_BADGING="$badging_file" \
      WOTB_SIM_STAGING="$SIM/staging.json" \
      WOTB_SIM_APK="$SIM/staged.apk" \
      WOTB_SIM_REPO="$ROOT" \
      WOTB_SIM_REAL_GIT="$REAL_GIT" \
      bash "$SIM/staged-step-head.sh"
    )
  }

  # 匹配：脚本头部必须在 set -u 下跑通，并写出 staged versionCode。
  : > "$SIM/github-output.txt"
  if ! run_staged_step_head "$SIM/badging-ok.txt" "$SIM_VERSION_CODE" > "$SIM/ok.log" 2>&1; then
    sed 's/^/    /' "$SIM/ok.log" >&2
    fail "publish staged identity head must run under set -u when APK badging matches the staged source"
  fi
  grep -qx "versionCode=$SIM_VERSION_CODE" "$SIM/github-output.txt" \
    || { sed 's/^/    /' "$SIM/ok.log" >&2; fail "publish must emit the staged versionCode ($SIM_VERSION_CODE)"; }
  grep -qi "unbound variable" "$SIM/ok.log" && fail "publish shell must not reference undefined variables"

  # fail closed：APK badging versionCode 与 staged versionCode 不一致。
  : > "$SIM/github-output.txt"
  if run_staged_step_head "$SIM/badging-mismatch.txt" "$SIM_VERSION_CODE" > "$SIM/mismatch.log" 2>&1; then
    fail "APK badging versionCode differing from the staged versionCode must fail closed"
  fi
  grep -q "does not match the staged source versionCode" "$SIM/mismatch.log" \
    || { sed 's/^/    /' "$SIM/mismatch.log" >&2; fail "mismatch must be reported by the badging validator"; }
  [ ! -s "$SIM/github-output.txt" ] || fail "a failed badging check must not emit outputs"

  # 回归证明：把同一段脚本换成「Python 局部变量泄漏到 shell」的写法（修复前的实现），
  # 必须在 set -u 下以 unbound variable 失败 —— 否则本用例挡不住这个 release blocker。
  # 用单引号 sed 脚本，避免 $expected 在生成阶段被 shell 展开。
  sed 's/versionCode=\$STAGED_VERSION_CODE/versionCode=$expected/' \
    "$SIM/staged-step-head.sh" > "$SIM/staged-step-regression.sh"
  grep -q 'versionCode=\$expected' "$SIM/staged-step-regression.sh" \
    || fail "the regression fixture must reference the pre-fix \`\$expected\` form"
  if (cd "$SIM_WORK" && PATH="$BIN:$PATH" ANDROID_HOME="$SIM/android-home" RUNNER_TEMP="$RUNNER_TEMP" \
        GITHUB_OUTPUT="$SIM/regression-output.txt" GITHUB_WORKSPACE="$SIM_WORK" \
        REQUESTED_VERSION="$SIM_VERSION" TAG_TARGET="$SIM_TAG_TARGET" \
        STAGED_VERSION_CODE="$SIM_VERSION_CODE" WOTB_FAKE_BADGING="$SIM/badging-ok.txt" \
        WOTB_SIM_STAGING="$SIM/staging.json" WOTB_SIM_APK="$SIM/staged.apk" \
        WOTB_SIM_REPO="$ROOT" WOTB_SIM_REAL_GIT="$REAL_GIT" \
        bash "$SIM/staged-step-regression.sh" > "$SIM/regression.log" 2>&1); then
    fail "the pre-fix implementation (shell reading the Python-local \`expected\`) must fail under set -u"
  fi
  grep -qi "unbound variable" "$SIM/regression.log" \
    || { sed 's/^/    /' "$SIM/regression.log" >&2; fail "the regression case must fail with an unbound variable"; }

  echo "publish staged-identity shell simulation: PASS (staged versionCode, mismatch fails closed, pre-fix form fails)"
fi
