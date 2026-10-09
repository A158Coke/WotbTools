#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sync="$ROOT/deploy/tx/k7c-sync-runtime-content.sh"
compose="$ROOT/deploy/tx/frontend-shadow.compose.yml"

[ -f "$sync" ] || { echo "missing runtime sync" >&2; exit 1; }
[ -f "$compose" ] || { echo "missing shadow compose" >&2; exit 1; }

grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$sync"
grep -Fq 'http://10.20.0.1:8081' "$sync"
grep -Fq '/opt/wotb-tx2/runtime-content' "$sync"
grep -Fq 'sponsor-config.json' "$sync"
grep -Fq 'apkUrl' "$sync"
! grep -Eq 'rsync|scp|ssh' "$sync"

# staging evidence 的存续不变量（2026-10-09）：android-release 把「已 stage、未发布」版本的
# 身份记录写进这棵树，publish 只按公开 URL 校验它，而 Caddy 在 TX1/TX2 之间负载——整树替换
# 必须整份带走这些记录，且必须早于 swap：晚于 swap 等于没做，公开 URL 会退化成按 origin
# 掷硬币（stage 校验通过、publish 404 fail closed）。
grep -Fq '*.staging.json' "$sync"
carry_line="$(grep -nF 'for evidence in "$RUNTIME_ROOT"/android-release/*.staging.json' "$sync" | head -n1 | cut -d: -f1 || true)"
swap_line="$(grep -nF 'sudo mv "$stage" "$RUNTIME_ROOT"' "$sync" | head -n1 | cut -d: -f1 || true)"
if [ -z "$carry_line" ] || [ -z "$swap_line" ] || [ "$carry_line" -ge "$swap_line" ]; then
  echo "staging evidence must be carried over before the runtime tree swap" >&2
  exit 1
fi
# 例外必须保持窄：树里只延续身份记录，不累积历史 APK（当前 APK 仍按 version.json 现拉）。
! grep -Fq '"$RUNTIME_ROOT"/android-release/*.apk' "$sync"

grep -Fq '/opt/wotb-tx2/runtime-content/sponsor-config.json:/usr/share/nginx/html/sponsor-config.json:ro' "$compose"
grep -Fq '/opt/wotb-tx2/runtime-content/sponsor:/usr/share/nginx/html/sponsor-assets:ro' "$compose"
grep -Fq '/opt/wotb-tx2/runtime-content/android-release:/usr/share/nginx/html/download/android:ro' "$compose"

echo "K7C runtime content contract: PASS"
