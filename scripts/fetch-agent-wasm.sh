#!/usr/bin/env bash
# 下载上游 Release 的 WASM 消费产物（二进制直取形态，免 Rust/wasm-bindgen 自建）。
#
# 与 build-agent-wasm.sh 的关系：本脚本是**首选路径**（直接取上游 Release 附件，
# sha256 校验后解压）；build-agent-wasm.sh（按 source.json 源码自建）保留为
# 源码构建回退/上游未发产物时的后备。
#
# 依赖：curl、sha256sum、python3（JSON 解析与 zip 解压，避免依赖 unzip）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_JSON="$ROOT/deploy/agent/source.json"
DEST="$ROOT/common/assets/wasm"

eval "$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
a = d.get("artifact") or {}
print("REPO=%s" % d.get("repo", ""))
print("RELEASE=%s" % a.get("release", ""))
print("ASSET=%s" % a.get("asset", ""))
print("EXPECT_SHA=%s" % a.get("sha256", ""))
' "$SOURCE_JSON")"

if [ -z "${ASSET:-}" ]; then
  echo "source.json 未配置 artifact（release/asset/sha256），无法直取" >&2
  exit 1
fi

# repo 兼容两种形态：完整 URL（当前 source.json）或 owner/name
case "$REPO" in
  http*) RELEASE_URL="$REPO" ;;
  *)     RELEASE_URL="https://github.com/$REPO" ;;
esac
URL="${RELEASE_URL}/releases/download/${RELEASE}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "下载 ${URL}"
curl --fail --silent --location --retry 3 "$URL" -o "$TMP/${ASSET}"

echo "${EXPECT_SHA}  ${TMP}/${ASSET}" | sha256sum -c --quiet

mkdir -p "$DEST"
python3 -c '
import sys, zipfile, os
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall(sys.argv[2])
print("解压完成:", sorted(os.listdir(sys.argv[2])))
' "$TMP/${ASSET}" "$DEST"
echo "WASM 产物已就位: $DEST"
