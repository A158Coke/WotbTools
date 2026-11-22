#!/usr/bin/env bash
set -euo pipefail
source "$ROOT/scripts/android-release/test-release-common.sh"

# 执行真实 delta/staging step；只替换 SSH/HTTP 传输，身份校验、分支与产物处理不 mock。
if command -v jq >/dev/null && command -v flock >/dev/null; then
python3 - "$ROOT" "$TMP" <<'PYFLOW'
import hashlib, importlib.util, json, os, re, shutil, subprocess, sys
from pathlib import Path
import yaml
root, tmp = map(Path, sys.argv[1:])
bash = "bash"
if os.name == "nt" and os.environ.get("EXEPATH"):
    # Git for Windows ships bash under EXEPATH; a bare "bash" would resolve to WSL.
    bash = str(Path(os.environ["EXEPATH"]) / "bash.exe")
sys.path.insert(0, str(root / "scripts/android-release"))
import workflow_model
work = tmp / "immutable-workflow"
for directory in ("scripts/android-release", "contracts", "deploy/agent", "release-staging", "bin", "tx1", "tx2", "runner", "android/app/build/outputs/apk/release"):
    (work / directory).mkdir(parents=True, exist_ok=True)
for name in ("android_contract.py", "delta_artifact.py", "staging-evidence.sh"):
    shutil.copyfile(root / "scripts/android-release" / name, work / "scripts/android-release" / name)
shutil.copyfile(tmp / "contract.json", work / "contracts/android-native-bridge.json")
shutil.copyfile(tmp / "pin.json", work / "deploy/agent/source.json")
target = work / "android/app/build/outputs/apk/release/app-release.apk"
shutil.copyfile(tmp / "bundle.apk", target)
sha = hashlib.sha256(target.read_bytes()).hexdigest()
runner = work / "runner"
(runner / "apk-badging.txt").write_text("package: name='com.wotbtools.app' versionCode='4000001' versionName='4.0.1'")
spec = importlib.util.spec_from_file_location("gates", root / "scripts/android-release/android_contract.py")
gates = importlib.util.module_from_spec(spec); spec.loader.exec_module(gates)
evidence = gates.apk_bundle_identity(str(target), json.loads((tmp / "contract.json").read_text()), json.loads((tmp / "pin.json").read_text()), "a" * 40, "4.0.1")
patch_bytes = bytes.fromhex("d6c3c40000") + b"immutable patch"
patch_sha = hashlib.sha256(patch_bytes).hexdigest()
patch_name = f"wotbtools-android-delta-4000000-4000001-{patch_sha}.vcdiff"
evidence.update(stagedAt="2026-10-01T00:00:00Z", apkSizeBytes=target.stat().st_size, patches=[{
    "fromVersionCode": 4000000, "fromSha256": "b" * 64, "algorithm": "xdelta3-vcdiff",
    "url": "https://wotbtools.com/download/android/" + patch_name, "sha256": patch_sha, "size": len(patch_bytes)}])
# 非标准空白及额外字段也属于不可变字节，禁止重序列化。
evidence["fixtureNote"] = "preserve exact bytes"
original = (json.dumps(evidence, indent=3) + "\n\n").encode()
name = "wotbtools-android-v4.0.1.staging.json"
(work / "patch").write_bytes(patch_bytes)
for node in ("tx1", "tx2"):
    (work / (node + ".lock")).touch()
(work / "bin/ssh").write_text('''#!/usr/bin/env python3
import os, shlex, subprocess, sys
from pathlib import Path
node = next((n for n in ("tx1", "tx2") if "user@" + n in sys.argv), None)
if node is None or os.environ.get("UNREACHABLE_NODE") == node: sys.exit(255)
args = shlex.split(sys.argv[-1])
base = Path(os.environ["FIXTURE_ROOT"])
args[4:6] = [(base / node).as_posix(), (base / (node + ".lock")).as_posix()]
# Git for Windows ships bash under EXEPATH; a bare "bash" would resolve to WSL.
if os.name == "nt" and os.environ.get("EXEPATH"): args[0] = str(Path(os.environ["EXEPATH"]) / "bash.exe")
sys.exit(subprocess.run(args, stdin=sys.stdin.buffer).returncode)
''')
(work / "bin/curl").write_text('''#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE_ROOT/curl.log"
out=''; headers=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -I) headers=true; shift ;;
    --retry|--connect-timeout|--max-time|-w) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [ "$headers" = true ]; then
  printf 'location: https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/\\r\\n' > "$out"
  printf 302
elif [[ "$url" == *.vcdiff ]]; then
  [ "${MOCK_PATCH:-same}" != missing ] || exit 22
  if [ "${MOCK_PATCH:-same}" = corrupt ]; then printf corrupt > "$out"; else cp "$FIXTURE_ROOT/patch" "$out"; fi
else
  # 即使有一个 origin 的 E[P] 存在，public E/base 仍返回 404。
  printf '{}' > "$out"; printf 404; exit 22
fi
''')
for command in ("ssh", "curl"):
    (work / "bin" / command).chmod(0o755)
shim_dir = (work / "bin").as_posix()
if os.name == "nt" and re.match(r"^[A-Za-z]:", shim_dir):
    shim_dir = "/" + shim_dir[0].lower() + shim_dir[2:]
(work / "shim-env.sh").write_text(f'PATH="{shim_dir}:$PATH"\n')
workflow = workflow_model.load(root)
steps = workflow["jobs"]["stage"]["steps"]
values = {"steps.version.outputs.versionCode": "4000001", "steps.version.outputs.versionName": "4.0.1",
          "steps.version.outputs.commit": "a" * 40, "steps.artifact.outputs.sha256": sha,
          "steps.artifact.outputs.apkName": "wotbtools-android-v4.0.1.apk"}
def step_env(step, extra=None):
    mapping = values | (extra or {})
    rendered = {}
    for key, expression in (step.get("env") or {}).items():
        match = re.fullmatch(r"\$\{\{\s*(.*?)\s*\}\}", str(expression))
        if match and match.group(1) in mapping:
            rendered[key] = mapping[match.group(1)]
    return rendered
delta_step = next(s for s in steps if s.get("id") == "delta")
staging_step = next(s for s in steps if s.get("id") == "staging")
delta, delta_env = delta_step["run"], step_env(delta_step)
staging = staging_step["run"]
env = dict(os.environ, FIXTURE_ROOT=work.as_posix(), RUNNER_TEMP=str(runner), GITHUB_OUTPUT=str(work / "output"), BASH_ENV=(work / "shim-env.sh").as_posix())
for node in ("TX1", "TX2"):
    for key, value in {"HOST": node.lower(), "USER": "user", "PORT": "22", "KEY": "fixture"}.items():
        env[node + "_SSH_" + key] = value
def run(text, success=True, env_extra=None, **overrides):
    result = subprocess.run([bash, "-c", text], cwd=work, env=env | (env_extra or {}) | overrides, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert (result.returncode == 0) == success, (result.stdout or "") + (result.stderr or "")
    return result
# A1: partial E[P], public E=404 and base fetch unavailable. Reuse E[P], no patch regeneration.
(work / "tx1" / name).write_bytes(original)
run(delta, env_extra=delta_env)
assert (runner / "delta-existing-staging.json").read_bytes() == original
assert not ".staging.json" in (work / "curl.log").read_text()
run(staging, env_extra=step_env(staging_step, {"steps.delta.outputs.existingEvidence": "200"}))
assert (work / "release-staging" / name).read_bytes() == original
# Existing patch failure/tampering cannot silently turn E[P] into full-only.
run(delta, False, env_extra=delta_env, MOCK_PATCH="missing")
run(delta, False, env_extra=delta_env, MOCK_PATCH="corrupt")
assert (work / "tx1" / name).read_bytes() == original
# A2: even semantically equal JSON with different bytes is a conflict.
(work / "tx2" / name).write_text(json.dumps(evidence))
run(delta, False, env_extra=delta_env)
# A4: same bytes on both nodes is idempotent, with identity validation still enforced.
(work / "tx2" / name).write_bytes(original)
run(delta, env_extra=delta_env)
invalid = dict(evidence, sourceSha="c" * 40)
for node in ("tx1", "tx2"): (work / node / name).write_text(json.dumps(invalid))
run(delta, False, env_extra=delta_env)
for node in ("tx1", "tx2"): (work / node / name).write_bytes(original)
# A5: unreachable never becomes missing (including when the other node is missing).
run(delta, False, env_extra=delta_env, UNREACHABLE_NODE="tx2")
for node in ("tx1", "tx2"): (work / node / name).unlink()
run(delta, False, env_extra=delta_env, UNREACHABLE_NODE="tx2")
# A3: both origins explicitly missing; optional base HTTP failure yields a NEW full-only E.
(runner / "prod-version.json").write_text(json.dumps({"latestVersionCode":4000000, "sha256":"b"*64,
    "apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v4.0.0.apk"}))
run(delta, env_extra=delta_env)
meta = json.loads((runner / "delta-metadata.json").read_text())
assert meta == {"apkSizeBytes":target.stat().st_size, "patches":[]}
(runner / "bundle-evidence.json").write_text(json.dumps(evidence | {"patches":[]}))
run(staging, env_extra=step_env(staging_step, {"steps.delta.outputs.existingEvidence":"404"}))
assert json.loads((work / "release-staging" / name).read_text())["patches"] == []
# A version already advertised without either immutable record must not mint new evidence.
(runner / "prod-version.json").write_text(json.dumps({"latestVersionCode":4000001}))
run(delta, False, env_extra=delta_env)
print("Android immutable workflow A1-A5 (real shell and identity verifiers): PASS")
PYFLOW
else
  echo 'jq/flock unavailable; immutable origin workflow behavior requires Linux PR CI'
fi
