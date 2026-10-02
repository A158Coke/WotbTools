#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/komodo
COMPOSE="$ROOT/compose.yml"
[[ -f "$COMPOSE" && ! -L "$COMPOSE" ]] || { echo 'Komodo live Compose file is unavailable.' >&2; exit 1; }

for service in mongo core; do
  id="$(docker compose -p komodo -f "$COMPOSE" ps -q "$service")"
  test -n "$id" || { echo "Komodo $service container is missing." >&2; exit 1; }
  state="$(docker inspect --format '{{.State.Status}}' "$id")"
  [[ "$state" == running ]] || {
    docker compose -p komodo -f "$COMPOSE" logs --tail 120 "$service" >&2 || true
    echo "Komodo $service is not running: $state" >&2
    exit 1
  }
done

ready=false
for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 5 http://10.20.0.2:9120/ >/dev/null; then
    ready=true
    break
  fi
  [[ "$attempt" -lt 60 ]] && sleep 2
done
[[ "$ready" == true ]] || {
  docker compose -p komodo -f "$COMPOSE" logs --tail 160 core >&2 || true
  echo 'Komodo Core did not become reachable on the Yecao WireGuard bind.' >&2
  exit 1
}

listen="$(docker port "$(docker compose -p komodo -f "$COMPOSE" ps -q core)" 9120/tcp)"
[[ "$listen" == 10.20.0.2:9120 ]] || {
  echo "Unexpected Komodo Core host bind: $listen" >&2
  exit 1
}
echo 'Komodo private controller health: PASS'
