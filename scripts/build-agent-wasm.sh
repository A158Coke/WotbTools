#!/usr/bin/env bash
# 依据 deploy/agent/source.json 锁定的上游完整 SHA，构建 WoT-Blitz-Agent 回放 WASM 产物。
#
# 产物输出 **commit-addressed 目录** `common/assets/wasm/<ref>/`（vite publicDir → dist
# 拷贝 → 线上 /wasm/<ref>/ 伺服），并写入上游同形状的 fingerprint.json
# （upstream_commit / tag，与 fetch-agent-wasm.sh 直取 Release 时一致），供运行期
# 版本门禁与诊断使用。两条路径产出同一形状，前端 loader 不区分来源。
#
# 依赖：cargo、rustup target wasm32-unknown-unknown、wasm-bindgen-cli
# （版本自动取上游 Cargo.lock 锁定值，缺失时 cargo install）。
# 上游按精确 SHA 浅克隆（external read-only upstream dependency，契约 §4）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_JSON="$ROOT/deploy/agent/source.json"
INGEST="$ROOT/scripts/agent-wasm-artifact.py"

eval "$(python3 - "$SOURCE_JSON" <<'PY'
import json, shlex, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
artifact = data.get("artifact") or {}
values = {"REPO": data.get("repo", ""), "REF": data.get("ref", ""), "RELEASE": artifact.get("release", "")}
for key, value in values.items():
    print(f"{key}={shlex.quote(value)}")
PY
)"
[ -n "$REF" ] && [ -n "$RELEASE" ] || { echo "source.json 未配置 ref/artifact.release" >&2; exit 1; }
echo "上游: $REPO @ $REF（$RELEASE）"

# ---- 按精确 SHA 浅克隆上游 ----
UPSTREAM="$(mktemp -d)/agent-upstream"
git init -q "$UPSTREAM"
git -C "$UPSTREAM" remote add origin "$REPO"
git -C "$UPSTREAM" fetch -q --depth 1 origin "$REF"
git -C "$UPSTREAM" checkout -q FETCH_HEAD

# ---- wasm-bindgen CLI 版本随上游 Cargo.lock ----
BINDGEN_VERSION=$(grep -A1 '^name = "wasm-bindgen"$' "$UPSTREAM/Cargo.lock" | grep '^version' | head -1 | cut -d'"' -f2)
if ! command -v wasm-bindgen >/dev/null 2>&1 || [ "$(wasm-bindgen --version | awk '{print $2}')" != "$BINDGEN_VERSION" ]; then
  echo "安装 wasm-bindgen-cli $BINDGEN_VERSION（与上游 Cargo.lock 对齐）"
  cargo install wasm-bindgen-cli --version "$BINDGEN_VERSION" --locked
fi

# ---- 构建 ----
rustup target add wasm32-unknown-unknown
cargo build -p wotb-replay-wasm --release --target wasm32-unknown-unknown --manifest-path "$UPSTREAM/Cargo.toml"

# ---- 产物落位（先落临时目录，校验通过后整体搬迁，不出半残目录）----
OUT="$ROOT/common/assets/wasm/$REF"
STAGE="$(mktemp -d)/wasm"
mkdir -p "$STAGE"
wasm-bindgen "$UPSTREAM/target/wasm32-unknown-unknown/release/wotb_replay_wasm.wasm" \
  --out-dir "$STAGE" --target web --out-name wotb_replay_wasm
python3 - "$STAGE/fingerprint.json" "$REF" "$RELEASE" "$BINDGEN_VERSION" <<'PY'
import json, sys
path, commit, tag, bindgen = sys.argv[1:5]
with open(path, "w", encoding="utf-8") as handle:
    json.dump({"upstream_commit": commit, "tag": tag, "bindgen": f"wasm-bindgen {bindgen}"}, handle, indent=2)
    handle.write("\n")
PY

# 与 fetch 路径同一套 fail-closed 校验（实现单一来源）
python3 "$INGEST" verify "$STAGE/fingerprint.json" "$REF" "$RELEASE"

rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
mv "$STAGE" "$OUT"
rm -f "$ROOT/common/assets/wasm/wotb_replay_wasm.js" "$ROOT/common/assets/wasm/wotb_replay_wasm_bg.wasm" \
  "$ROOT/common/assets/wasm/fingerprint.json" "$ROOT/common/assets/wasm/source.json"
echo "产物已输出: $OUT（/wasm/$REF/）"
