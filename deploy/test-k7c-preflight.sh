#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
preflight="$ROOT/deploy/tx/k7c-preflight.sh"
deploy="$ROOT/deploy/tx/deploy.sh"
caddy_compose="$ROOT/deploy/tx/caddy.compose.yml"

[ -f "$preflight" ] || { echo "missing K7C preflight" >&2; exit 1; }

# K7C audit must remain read-only: it may observe Docker and HTTP state but never
# reconcile containers, copy runtime content, or switch Caddy.
if grep -Eq 'docker[[:space:]]+(compose[[:space:]]+)?(up|down|restart|stop|rm|pull)|(^|[[:space:]])(rsync|scp|ssh)([[:space:]]|$)' "$preflight"; then
  echo "K7C preflight must remain read-only" >&2
  exit 1
fi

grep -Fq 'TX1_FRONTEND="${TX1_FRONTEND:-http://10.20.0.1:8081}"' "$preflight"
grep -Fq 'TX2_FRONTEND="${TX2_FRONTEND:-http://10.20.0.3:8081}"' "$preflight"
grep -Fq 'compare_runtime_file' "$preflight"
grep -Fq 'compare_tree' "$preflight"
grep -Fq 'sponsor-config.json' "$preflight"
grep -Fq '/sponsor-assets' "$preflight"
grep -Fq '/download/android/version.json' "$preflight"
grep -Fq 'K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS' "$preflight"

# Caddy keeps an environment-selected logical endpoint so cutover and rollback
# are data changes, not Caddyfile edits.
grep -Fq 'CADDY_FRONTEND_UPSTREAM: ${CADDY_FRONTEND_UPSTREAM:-wotb-frontend:80}' "$caddy_compose"
grep -Fq 'reverse_proxy {$CADDY_FRONTEND_UPSTREAM}' "$ROOT/deploy/tx/Caddyfile"

# The production deploy guard must accept exactly the reviewed TX WireGuard
# addresses, preserving both forward cutover and rollback.
grep -Fq '"10.20.0.1:$wg_port"|"10.20.0.3:$wg_port"' "$deploy"
grep -Fq 'validate_caddy_upstream CADDY_FRONTEND_UPSTREAM' "$deploy"

echo "K7C frontend cutover preflight contract: PASS"
