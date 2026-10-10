#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export PYTHONPATH="$SCRIPT_DIR"

python3 - "$REPO_ROOT" <<'PY'
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from android_contract import (
    auth_surface,
    contract_result,
    parse_version,
    runtime_path,
    validate_frontend_sources,
    validate_native_sources,
    version_code,
)

root = Path(sys.argv[1])
assert version_code(parse_version("1.4.2")) == 1_004_002
assert version_code(parse_version("2100.0.0")) == 2_100_000_000
for invalid in ("1", "1.0", "1.04.2", "1.0.2-rc1"):
    try:
        parse_version(invalid)
    except SystemExit:
        pass
    else:
        raise AssertionError(invalid)
try:
    parse_version("2101.0.0")
except SystemExit:
    pass
else:
    raise AssertionError("versionCode upper bound")

assert runtime_path("android/app/src/main/java/com/wotbtools/app/MainActivity.kt")
assert runtime_path("android/app/build.gradle.kts")
assert not runtime_path("android/gradle.properties")
assert not runtime_path("android/app/src/test/java/com/wotbtools/app/MainActivityTest.kt")
assert not runtime_path("docs/android/release-process.md")
validate_native_sources(base := json.loads((root / "contracts/android-native-bridge.json").read_text()), [
    str(root / "android/app/src/main/java/com/wotbtools/app/NativeBridge.kt"),
    str(root / "android/app/src/main/java/com/wotbtools/app/MainActivity.kt"),
    str(root / "android/app/src/main/java/com/wotbtools/app/ReplayIntentHandler.kt"),
    str(root / "android/app/src/main/java/com/wotbtools/app/ConnectivityMonitor.kt"),
])
validate_frontend_sources(base, [
    str(root / "frontend/src/platform/nativeBridgeContract.js"),
    str(root / "frontend/src/platform/androidAuthProvider.js"),
    str(root / "frontend/src/platform/connectivity.js"),
])
auth_methods, auth_capabilities, auth_globals = auth_surface(base)
assert sorted(auth_methods) == ["authGetAccessToken", "authGetState", "authLogin", "authLogout"], auth_methods
assert auth_capabilities == ["native-auth"], auth_capabilities
# 事件集合逐字固定（auth_surface 返回契约里的**全部**事件全局）：新增事件必须在这里显式登记，
# 不允许悄悄多出一个页面全局。
assert auth_globals == ["wotbtoolsOnAuthChanged", "wotbtoolsOnConnectivityChanged"], auth_globals
# connectivity 是 PR B 新增的 wire surface：方法与能力同样逐字固定（additive 不等于随手加）。
connectivity_methods = [name for name in base["methods"] if name.startswith("connectivity")]
assert connectivity_methods == ["connectivityGetState"], connectivity_methods
assert [name for name in base["capabilities"] if name == "connectivity"] == ["connectivity"]
assert base["methods"]["connectivityGetState"]["response"]["enum"] == ["online", "offline"]

# Trusted local origin addition retains Bridge v2 RPC semantics and both production origins.
local_contract = json.loads(json.dumps(base))
remote_contract = json.loads(json.dumps(local_contract))
remote_contract["origin"] = "https://wotbtools.com"
remote_contract["allowedOrigins"] = ["https://wotbtools.com", "https://www.wotbtools.com"]
remote_contract["syntheticResources"]["pendingReplay"]["url"] = "https://wotbtools.com/__native/replay-pending"
assert not contract_result(remote_contract, local_contract)["breaking"]
for field, value in [("url", "https://appassets.androidplatform.net/__native/other"), ("method", "POST"), ("failure", "network-fallback"), ("requiredHeaders", [])]:
    broken = json.loads(json.dumps(local_contract))
    broken["syntheticResources"]["pendingReplay"][field] = value
    assert contract_result(remote_contract, broken)["breaking"], field
removed_origin = json.loads(json.dumps(local_contract))
removed_origin["allowedOrigins"].remove("https://wotbtools.com")
assert contract_result(remote_contract, removed_origin)["breaking"]
untrusted_origin = json.loads(json.dumps(local_contract))
untrusted_origin["origin"] = "https://other.example"
assert contract_result(remote_contract, untrusted_origin)["breaking"]

# Resource validation must resolve the canonical Kotlin constant reference.
with tempfile.TemporaryDirectory() as temp:
    native = Path(temp) / "Native.kt"
    declarations = '\n'.join(f'"{item}"' for item in [*base["methods"], *base["allowedOrigins"], *base["capabilities"], *auth_globals])
    native.write_text(declarations + '\nconst val LOCAL_APP_ORIGIN = "https://appassets.androidplatform.net"\nconst val STREAM_URL = MainActivity.LOCAL_APP_ORIGIN + "/__native/replay-pending"\n"X-Wotb-Pending-Id"\nconst val FOLDER_STREAM_URL = MainActivity.LOCAL_APP_ORIGIN + "/__native/replay-folder"\n"X-Wotb-Folder-Selection-Id"\n"X-Wotb-Folder-File-Id"', encoding="utf-8")
    validate_native_sources(base, [str(native)])
    native.write_text(native.read_text(encoding="utf-8").replace('/__native/replay-pending', '/__native/wrong'), encoding="utf-8")
    try:
        validate_native_sources(base, [str(native)])
    except SystemExit:
        pass
    else:
        raise AssertionError("wrong canonical replay resource path was accepted")

# Optional directory capability/method/resource additions preserve the existing v2 wire surface.
without_folder = json.loads(json.dumps(base))
without_folder["capabilities"].remove("replay-folder-picker")
for method in ("pickReplayFolder", "cancelReplayFolderPicker", "releaseReplayFolderSelection"):
    del without_folder["methods"][method]
del without_folder["syntheticResources"]["folderReplay"]
assert not contract_result(without_folder, base)["breaking"]

base["bridgeVersion"] = 1

additive = json.loads(json.dumps(base))
additive["methods"]["getPendingReplay"]["response"]["fields"]["optionalLabel"] = {"type": "string", "required": False}
assert contract_result(base, additive)["breaking"] is False

breaking = json.loads(json.dumps(base))
del breaking["methods"]["getPendingReplay"]["response"]["fields"]["uri"]
assert contract_result(base, breaking)["breaking"] is True
optional_base = json.loads(json.dumps(base))
optional_base["methods"]["getPendingReplay"]["response"]["fields"]["extra"] = {"type": "string", "required": False}
required_breaking = json.loads(json.dumps(optional_base))
required_breaking["methods"]["getPendingReplay"]["response"]["fields"]["extra"]["required"] = True
assert contract_result(optional_base, required_breaking)["breaking"] is True
header_breaking = json.loads(json.dumps(base))
header_breaking["syntheticResources"]["pendingReplay"]["requiredHeaders"] = []
assert contract_result(base, header_breaking)["breaking"] is True

with tempfile.TemporaryDirectory() as temp:
    temp_path = Path(temp)
    base_path = temp_path / "base.json"
    head_path = temp_path / "head.json"
    paths_path = temp_path / "paths.txt"
    base_path.write_text(json.dumps(base))
    head_path.write_text(json.dumps(additive))

    def run_gate(head, version, paths, frontend_versions="1"):
        head_path.write_text(json.dumps(head))
        paths_path.write_text("\n".join(paths) + "\n")
        return subprocess.run([
            sys.executable, str(root / "scripts/android-release/android_contract.py"), "gate",
            "--base-contract", str(base_path), "--head-contract", str(head_path),
            "--base-version", "1.4.2", "--head-version", version, "--paths", str(paths_path),
            "--frontend-versions", frontend_versions,
        ]).returncode

    assert run_gate(additive, "1.4.2", ["docs/android/release-process.md"]) == 0
    assert run_gate(additive, "1.4.2", ["android/app/src/main/MainActivity.kt"]) != 0
    assert run_gate(additive, "1.4.3", ["android/app/src/main/MainActivity.kt"]) == 0
    assert run_gate(additive, "1.4.2", ["docs/android/release-process.md"], frontend_versions="2") != 0
    assert run_gate(breaking, "1.4.2", ["docs/android/release-process.md"]) != 0
    breaking_bumped = json.loads(json.dumps(breaking))
    breaking_bumped["bridgeVersion"] = 2
    assert run_gate(breaking_bumped, "1.4.2", ["docs/android/release-process.md"], frontend_versions="1,2") == 0

print("Android contract tests passed")
PY
