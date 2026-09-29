#!/usr/bin/env bash
# 依据 deploy/agent/source.json 锁定的上游完整 SHA，构建 WoT-Blitz-Agent 回放 WASM 产物。
#
# 产物输出 common/assets/wasm/（vite publicDir → dist 拷贝 → 线上 /wasm/ 伺服），
# 并写入 source.json 指纹（记录产物对应的上游 repo/SHA，供运行期诊断）。
#
# 依赖：cargo、rustup target wasm32-unknown-unknown、wasm-bindgen-cli
# （版本自动取上游 Cargo.lock 锁定值，缺失时 cargo install）。
# 上游按精确 SHA 浅克隆（external read-only upstream dependency，契约 §4）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_JSON="$ROOT/deploy/agent/source.json"

REPO=$(python3 - "$SOURCE_JSON" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["repo"])
PY
)
REF=$(python3 - "$SOURCE_JSON" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["ref"])
PY
)
echo "上游: $REPO @ $REF"

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

# ---- 产物落位（common/assets → vite publicDir → dist → /wasm/）----
OUT="$ROOT/common/assets/wasm"
mkdir -p "$OUT"
wasm-bindgen "$UPSTREAM/target/wasm32-unknown-unknown/release/wotb_replay_wasm.wasm" \
  --out-dir "$OUT" --target web --out-name wotb_replay_wasm
printf '{"repo":"%s","ref":"%s"}\n' "$REPO" "$REF" > "$OUT/source.json"
echo "产物已输出: $OUT（/wasm/wotb_replay_wasm.js @ $REF）"
