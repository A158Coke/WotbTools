#!/usr/bin/env bash
# Pure Android release helper tests: committed version authority, contract gate,
# and production state classification. No secrets or release side effects.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOLVE="$ROOT/scripts/android-release/resolve-version.sh"
GUARDS="$ROOT/scripts/android-release/check-release-guards.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

python3 - "$ROOT/.github/workflows/android-release.yml" <<'PY'
import sys
import yaml

workflow = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
trigger = workflow.get(True, workflow.get("on", {}))
push = trigger["push"]
assert "android/gradle.properties" in push["paths"], "Android release must be version-triggered"
assert "android-v*" in push["tags"], "Android tag recovery trigger is missing"
PY

resolve() {
  WOTB_ROOT="$ROOT" WOTB_TRIGGER="$1" WOTB_TAG_NAME="${2:-}" WOTB_COMMIT="deadbeef" bash "$RESOLVE"
}

# 期望值取自已提交的 android/gradle.properties，而不是写死某个版本：每次发版升号都不该改测试。
COMMITTED_VERSION="$(sed -n 's/^wotbVersion=//p' "$ROOT/android/gradle.properties" | head -n1)"
[[ "$COMMITTED_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || fail "committed version is not X.Y.Z: $COMMITTED_VERSION"
EXPECTED_CODE=$(( BASH_REMATCH[1] * 1000000 + BASH_REMATCH[2] * 1000 + BASH_REMATCH[3] ))
# Bridge 版本同样取自已提交的 contract：bridge 升版不该改测试。
EXPECTED_BRIDGE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1], encoding="utf-8"))["bridgeVersion"])' "$ROOT/contracts/android-native-bridge.json")"
resolve workflow_dispatch | grep -qx "versionName=$COMMITTED_VERSION" || fail "committed version authority"
resolve workflow_dispatch | grep -qx "versionCode=$EXPECTED_CODE" || fail "versionCode formula"
resolve workflow_dispatch | grep -qx "nativeBridgeVersion=$EXPECTED_BRIDGE" || fail "bridge version from contract"
resolve push "android-v$COMMITTED_VERSION" | grep -qx "tagName=android-v$COMMITTED_VERSION" || fail "compatible tag"
if resolve push android-v9.9.9 >/dev/null 2>&1; then fail "mismatched tag must fail"; fi

# 纯 bash 的 bridge cutover guard，不依赖 jq，因此本机也能跑。
. "$GUARDS"
bridge_cutover_code=2000000
guard_bridge_covered 1 2 "2" "$bridge_cutover_code" "$bridge_cutover_code" || fail "configured bridge cutover must pass"
if guard_bridge_covered 1 2 "2" 1000000 "$bridge_cutover_code"; then fail "dropped bridge without mandatory update must fail"; fi
guard_bridge_covered 1 2 "1,2" 1000000 "$bridge_cutover_code" || fail "frontend still serving the old bridge needs no cutover"
guard_bridge_covered "" 2 "2" 1000000 "$bridge_cutover_code" || fail "first release needs no cutover"
guard_bridge_covered 2 2 "2" 1000000 2001000 || fail "unchanged bridge needs no cutover"
if guard_bridge_covered 1 2 "" 1000000 "$bridge_cutover_code" 2>/dev/null; then fail "empty frontend version set must not be treated as coverage"; fi

# 发布权威是 staged release 身份（tag + staging evidence + APK SHA），纯 bash、不依赖 jq/git。
staged_a='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
staged_b='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
apk_sha='dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
apk_sha_other='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
guard_staged_release_identity "$staged_a" "$staged_a" "$staged_a" "$apk_sha" "$apk_sha" \
  || fail "matching tag/evidence/APK identity must pass"
if guard_staged_release_identity "$staged_b" "$staged_a" "$staged_a" "$apk_sha" "$apk_sha" 2>/dev/null; then
  fail "a tag pointing at another commit must fail"
fi
if guard_staged_release_identity "$staged_a" "$staged_a" "$staged_b" "$apk_sha" "$apk_sha" 2>/dev/null; then
  fail "staging evidence from another commit must fail"
fi
if guard_staged_release_identity "$staged_a" "$staged_a" "$staged_a" "$apk_sha" "$apk_sha_other" 2>/dev/null; then
  fail "a staged APK whose SHA-256 differs from the evidence must fail"
fi
if guard_staged_release_identity "" "$staged_a" "$staged_a" "$apk_sha" "$apk_sha" 2>/dev/null; then
  fail "a missing/absent release tag must fail"
fi
if guard_staged_release_identity "$staged_a" "$staged_a" "$staged_a" "not-a-sha" "$apk_sha" 2>/dev/null; then
  fail "malformed evidence SHA-256 must fail"
fi

# 历史模型 A（staged）─ F（线上前端）─ B（当前 main）：main 前进不作废已 staged 版本，
# 但前端必须包含 A、且本身来自 main；反向（前端比 A 旧）必须失败。
guard_release_ancestry 1 1 1 || fail "A ∈ main, F ⊇ A, F ∈ main must pass"
if guard_release_ancestry 0 1 1 2>/dev/null; then fail "staged source outside current main history must fail"; fi
if guard_release_ancestry 1 1 0 2>/dev/null; then fail "frontend build outside main history must fail"; fi
if guard_release_ancestry 1 0 1 2>/dev/null; then fail "frontend older than the staged release (reversed ancestry) must fail"; fi

python3 "$ROOT/scripts/android-release/android_contract.py" version 1.0.2 | grep -q '1000002' || fail "version parser"
if python3 "$ROOT/scripts/android-release/android_contract.py" version 1.0.02 >/dev/null 2>&1; then fail "invalid version must fail"; fi
bash "$ROOT/scripts/android-release/test-android-contract.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is unavailable; production JSON classifier cases are CI-only"
  exit 0
fi

. "$GUARDS"
guard_min_supported 1000000 1000002 || fail "minSupported ok"
if guard_min_supported 1001000 1000002; then fail "minSupported over-bound should reject"; fi

write_json() { printf '%s' "$2" > "$TMP/$1"; }
sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
source_sha='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
write_json older '{"schemaVersion":1,"latestVersionCode":1000001,"latestVersionName":"1.0.1","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.1.apk","sha256":"'$sha'"}'
classify_prod "$TMP/older" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1
[ "$PROD_STATE" = prod_older ] || fail "prod_older"
write_json newer '{"schemaVersion":1,"latestVersionCode":1000003,"latestVersionName":"1.0.3","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.3.apk","sha256":"'$sha'"}'
classify_prod "$TMP/newer" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1
[ "$PROD_STATE" = prod_newer ] || fail "prod_newer"
write_json equal '{"schemaVersion":1,"latestVersionCode":1000002,"latestVersionName":"1.0.2","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"sourceSha":"'$source_sha'","apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.2.apk","sha256":"'$sha'"}'
classify_prod "$TMP/equal" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1 "$source_sha"
[ "$PROD_STATE" = prod_equal_ok ] || fail "prod_equal_ok"
classify_prod "$TMP/equal" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1 wrong-source-sha
[ "$PROD_STATE" = prod_equal_conflict ] || fail "sourceSha conflict"
sed 's/"nativeBridgeVersion":1/"nativeBridgeVersion":2/' "$TMP/equal" > "$TMP/bridge-conflict"
classify_prod "$TMP/bridge-conflict" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1
[ "$PROD_STATE" = prod_equal_conflict ] || fail "bridge conflict"

classify_prod_apk "" 1000002
[ "$APK_STATE" = apk_absent ] || fail "apk_absent"
classify_prod_apk abc abc
[ "$APK_STATE" = apk_equal ] || fail "apk_equal"
classify_prod_apk abc def
[ "$APK_STATE" = apk_conflict ] || fail "apk_conflict"

classify_tag "" android-v1.0.2 1000002
[ "$TAG_STATE" = tag_absent ] || fail "tag_absent"
classify_tag $'abc\trefs/tags/android-v1.0.2' android-v1.0.2 abc
[ "$TAG_STATE" = tag_equal ] || fail "tag_equal"
classify_tag $'abc\trefs/tags/android-v1.0.2\ndef456\trefs/tags/android-v1.0.2^{}' android-v1.0.2 def456
[ "$TAG_STATE" = tag_equal ] || fail "annotated tag_equal"

classify_tag $'abc\trefs/tags/android-v1.0.2' android-v1.0.2 def456
[ "$TAG_STATE" = tag_conflict ] || fail "tag_conflict"

python3 - "$ROOT/.github/workflows/android-release.yml" <<'PY'
from pathlib import Path
import sys

workflow = Path(sys.argv[1]).read_text(encoding="utf-8")
preflight = workflow.index("Preflight classify production state")
agent_wasm = workflow.index("Fetch pinned Agent WASM for frontend validation")
frontend = workflow.index("Frontend tests + build validation")
upload = workflow.index("Upload APK to TX")
ensure_tag = workflow.index("Ensure release tag (idempotent)")
assert preflight < agent_wasm < frontend < upload < ensure_tag
preflight_block = workflow[preflight:agent_wasm]
assert 'classify_tag "$REFS" "$TAG" "$COMMIT_SHA"' in preflight_block
assert 'if [ "$TAG_STATE" = "tag_conflict" ]; then' in preflight_block
agent_wasm_block = workflow[agent_wasm:frontend]
assert "bash scripts/fetch-agent-wasm.sh" in agent_wasm_block, \
    "Android release frontend validation must fetch the pinned Agent WASM first"
PY

# 两阶段发布协议：stage 只做 staging（绝不写 production version.json），publish 只能手工续跑、
# 绝不重建 APK，并且必须在写 manifest 之前证明四件事（staged 身份 / Keycloak client /
# production frontend native 运行面 / minSupported 覆盖 cutover）。
python3 - "$ROOT/.github/workflows/android-release.yml" <<'PY'
import sys
import yaml

workflow = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
trigger = workflow.get(True, workflow.get("on", {}))
mode = trigger["workflow_dispatch"]["inputs"]["mode"]
assert mode["default"] == "stage", mode
assert mode["options"] == ["stage", "publish"], mode

jobs = workflow["jobs"]
assert set(jobs) == {"stage", "publish"}, sorted(jobs)
stage, publish = jobs["stage"], jobs["publish"]


def runs(job):
    return "\n".join(step.get("run") or "" for step in job["steps"])


def names(job):
    return [step.get("name", "") for step in job["steps"]]


stage_runs, stage_names = runs(stage), names(stage)
publish_runs, publish_names = runs(publish), names(publish)

# --- stage: immutable evidence only, never the publication commit point ---
assert "release-staging/version.json" not in stage_runs, "stage must not write version.json"
assert ".staging.json" in stage_runs, "stage must publish staging evidence"
assert "stagingName" in stage_runs, "stage must expose the staging evidence name"
assert any("staging evidence" in name.lower() for name in stage_names), stage_names
assert "sha256sum" in stage_runs, "stage must verify the APK it staged"
assert "download/android" in stage_runs, "stage must verify the public APK URL"
assert "assembleRelease" in stage_runs, "stage is the phase that builds and signs the APK"

# --- publish: manual continuation, no rebuild ---
assert "inputs.mode == 'publish'" in publish.get("if", ""), publish.get("if")
# `--gradle-properties`（契约校验参数）不是构建；这里禁的是真正的重建 / 重新签名路径。
for forbidden in ("assembleRelease", "setup-gradle", "wotbKeystorePath", "keystore.jks",
                  "ANDROID_KEYSTORE_BASE64", "base64 --decode"):
    assert forbidden not in publish_runs, f"publish must reuse the staged APK, not rebuild ({forbidden})"

# --- publish: the release authority is the STAGED identity, not the checkout SHA ---
assert "guard_staged_release_identity" in publish_runs, "publish must prove the staged artifact identity"
assert "guard_release_ancestry" in publish_runs, "publish must prove the release/frontend ancestry"
assert "steps.staged.outputs.stagedSource" in publish_runs, "publish must carry the staged source SHA"
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
assert "nativeRuntime" in publish_runs, "publish must verify the production frontend capability"

# --- version.json is the LAST mutation, and it records the STAGED source ---
write_index = next(i for i, name in enumerate(publish_names) if name.startswith("Write version.json"))
upload_index = next(i for i, name in enumerate(publish_names) if name.startswith("Upload version.json"))
verify_index = next(i for i, name in enumerate(publish_names) if name.startswith("Verify production version.json"))
assert write_index < upload_index < verify_index, publish_names
assert "steps.staged.outputs.stagedSource" in publish["steps"][write_index]["run"], \
    "version.json must record the staged release source, not the checkout HEAD"
scp_indices = [i for i, step in enumerate(publish["steps"])
               if str(step.get("uses", "")).startswith("appleboy/scp-action")]
assert max(scp_indices) == upload_index, "the version.json upload must be the last artifact upload"
for step in publish["steps"][upload_index + 1:]:
    assert not str(step.get("uses", "")).startswith(("appleboy/scp-action", "appleboy/ssh-action")), step
    assert "release-staging" not in (step.get("run") or ""), step

# --- frontend ancestry direction: staged A must be included BY the frontend build F ---
assert '--is-ancestor "$STAGED_SOURCE" "$FE_COMMIT"' in publish_runs, \
    "the frontend build must include the staged Android source"
assert '--is-ancestor "$FE_COMMIT" "$ORIGIN_MAIN"' in publish_runs, \
    "the frontend build must itself be contained in current main"
assert '--is-ancestor "$FE_COMMIT" "${{ steps.version.outputs.commit }}"' not in publish_runs, \
    "the reversed (old) frontend ancestry check must be gone"
print("Android release two-phase protocol: PASS")
PY

echo "ALL ANDROID RELEASE TESTS PASSED"
