#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_SHA="${1:?usage: deploy.sh <source-sha> <staged-runtime-dir>}"
STAGED_RUNTIME="${2:?usage: deploy.sh <source-sha> <staged-runtime-dir>}"
ROOT=/opt/komodo
LIVE_COMPOSE="$ROOT/compose.yml"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Komodo source SHA.' >&2; exit 2; }
[[ -d "$ROOT" && ! -L "$ROOT" ]] || install -d -m 700 "$ROOT"
[[ -f "$STAGED_RUNTIME/compose.yml" && ! -L "$STAGED_RUNTIME/compose.yml" ]] || {
  echo 'Staged Komodo Compose file is missing or unsafe.' >&2
  exit 1
}
for name in KOMODO_DATABASE_PASSWORD KOMODO_INIT_ADMIN_PASSWORD KOMODO_JWT_SECRET KOMODO_WEBHOOK_SECRET; do
  test -n "$(printenv "$name")" || { echo "$name is required." >&2; exit 2; }
done
command -v docker >/dev/null
docker compose version >/dev/null
ip -4 addr show | grep -F '10.20.0.2/' >/dev/null || {
  echo 'Yecao WireGuard address 10.20.0.2 is unavailable.' >&2
  exit 1
}

if [[ -n "${KOMODO_DEPLOY_LOCK_FD:-}" ]]; then
  [[ "$KOMODO_DEPLOY_LOCK_FD" == 9 ]] || { echo 'Unsupported inherited Komodo lock fd.' >&2; exit 2; }
  { true >&9; } 2>/dev/null || { echo 'Inherited Komodo lock fd is unavailable.' >&2; exit 1; }
  flock -n 9 || { echo 'Another Komodo controller mutation is running.' >&2; exit 1; }
else
  exec 9>"$ROOT/.deploy.lock"
  flock -n 9 || { echo 'Another Komodo controller mutation is running.' >&2; exit 1; }
fi

install -d -m 700 "$ROOT/backups"
docker compose -p komodo -f "$STAGED_RUNTIME/compose.yml" config --quiet
docker compose -p komodo -f "$STAGED_RUNTIME/compose.yml" pull

tmp="$ROOT/compose.yml.incoming.$SOURCE_SHA"
install -m 600 "$STAGED_RUNTIME/compose.yml" "$tmp"
mv -f -- "$tmp" "$LIVE_COMPOSE"
printf '%s
' "$SOURCE_SHA" > "$ROOT/source-sha"
chmod 600 "$ROOT/source-sha"

docker compose -p komodo -f "$LIVE_COMPOSE" up -d --remove-orphans
