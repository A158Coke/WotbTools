#!/usr/bin/env bash
# 下载上游 Release 的 WASM 消费产物（二进制直取形态，免 Rust/wasm-bindgen 自建）。
#
# 与 build-agent-wasm.sh 的关系：本脚本是**首选路径**（经 GitHub Releases API 取上游
# Release 附件，sha256 校验后解压）；build-agent-wasm.sh（按 source.json 源码自建）保留为
# 源码构建回退/上游未发产物时的后备。
#
# 下载路径（不再使用 github.com/<repo>/releases/download 直链）：
#   1. GET {API}/repos/{owner}/{name}/releases/tags/{release}  → 按 asset 名解析 Asset ID（不硬编码）
#   2. GET {API}/repos/{owner}/{name}/releases/assets/{id}     → Accept: application/octet-stream，
#      经 302 跳转到对象存储取得 ZIP（curl --location 跟随；签名 URL 不写入日志）
#   3. sha256 + fingerprint 校验（任何失败都拒绝产物，不回退到其他来源）
#
# 产物落位是 **commit-addressed 目录**（`common/assets/wasm/<source.json ref>/`），
# 不是 stable 路径：
#   source.json.ref → ZIP → fingerprint 校验 → common/assets/wasm/<ref>/
# 运行时 URL `/wasm/<ref>/…` 因此与内容同身份——同一个 frontend build 只能加载
# 自己 pin 的 Agent，旧 URL 永不覆盖；浏览器缓存失效靠 URL identity（不靠 no-cache）。
# stable `/wasm/wotb_replay_wasm.js` 已废除，不保留 alias（否则很容易被重新引用）。
#
# 校验实现（含 self-test）在 scripts/agent-wasm-artifact.py，与 build-agent-wasm.sh 共用。
#
# 用法：
#   bash scripts/fetch-agent-wasm.sh              # Release Asset API 下载（CI / 本地）
#   bash scripts/fetch-agent-wasm.sh --self-test  # ingest 契约自测（用已暂存 ZIP，不写产物目录）
#   WOTB_AGENT_ARTIFACT_FILE=<zip> bash scripts/fetch-agent-wasm.sh   # 已暂存 ZIP
#   GITHUB_TOKEN=<token> bash scripts/fetch-agent-wasm.sh             # 可选：避免匿名 API 限流
#
# 依赖：curl、sha256sum、python3（JSON 解析与 zip 解压，避免依赖 unzip）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_JSON="$ROOT/deploy/agent/source.json"
INGEST="$ROOT/scripts/agent-wasm-artifact.py"
WASM_ROOT="$ROOT/common/assets/wasm"

eval "$(python3 -c '
import json, sys
from urllib.parse import urlparse
d = json.load(open(sys.argv[1], encoding="utf-8"))
a = d.get("artifact") or {}
repo = d.get("repo", "")
path = urlparse(repo).path if repo.startswith("http") else repo
print("REPO=%s" % repo)
print("OWNER_REPO=%s" % path.strip("/").removesuffix(".git"))
print("REF=%s" % d.get("ref", ""))
print("RELEASE=%s" % a.get("release", ""))
print("ASSET=%s" % a.get("asset", ""))
print("EXPECT_SHA=%s" % a.get("sha256", ""))
' "$SOURCE_JSON")"

if [ -z "${ASSET:-}" ] || [ -z "${RELEASE:-}" ] || [ -z "${REF:-}" ] || [ -z "${OWNER_REPO:-}" ]; then
  echo "source.json 未配置 ref、repo 或 artifact（release/asset/sha256），无法下载" >&2
  exit 1
fi

# 产物落位：commit-addressed 目录 + 无 stable alias。stable `/wasm/wotb_replay_wasm.js`
# 已废除，留在这里才会被下一个引用的人捡回去用。
stage_artifact() {
  local zip="$1"
  python3 "$INGEST" ingest "$zip" "$REF" "$RELEASE" "$WASM_ROOT/$REF"
  local stale
  for stale in wotb_replay_wasm.js wotb_replay_wasm_bg.wasm fingerprint.json source.json; do
    rm -f "$WASM_ROOT/$stale"
  done
  # 只保留当前 pin 的 commit 目录：旧版本目录会随 Vite publicDir 一起进 dist，而
  # dist/Docker/TX 三处校验都要求 `/wasm/` 下**恰好一个** ref 目录——本地升级 pin 后
  # 残留的旧目录会让下一次 build 以"必须只含 pin 的 commit 目录"失败。
  # 这些目录是 gitignored 的可再生产物，删掉只会让下一次 fetch 重新下载。
  for dir in "$WASM_ROOT"/*/; do
    [ -d "$dir" ] || continue
    [ "$(basename "$dir")" = "$REF" ] || rm -rf "$dir"
  done
  echo "WASM 产物已就位: $WASM_ROOT/$REF（/wasm/$REF/）"
}

# GitHub REST API 根地址；测试用 WOTB_GITHUB_API 指向本地 fixture。
API_BASE="${WOTB_GITHUB_API:-https://api.github.com}"

# 有限重试 + 指数退避 + 总时限（仅作用于 HTTP/传输层，不影响校验）。
# - 可恢复：无 HTTP 响应（000）、200 但响应被中断、408/429/5xx、重定向后目标连接失败（保留的 3xx + 非零 exit）。
# - 永久：其余 HTTP 状态（如 403/404），即使截断（非零 exit）也立即失败；完整返回的 3xx 亦为永久。
# - 上限：最多 RETRY_MAX_ATTEMPTS 次；退避 5/10/20/40s（封顶 60s）；总时限 RETRY_DEADLINE_SECONDS
#   内不再发起新尝试；单次请求 --max-time 90。WOTB_FETCH_RETRY_DELAY 仅供测试缩短退避。
RETRY_MAX_ATTEMPTS=5
RETRY_DEADLINE_SECONDS=240
RETRY_BASE_DELAY="${WOTB_FETCH_RETRY_DELAY:-5}"

# http_get_retry <url> <out> <accept>：响应只经 `<out>.part` 落位，HTTP 200 且 curl 成功后才 mv 到 <out>。
# 认证：仅当 URL 属于 API 根时附带 GITHUB_TOKEN（若设置）；curl 跨主机重定向到对象存储时会丢弃 Authorization。
# 日志只输出请求的 API URL，不输出重定向后的签名 URL。
http_get_retry() {
  local url="$1" out="$2" accept="$3"
  local attempt=1 delay="$RETRY_BASE_DELAY" started=$SECONDS
  local http="" rc=0 retryable=0 reason=""
  local auth=()
  if [ -n "${GITHUB_TOKEN:-}" ] && [[ "$url" == "$API_BASE"/* ]]; then
    auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi
  while :; do
    rc=0
    http="$(curl --silent --show-error --location --max-time 90 \
      -H "Accept: ${accept}" -H "User-Agent: wotbtools-fetch-agent-wasm" \
      ${auth[@]+"${auth[@]}"} \
      --output "$out.part" --write-out '%{http_code}' "$url")" || rc=$?
    if [ "$rc" -eq 0 ] && [ "$http" = "200" ]; then
      mv -f "$out.part" "$out" || return 1
      echo "下载成功: HTTP 200（第 ${attempt}/${RETRY_MAX_ATTEMPTS} 次尝试）"
      return 0
    fi
    rm -f "$out.part"
    reason="HTTP ${http:-000} curl_exit=${rc}"
    # 先看已收到的 HTTP 状态，再看 curl exit code：截断的永久错误（如 404 + exit 18）仍按状态判永久。
    case "$http" in
      000|"") retryable=1 ;;                           # 未收到 HTTP 响应：传输失败
      200) retryable=1 ;;                              # 200 但响应中断
      3??) if [ "$rc" -ne 0 ]; then retryable=1; else retryable=0; fi ;;  # 跳转目标失败 vs 完整返回的 3xx
      408|429|5??) retryable=1 ;;
      *) retryable=0 ;;                                # 403/404 等永久错误
    esac
    if [ "$retryable" -eq 0 ]; then
      echo "下载失败（永久错误，不重试）: ${reason}  URL=${url}" >&2
      return 1
    fi
    if [ "$attempt" -ge "$RETRY_MAX_ATTEMPTS" ] \
      || [ $((SECONDS - started + delay)) -ge "$RETRY_DEADLINE_SECONDS" ]; then
      echo "下载失败（可恢复错误，已达重试上限，第 ${attempt}/${RETRY_MAX_ATTEMPTS} 次，已耗时 $((SECONDS - started))s）: ${reason}  URL=${url}" >&2
      return 1
    fi
    echo "下载失败（可恢复错误: ${reason}，第 ${attempt}/${RETRY_MAX_ATTEMPTS} 次），${delay}s 后重试" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
    [ "$delay" -le 60 ] || delay=60
  done
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 经 Releases API 下载附件到 $TMP/$ASSET：按 tag 查询元数据 → 按名称解析 Asset ID → Asset API 二进制下载。
download_release_asset() {
  local meta="$TMP/release.json" asset_id=""
  local meta_url="${API_BASE}/repos/${OWNER_REPO}/releases/tags/${RELEASE}"
  echo "查询 Release 元数据: ${meta_url}"
  http_get_retry "$meta_url" "$meta" "application/vnd.github+json" || return 1
  asset_id="$(python3 "$INGEST" asset-id "$meta" "$RELEASE" "$ASSET")" || return 1
  local asset_url="${API_BASE}/repos/${OWNER_REPO}/releases/assets/${asset_id}"
  echo "下载附件 ${ASSET}（id=${asset_id}）: ${asset_url}"
  http_get_retry "$asset_url" "$TMP/${ASSET}" "application/octet-stream"
}

# 契约自测：正例用合成 ZIP，因此本分支只把暂存件当作「真实产物清单不匹配」这条反例的样本
#（不校验 sha256——暂存件内容不影响自测结论，缺网络也能跑）。
if [ "${1:-}" = "--self-test" ]; then
  if [ -n "${WOTB_AGENT_ARTIFACT_FILE:-}" ]; then
    [ -f "$WOTB_AGENT_ARTIFACT_FILE" ] || {
      echo "指定的 WOTB_AGENT_ARTIFACT_FILE 不存在: $WOTB_AGENT_ARTIFACT_FILE" >&2
      exit 1
    }
    cp "$WOTB_AGENT_ARTIFACT_FILE" "$TMP/${ASSET}"
    echo "self-test 反例样本: $WOTB_AGENT_ARTIFACT_FILE"
  else
    download_release_asset || exit 1
  fi
  python3 "$INGEST" self-test "$TMP/${ASSET}" "$TMP/self-test"
  exit 0
fi

if [ -n "${WOTB_AGENT_ARTIFACT_FILE:-}" ]; then
  [ -f "$WOTB_AGENT_ARTIFACT_FILE" ] || {
    echo "指定的 WOTB_AGENT_ARTIFACT_FILE 不存在: $WOTB_AGENT_ARTIFACT_FILE" >&2
    exit 1
  }
  cp "$WOTB_AGENT_ARTIFACT_FILE" "$TMP/${ASSET}"
  echo "使用本地已暂存 Agent WASM artifact: $WOTB_AGENT_ARTIFACT_FILE"
else
  download_release_asset || exit 1
fi

if ! echo "${EXPECT_SHA}  ${TMP}/${ASSET}" | sha256sum -c --quiet; then
  echo "SHA256 校验失败：附件与 deploy/agent/source.json 的 artifact.sha256 不一致，拒绝使用" >&2
  exit 1
fi
stage_artifact "$TMP/${ASSET}"
