#!/usr/bin/env bash
# Pure Android release helper tests: committed version authority, contract gate,
# and production state classification. No secrets or release side effects.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REAL_GIT="$(command -v git || true)"
REAL_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')"
RESOLVE="$ROOT/scripts/android-release/resolve-version.sh"
RESOLVE_STAGED="$ROOT/scripts/android-release/resolve-staged-version.sh"
GUARDS="$ROOT/scripts/android-release/check-release-guards.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

python3 - "$ROOT" "$ROOT/.github/workflows/android-release.yml" <<'PY'
from pathlib import Path
import sys
import yaml

root = Path(sys.argv[1])
workflow = yaml.safe_load(open(sys.argv[2], encoding="utf-8"))
trigger = workflow.get(True, workflow.get("on", {}))
push = trigger["push"]
assert "android/gradle.properties" in push["paths"], "Android release must be version-triggered"
assert "android-v*" in push["tags"], "Android tag recovery trigger is missing"
android_proxy = (root / "android/app/src/main/java/com/wotbtools/app/AgentAssetProxy.kt").read_text(encoding="utf-8")
assert 'REMOTE_ASSET_BASE = "https://assets.wotbtools.com"' in android_proxy
assert "COS_BASE" not in android_proxy
release_workflow = yaml.safe_load((root / ".github/workflows/android-release.yml").read_text(encoding="utf-8"))
staged_source = next(step for step in release_workflow["jobs"]["publish"]["steps"] if step.get("id") == "stagedref")
assert "android/app/src/main/java/com/wotbtools/app/AgentAssetProxy.kt" in staged_source["run"]
staged = next(step for step in release_workflow["jobs"]["publish"]["steps"] if step.get("id") == "staged")
assert 'assetOrigin=$ASSET_ORIGIN' in staged["run"]
readiness = next(step for step in release_workflow["jobs"]["publish"]["steps"] if step.get("name", "").startswith("Verify production API CORS"))
assert '"${{ steps.staged.outputs.assetOrigin }}"' in readiness["run"]
assert '"$ASSET_ORIGIN/index.json"' in readiness["run"]
assert "REMOTE_ASSET_BASE=\"https://assets.wotbtools.com\"" not in readiness["run"]
for name in ("frontend.yml", "frontend-replica.yml"):
    web_workflow = yaml.safe_load((root / ".github/workflows" / name).read_text(encoding="utf-8"))
    assert web_workflow["env"]["ASSET_BASE_URL"] == "https://assets.wotbtools.com", name
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

# --- publish(version=X)：候选身份只能来自显式版本 + 它的 immutable tag target ---
# 历史场景（review P2）：stage 2.0.1 → main 后来升到 2.0.2 → publish(version=2.0.1)。
# 候选必须仍然是 2.0.1：不能因为当前 main 是 2.0.2 就去寻找 2.0.2。
STAGED_VERSION="2.0.1"
NEXT_VERSION="2.0.2"
STAGED_SOURCE="$(printf 'a%.0s' $(seq 40))"
STAGED_APK="wotbtools-android-v$STAGED_VERSION.apk"
STAGED_VERSION_CODE=2000001

if ! command -v git >/dev/null 2>&1 || ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "git is unavailable; the staged-candidate cases are CI-only"
else
  # 构造一个 staged 源码：目录布局与仓库一致（android/gradle.properties 等），
  # 因此 `git show <ref>:<path>` 与 workflow 里 `git archive <ref>` 导出的是同一种东西。
  make_staged_source() {
    local version="$1" contract="$2"
    local dir="$TMP/staged-src-$version-$RANDOM"
    mkdir -p "$dir/android" "$dir/contracts" "$dir/deploy/agent"
    cp "$contract" "$dir/contracts/android-native-bridge.json"
    cp "$ROOT/deploy/agent/source.json" "$dir/deploy/agent/source.json"
    printf 'wotbVersion=%s\nwotbNativeBridgeVersion=%s\n' "$version" \
      "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1], encoding="utf-8"))["bridgeVersion"])' "$contract")" \
      > "$dir/android/gradle.properties"
    git -C "$dir" init -q
    git -C "$dir" config user.email test@example.invalid
    git -C "$dir" config user.name test
    git -C "$dir" add -A
    git -C "$dir" commit -qm "stage $version"
    git -C "$dir" tag "android-v$version"
    printf '%s' "$dir"
  }

  # 把 tag target 的源码交给 helper（与 workflow 同一条取值路径：只读 ref 的内容）。
  resolve_staged() {
    local repo="$1" ref="$2" requested="${3:-}"
    local dir="$TMP/resolved-$RANDOM"
    mkdir -p "$dir/android"
    git -C "$repo" show "$ref:android/gradle.properties" > "$dir/android/gradle.properties"
    WOTB_ROOT="$ROOT" WOTB_TRIGGER=workflow_dispatch WOTB_TAG_NAME="" \
      WOTB_COMMIT="$ref" WOTB_STAGED_REF="$ref" \
      WOTB_STAGED_PROPERTIES="$dir/android/gradle.properties" \
      WOTB_REQUESTED_VERSION="$requested" \
      bash "$RESOLVE_STAGED" 2>&1
  }

  # CASE 1（历史候选）：staged 2.0.1 + publish(version=2.0.1) ⇒ 仍然选中 2.0.1。
  STAGED_REPO="$(make_staged_source "$STAGED_VERSION" "$ROOT/contracts/android-native-bridge.json")"
  STAGED_REF="$(git -C "$STAGED_REPO" rev-parse HEAD)"

  OUT="$(resolve_staged "$STAGED_REPO" "$STAGED_REF" "$STAGED_VERSION")"
  echo "$OUT" | grep -qx "versionName=$STAGED_VERSION" || fail "historical staged candidate must select $STAGED_VERSION: $OUT"
  echo "$OUT" | grep -qx "versionCode=$STAGED_VERSION_CODE" || fail "staged versionCode must come from the tag target: $OUT"
  echo "$OUT" | grep -qx "tagName=android-v$STAGED_VERSION" || fail "staged tag must be derived from the requested version: $OUT"
  echo "$OUT" | grep -qx "apkName=$STAGED_APK" || fail "staged APK name must be derived from the requested version: $OUT"

  # CASE 2：publish 没给版本 ⇒ fail closed（绝不从当前 main 猜候选）。
  if resolve_staged "$STAGED_REPO" "$STAGED_REF" "" >/dev/null 2>&1; then
    fail "publish without an explicit version must fail"
  fi

  # CASE 3：请求 2.0.2 但 staged 源码是 2.0.1（= 没有 2.0.2 的 staging evidence）⇒ fail closed。
  if resolve_staged "$STAGED_REPO" "$STAGED_REF" "$NEXT_VERSION" >/dev/null 2>&1; then
    fail "requesting a version that was not staged must fail"
  fi

  # CASE 4：requested=2.0.1 但 tag target 的 gradle version=2.0.2 ⇒ fail closed。
  NEXT_REPO="$(make_staged_source "$NEXT_VERSION" "$ROOT/contracts/android-native-bridge.json")"
  NEXT_REF="$(git -C "$NEXT_REPO" rev-parse HEAD)"
  if resolve_staged "$NEXT_REPO" "$NEXT_REF" "$STAGED_VERSION" >/dev/null 2>&1; then
    fail "tag target version differing from the requested version must fail"
  fi

  # CASE 6：staged 源码自身不自洽（contract bridge 与 gradle 声明不一致）⇒ fail closed。
  OTHER_CONTRACT="$TMP/other-contract.json"
  python3 -c 'import json,sys; doc=json.load(open(sys.argv[1], encoding="utf-8")); doc["bridgeVersion"]=int(doc["bridgeVersion"])+1; json.dump(doc, open(sys.argv[2], "w", encoding="utf-8"))' \
    "$ROOT/contracts/android-native-bridge.json" "$OTHER_CONTRACT"
  DRIFT_REPO="$(make_staged_source "$STAGED_VERSION" "$OTHER_CONTRACT")"
  DRIFT_REF="$(git -C "$DRIFT_REPO" rev-parse HEAD)"
  if resolve_staged "$DRIFT_REPO" "$DRIFT_REF" "$STAGED_VERSION" >/dev/null 2>&1; then
    fail "staged source whose contract bridge disagrees with its gradle.properties must fail"
  fi
fi

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
pin = json.loads((root / "deploy/agent/source.json").read_text(encoding="utf-8"))
source = "a" * 40
version = "2.0.1"
contents = {"index.html": b"local index", f"wasm/{pin['ref']}/wotb_replay_wasm.js": b"js", f"wasm/{pin['ref']}/wotb_replay_wasm_bg.wasm": b"wasm"}
digest = lambda data: hashlib.sha256(data).hexdigest()
manifest = {
    "schemaVersion": 2, "target": "android", "buildCommit": source,
    "runtimeOrigin": contract["origin"], "apiOrigin": "https://wotbtools.com",
    "assetOrigin": "/agent-assets", "entry": "index.html",
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
for field in ("runtimeOrigin", "buildCommit", "agentWasm", "nativeRuntime", "fileCount", "totalBytes", "files", "entrySha256", "assetOrigin"):
    broken = copy.deepcopy(manifest)
    broken[field] = [] if field == "files" else None
    write_apk(broken)
    reject(lambda: gates.apk_bundle_identity(str(apk), contract, pin, source, version))
write_apk(manifest, {**contents, "index.html": b"tampered index"})
reject(lambda: gates.apk_bundle_identity(str(apk), contract, pin, source, version))
# assetOrigin 是已审查 origin 白名单：legacy 网关取值（≤2.1.6 已 staged 候选的合法身份）
# 必须放行——main 前进不得作废已 staged 的候选；白名单之外的 origin 一律拒绝。
legacy_origin = copy.deepcopy(manifest)
legacy_origin["assetOrigin"] = "https://wotbtools.com/agent-assets"
write_apk(legacy_origin)
gates.apk_bundle_identity(str(apk), contract, pin, source, version)
unreviewed_origin = copy.deepcopy(manifest)
unreviewed_origin["assetOrigin"] = "https://evil.example.com/assets"
write_apk(unreviewed_origin)
reject(lambda: gates.apk_bundle_identity(str(apk), contract, pin, source, version))
write_apk(manifest)
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
python3 - "$ROOT/.github/workflows/android-release.yml" <<'PY'
from pathlib import Path
import sys

workflow = Path(sys.argv[1]).read_text(encoding="utf-8")
preflight = workflow.index("Preflight classify production state")
agent_wasm = workflow.index("Fetch pinned Agent WASM for frontend validation")
frontend = workflow.index("Frontend tests + build validation")
upload = workflow.index("Seed APK to TX from Tsinghua replica")
ensure_tag = workflow.index("Ensure release tag (idempotent)")
assert preflight < agent_wasm < frontend < upload < ensure_tag
preflight_block = workflow[preflight:agent_wasm]
assert 'classify_tag "$REFS" "$TAG" "$COMMIT_SHA"' in preflight_block
assert 'if [ "$TAG_STATE" = "tag_conflict" ]; then' in preflight_block
agent_wasm_block = workflow[agent_wasm:frontend]
assert "bash scripts/fetch-agent-wasm.sh" in agent_wasm_block, \
    "Android release frontend validation must fetch the pinned Agent WASM first"
PY

# 发布上传链（2026-10-08 优化后锁死，防回退）：APK 不得再走 scp-action 跨洋直推
#（drone-scp 的 SFTP 单流实测 12.6–13.8 KB/s → 15MB × 2 台 ≈ 40 分钟，占 stage job 89%）；
# 两台 origin 必须"从清华副本拉取 + 就地 SHA-256 校验 + 原子落位"，且仍只在 origin
# absent 时触发（幂等：equal 跳过、清华 replace=1 覆盖自愈）。顺序：classify → 清华 → seed×2。
python3 - "$ROOT/.github/workflows/android-release.yml" <<'PY'
import sys
import yaml

workflow = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
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
assert order.index(classify) < order.index(tsinghua) < order.index(seeds[0]["name"]) \
    < order.index(seeds[1]["name"]) < order.index(verify), order
PY

# 两阶段发布协议：stage 只做 staging（绝不写 production version.json），publish 由自动续跑或手动 recovery 触发、
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
assert "steps.version.outputs" not in publish_runs, \
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
write_runs = publish["steps"][next(i for i, name in enumerate(publish_names)
                                   if name.startswith("Write version.json"))]["run"]
for source in ("steps.staged.outputs.versionCode", "steps.staged.outputs.versionName",
               "steps.staged.outputs.nativeBridgeVersion", "steps.staged.outputs.stagedSource",
               "steps.staged.outputs.apkSha", "steps.stagedref.outputs.apkName"):
    assert source in write_runs, f"version.json must be written from {source}"
assert "steps.version.outputs" not in write_runs, write_runs

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
# 资产源是本机路径 /agent-assets + Native AgentAssetProxy 直连 Alibaba（原生无 CORS），
# readiness 探测对象是新版本对象源匿名可读性，而不是 legacy 网关 exact-origin CORS。
assert '"$ASSET_ORIGIN/index.json"' in publish_runs
assert "$COS_BASE/index.json" not in publish_runs
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

  python3 - "$ROOT/.github/workflows/android-release.yml" "$SIM" <<'PY'
import re
import sys
from pathlib import Path

import yaml

workflow = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
sim = Path(sys.argv[2])
step = next(s for s in workflow["jobs"]["publish"]["steps"] if s.get("id") == "staged")
run = step["run"]
# 展开 GitHub expression（模拟 runner 渲染后的脚本）：先替换被测身份，再用中性字面量吃掉其余
# 表达式（它们的下游命令都被 stub 掉了，值不影响本用例）。
run = run.replace("${{ steps.stagedref.outputs.apkName }}", "wotbtools-android-vSTAGED.apk")
run = run.replace("${{ steps.stagedref.outputs.stagingName }}", "wotbtools-android-vSTAGED.staging.json")
run = run.replace("${{ inputs.version }}", "STAGED")
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
assert "auto_publish=true" in release_doc and "queue: max" in release_doc, \
    "the canonical runbook must document the automatic continuation and the scheduling contract"

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

echo "ALL ANDROID RELEASE TESTS PASSED"
