#!/usr/bin/env bash
# Promote the staged Komodo Compose runtime onto the Yecao host.
#
# Owns the Docker Compose half of the controller transaction: staged-runtime
# validation, image pull, live Compose promotion, and the Compose mutation.
# `reconcile.sh` owns the OpenTofu half and calls this under the host lock.
set -Eeuo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$script_dir/lib.sh" && ! -L "$script_dir/lib.sh" ]] || {
  echo 'Komodo controller helper library is missing or unsafe.' >&2
  exit 1
}
# shellcheck source=deploy/komodo/lib.sh
source "$script_dir/lib.sh"

SOURCE_SHA="${1:?usage: deploy.sh <source-sha> <staged-runtime-dir>}"
STAGED_RUNTIME="${2:?usage: deploy.sh <source-sha> <staged-runtime-dir>}"
root=/opt/komodo
live_compose="$root/compose.yml"
wireguard_address=10.20.0.2

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Komodo source SHA.' >&2; exit 2; }
[[ -f "$STAGED_RUNTIME/compose.yml" && ! -L "$STAGED_RUNTIME/compose.yml" ]] || {
  echo 'Staged Komodo Compose file is missing or unsafe.' >&2
  exit 1
}
for name in KOMODO_DATABASE_PASSWORD KOMODO_INIT_ADMIN_PASSWORD KOMODO_JWT_SECRET KOMODO_WEBHOOK_SECRET; do
  test -n "$(printenv "$name")" || { echo "$name is required." >&2; exit 2; }
done
for command_name in docker ip; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 2; }
done
docker compose version >/dev/null

# Fail closed when Yecao does not own the WireGuard address: publishing Core on a
# missing address would either fail or land on a different interface.
ip -4 addr show | grep -F "$wireguard_address/" >/dev/null || {
  echo "Yecao WireGuard address $wireguard_address is unavailable." >&2
  exit 1
}

require_real_dir "$root"

# The controller lock spans Compose promotion and the whole OpenTofu
# transaction. `reconcile.sh` acquires it once and passes the descriptor down so
# the two halves can never interleave with another controller mutation.
if [[ -n "${KOMODO_DEPLOY_LOCK_FD:-}" ]]; then
  [[ "$KOMODO_DEPLOY_LOCK_FD" == 9 ]] || { echo 'Unsupported inherited Komodo lock fd.' >&2; exit 2; }
  { true >&9; } 2>/dev/null || { echo 'Inherited Komodo lock fd is unavailable.' >&2; exit 1; }
else
  exec 9>"$root/.deploy.lock"
fi
flock -n 9 || { echo 'Another Komodo controller mutation is running.' >&2; exit 1; }

require_real_dir "$root/backups"

# Validate and pull before touching the live runtime, so a broken rendering or an
# unavailable image can never replace the running controller configuration.
docker compose -p komodo -f "$STAGED_RUNTIME/compose.yml" config --quiet
docker compose -p komodo -f "$STAGED_RUNTIME/compose.yml" pull

tmp="$root/compose.yml.incoming.$SOURCE_SHA"
install -m 600 "$STAGED_RUNTIME/compose.yml" "$tmp"
mv -f -- "$tmp" "$live_compose"

docker compose -p komodo -f "$live_compose" up -d --remove-orphans
