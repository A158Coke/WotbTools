#!/usr/bin/env bash
# 下载上游 Release 的 WASM 消费产物（二进制直取形态，免 Rust/wasm-bindgen 自建）。
#
# 与 build-agent-wasm.sh 的关系：本脚本是**首选路径**（直接取上游 Release 附件，
# sha256 校验后解压）；build-agent-wasm.sh（按 source.json 源码自建）保留为
# 源码构建回退/上游未发产物时的后备。
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
#   bash scripts/fetch-agent-wasm.sh              # Release 直取（CI / 本地）
#   bash scripts/fetch-agent-wasm.sh --self-test  # ingest 契约自测（用已暂存 ZIP，不写产物目录）
#   WOTB_AGENT_ARTIFACT_FILE=<zip> bash scripts/fetch-agent-wasm.sh   # 已暂存 ZIP
#
# 依赖：curl、sha256sum、python3（JSON 解析与 zip 解压，避免依赖 unzip）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_JSON="$ROOT/deploy/agent/source.json"
INGEST="$ROOT/scripts/agent-wasm-artifact.py"
WASM_ROOT="$ROOT/common/assets/wasm"

eval "$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
a = d.get("artifact") or {}
print("REPO=%s" % d.get("repo", ""))
print("REF=%s" % d.get("ref", ""))
print("RELEASE=%s" % a.get("release", ""))
print("ASSET=%s" % a.get("asset", ""))
print("EXPECT_SHA=%s" % a.get("sha256", ""))
' "$SOURCE_JSON")"

if [ -z "${ASSET:-}" ] || [ -z "${RELEASE:-}" ] || [ -z "${REF:-}" ]; then
  echo "source.json 未配置 ref 或 artifact（release/asset/sha256），无法直取" >&2
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

# 下载 Release 附件（有限重试 + 指数退避 + 总时限）。
# - 可恢复错误重试：HTTP 408/429/5xx 与 curl 传输失败（连接中断、超时、DNS 等）。
# - 永久错误立即失败：其余 HTTP 状态（如 404/403），不重试、不回退。
# - 数据只写入 `.part` 临时文件，成功（HTTP 200）后才 mv 到目标路径；失败不留下可用文件。
# - 上限：最多 RETRY_MAX_ATTEMPTS 次；退避 1x/2x/4x…（封顶 60s）；总时限 RETRY_DEADLINE_SECONDS
#   内不再发起新尝试（单次 curl 另有 --max-time）。WOTB_FETCH_RETRY_DELAY 仅供测试缩短退避。
RETRY_MAX_ATTEMPTS=5
RETRY_DEADLINE_SECONDS=240
RETRY_BASE_DELAY="${WOTB_FETCH_RETRY_DELAY:-5}"

fetch_release_asset() {
  local url="$1" out="$2"
  local attempt=1 delay="$RETRY_BASE_DELAY" started=$SECONDS
  local http="" rc=0 retryable=0 reason=""
  while :; do
    rc=0
    http="$(curl --silent --show-error --location --max-time 90 \
      --output "$out.part" --write-out '%{http_code}' "$url")" || rc=$?
    if [ "$rc" -eq 0 ] && [ "$http" = "200" ]; then
      mv -f "$out.part" "$out"
      echo "下载成功: HTTP 200（第 ${attempt}/${RETRY_MAX_ATTEMPTS} 次尝试）"
      return 0
    fi
    rm -f "$out.part"
    reason="HTTP ${http:-000} curl_exit=${rc}"
    # 先看已收到的 HTTP 状态，再看 curl exit code：截断/超时的永久错误响应（如 404 + exit 18）
    # 仍按 HTTP 状态判为永久失败；无有效状态（000）或 200 但传输中断才是可重试的传输失败。
    case "$http" in
      000|""|200) retryable=1 ;;        # 无 HTTP 状态或 200 响应被中断
      408|429|5??) retryable=1 ;;
      *) retryable=0 ;;                 # 403/404 等永久错误，无论 curl exit code
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

# repo 兼容两种形态：完整 URL（当前 source.json）或 owner/name
case "$REPO" in
  http*) RELEASE_URL="$REPO" ;;
  *)     RELEASE_URL="https://github.com/$REPO" ;;
esac
URL="${RELEASE_URL}/releases/download/${RELEASE}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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
    echo "下载 ${URL}"
    fetch_release_asset "$URL" "$TMP/${ASSET}" || exit 1
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
  echo "下载 ${URL}"
  fetch_release_asset "$URL" "$TMP/${ASSET}" || exit 1
fi

if ! echo "${EXPECT_SHA}  ${TMP}/${ASSET}" | sha256sum -c --quiet; then
  echo "SHA256 校验失败：附件与 deploy/agent/source.json 的 artifact.sha256 不一致，拒绝使用" >&2
  exit 1
fi
stage_artifact "$TMP/${ASSET}"
