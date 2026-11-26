#!/usr/bin/env bash
set -euo pipefail
APK="android/app/build/outputs/apk/release/app-release.apk"
test -s "$APK" || { echo "::error::release APK missing or empty" >&2; exit 1; }

MANIFEST="android/app/src/main/assets/web/bundle-manifest.json"
test -s "$MANIFEST" || { echo "::error::bundle manifest missing; build:android did not run" >&2; exit 1; }
AGENT_REF="$(python3 -c 'import json;print(json.load(open("deploy/agent/source.json"))["ref"])')"
AGENT_RELEASE="$(python3 -c 'import json;print(json.load(open("deploy/agent/source.json"))["artifact"]["release"])')"
MANIFEST_REF="$(python3 -c 'import json;print(json.load(open("android/app/src/main/assets/web/bundle-manifest.json"))["agentWasm"]["commit"])')"
MANIFEST_RELEASE="$(python3 -c 'import json;print(json.load(open("android/app/src/main/assets/web/bundle-manifest.json"))["agentWasm"]["release"])')"
test "$AGENT_REF" = "$MANIFEST_REF" || {
  echo "::error::bundle manifest agent commit $MANIFEST_REF != pinned $AGENT_REF" >&2
  exit 1
}
test "$AGENT_RELEASE" = "$MANIFEST_RELEASE" || {
  echo "::error::bundle manifest agent release $MANIFEST_RELEASE != pinned $AGENT_RELEASE" >&2
  exit 1
}

listing_file="$RUNNER_TEMP/release-apk-listing.txt"
unzip -Z1 "$APK" > "$listing_file"
for required in \
  assets/web/index.html \
  assets/web/bundle-manifest.json \
  "assets/web/wasm/$AGENT_REF/wotb_replay_wasm.js" \
  "assets/web/wasm/$AGENT_REF/wotb_replay_wasm_bg.wasm"; do
  grep -Fxq "$required" "$listing_file" || {
    echo "::error::release APK 缺少离线前端 bundle 文件：$required" >&2
    grep '^assets/web/' "$listing_file" | head -n 10 || true
    exit 1
  }
done
if [ "$STEP_SPONSOR_STATE" = "injected" ]; then
  python3 - "$APK" "$listing_file" "$STEP_SPONSOR_BUNDLE" <<'PY'
import hashlib, json, sys, tarfile, zipfile

apk_path, listing_path, bundle_path = sys.argv[1], sys.argv[2], sys.argv[3]
listed = set(open(listing_path, encoding="utf-8", errors="replace").read().split())

with zipfile.ZipFile(apk_path) as apk:
    entries = set(apk.namelist())
    if "assets/web/sponsor-config.json" not in listed or "assets/web/sponsor-config.json" not in entries:
        raise SystemExit("::error::release APK 缺少 assets/web/sponsor-config.json（pin 存在却没进 bundle）")
    try:
        config = json.loads(apk.read("assets/web/sponsor-config.json").decode("utf-8"))
    except ValueError as error:
        raise SystemExit(f"::error::release APK 内 sponsor-config.json 不是合法 JSON：{error}")
    methods = config.get("methods") or []
    if config.get("enabled") is True and not methods:
        raise SystemExit("::error::release APK 内 sponsor-config.json 声明 enabled 却没有任何 methods")

    verified = 0
    with tarfile.open(bundle_path, "r:gz") as bundle:
        for method in methods:
            image = (method or {}).get("image") or ""
            if not image.startswith("/sponsor-assets/"):
                raise SystemExit(f"::error::release APK 配置里的图片路径不合法：{image!r}")
            entry = "assets/web" + image
            if entry not in entries:
                raise SystemExit(f"::error::release APK 缺少配置引用的图片：{entry}")
            member = bundle.extractfile(image.lstrip("/"))
            if member is None:
                raise SystemExit(f"::error::pinned 赞助资产包缺少 {image}")
            apk_sha = hashlib.sha256(apk.read(entry)).hexdigest()
            bundle_sha = hashlib.sha256(member.read()).hexdigest()
            if apk_sha != bundle_sha:
                raise SystemExit(
                    f"::error::APK 内 {entry} 与 pin 住的赞助资产包不一致（{apk_sha[:12]} != {bundle_sha[:12]}）"
                )
            verified += 1
            print(f"sponsor asset verified: {entry} sha256={apk_sha[:12]}")
    print(f"sponsor runtime content verified: {verified} image(s) + sponsor-config.json")
PY
fi
AAPT="$(find "$ANDROID_HOME/build-tools" -name aapt -type f | sort -V | tail -n 1)"
test -x "$AAPT"
"$AAPT" dump badging "$APK" > "$RUNNER_TEMP/apk-badging.txt"
python3 scripts/android-release/android_contract.py bundle \
  --badging "$RUNNER_TEMP/apk-badging.txt" --apk "$APK" --contract contracts/android-native-bridge.json --pin deploy/agent/source.json \
  --source "$STEP_VERSION_COMMIT" --version "$STEP_VERSION_VERSIONNAME" \
  --output "$RUNNER_TEMP/bundle-evidence.json"
{
  echo "bundleFiles=$(jq -r '.bundleFileCount' "$RUNNER_TEMP/bundle-evidence.json")"
  echo "agentWasmCommit=$AGENT_REF"
  echo "agentWasmRelease=$AGENT_RELEASE"
  echo "bundleManifestSha256=$(jq -r '.bundleManifestSha256' "$RUNNER_TEMP/bundle-evidence.json")"
} >> "$GITHUB_OUTPUT"
