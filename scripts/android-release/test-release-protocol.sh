#!/usr/bin/env bash
set -euo pipefail
source "$ROOT/scripts/android-release/test-release-common.sh"

python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

import yaml

workflow = Path(sys.argv[1]) / ".github/workflows/android-repair-replica.yml"
job = yaml.safe_load(workflow.read_text(encoding="utf-8"))["jobs"]["repair"]
steps = job["steps"]
checkout, start = steps[:2]
assert checkout["uses"].startswith("actions/checkout@")
assert "stage-00-record-job-start.sh" in start["run"]

def step_running(command):
    step, = (s for s in steps if command in s.get("run", ""))
    return step


fetch = step_running("fetch-published-apk.sh")
upload = step_running("stage-17-upload-tsinghua.sh")
public = step_running("--replica stable")
candidate = step_running("install-aliyun-download.sh")
assert steps.index(fetch) < steps.index(upload) < steps.index(public) < steps.index(candidate)
job_seconds = job["timeout-minutes"] * 60
reserve = int(upload["env"]["POST_STAGE_RESERVE_SECONDS"])
assert int(upload["env"]["JOB_TIMEOUT_SECONDS"]) == job_seconds
assert 0 < fetch["timeout-minutes"] * 60 < job_seconds - reserve
assert reserve > (checkout["timeout-minutes"] + public["timeout-minutes"] + candidate["timeout-minutes"]) * 60
assert all(not step.get("continue-on-error") for step in (public, candidate))
print("Repair job budgets cover checkout, origin transfer and final public verification.")
PY

python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]) / "scripts/android-release"))
import workflow_model

workflow = workflow_model.load(Path(sys.argv[1]))
steps = workflow["jobs"]["stage"]["steps"]


def named(fragment):
    hits = [s for s in steps if fragment in (s.get("name") or "")]
    assert len(hits) == 1, f"expected exactly one step containing {fragment!r}, got {len(hits)}"
    return hits[0]


for step in steps:
    if "APK" in (step.get("name") or ""):
        assert "scp-action" not in (step.get("uses") or ""), \
            f"APK must not be pushed via scp-action (cross-border SFTP): {step['name']}"

seeds = [named("Seed APK to TX from Tsinghua replica"), named("Seed APK to TX2 from Tsinghua replica")]
for seed in seeds:
    assert seed["uses"].startswith("appleboy/ssh-action"), seed["name"]
    script = seed["with"]["script"]
    assert "sha256sum -c" in script, f"seed must verify SHA before landing bytes: {seed['name']}"
    assert 'TMP="$DEST.partial.$$"' in script, \
        f"seed temp file must be a hidden sibling of DEST: {seed['name']}"
    # 落位必须原子且 **no-clobber**：classify 的 apk_absent 只是快照，窗口内可能有 manual SSH /
    # 恢复脚本等第三方写入——`mv -f` 会覆盖 immutable 字节，同目录 `ln` 则原子失败并走冲突判定。
    assert 'ln "$TMP" "$DEST"' in script, \
        f"seed must publish via same-dir hard link (atomic no-clobber): {seed['name']}"
    assert 'mv -f "$TMP" "$DEST"' not in script and 'mv "$TMP" "$DEST"' not in script, \
        f"seed must never clobber an existing origin file (immutable APK): {seed['name']}"
    assert 'EXISTING_SHA' in script and 'refusing to overwrite' in script, \
        f"seed must compare existing bytes and fail closed on a concurrent immutable conflict: {seed['name']}"
    cond = seed.get("if") or ""
    assert "apk_absent" in cond, f"seed must stay idempotent (origin apk_absent only): {seed['name']}"
    assert "apkcheck.outputs.tx1State" in cond or "apkcheck.outputs.tx2State" in cond, cond

order = [s.get("name") for s in steps]
tsinghua = named("Upload APK to Tsinghua Cloud")["name"]
classify = named("Classify origin APK on TX1/TX2")["name"]
verify = named("Verify production APK")["name"]
assert order.index(classify) < order.index(named("Install and verify Aliyun APK")["name"]) < order.index(tsinghua) < order.index(seeds[0]["name"]) \
    < order.index(seeds[1]["name"]) < order.index(verify), order
PY

python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]) / "scripts/android-release"))
import workflow_model

workflow = workflow_model.load(Path(sys.argv[1]))
trigger = workflow["on"]
mode = trigger["workflow_dispatch"]["inputs"]["mode"]
assert mode["default"] == "stage", mode
assert mode["options"] == ["stage", "publish"], mode

jobs = workflow["jobs"]
assert set(jobs) == {"stage", "publish_gate", "publish"}, sorted(jobs)
stage, gate, publish = jobs["stage"], jobs["publish_gate"], jobs["publish"]

# --- 调度不变量：生产 mutation 仍串行，但 stage / publish 请求不因单 pending 槽互相替换 ---
assert workflow["concurrency"] == {
    "group": "android-release", "cancel-in-progress": False, "queue": "max",
}, workflow["concurrency"]

# --- 自动发布新鲜度 gate：只在 auto_publish=true 时生效，且在 publish 开始执行时判定 ---
auto_input = trigger["workflow_dispatch"]["inputs"]["auto_publish"]
assert auto_input["default"] == "false", auto_input
assert auto_input["options"] == ["false", "true"], auto_input
assert gate.get("needs") is None, "the freshness gate must run at the start of the publish run"
assert gate["if"] == "github.event_name == 'workflow_dispatch' && inputs.mode == 'publish'", gate["if"]
assert gate["outputs"] == {
    "superseded": "${{ steps.freshness.outputs.superseded }}",
}, gate["outputs"]
assert publish.get("needs") == "publish_gate", publish.get("needs")
assert "needs.publish_gate.outputs.superseded != 'true'" in publish["if"], publish["if"]
assert "inputs.auto_publish" not in publish["if"], \
    "manual recovery must not be subject to the automatic latest-candidate policy"
gate_checkout = next(step for step in gate["steps"] if str(step.get("uses", "")).startswith("actions/checkout"))
assert gate_checkout["with"]["ref"] == "main", gate_checkout
freshness = next(step for step in gate["steps"] if step.get("id") == "freshness")
assert "${{ inputs.auto_publish }}" in freshness["env"]["AUTO_PUBLISH"], freshness["env"]
assert "${{ inputs.version }}" in freshness["env"]["REQUESTED_VERSION"], freshness["env"]
freshness_run = freshness["run"]
assert "classify_candidate_freshness" in freshness_run, freshness_run
auto_branch = freshness_run.index('if [ "$AUTO_PUBLISH" = "true" ]')
assert freshness_run.index("classify_candidate_freshness") > auto_branch, \
    "the latest-candidate decision must be opt-in (manual recovery bypasses it)"
assert "SUPERSEDED=false" in freshness_run and 'echo "superseded=$SUPERSEDED"' in freshness_run, freshness_run


def runs(job):
    return "\n".join(step.get("run") or "" for step in job["steps"])


def names(job):
    return [step.get("name", "") for step in job["steps"]]


def with_env(job):
    parts = []
    for step in job["steps"]:
        parts.append(step.get("run") or "")
        parts.extend(str(value) for value in (step.get("env") or {}).values())
    return "\n".join(parts)


stage_runs, stage_names = runs(stage), names(stage)
publish_runs, publish_names = runs(publish), names(publish)
stage_text, publish_text = with_env(stage), with_env(publish)

# --- stage: immutable evidence only, never the publication commit point ---
assert "release-staging/version.json" not in stage_runs, "stage must not write version.json"
assert ".staging.json" in stage_runs, "stage must publish staging evidence"
assert "stagingName" in stage_runs, "stage must expose the staging evidence name"
assert any("staging evidence" in name.lower() for name in stage_names), stage_names
assert "sha256sum" in stage_runs, "stage must verify the APK it staged"
assert "download/android" in stage_runs, "stage must verify the public APK URL"
assert "assembleRelease" in stage_runs, "stage is the phase that builds and signs the APK"

# --- stage: the signed release APK must carry the local-first bundle (PR #467 review) ---
# 顺序即协议：取回 pinned Agent 产物 → 前端校验/构建 → 构建 Android bundle → assembleRelease
# → 内容验证 → 才允许 seed 到两台 origin / 打 tag / 写 staging evidence。
def step_index(predicate, label):
    for i, name in enumerate(stage_names):
        if predicate(name, i):
            return i
    raise AssertionError(f"stage step not found: {label}")


fetch_wasm_i = step_index(lambda n, i: n.startswith("Fetch pinned Agent WASM"), "fetch wasm")
frontend_i = step_index(lambda n, i: n.startswith("Frontend tests"), "frontend validation")
bundle_i = step_index(lambda n, i: "local-first frontend bundle" in n, "build:android")
assemble_i = step_index(
    lambda n, i: "assembleRelease" in (stage["steps"][i].get("run") or ""), "assembleRelease")
verify_bundle_i = step_index(lambda n, i: "Verify release APK carries" in n, "release APK bundle verification")
seed_apk_i = step_index(lambda n, i: n.startswith("Seed APK to TX"), "seed APK")
tag_i = step_index(lambda n, i: n.startswith("Ensure release tag"), "release tag")
evidence_i = step_index(lambda n, i: "staging evidence" in n.lower(), "staging evidence")
assert fetch_wasm_i < frontend_i < bundle_i < assemble_i < verify_bundle_i, stage_names
assert verify_bundle_i < seed_apk_i < tag_i < evidence_i, stage_names
bundle_runs = "\n".join(step.get("run") or "" for step in stage["steps"][bundle_i:assemble_i])
assert "pnpm --dir frontend run build:android" in bundle_runs, bundle_runs
# 不重复 pnpm install / 不重复取回 Agent 产物：bundle 步骤只复用前端校验的工作区。
assert "pnpm install" not in bundle_runs, bundle_runs
assert "fetch-agent-wasm" not in bundle_runs, bundle_runs
verify_runs = stage["steps"][verify_bundle_i]["run"]
for required in ("assets/web/index.html", "assets/web/bundle-manifest.json",
                 "wotb_replay_wasm.js", "wotb_replay_wasm_bg.wasm"):
    assert required in verify_runs, f"release APK verification must require {required}"
assert "unzip -Z1" in verify_runs and "listing_file" in verify_runs, \
    "release APK verification must use a listing file (no pipe into grep -q under pipefail)"
# 注释里可以解释这个坑；真实命令里不允许再出现（YAML 注释以 # 开头）。
verify_commands = "\n".join(
    line for line in verify_runs.splitlines() if not line.lstrip().startswith("#"))
assert "| grep -q" not in verify_commands, verify_runs
assert '"$AGENT_REF" = "$MANIFEST_REF"' in verify_runs or "AGENT_REF" in verify_runs, verify_runs

# --- publish: automatic continuation / manual recovery, no rebuild ---
assert "inputs.mode == 'publish'" in publish.get("if", ""), publish.get("if")
# `--gradle-properties`（契约校验参数）不是构建；这里禁的是真正的重建 / 重新签名路径。
for forbidden in ("assembleRelease", "setup-gradle", "wotbKeystorePath", "keystore.jks",
                  "ANDROID_KEYSTORE_BASE64", "base64 --decode"):
    assert forbidden not in publish_runs, f"publish must reuse the staged APK, not rebuild ({forbidden})"

# --- publish: the candidate identity is the EXPLICIT version, never current main ---
version_input = trigger["workflow_dispatch"]["inputs"]["version"]
assert version_input["type"] == "string", version_input
assert version_input["required"] is False, "GitHub cannot express a conditional required; the job must fail closed"
# 显式版本是唯一入口：没有它就 fail closed（绝不猜、绝不从当前 main 推导候选）。
guard_step = next(i for i, name in enumerate(publish_names) if "explicit staged version" in name)
assert "REQUESTED_VERSION" in publish["steps"][guard_step].get("env", {}), publish["steps"][guard_step]
guard_runs = publish["steps"][guard_step]["run"]
assert "${{ inputs.version }}" in publish["steps"][guard_step]["env"]["REQUESTED_VERSION"], \
    "the guard must read the workflow_dispatch version input"
assert "exit 1" in guard_runs and "X.Y.Z" in guard_runs, guard_runs
# 候选 tag / APK / staging evidence 名全部由显式版本推导。
stagedref_i = next(i for i, step in enumerate(publish["steps"]) if step.get("id") == "stagedref")
stagedref_runs = publish["steps"][stagedref_i]["run"]
assert 'TAG="android-v$REQUESTED_VERSION"' in stagedref_runs, stagedref_runs
assert 'apkName=wotbtools-android-v$REQUESTED_VERSION.apk' in stagedref_runs, stagedref_runs
assert 'stagingName=wotbtools-android-v$REQUESTED_VERSION.staging.json' in stagedref_runs, stagedref_runs
assert "resolve-staged-version.sh" in stagedref_runs, \
    "publish must resolve the staged version from the tag target, not from the workspace"
# 工作区的 committed 版本不得参与候选身份：publish 里不允许再解析 steps.version 或读它的属性。
assert "steps.version.outputs" not in publish_text, \
    "publish must not derive the candidate from the current main committed version"
# 当前 main 的 gradle.properties 只能在「当前策略」校验里出现（android_contract.py validate），
# 不允许作为候选版本 / 候选版本号的来源。
for step in publish["steps"]:
    run = step.get("run") or ""
    if "grep -Fxq" in run and "gradle.properties" in run:
        assert "$RUNNER_TEMP" in run, f"candidate version must come from the tag target copy: {step.get('name')}"
# 显式版本必须与 staged 源码的版本一致（CASE 4/5 的强制点），并且 tag 由 staged 版本推导。
assert "resolve-staged-version.sh" in stagedref_runs and "grep -Fxq \"tagName=$TAG\"" in stagedref_runs
stagedversion_i = next(i for i, step in enumerate(publish["steps"]) if step.get("id") == "stagedversion")
stagedversion_runs = publish["steps"][stagedversion_i]["run"]
assert "git archive" in stagedref_runs, "the staged source must be exported from the tag target"
assert "$TAG_TARGET" in stagedversion_runs, stagedversion_runs
assert "cmp -s" in stagedversion_runs, "current main's contract drift must fail closed"

# --- staged versionCode：唯一来源 + 不得把 Python 局部变量当 shell 变量（release blocker）---
staged_i = next(i for i, step in enumerate(publish["steps"]) if step.get("id") == "staged")
staged_step = publish["steps"][staged_i]
staged_runs = staged_step["run"]
staged_env = staged_step.get("env", {})
# 1) canonical 值来自 stagedref（显式版本 → tag target），不是当前 main。
assert staged_env.get("STAGED_VERSION_CODE") == "${{ steps.stagedref.outputs.versionCode }}", staged_env
# 2) 写 $GITHUB_OUTPUT 的 versionCode 必须用那个 env 值。
assert 'echo "versionCode=$STAGED_VERSION_CODE" >> "$GITHUB_OUTPUT"' in staged_runs, \
    "staged versionCode output must come from STAGED_VERSION_CODE (the tag target), not a shell copy"
# 3) 回归锁：`expected` 只存在于 Python 进程内，绝不能出现在 shell 命令里
#    （set -euo pipefail 下会直接 `expected: unbound variable` 炸掉整个 publish）。
shell_lines = [line for line in staged_runs.splitlines() if not line.lstrip().startswith("#")]
assert not any("$expected" in line or "${expected}" in line for line in shell_lines), \
    "shell must not reference the Python-local `expected` (unbound variable under set -u)"
assert "${{ steps.version.outputs" not in staged_runs, staged_runs
# 4) APK badging 校验必须仍然存在，且比对的是 STAGED_VERSION_CODE。
assert "apk-badging.txt" in staged_runs and "versionCode='" in staged_runs, staged_runs
assert '"$STAGED_VERSION_CODE"' in staged_runs, "badging validation must compare against the staged versionCode"
# version.json 的内容（= 发布结果）只能来自 staged 身份。
write_step = publish["steps"][next(i for i, name in enumerate(publish_names)
                                         if name.startswith("Write version.json"))]
write_runs = write_step["run"]
write_env = "\n".join(str(value) for value in (write_step.get("env") or {}).values())
write_sources = write_runs + "\n" + write_env
for source in ("steps.staged.outputs.versionCode", "steps.staged.outputs.versionName",
               "steps.staged.outputs.nativeBridgeVersion", "steps.staged.outputs.stagedSource",
               "steps.staged.outputs.apkSha", "steps.stagedref.outputs.apkName"):
    assert source in write_sources, f"version.json must be written from {source}"
assert "steps.version.outputs" not in write_sources, write_sources

# --- publish: the release authority is the STAGED identity, not the checkout SHA ---
assert "guard_staged_release_identity" in publish_runs, "publish must prove the staged artifact identity"
assert '--is-ancestor "$TAG_TARGET" origin/main' in publish_runs, "publish must keep staged main ancestry"
assert "steps.staged.outputs.stagedSource" in publish_text, "publish must carry the staged source SHA"
assert "origin/main" in publish_runs, "publish must anchor ancestry on current main"
assert "publish must run from origin/main HEAD" not in publish_runs, \
    "publish must not require the staged source to equal current main HEAD (main may have advanced)"

# --- publish: the four publication invariants ---
assert ".staging.json" in publish_runs, "publish must read the staging evidence"
assert "sha256sum" in publish_runs, "publish must re-verify the staged APK bytes"
assert "refs/tags/" in publish_runs, "publish must resolve the immutable release tag"
assert "guard_min_supported" in publish_runs, "publish must verify minSupportedVersionCode"
assert "guard_bridge_covered" in publish_runs, "publish must verify the bridge cutover coverage"
assert "protocol/openid-connect/auth" in publish_runs, "publish must re-verify the Keycloak client"
assert "android_contract.py bundle" in publish_runs, "publish must validate the APK manifest/auth identity"
assert "--evidence" in publish_runs and "--output" in stage_runs, "stage and publish must share evidence validation"
assert "guard_local_first_cutover" in publish_runs and "guard_local_first_cutover" in stage_runs
assert "android_contract.py cors" in publish_runs and "/api/users/profile" in publish_runs
# 资产源是本机路径 /agent-assets + Native AgentAssetProxy 直连 Alibaba（原生无 CORS），
# readiness 探测对象是新版本对象源匿名可读性，而不是 legacy 网关 exact-origin CORS。
assert '"$ASSET_ORIGIN/index.json"' in publish_runs
assert "$COS_BASE/index.json" not in publish_runs
assert "https://wotbtools.com/version.json" not in publish_runs
assert "FE_COMMIT" not in publish_text and "frontend-version.json" not in publish_text

# --- version.json is the LAST mutation, and it records the STAGED source ---
write_index = next(i for i, name in enumerate(publish_names) if name.startswith("Write version.json"))
upload_index = next(i for i, name in enumerate(publish_names) if name.startswith("Upload version.json"))
verify_index = next(i for i, name in enumerate(publish_names) if name.startswith("Verify production version.json"))
assert write_index < upload_index < verify_index, publish_names
assert "steps.staged.outputs.stagedSource" in write_sources, \
    "version.json must record the staged release source, not the checkout HEAD"
scp_indices = [i for i, step in enumerate(publish["steps"])
               if str(step.get("uses", "")).startswith("appleboy/scp-action")]
distribution = next(i for i, step in enumerate(publish["steps"]) if step.get("run_path", "").endswith("/publish-verify-distribution.sh"))
assert staged_i < distribution < next(i for i, step in enumerate(publish["steps"]) if step.get("run_path", "").endswith("/publish-09-write-version-json.sh")) < min(scp_indices)
assert publish["steps"][distribution]["if"] == publish["steps"][min(scp_indices)]["if"]
assert not publish["steps"][distribution].get("continue-on-error")
assert max(scp_indices) == upload_index, "the version.json upload must be the last artifact upload"
for step in publish["steps"][upload_index + 1:]:
    assert not str(step.get("uses", "")).startswith(("appleboy/scp-action", "appleboy/ssh-action")), step
    assert "release-staging" not in (step.get("run") or ""), step

print("Android release two-phase protocol: PASS")
PY
