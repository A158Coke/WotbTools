#!/usr/bin/env bash
# 赞助内容（收款码 runtime bundle）指纹的**唯一**派生实现——与 Frontend 工作流 sponsor 步骤同语义：
#   - pin 缺失（deploy/sponsor/content.json 不存在）→ 打印 `-`（对应构建侧"未注入"的输入）
#   - pin 在 → 必须是完整的 artifact 元数据，打印其 sha256（构建侧下载后逐字节校验的那个值）
#
# 该值是镜像不可变 tag 的 identity 第三输入（见 deploy/tx/frontend-image-identity.sh 的口径说明）。
# 2026-10-10 事故：Frontend deploy / Frontend Replica 两侧就地重算 identity 时漏掉本输入
# ⇒ 每次 main 部署都以 `...wotbtools-frontend:sha-<另一枚> : not found` 失败。
#
# 用法：bash deploy/tx/sponsor-fingerprint.sh <repo-root>
set -euo pipefail

root="${1:?usage: sponsor-fingerprint.sh <repo-root>}"
pin="$root/deploy/sponsor/content.json"
if [ ! -f "$pin" ]; then
  printf -- '-\n'
  exit 0
fi

python3 - "$pin" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
artifact = data.get("artifact") or {}
repo = data.get("repo", "")
release = artifact.get("release", "")
asset = artifact.get("asset", "")
sha = artifact.get("sha256", "")
# 校验口径与 Frontend 工作流 sponsor 步骤保持一致（只看完整性 + 长度），避免两处派生漂移。
if not (repo and release and asset and len(sha) == 64):
    raise SystemExit("deploy/sponsor/content.json has incomplete artifact metadata")
print(sha)
PY
