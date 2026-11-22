#!/usr/bin/env bash
set -euo pipefail
source "$ROOT/scripts/android-release/test-release-common.sh"

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
python3 - "$ROOT" <<'PY'
from pathlib import Path
import sys

sys.path.insert(0, sys.argv[1] + "/scripts/android-release")
import workflow_model
model = workflow_model.load(Path(sys.argv[1]))
steps = model["jobs"]["stage"]["steps"]
def step_index(label):
    return next(index for index, step in enumerate(steps) if label in step.get("name", ""))
preflight = step_index("Preflight classify production state")
agent_wasm = step_index("Fetch pinned Agent WASM for frontend validation")
frontend = step_index("Frontend tests + build validation")
upload = step_index("Seed APK to TX from Tsinghua replica")
ensure_tag = step_index("Ensure release tag (idempotent)")
assert preflight < agent_wasm < frontend < upload < ensure_tag
preflight_block = "\n".join(step.get("run", "") for step in steps[preflight:agent_wasm])
assert 'classify_tag "$REFS" "$TAG" "$COMMIT_SHA"' in preflight_block
assert 'if [ "$TAG_STATE" = "tag_conflict" ]; then' in preflight_block
agent_wasm_block = "\n".join(step.get("run", "") for step in steps[agent_wasm:frontend])
assert "bash scripts/fetch-agent-wasm.sh" in agent_wasm_block, \
    "Android release frontend validation must fetch the pinned Agent WASM first"
PY
