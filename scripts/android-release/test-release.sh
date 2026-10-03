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

guard_local_first_cutover 2000001 2000001 || fail "local-first cutover floor must pass"
guard_local_first_cutover 2000001 2000002 || fail "later patches keep the local-first floor"
if guard_local_first_cutover 2000000 2000001 2>/dev/null; then fail "PR A minimum must not permit PR B publish"; fi
if guard_local_first_cutover 1000000 2000001 2>/dev/null; then fail "1.x minimum must reject local-first cutover"; fi

python3 "$ROOT/scripts/android-release/android_contract.py" version 1.0.2 | grep -q '1000002' || fail "version parser"
if python3 "$ROOT/scripts/android-release/android_contract.py" version 1.0.02 >/dev/null 2>&1; then fail "invalid version must fail"; fi
bash "$ROOT/scripts/android-release/test-android-contract.sh"

# Stage/publish evidence roundtrip against APK bytes, with independent corruption cases.
python3 - "$ROOT" "$TMP" <<'PY'
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import sys
import zipfile
from argparse import Namespace
from pathlib import Path

root, tmp = map(Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location("android_contract", root / "scripts/android-release/android_contract.py")
gates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gates)
contract = json.loads((root / "contracts/android-native-bridge.json").read_text(encoding="utf-8"))
contract["origin"] = "https://appassets.androidplatform.net"
pin = json.loads((root / "deploy/agent/source.json").read_text(encoding="utf-8"))
source = "a" * 40
version = "2.0.1"
contents = {"index.html": b"local index", f"wasm/{pin['ref']}/wotb_replay_wasm.js": b"js", f"wasm/{pin['ref']}/wotb_replay_wasm_bg.wasm": b"wasm"}
digest = lambda data: hashlib.sha256(data).hexdigest()
manifest = {
    "schemaVersion": 2, "target": "android", "buildCommit": source,
    "runtimeOrigin": contract["origin"], "apiOrigin": "https://wotbtools.com",
    "assetOrigin": "https://wotbtools.com/agent-assets", "entry": "index.html",
    "agentWasm": {"commit": pin["ref"], "release": pin["artifact"]["release"]},
    "nativeRuntime": {"supportedBridgeVersions": [contract["bridgeVersion"]], "nativeAuthCapability": "native-auth",
                      "nativeAuthMethods": gates.auth_surface(contract)[0], "authChangedGlobal": contract["events"]["authChanged"]["global"]},
    "files": [{"path": path, "size": len(data), "sha256": digest(data)} for path, data in contents.items()],
    "fileCount": len(contents), "totalBytes": sum(map(len, contents.values())),
    "entrySha256": digest(contents["index.html"]), "agentWasmSha256": digest(b"wasm"),
}
apk = tmp / "bundle.apk"
def write_apk(doc, files=contents):
    with zipfile.ZipFile(apk, "w") as archive:
        for path, data in files.items():
            archive.writestr("assets/web/" + path, data)
        archive.writestr("assets/web/bundle-manifest.json", json.dumps(doc))

def reject(call):
    with contextlib.redirect_stderr(io.StringIO()):
        try:
            call()
        except SystemExit:
            return
    raise AssertionError("corrupt artifact / readiness was accepted")

write_apk(manifest)
contract_file, pin_file, badging = tmp / "contract.json", tmp / "pin.json", tmp / "badging.txt"
contract_file.write_text(json.dumps(contract), encoding="utf-8")
pin_file.write_text(json.dumps(pin), encoding="utf-8")
badging.write_text("package: name='com.wotbtools.app' versionCode='2000001' versionName='2.0.1'", encoding="utf-8")
evidence_path = tmp / "evidence.json"
args = Namespace(apk=str(apk), badging=str(badging), contract=str(contract_file), pin=str(pin_file), source=source, version=version, evidence=None, output=str(evidence_path))
gates.command_bundle(args)
evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
assert evidence["schemaVersion"] == 2 and evidence["bundleFileCount"] == 4
args.evidence = str(evidence_path)
gates.command_bundle(args)  # publish validates the exact stage identity without rebuilding.
for field in evidence:
    broken = copy.deepcopy(evidence)
    broken[field] = None
    evidence_path.write_text(json.dumps(broken), encoding="utf-8")
    reject(lambda: gates.command_bundle(args))
evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
# Legacy PR A schema1 evidence cannot establish a local-first bundle.
legacy = copy.deepcopy(evidence); legacy["schemaVersion"] = 1
evidence_path.write_text(json.dumps(legacy), encoding="utf-8")
reject(lambda: gates.command_bundle(args))
evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
for field in ("runtimeOrigin", "buildCommit", "agentWasm", "nativeRuntime", "fileCount", "totalBytes", "files", "entrySha256"):
    broken = copy.deepcopy(manifest)
    broken[field] = [] if field == "files" else None
    write_apk(broken)
    reject(lambda: gates.apk_bundle_identity(str(apk), contract, pin, source, version))
write_apk(manifest, {**contents, "index.html": b"tampered index"})
reject(lambda: gates.apk_bundle_identity(str(apk), contract, pin, source, version))
reject(lambda: gates.validate_apk_version("package: name='com.wotbtools.app' versionCode='2000000' versionName='2.0.0'", version))
# Exact-origin preflight, authenticated route and asset readiness; no wildcard or credentials.
headers = {"access-control-allow-origin": contract["origin"], "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
           "access-control-allow-headers": "Authorization, Content-Type, Content-Encoding, Accept",
           "access-control-expose-headers": "Content-Disposition, X-Request-ID, X-Map-Meta"}
gates.validate_cors(204, headers, contract["origin"], ["GET", "PATCH"], ["authorization", "content-encoding"])
gates.validate_cors(401, headers, contract["origin"], [], [], 401)
for field, value in [("access-control-allow-origin", "*"), ("access-control-allow-origin", "https://untrusted.example"),
                     ("access-control-allow-credentials", "true"), ("access-control-allow-methods", "GET"),
                     ("access-control-allow-headers", "Accept"),
                     ("access-control-expose-headers", "Content-Disposition, X-Request-ID")]:
    reject(lambda: gates.validate_cors(204, {**headers, field: value}, contract["origin"], ["PATCH"], ["authorization"]))
reject(lambda: gates.validate_cors(503, headers, contract["origin"], [], []))
reject(lambda: gates.validate_cors(200, headers, contract["origin"], [], [], 401))
print("APK bundle evidence and exact-origin readiness: PASS")
PY

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
# bundled frontend / API / assets / minSupported 覆盖 cutover）。
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

# --- stage: the signed release APK must carry the local-first bundle (PR #467 review) ---
# 顺序即协议：取回 pinned Agent 产物 → 前端校验/构建 → 构建 Android bundle → assembleRelease
# → 内容验证 → 才允许上传 / 打 tag / 写 staging evidence。
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
upload_apk_i = step_index(lambda n, i: n.startswith("Upload APK to TX"), "upload APK")
tag_i = step_index(lambda n, i: n.startswith("Ensure release tag"), "release tag")
evidence_i = step_index(lambda n, i: "staging evidence" in n.lower(), "staging evidence")
assert fetch_wasm_i < frontend_i < bundle_i < assemble_i < verify_bundle_i, stage_names
assert verify_bundle_i < upload_apk_i < tag_i < evidence_i, stage_names
bundle_runs = "\n".join(step.get("run") or "" for step in stage["steps"][bundle_i:assemble_i])
assert "npm --prefix frontend run build:android" in bundle_runs, bundle_runs
# 不重复 npm ci / 不重复取回 Agent 产物：bundle 步骤只复用前端校验的工作区。
assert "npm ci" not in bundle_runs, bundle_runs
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

# --- publish: manual continuation, no rebuild ---
assert "inputs.mode == 'publish'" in publish.get("if", ""), publish.get("if")
# `--gradle-properties`（契约校验参数）不是构建；这里禁的是真正的重建 / 重新签名路径。
for forbidden in ("assembleRelease", "setup-gradle", "wotbKeystorePath", "keystore.jks",
                  "ANDROID_KEYSTORE_BASE64", "base64 --decode"):
    assert forbidden not in publish_runs, f"publish must reuse the staged APK, not rebuild ({forbidden})"

# --- publish: the release authority is the STAGED identity, not the checkout SHA ---
assert "guard_staged_release_identity" in publish_runs, "publish must prove the staged artifact identity"
assert '--is-ancestor "$TAG_TARGET" origin/main' in publish_runs, "publish must keep staged main ancestry"
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
assert "android_contract.py bundle" in publish_runs, "publish must validate the APK manifest/auth identity"
assert "--evidence" in publish_runs and "--output" in stage_runs, "stage and publish must share evidence validation"
assert "guard_local_first_cutover" in publish_runs and "guard_local_first_cutover" in stage_runs
assert "android_contract.py cors" in publish_runs and "/api/users/profile" in publish_runs
assert "$ASSETS/index.json" in publish_runs
assert "https://wotbtools.com/version.json" not in publish_runs
assert "FE_COMMIT" not in publish_runs and "frontend-version.json" not in publish_runs

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

print("Android release two-phase protocol: PASS")
PY

echo "ALL ANDROID RELEASE TESTS PASSED"
