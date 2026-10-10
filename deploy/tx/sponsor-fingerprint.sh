#!/usr/bin/env bash
# 赞助内容（收款码 runtime bundle）指纹的**唯一**派生实现——与 Frontend 工作流 sponsor 步骤 /
# 构建器 CLI 的归一化口径一致：
#   - pin 缺失（deploy/sponsor/content.json 不存在）→ 打印**空行**（identity 第三输入 = 空串）
#   - pin 在 → 必须是完整的 artifact 元数据，打印其 sha256（构建侧下载后逐字节校验的那个值）
#
# ⚠️ 缺失值必须与构建器的实产 identity 完全一致：CLI 入口把占位符 `-` 归一化为空串
# （`build-frontend-from-gitee.sh`：`[ "$sponsor_fingerprint" != "-" ] || sponsor_fingerprint=""`），
# 故本脚本对"无 pin"只能给空串——曾给 `-` 导致 deploy/replica 查到未发布的 tag
# （2026-10-10 复审 P2：同一 source SHA 下 builder=sha-f1698ee92506 vs deploy=sha-6d521aeadd3e，
#  回归见 deploy/test_frontend_image_identity.py 的 no-pin 数据点）。
# 该值是镜像不可变 tag 的 identity 第三输入（见下文调用点与守卫测试）。
#
# 用法：bash deploy/tx/sponsor-fingerprint.sh <repo-root>
set -euo pipefail

root="${1:?usage: sponsor-fingerprint.sh <repo-root>}"
pin="$root/deploy/sponsor/content.json"
if [ ! -f "$pin" ]; then
  printf '\n'
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
