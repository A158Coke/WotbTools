#!/usr/bin/env bash
set -euo pipefail
source "$ROOT/scripts/android-release/test-release-common.sh"

# --- 自动 publish 的候选新鲜度：以 Version-as-Code 判定，不是 staged SHA == main SHA ---
# review P2 反例：staged A 之后 main 只合入 docs-only / backend-only 提交，SHA 前进但
# android/gradle.properties:wotbVersion 不变。旧实现（SHA 相等）会把唯一 Android candidate
# 误判成 stale；这里用真实 git 时序复现同一时刻，证明判定只看版本号。
mkdir -p "$TMP/candidate"
printf 'wotbVersion=%s\n' "$STAGED_VERSION" > "$TMP/candidate/main-latest.properties"
printf 'wotbVersion=%s\n' "$NEXT_VERSION" > "$TMP/candidate/main-newer.properties"
printf 'wotbVersion=1.9.9\n' > "$TMP/candidate/main-older.properties"
printf 'wotbNativeBridgeVersion=3\n' > "$TMP/candidate/main-no-version.properties"

. "$GUARDS"

# Case 1：没有更新的 Android candidate ⇒ 自动发布继续。
classify_candidate_freshness "$STAGED_VERSION" "$TMP/candidate/main-latest.properties"
[ "$CANDIDATE_STATE" = candidate_latest ] || fail "same committed version must stay publishable"
[ "$MAIN_CANDIDATE_VERSION" = "$STAGED_VERSION" ] || fail "main candidate version must be reported"

# Case 4：main 上已有更高的 Android candidate ⇒ staged A 失去自动发布权。
classify_candidate_freshness "$STAGED_VERSION" "$TMP/candidate/main-newer.properties"
[ "$CANDIDATE_STATE" = candidate_superseded ] \
  || fail "a newer committed Android version must supersede the staged candidate"
[ "$MAIN_CANDIDATE_VERSION" = "$NEXT_VERSION" ] || fail "superseding version must be reported"

# 更低的 committed 版本不是「新候选」；是否允许发布交给既有 publish 守卫。
classify_candidate_freshness "$STAGED_VERSION" "$TMP/candidate/main-older.properties"
[ "$CANDIDATE_STATE" = candidate_latest ] || fail "a lower committed version is not a newer candidate"

# fail-closed：main / staged 的 Version-as-Code 不可读时绝不猜。
if classify_candidate_freshness "$STAGED_VERSION" "$TMP/candidate/main-no-version.properties" 2>/dev/null; then
  fail "main gradle.properties without wotbVersion must fail closed"
fi
if classify_candidate_freshness "$STAGED_VERSION" "$TMP/candidate/missing.properties" 2>/dev/null; then
  fail "missing main gradle.properties must fail closed"
fi
if classify_candidate_freshness "not-a-version" "$TMP/candidate/main-latest.properties" 2>/dev/null; then
  fail "malformed staged version must fail closed"
fi

# Case 2 / Case 3（真实 git 时序）：A stage 期间 main 合入 docs-only B、backend-only C ⇒
# SHA 前进但版本不变，A 仍是唯一 Android candidate。Case 4 续：main 再合入更高版本 ⇒ 让位。
if command -v git >/dev/null 2>&1; then
  CANDIDATE_REPO="$TMP/candidate-repo"
  mkdir -p "$CANDIDATE_REPO/android" "$CANDIDATE_REPO/docs" "$CANDIDATE_REPO/java/src"
  git -C "$CANDIDATE_REPO" init -q
  git -C "$CANDIDATE_REPO" config user.email test@example.invalid
  git -C "$CANDIDATE_REPO" config user.name test
  printf 'wotbVersion=%s\nwotbNativeBridgeVersion=3\n' "$STAGED_VERSION" \
    > "$CANDIDATE_REPO/android/gradle.properties"
  printf 'release %s\n' "$STAGED_VERSION" > "$CANDIDATE_REPO/docs/README.md"
  git -C "$CANDIDATE_REPO" add -A
  git -C "$CANDIDATE_REPO" commit -qm "release $STAGED_VERSION"
  STAGED_FIXTURE_SHA="$(git -C "$CANDIDATE_REPO" rev-parse HEAD)"
  printf 'unrelated documentation\n' > "$CANDIDATE_REPO/docs/notes.md"
  git -C "$CANDIDATE_REPO" add -A
  git -C "$CANDIDATE_REPO" commit -qm "docs-only B"
  printf 'final class Backend {}\n' > "$CANDIDATE_REPO/java/src/Backend.java"
  git -C "$CANDIDATE_REPO" add -A
  git -C "$CANDIDATE_REPO" commit -qm "backend-only C"
  ADVANCED_FIXTURE_SHA="$(git -C "$CANDIDATE_REPO" rev-parse HEAD)"
  [ "$STAGED_FIXTURE_SHA" != "$ADVANCED_FIXTURE_SHA" ] || fail "the fixture must advance main"
  git -C "$CANDIDATE_REPO" show HEAD:android/gradle.properties > "$TMP/candidate/advanced.properties"
  classify_candidate_freshness "$STAGED_VERSION" "$TMP/candidate/advanced.properties"
  [ "$CANDIDATE_STATE" = candidate_latest ] \
    || fail "docs-only / backend-only main advance must not supersede the only Android candidate"
  printf 'wotbVersion=%s\nwotbNativeBridgeVersion=3\n' "$NEXT_VERSION" \
    > "$CANDIDATE_REPO/android/gradle.properties"
  git -C "$CANDIDATE_REPO" add -A
  git -C "$CANDIDATE_REPO" commit -qm "bump to $NEXT_VERSION"
  git -C "$CANDIDATE_REPO" show HEAD:android/gradle.properties > "$TMP/candidate/bumped.properties"
  classify_candidate_freshness "$STAGED_VERSION" "$TMP/candidate/bumped.properties"
  [ "$CANDIDATE_STATE" = candidate_superseded ] \
    || fail "a newer Android version commit must supersede the staged candidate"
fi

echo "android candidate freshness (Version-as-Code supersession): PASS"

# --- 执行 publish_gate 的真实 shell block（不只静态 YAML inspection）---
# 用例覆盖 review 要求：自动续跑只在「main 已有更高 Android candidate」时 skip；手动 recovery
# 不受该策略限制；version / Version-as-Code 不可读时 fail closed。
GATE_DIR="$TMP/gate-sim"
GATE_REPO="$GATE_DIR/repo"
mkdir -p "$GATE_REPO/android" "$GATE_DIR/runner-temp"
python3 - "$ROOT/.github/workflows/android-release.yml" "$GATE_DIR" <<'PY'
import sys
import textwrap
from pathlib import Path
import yaml

workflow = yaml.safe_load(Path(sys.argv[1]).read_text(encoding="utf-8"))
step = next(s for s in workflow["jobs"]["publish_gate"]["steps"] if s.get("id") == "freshness")
body = textwrap.dedent(step["run"])
assert "${{" not in body, "the gate must take inputs from env, not interpolate expressions into its shell body"
(Path(sys.argv[2]) / "gate.sh").write_text(body, encoding="utf-8")
PY
ln -s "$ROOT/scripts" "$GATE_REPO/scripts"
git -C "$GATE_REPO" init -q
git -C "$GATE_REPO" config user.email test@example.invalid
git -C "$GATE_REPO" config user.name test

run_gate() {
  local auto="$1" version="$2" main_version="$3" output="$4" summary="$5" log="$6"
  printf 'wotbVersion=%s\nwotbNativeBridgeVersion=3\n' "$main_version" \
    > "$GATE_REPO/android/gradle.properties"
  git -C "$GATE_REPO" add -A
  if ! git -C "$GATE_REPO" diff --cached --quiet; then
    git -C "$GATE_REPO" commit -qm "main $main_version"
  fi
  : > "$output"
  : > "$summary"
  (
    cd "$GATE_REPO" || exit 1
    AUTO_PUBLISH="$auto" REQUESTED_VERSION="$version" \
      RUNNER_TEMP="$GATE_DIR/runner-temp" \
      GITHUB_OUTPUT="$output" GITHUB_STEP_SUMMARY="$summary" \
      bash "$GATE_DIR/gate.sh"
  ) > "$log" 2>&1
}

# Case 1（执行版）：自动续跑 + 没有更新候选 ⇒ superseded=false，继续走既有 publish 守卫。
run_gate true "$STAGED_VERSION" "$STAGED_VERSION" \
  "$GATE_DIR/out1" "$GATE_DIR/sum1" "$GATE_DIR/log1" \
  || { cat "$GATE_DIR/log1" >&2; fail "automatic publish with no newer candidate must proceed"; }
grep -qx 'superseded=false' "$GATE_DIR/out1" \
  || { cat "$GATE_DIR/log1" >&2; fail "automatic publish must not be skipped when main version equals the staged version"; }
grep -q 'Entry: automatic' "$GATE_DIR/sum1" || fail "gate summary must report the automatic entry"

# Case 4（执行版）：自动续跑 + main 已有更高版本 ⇒ superseded=true，安全 no-op。
run_gate true "$STAGED_VERSION" "$NEXT_VERSION" \
  "$GATE_DIR/out2" "$GATE_DIR/sum2" "$GATE_DIR/log2" \
  || { cat "$GATE_DIR/log2" >&2; fail "an automatic publish superseded by a newer candidate must stay a green no-op"; }
grep -qx 'superseded=true' "$GATE_DIR/out2" \
  || { cat "$GATE_DIR/log2" >&2; fail "a newer Android candidate must make the automatic publish a safe no-op"; }
grep -q "No publish step ran" "$GATE_DIR/sum2" \
  || fail "the skipped automatic publish must state that no publish step ran"

# Case 7（执行版）：手动 recovery 不受最新候选策略限制（main 更高也交给现有 publish 守卫）。
run_gate false "$STAGED_VERSION" "$NEXT_VERSION" \
  "$GATE_DIR/out3" "$GATE_DIR/sum3" "$GATE_DIR/log3" \
  || { cat "$GATE_DIR/log3" >&2; fail "manual recovery gate must not fail on a newer main candidate"; }
grep -qx 'superseded=false' "$GATE_DIR/out3" \
  || { cat "$GATE_DIR/log3" >&2; fail "manual recovery must not be subject to the automatic latest-candidate policy"; }

# fail closed：自动续跑的 version / main Version-as-Code 不可读时 gate 必须非零退出。
if run_gate true "not-a-version" "$STAGED_VERSION" \
    "$GATE_DIR/out4" "$GATE_DIR/sum4" "$GATE_DIR/log4"; then
  fail "a malformed automatic publish version must fail closed"
fi
if run_gate true "$STAGED_VERSION" "broken" \
    "$GATE_DIR/out5" "$GATE_DIR/sum5" "$GATE_DIR/log5"; then
  fail "an unreadable main Version-as-Code must fail closed"
fi

echo "publish gate shell (executed): PASS"

# --- 调度策略：queue: max 让 stage / publish 请求互不替换；gate 在执行时判定 ---
python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path
import yaml

root = Path(sys.argv[1])
release = yaml.safe_load((root / ".github/workflows/android-release.yml").read_text(encoding="utf-8"))
auto = yaml.safe_load((root / ".github/workflows/android-auto-publish.yml").read_text(encoding="utf-8"))

assert release["concurrency"] == {
    "group": "android-release", "cancel-in-progress": False, "queue": "max",
}, release["concurrency"]
# 只允许一个 Android release canonical runbook；补充契约不得复活。
assert not (root / "docs/android/auto-publish.md").exists(), \
    "docs/android/release-process.md is the only canonical Android release runbook"
release_doc = (root / "docs/android/release-process.md").read_text(encoding="utf-8")
assert "只能手工续跑" not in release_doc, "the canonical runbook must describe the automatic path"
# canonical runbook 与当前状态摘要入口都不得再描述「真机验收通过后手工 publish」的旧流程。
for doc_path in ("docs/android/release-process.md", "docs/DEVELOPER_GUIDE.md",
                 "docs/android/version-manifest.md", "docs/android/architecture.md"):
    doc_text = (root / doc_path).read_text(encoding="utf-8")
    for stale in ("验证通过后手工", "真机 B13/B14 验证通过后", "发布前的真机验收负责", "只能手工续跑"):
        assert stale not in doc_text, f"{doc_path} still describes the manual publish gate: {stale}"
assert "auto_publish=true" in release_doc and "queue: max" in release_doc, \
    "the canonical runbook must document the automatic continuation and the scheduling contract"
# major / bridge cutover：自动续跑只观察 stage 结论，不得再声称等待基础设施 workflow。
for infra_path in ("docs/android/release-process.md", "docs/DEVELOPER_GUIDE.md",
                   ".github/workflows/android-release.yml", ".github/workflows/android-auto-publish.yml"):
    infra_text = (root / infra_path).read_text(encoding="utf-8")
    assert "两者都成功" not in infra_text, \
        f"{infra_path} still claims automatic publish waits for infra workflows"
assert "不等待" in release_doc and "fail-closed" in release_doc, \
    "the runbook must state the infra-not-ready fail-closed ordering contract"
guide_doc = (root / "docs/DEVELOPER_GUIDE.md").read_text(encoding="utf-8")
assert "android-auto-publish.yml" in guide_doc and "auto_publish=true" in guide_doc, \
    "the developer guide summary must describe the automatic continuation"

# 薄续跑入口只负责请求 publish；是否发布由目标 workflow 在执行时判定。
auto_jobs = auto["jobs"]
assert set(auto_jobs) == {"publish"}, sorted(auto_jobs)
auto_runs = "\n".join(step.get("run") or "" for step in auto_jobs["publish"]["steps"])
assert "-f auto_publish=true" in auto_runs, auto_runs
assert "ls-remote" not in auto_runs, \
    "the thin entry must not decide freshness from a repository SHA comparison"
assert "auto-publish-decision.sh" not in auto_runs, auto_runs
assert auto["concurrency"] == {
    "group": "android-auto-publish", "cancel-in-progress": False, "queue": "max",
}, auto["concurrency"]


def pending_capacity(concurrency):
    """GitHub Actions concurrency: default is one pending slot; queue: max keeps up to 100."""
    queue = concurrency.get("queue", "single")
    if queue == "max":
        return 100
    if queue == "single":
        return 1
    return int(queue)


def simulate(arrivals, capacity):
    """Deterministic model of the documented concurrency semantics (FIFO start order)."""
    started = [arrivals[0]]
    pending = []
    dropped = []
    for request in arrivals[1:]:
        if len(pending) < capacity:
            pending.append(request)
        elif capacity == 1:
            # Default single pending slot: the queued request is canceled and replaced.
            dropped.append(pending.pop())
            pending.append(request)
        else:
            # queue: max with a full queue: the new request is canceled.
            dropped.append(request)
    while pending:
        started.append(pending.pop(0))
    return started, dropped


# Case 5：stage A running → stage B pending → publish A arrives → stage C arrives。
# queue: max 下 B / publish A / C 都留在队列里，没有任何 stage 被自动 publish 挤掉。
capacity = pending_capacity(release["concurrency"])
assert capacity >= 100, capacity
arrivals = ["stage A", "stage B", "publish A", "stage C"]
started, dropped = simulate(arrivals, capacity)
assert dropped == [], f"no stage/publish request may be displaced: {dropped}"
assert sorted(started) == sorted(arrivals), (started, dropped)

# 反证：默认单 pending 槽下同一到达序列会丢失更新的 stage —— 这正是 review P2 的场景，
# 如果 production 配置退回 queue: single，本测试会失败。
legacy_started, legacy_dropped = simulate(arrivals, 1)
assert legacy_dropped, "the single-pending model must demonstrate the displacement this policy prevents"
assert len(legacy_started) < len(arrivals), legacy_started

# Case 6：publish A 排队后 main 出现更新的 Android candidate。publish A 拿到 runner 时，
# publish run 的第一个 job（publish_gate）重新判定，真实 guarded 用例已在上面的 git 时序里
# 执行（candidate_superseded）；publish job 因 needs + superseded 条件被整体 skip，因此不会写
# version.json，旧 candidate 保持 immutable。queue 模型同时证明 B / C 的 stage 请求没有丢失。
assert "needs.publish_gate.outputs.superseded != 'true'" in release["jobs"]["publish"]["if"]

print("android release scheduling policy + candidate freshness wiring: PASS")
PY
