#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$ROOT/deploy/nginx/nginx.conf"
NETWORK=wotb-nginx-real-ip-net
CONTAINER=wotb-nginx-real-ip-test
PUB_PORT=18080

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm --add-host grafana:127.0.0.1 --add-host keycloak:127.0.0.1 --add-host wotb-backend:127.0.0.1 \
  -v "$CFG:/etc/nginx/conf.d/default.conf:ro" --entrypoint nginx nginx:alpine -t

grep -q 'set_real_ip_from 172.28.0.1;' "$CFG" \
  || { echo "FAIL: prod config must trust the pinned compose gateway 172.28.0.1" >&2; exit 1; }
grep -q 'set_real_ip_from 0.0.0.0/0;' "$CFG" \
  && { echo "FAIL: prod config must not trust all sources" >&2; exit 1; }
if grep -q 'submissions/wargaming' "$CFG"; then
  echo "FAIL: retired WG hundred-battle endpoint must not be present" >&2
  exit 1
fi
trust_count="$(grep -c 'set_real_ip_from ' "$CFG")"
[[ "$trust_count" == "1" ]] \
  || { echo "FAIL: prod config must trust exactly one source (found $trust_count)" >&2; exit 1; }

docker network rm "$NETWORK" >/dev/null 2>&1 || true
for stale_network in wotb_tx_internal deploy_default; do
  docker network rm "$stale_network" >/dev/null 2>&1 || true
done
docker network create --driver bridge --subnet 172.28.0.0/16 --gateway 172.28.0.1 "$NETWORK" >/dev/null

docker run -d --name "$CONTAINER" --network "$NETWORK" \
  --add-host grafana:127.0.0.1 --add-host keycloak:127.0.0.1 --add-host wotb-backend:127.0.0.1 \
  -v "$CFG:/etc/nginx/conf.d/default.conf:ro" -p "127.0.0.1:$PUB_PORT:80" nginx:alpine >/dev/null

for i in $(seq 1 30); do
  if docker exec "$CONTAINER" nginx -t >/dev/null 2>&1 \
     && curl -s -o /dev/null -H 'Host: wotbtools.com' "http://127.0.0.1:$PUB_PORT/api/health"; then
    break
  fi
  sleep 1
done

logged_client() {
  docker logs "$CONTAINER" 2>&1 | grep "$1" \
    | awk '{print $1}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -n 1
}

marker="direct-${RANDOM}-$$"
curl -s -o /dev/null -H 'Host: wotbtools.com' "http://127.0.0.1:$PUB_PORT/api/health?$marker"
sleep 1
observed="$(logged_client "$marker")"
[[ "$observed" == "172.28.0.1" ]] \
  || { echo "FAIL: observed host source $observed != trusted gateway 172.28.0.1" >&2; exit 1; }

marker="trusted-${RANDOM}-$$"
curl -s -o /dev/null -H 'Host: wotbtools.com' -H 'X-Forwarded-For: 1.1.1.1' \
  "http://127.0.0.1:$PUB_PORT/api/health?$marker"
sleep 1
observed="$(logged_client "$marker")"
[[ "$observed" == "1.1.1.1" ]] \
  || { echo "FAIL: trusted X-Forwarded-For was not applied (logged $observed)" >&2; exit 1; }

marker="untrusted-${RANDOM}-$$"
docker run --rm --network "$NETWORK" nginx:alpine wget -qO- \
  --header 'Host: wotbtools.com' \
  --header 'X-Forwarded-For: 1.1.1.1' \
  "http://$CONTAINER/api/health?$marker" >/dev/null 2>&1 || true
sleep 1
observed="$(logged_client "$marker")"
if [[ -z "$observed" || "$observed" == "1.1.1.1" || "$observed" == "172.28.0.1" ]]; then
  echo "FAIL: untrusted source was able to forge its client address (logged '$observed')" >&2
  exit 1
fi

echo "OK: nginx -t passed; trusted gateway 172.28.0.1 is the only real-IP source; untrusted XFF ignored"
