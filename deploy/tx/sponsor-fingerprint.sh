#!/usr/bin/env bash
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
