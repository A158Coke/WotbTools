#!/usr/bin/env bash
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

stage_artifact() {
  local zip="$1"
  python3 "$INGEST" ingest "$zip" "$REF" "$RELEASE" "$WASM_ROOT/$REF"
  local stale
  for stale in wotb_replay_wasm.js wotb_replay_wasm_bg.wasm fingerprint.json source.json; do
    rm -f "$WASM_ROOT/$stale"
  done
  for dir in "$WASM_ROOT"/*/; do
    [ -d "$dir" ] || continue
    [ "$(basename "$dir")" = "$REF" ] || rm -rf "$dir"
  done
  echo "WASM 产物已就位: $WASM_ROOT/$REF（/wasm/$REF/）"
}

API_BASE="${WOTB_GITHUB_API:-https://api.github.com}"

RETRY_MAX_ATTEMPTS=5
RETRY_DEADLINE_SECONDS=240
RETRY_BASE_DELAY="${WOTB_FETCH_RETRY_DELAY:-5}"

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
    case "$http" in
      000|"") retryable=1 ;;
      200) retryable=1 ;;
      3??) if [ "$rc" -ne 0 ]; then retryable=1; else retryable=0; fi ;;
      408|429|5??) retryable=1 ;;
      *) retryable=0 ;;
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
