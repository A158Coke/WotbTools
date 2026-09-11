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

from android_contract import contract_result, parse_version, runtime_path, validate_native_sources, version_code

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
assert not runtime_path("android/app/src/test/java/com/wotbtools/app/MainActivityTest.kt")
assert not runtime_path("docs/android/release-process.md")
validate_native_sources(base := json.loads((root / "contracts/android-native-bridge.json").read_text()), [
    str(root / "android/app/src/main/java/com/wotbtools/app/NativeBridge.kt"),
    str(root / "android/app/src/main/java/com/wotbtools/app/MainActivity.kt"),
    str(root / "android/app/src/main/java/com/wotbtools/app/ReplayIntentHandler.kt"),
])

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

    def run_gate(head, version, paths, frontend_version=1):
        head_path.write_text(json.dumps(head))
        paths_path.write_text("\n".join(paths) + "\n")
        return subprocess.run([
            sys.executable, str(root / "scripts/android-release/android_contract.py"), "gate",
            "--base-contract", str(base_path), "--head-contract", str(head_path),
            "--base-version", "1.4.2", "--head-version", version, "--paths", str(paths_path),
            "--frontend-version", str(frontend_version),
        ]).returncode

    assert run_gate(additive, "1.4.2", ["docs/android/release-process.md"]) == 0
    assert run_gate(additive, "1.4.2", ["android/app/src/main/MainActivity.kt"]) != 0
    assert run_gate(additive, "1.4.3", ["android/app/src/main/MainActivity.kt"]) == 0
    assert run_gate(additive, "1.4.2", ["docs/android/release-process.md"], frontend_version=2) != 0
    assert run_gate(breaking, "1.4.2", ["docs/android/release-process.md"]) != 0
    breaking_bumped = json.loads(json.dumps(breaking))
    breaking_bumped["bridgeVersion"] = 2
    assert run_gate(breaking_bumped, "1.4.2", ["docs/android/release-process.md"], frontend_version=2) == 0

print("Android contract tests passed")
PY
