#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 22: Upload APK to Tsinghua Cloud (public download offload + origin seed source)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
APK_NAME="$STEP_ARTIFACT_APKNAME"
APK_FILE="release-staging/$APK_NAME"
EXPECTED_SHA="$STEP_ARTIFACT_SHA256"
# 网盘约定（与 TX1 Caddyfile 的 redir 目标一一对应，改这边必须同步改 Caddy）：
# 仓库 = 个人资料库，目录 = /wotbtools-android/，
# 分享 = https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/（可下载、无密码、不过期）。
REPO_ID="a757b2fa-9bc9-42f9-bc90-d6a2c0a94ed0"
PARENT_DIR="/wotbtools-android"
SHARE_DIRECT="https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/$APK_NAME&dl=1"

# Seafile upload-link 返回 **JSON 编码的 URL 字符串**（Response(url)）：
# 命令替换会保留响应中的双引号，必须解析后取裸 URL 再交给 curl
ULINK_RAW="$(curl -fsS -H "Authorization: Token $TSINGHUA_CLOUD_TOKEN" \
  "https://cloud.tsinghua.edu.cn/api2/repos/$REPO_ID/upload-link/?p=$PARENT_DIR&reuse=1")"
ULINK="$(printf '%s' "$ULINK_RAW" | jq -r '.')"
case "$ULINK" in
  https://*) ;;
  *) echo "::error::upload-link response is not a JSON URL string: $ULINK_RAW" >&2; exit 1;;
esac

# replace=1 = 覆盖同名文件（reuse=1 只是幂等令牌，**不是**覆盖开关——缺
# replace 时同名上传会被改名 `filename (1).apk`，固定下载路径拿不到新副本，
# 损坏副本无法自愈，评审 P2）。已知怪癖：这套清华云盘部署「上传成功也返回
# HTTP 400 Parent dir doesn't exist」——响应码不可作为成败依据；唯一权威
# 判定 = 从分享直链下载回来 SHA-256 一致（下方 5 次重试全败即 workflow
# 失败，fail-visible）。curl 层错误打诊断后同样交由下载校验裁决。
upload_rc=0
curl -sS --connect-timeout 10 --max-time 2700 -o "$RUNNER_TEMP/thu-upload-resp.txt" -H "Authorization: Token $TSINGHUA_CLOUD_TOKEN" \
  -F "parent_dir=$PARENT_DIR" -F "replace=1" -F "file=@$APK_FILE" "$ULINK" || upload_rc=$?
echo "upload curl rc=$upload_rc; resp=$(head -c 200 "$RUNNER_TEMP/thu-upload-resp.txt" 2>/dev/null || echo '<none>')"

for attempt in 1 2 3 4 5; do
  sleep 3
  if curl -fsSL --connect-timeout 5 --max-time 900 \
      -o "$RUNNER_TEMP/thu-offload.apk" "$SHARE_DIRECT" 2>/dev/null \
      && [ "$(sha256sum "$RUNNER_TEMP/thu-offload.apk" | awk '{print $1}')" = "$EXPECTED_SHA" ]; then
    echo "Tsinghua Cloud offload verified: $APK_NAME sha256=$EXPECTED_SHA"
    exit 0
  fi
  echo "Tsinghua Cloud offload verify attempt $attempt/5 failed; retrying."
done
echo "::error::Tsinghua Cloud offload verification failed after 5 attempts; public /download/android/*.apk redirects would hit a missing drive object." >&2
exit 1
