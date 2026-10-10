#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
preflight="$ROOT/deploy/tx/k7c-preflight.sh"
sync="$ROOT/deploy/tx/k7c-sync-runtime-content.sh"
deploy="$ROOT/deploy/tx/deploy.sh"
caddy_compose="$ROOT/deploy/tx/caddy.compose.yml"

[ -f "$preflight" ] || { echo "missing K7C preflight" >&2; exit 1; }
[ -f "$sync" ] || { echo "missing K7C runtime sync" >&2; exit 1; }

# Preflight is read-only. Runtime mutation is isolated in the explicit TX2 sync step.
if grep -Eq 'docker[[:space:]]+(compose[[:space:]]+)?(up|down|restart|stop|rm|pull)|(^|[[:space:]])(rsync|scp|ssh)([[:space:]]|$)' "$preflight"; then
  echo "K7C preflight must remain read-only" >&2
  exit 1
fi

grep -Fq 'TX1_FRONTEND="${TX1_FRONTEND:-http://10.20.0.1:8081}"' "$preflight"
grep -Fq 'TX2_FRONTEND="${TX2_FRONTEND:-http://10.20.0.3:8081}"' "$preflight"
# Sponsor QR 内容不再是 host runtime content（已在对象存储资产面），预检不得再比对它。
! grep -Fiq 'sponsor' "$preflight"
grep -Fq '/download/android/version.json' "$preflight"
grep -Fq 'apkUrl' "$preflight"
grep -Fq 'K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS' "$preflight"

# Historical APKs / staging evidence are deliberately not part of the cutover surface.
! grep -Fq 'compare_tree' "$preflight"
grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$sync"
grep -Fq 'runtime-content' "$sync"
grep -Fq 'apkUrl' "$sync"

# Caddy keeps an environment-selected logical endpoint so cutover and rollback
# are data changes, not Caddyfile edits.
grep -Fq 'CADDY_FRONTEND_UPSTREAM: ${CADDY_FRONTEND_UPSTREAM:-wotb-frontend:80}' "$caddy_compose"
grep -Fq 'reverse_proxy {$CADDY_FRONTEND_UPSTREAM}' "$ROOT/deploy/tx/Caddyfile"
grep -Fq '"10.20.0.1:$wg_port"|"10.20.0.3:$wg_port"' "$deploy"
grep -Fq 'validate_caddy_upstream CADDY_FRONTEND_UPSTREAM' "$deploy"

echo "K7C frontend cutover preflight contract: PASS"
