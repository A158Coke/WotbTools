#!/usr/bin/env bash
set -euo pipefail
source "$ROOT/scripts/android-release/test-release-common.sh"

# Delta 身份与实际重建必须同时成立；不依赖正式网络、密钥或持久化环境。
python3 - "$ROOT" <<'PY'
import argparse, hashlib, importlib.util, json, pathlib, tempfile
from unittest.mock import patch
import sys
path = pathlib.Path(sys.argv[1]) / "scripts/android-release/delta_artifact.py"
spec = importlib.util.spec_from_file_location("delta_artifact", path)
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
# Runtime 和 stage/publish verifier 使用相同的有界整数比较，禁止静默漂移。
import re
client = (pathlib.Path(sys.argv[1]) / "android/app/src/main/java/com/wotbtools/app/ApkUpdater.kt").read_text(encoding="utf-8")
match = re.search(r"const val MAX_DELTA_RATIO_DENOMINATOR = ([0-9]+)", client)
assert match and int(match.group(1)) == delta.MAX_DELTA_RATIO_DENOMINATOR
assert "patch.size > targetSize / MAX_DELTA_RATIO_DENOMINATOR" in client
sha = lambda b: hashlib.sha256(b).hexdigest()
with tempfile.TemporaryDirectory() as work:
    root = pathlib.Path(work)
    base, target, meta = root / "base.apk", root / "target.apk", root / "metadata.json"
    base.write_bytes(b"official base")
    target.write_bytes(b"signed target" * 1000)
    base_manifest = root / "base.json"
    base_manifest.write_text(json.dumps({"latestVersionCode": 4000000, "sha256": sha(base.read_bytes())}))
    args = argparse.Namespace(target=str(target), target_sha=sha(target.read_bytes()), target_code=4001000,
        xdelta="fake-xdelta", output_dir=str(root), output=str(meta), base_manifest=str(base_manifest), base_file=str(base))
    def valid_command(command, check):
        assert check
        output = pathlib.Path(command[-1])
        if "-e" in command:
            assert "-A" in command and "-a" in command and command[command.index("-S") + 1] == "none"
            output.write_bytes(bytes.fromhex("d6c3c40000") + b"valid patch")
        else:
            output.write_bytes(target.read_bytes())
    with patch.object(delta.subprocess, "run", valid_command):
        delta.build(args)
    doc = json.loads(meta.read_text())
    assert doc["apkSizeBytes"] == len(target.read_bytes())
    assert len(doc["patches"]) == 1
    patch_item = doc["patches"][0]
    assert delta.validate(doc, args.target_code, args.target_sha, target.stat().st_size) == doc["patches"]
    boundary = json.loads(json.dumps(doc))
    boundary["patches"][0]["size"] = target.stat().st_size // delta.MAX_DELTA_RATIO_DENOMINATOR
    assert delta.validate(boundary, args.target_code, args.target_sha, target.stat().st_size) == boundary["patches"]
    assert delta.validate({}, args.target_code, args.target_sha, target.stat().st_size) == []
    p = root / patch_item["url"].rsplit("/", 1)[-1]
    verify = argparse.Namespace(target=str(target), target_sha=args.target_sha, target_code=args.target_code,
        evidence=str(meta), patch_dir=str(root))
    delta.check(verify)
    # 即使 identity 自洽，也不能发布 Android decoder 不支持的应用头。
    wrong = bytes.fromhex("d6c3c40004") + b"valid patch"
    wrong_sha = sha(wrong)
    wrong_doc = json.loads(json.dumps(doc))
    wrong_doc["patches"][0]["sha256"] = wrong_sha
    wrong_doc["patches"][0]["url"] = patch_item["url"].replace(patch_item["sha256"], wrong_sha)
    (root / wrong_doc["patches"][0]["url"].rsplit("/", 1)[-1]).write_bytes(wrong)
    meta.write_text(json.dumps(wrong_doc))
    try:
        delta.check(verify)
        raise AssertionError("unsupported VCDIFF header accepted")
    except ValueError:
        pass
    meta.write_text(json.dumps(doc))
    p.write_bytes(b"bad bytes")
    try:
        delta.check(verify)
        raise AssertionError("tampered patch accepted")
    except ValueError:
        pass
    for update in ({"size": target.stat().st_size // delta.MAX_DELTA_RATIO_DENOMINATOR + 1}, {"url": "https://other.invalid/patch"},
                   {"fromVersionCode": 3999999}, {"algorithm": "unsupported"}, {"sha256": "0" * 64}):
        invalid = json.loads(json.dumps(doc)); invalid["patches"][0].update(update)
        try:
            delta.validate(invalid, args.target_code, args.target_sha, target.stat().st_size)
            raise AssertionError(f"invalid patch accepted: {update}")
        except ValueError:
            pass
    base_manifest.write_text(json.dumps({"latestVersionCode": 3999000, "sha256": sha(base.read_bytes())}))
    with patch.object(delta.subprocess, "run", side_effect=AssertionError("old client should not generate delta")):
        delta.build(args)
    assert json.loads(meta.read_text())["patches"] == []
print("Android delta metadata and reconstruction: PASS")
PY

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
sys.path.insert(0, str(root / "scripts/android-release"))
import workflow_model
release_workflow = workflow_model.load(root)
delta_step = next(step for step in release_workflow["jobs"]["stage"]["steps"] if step.get("id") == "delta")
assert 'delta-base-staging.json' in delta_step["run"] and '.versionCode == $code and .sha256 == $sha' in delta_step["run"]
delta_upload = next(step for step in release_workflow["jobs"]["stage"]["steps"] if step.get("name") == "Upload Android delta to Tsinghua Cloud")
assert 'replace=0' in delta_upload["run"]
assert "delta-probe.vcdiff" not in delta_step["run"]
delta_ids = ("delta_aliyun", "delta_cloud", "delta_tx_prepare", "delta_tx_upload", "delta_tx_install",
             "delta_tx2_prepare", "delta_tx2_upload", "delta_tx2_install", "delta_public")
steps = release_workflow["jobs"]["stage"]["steps"]
assert all(next(step for step in steps if step.get("id") == item).get("continue-on-error") is True for item in delta_ids)
policy = next(step for step in steps if step.get("name") == "Resolve optional Android delta availability")
assert all("steps." + item + ".outcome" in policy["env"]["DELTA_RESULTS"] for item in delta_ids)
resolution = policy["run"]
assert 'EXISTING_EVIDENCE' in resolution and "'.patches = []'" in resolution and 'exit 1' in resolution
staged_source = next(step for step in release_workflow["jobs"]["publish"]["steps"] if step.get("id") == "stagedref")
assert "android/app/src/main/java/com/wotbtools/app/AgentAssetProxy.kt" in staged_source["run"]
staged = next(step for step in release_workflow["jobs"]["publish"]["steps"] if step.get("id") == "staged")
assert 'assetOrigin=$ASSET_ORIGIN' in staged["run"]
readiness = next(step for step in release_workflow["jobs"]["publish"]["steps"] if step.get("name", "").startswith("Verify production API CORS"))
assert readiness.get("env", {}).get("STEP_STAGED_ASSETORIGIN") == "${{ steps.staged.outputs.assetOrigin }}"
assert '"$ASSET_ORIGIN/index.json"' in readiness["run"]
assert "REMOTE_ASSET_BASE=\"https://assets.wotbtools.com\"" not in readiness["run"]
for name in ("frontend.yml", "frontend-replica.yml"):
    web_workflow = yaml.safe_load((root / ".github/workflows" / name).read_text(encoding="utf-8"))
    assert web_workflow["env"]["ASSET_BASE_URL"] == "https://assets.wotbtools.com", name
PY

# 对 workflow 的真实 shell 逻辑执行成功、首次可选失败和不可变重试失败三条路径。
if command -v jq >/dev/null; then
  POLICY_DIR="$TMP/delta-policy"
  mkdir -p "$POLICY_DIR"
  python3 - "$ROOT" > "$POLICY_DIR/run.sh" <<'PYCODE'
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1] + "/scripts/android-release")
import workflow_model
model = workflow_model.load(Path(sys.argv[1]))
print(next(step["run"] for step in model["jobs"]["stage"]["steps"]
           if step.get("name") == "Resolve optional Android delta availability"))
PYCODE
  printf '%s\n' '{"apkSizeBytes":100,"patches":[{"sha256":"fixed"}]}' > "$POLICY_DIR/delta-metadata.json"
  RUNNER_TEMP="$POLICY_DIR" DELTA_RESULTS='success,success,success,success,success,success,success,success,success' EXISTING_EVIDENCE=404 bash "$POLICY_DIR/run.sh"
  jq -e '.patches | length == 1' "$POLICY_DIR/delta-metadata.json" >/dev/null || fail 'successful delta was dropped'
  RUNNER_TEMP="$POLICY_DIR" DELTA_RESULTS='failure,success,success,success,success,success,success,success,success' EXISTING_EVIDENCE=404 bash "$POLICY_DIR/run.sh"
  jq -e '.patches | length == 0' "$POLICY_DIR/delta-metadata.json" >/dev/null || fail 'new delta failure did not use full-only'
  printf '%s\n' '{"apkSizeBytes":100,"patches":[{"sha256":"fixed"}]}' > "$POLICY_DIR/delta-metadata.json"
  if RUNNER_TEMP="$POLICY_DIR" DELTA_RESULTS='failure,success,success,success,success,success,success,success,success' EXISTING_EVIDENCE=200 bash "$POLICY_DIR/run.sh"; then
    fail 'existing immutable delta failure must stop staging'
  fi
  jq -e '.patches | length == 1' "$POLICY_DIR/delta-metadata.json" >/dev/null || fail 'existing evidence was changed'
  echo 'Android optional delta stage policy: PASS'

  # 执行实际上传 step 的 shell；模拟云端同字节、缺失和冲突，不接触网络或密钥。
  mkdir -p "$POLICY_DIR/bin" "$POLICY_DIR/release-staging"
  printf 'immutable patch\n' > "$POLICY_DIR/release-staging/fixture.vcdiff"
  expected_sha="$(sha256sum "$POLICY_DIR/release-staging/fixture.vcdiff" | awk '{print $1}')"
  printf '{"patches":[{"sha256":"%s"}]}\n' "$expected_sha" > "$POLICY_DIR/delta-metadata.json"
  python3 - "$ROOT" > "$POLICY_DIR/upload.sh" <<'PYCODE'
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1] + "/scripts/android-release")
import workflow_model
model = workflow_model.load(Path(sys.argv[1]))
print(next(step["run"] for step in model["jobs"]["stage"]["steps"]
           if step.get("name") == "Upload Android delta to Tsinghua Cloud"))
PYCODE
  cat > "$POLICY_DIR/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -eu
out=''; write=''; url=''; upload=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) write="$2"; shift 2 ;;
    -F) upload=true; shift 2 ;;
    -H|--connect-timeout|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [ "$upload" = true ]; then
  : > "$RUNNER_TEMP/upload-called"
  [ -z "$out" ] || : > "$out"
elif [[ "$url" == *upload-link* ]]; then
  printf '%s' '"https://fixture.invalid/upload"'
elif [ -n "$write" ]; then
  case "$MOCK_EXISTING" in
    same) cp "$RUNNER_TEMP/release-staging/fixture.vcdiff" "$out"; printf '200 application/octet-stream' ;;
    absent) printf '<html>missing</html>' > "$out"; printf '200 text/html; charset=utf-8' ;;
    conflict) printf 'conflict' > "$out"; printf '200 application/octet-stream' ;;
  esac
else
  cp "$RUNNER_TEMP/release-staging/fixture.vcdiff" "$out"
fi
CURL
  printf '#!/usr/bin/env bash\nexit 0\n' > "$POLICY_DIR/bin/sleep"
  chmod +x "$POLICY_DIR/bin/curl" "$POLICY_DIR/bin/sleep"
  (cd "$POLICY_DIR"; PATH="$POLICY_DIR/bin:$PATH" RUNNER_TEMP="$POLICY_DIR" STEP_DELTA_PATCHNAME=fixture.vcdiff MOCK_EXISTING=same TSINGHUA_CLOUD_TOKEN=fixture bash upload.sh)
  [ ! -e "$POLICY_DIR/upload-called" ] || fail 'identical delta must not be uploaded again'
  (cd "$POLICY_DIR"; PATH="$POLICY_DIR/bin:$PATH" RUNNER_TEMP="$POLICY_DIR" STEP_DELTA_PATCHNAME=fixture.vcdiff MOCK_EXISTING=absent TSINGHUA_CLOUD_TOKEN=fixture bash upload.sh)
  [ -e "$POLICY_DIR/upload-called" ] || fail 'absent delta must be uploaded'
  rm "$POLICY_DIR/upload-called"
  if (cd "$POLICY_DIR"; PATH="$POLICY_DIR/bin:$PATH" RUNNER_TEMP="$POLICY_DIR" STEP_DELTA_PATCHNAME=fixture.vcdiff MOCK_EXISTING=conflict TSINGHUA_CLOUD_TOKEN=fixture bash upload.sh); then
    fail 'conflicting immutable cloud delta must fail'
  fi
  [ ! -e "$POLICY_DIR/upload-called" ] || fail 'conflicting delta must not be overwritten'
  echo 'Android immutable delta cloud retry: PASS'
fi
