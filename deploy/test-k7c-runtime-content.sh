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

grep -Fq '/opt/wotb-tx2/runtime-content/sponsor-config.json:/usr/share/nginx/html/sponsor-config.json:ro' "$compose"
grep -Fq '/opt/wotb-tx2/runtime-content/sponsor:/usr/share/nginx/html/sponsor-assets:ro' "$compose"
grep -Fq '/opt/wotb-tx2/runtime-content/android-release:/usr/share/nginx/html/download/android:ro' "$compose"

echo "K7C runtime content contract: PASS"
