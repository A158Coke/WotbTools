#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 5: Resolve the staged release identity from the immutable tag (no rebuild)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
. scripts/android-release/check-release-guards.sh

# 发布权威 = 已 staged 的 release 身份（显式版本 → tag target → staging evidence → APK 字节）。
# stage 完成后 main 可能已经前进（A → B）：那**不能**作废一个已经 staged 的
# Android 版本（Android 版本/tag/APK 身份都是 immutable，无法从 B 重新 staged 同一版本）。
# 自动续跑只在 main 已有更高 Version-as-Code 时让位，见 publish_gate。
APK_NAME="$STEP_STAGEDREF_APKNAME"
STAGING_NAME="$STEP_STAGEDREF_STAGINGNAME"
TAG="$STEP_STAGEDREF_TAGNAME"
BASE="https://wotbtools.com/download/android"

STAGING="$RUNNER_TEMP/staging.json"
bash scripts/android-release/staging-evidence.sh collect-required "$STAGING_NAME" "$RUNNER_TEMP/staging-origins.json" >/dev/null
if ! curl -fsSL -o "$STAGING" "$BASE/$STAGING_NAME"; then
  echo "::error::No staging evidence at $BASE/$STAGING_NAME; stage version $REQUESTED_VERSION first." >&2
  exit 1
fi
cmp "$STAGING" "$RUNNER_TEMP/staging-origins.json" || { echo "::error::Public staging evidence differs from origins" >&2; exit 1; }
git show "$TAG_TARGET:contracts/android-native-bridge.json" > "$RUNNER_TEMP/staged-contract.json"
git show "$TAG_TARGET:deploy/agent/source.json" > "$RUNNER_TEMP/staged-agent.json"
# staged 源码的 gradle.properties 已在 stagedref 步骤导出到 $RUNNER_TEMP（git archive），
# 这里断言它的版本就是请求的版本；工作区的 android/gradle.properties 不参与候选身份。
grep -Fxq "wotbVersion=$REQUESTED_VERSION" "$RUNNER_TEMP/android/gradle.properties"
# staged 源码的 bridge 必须等于 staged 源码自己声明的 bridge（同样来自 tag target）。
STAGED_BRIDGE="$(jq -r '.bridgeVersion' "$RUNNER_TEMP/staged-contract.json")"
grep -Fxq "wotbNativeBridgeVersion=$STAGED_BRIDGE" "$RUNNER_TEMP/android/gradle.properties"
curl -fsSL -o "$RUNNER_TEMP/staged.apk" "$BASE/$APK_NAME"
test -s "$RUNNER_TEMP/staged.apk" || { echo "::error::Staged APK is empty" >&2; exit 1; }
ACTUAL_APK_SHA="$(sha256sum "$RUNNER_TEMP/staged.apk" | awk '{print $1}')"

guard_staged_release_identity \
  "$TAG_TARGET" "$TAG_TARGET" "$(jq -r '.sourceSha' "$STAGING")" \
  "$(jq -r '.sha256' "$STAGING")" "$ACTUAL_APK_SHA"

AAPT="$(find "$ANDROID_HOME/build-tools" -name aapt -type f | sort -V | tail -n 1)"
test -x "$AAPT"
"$AAPT" dump badging "$RUNNER_TEMP/staged.apk" > "$RUNNER_TEMP/apk-badging.txt"
# APK badging 的 versionCode 必须等于 **staged 源码**（tag target）的 versionCode，
# 而不是当前 main 的 committed 版本。这里的 Python 只做「验证」并把值打进日志：
# 它的局部变量永远不会泄漏回 shell，所以下游写 $GITHUB_OUTPUT 用的是 env 里的
# STAGED_VERSION_CODE（= steps.stagedref.outputs.versionCode），
# 在 set -euo pipefail 下不会出现 unbound variable。
python3 - "$RUNNER_TEMP/apk-badging.txt" "$STAGED_VERSION_CODE" <<'PY'
import re
import sys

badging = open(sys.argv[1], encoding="utf-8").read()
expected = sys.argv[2]
match = re.search(r"versionCode='([0-9]+)'", badging)
if not match:
    raise SystemExit("APK badging has no versionCode")
if match.group(1) != expected:
    raise SystemExit(f"Staged APK versionCode {match.group(1)} does not match the staged source versionCode {expected}")
print(f"Staged APK versionCode matches the staged source: {expected}")
PY
python3 scripts/android-release/android_contract.py bundle \
  --badging "$RUNNER_TEMP/apk-badging.txt" --apk "$RUNNER_TEMP/staged.apk" --contract "$RUNNER_TEMP/staged-contract.json" \
  --pin "$RUNNER_TEMP/staged-agent.json" --source "$TAG_TARGET" \
  --version "$REQUESTED_VERSION" --evidence "$STAGING"
# 只消费已经固定的 staged patch 清单；publish 绝不重建或修改其身份。
python3 scripts/android-release/delta_artifact.py verify --target "$RUNNER_TEMP/staged.apk" \
  --target-sha "$ACTUAL_APK_SHA" --target-code "$STAGED_VERSION_CODE" --evidence "$STAGING" > "$RUNNER_TEMP/delta-publish.json"
PATCH_URL="$(jq -r '.patches[0].url // empty' "$RUNNER_TEMP/delta-publish.json")"
if [ -n "$PATCH_URL" ]; then
  PATCH_NAME="${PATCH_URL##*/}"
  mkdir -p "$RUNNER_TEMP/delta-publish"
  curl -fsSL --retry 3 --connect-timeout 10 --max-time 300 -o "$RUNNER_TEMP/delta-publish/$PATCH_NAME" "$PATCH_URL"
  python3 scripts/android-release/delta_artifact.py verify --target "$RUNNER_TEMP/staged.apk" \
    --target-sha "$ACTUAL_APK_SHA" --target-code "$STAGED_VERSION_CODE" --evidence "$STAGING" --patch-dir "$RUNNER_TEMP/delta-publish" >/dev/null
  BASE_CODE="$(jq -r '.patches[0].fromVersionCode' "$RUNNER_TEMP/delta-publish.json")"
  BASE_SHA="$(jq -r '.patches[0].fromSha256' "$RUNNER_TEMP/delta-publish.json")"
  BASE_VERSION="$(python3 -c 'import sys; v=int(sys.argv[1]); print(f"{v//1000000}.{v//1000%1000}.{v%1000}")' "$BASE_CODE")"
  curl -fsSL --connect-timeout 10 --max-time 30 -o "$RUNNER_TEMP/delta-base-staging.json" "$BASE/wotbtools-android-v$BASE_VERSION.staging.json"
  jq -e --argjson code "$BASE_CODE" --arg sha "$BASE_SHA" '.versionCode == $code and .sha256 == $sha' "$RUNNER_TEMP/delta-base-staging.json" >/dev/null \
    || { echo "::error::Delta base staging identity differs from patch" >&2; exit 1; }
fi
git merge-base --is-ancestor "$TAG_TARGET" origin/main || {
  echo "::error::The staged Android source is outside current main history" >&2
  exit 1
}
echo "Staged release identity verified: $APK_NAME tag=$TAG source=$TAG_TARGET sha256=$ACTUAL_APK_SHA"
echo "versionName=$REQUESTED_VERSION" >> "$GITHUB_OUTPUT"
echo "versionCode=$STAGED_VERSION_CODE" >> "$GITHUB_OUTPUT"
echo "nativeBridgeVersion=$STAGED_BRIDGE" >> "$GITHUB_OUTPUT"
echo "stagedSource=$TAG_TARGET" >> "$GITHUB_OUTPUT"
ASSET_ORIGIN="$(python3 scripts/android-release/android_contract.py asset-origin \
  --native-source "$RUNNER_TEMP/android/app/src/main/java/com/wotbtools/app/AgentAssetProxy.kt")"
echo "assetOrigin=$ASSET_ORIGIN" >> "$GITHUB_OUTPUT"
echo "apkSha=$ACTUAL_APK_SHA" >> "$GITHUB_OUTPUT"
