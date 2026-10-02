#!/usr/bin/env bash
# Real-IP trust smoke test (CI-safe, docker required).
#
# Simulates the real production chain:
#   host curl/Caddy -> 127.0.0.1 published port (loopback-bound Docker port)
#   -> frontend nginx container on a user-defined bridge network pinned to the
#      SAME subnet/gateway as deploy/docker-compose.prod.yml
#      (172.28.0.0/16, gateway 172.28.0.1).
#
# Uses the UNMODIFIED production nginx config (no sed, no 0.0.0.0/0) and asserts:
#   1. nginx -t passes and the config trusts exactly the pinned gateway;
#   2. the source address nginx observes from the host is that trusted gateway;
#   3. X-Forwarded-For from the trusted gateway becomes the logged client address;
#   4. an untrusted source (another container on the same network, IP != gateway)
#      forging X-Forwarded-For is logged under its own address.
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

# 0) production config syntax check
docker run --rm --add-host grafana:127.0.0.1 --add-host keycloak:127.0.0.1 --add-host wotb-backend:127.0.0.1 \
  -v "$CFG:/etc/nginx/conf.d/default.conf:ro" --entrypoint nginx nginx:alpine -t

# prod must trust exactly the pinned compose gateway, never an arbitrary source.
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

# 1) recreate the pinned production network topology (same subnet/gateway)
docker network rm "$NETWORK" >/dev/null 2>&1 || true
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

# Access-log lines start with the client address; error-log lines start with a
# date (e.g. 2026/08/13) and also mention the request, so only the IP-shaped
# first field is taken.
logged_client() {
  docker logs "$CONTAINER" 2>&1 | grep "$1" \
    | awk '{print $1}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -n 1
}

# 2) the source nginx observes from the host must be the trusted gateway.
marker="direct-${RANDOM}-$$"
curl -s -o /dev/null -H 'Host: wotbtools.com' "http://127.0.0.1:$PUB_PORT/api/health?$marker"
sleep 1
observed="$(logged_client "$marker")"
[[ "$observed" == "172.28.0.1" ]] \
  || { echo "FAIL: observed host source $observed != trusted gateway 172.28.0.1" >&2; exit 1; }

# 3) X-Forwarded-For from the trusted gateway is honoured.
marker="trusted-${RANDOM}-$$"
curl -s -o /dev/null -H 'Host: wotbtools.com' -H 'X-Forwarded-For: 1.1.1.1' \
  "http://127.0.0.1:$PUB_PORT/api/health?$marker"
sleep 1
observed="$(logged_client "$marker")"
[[ "$observed" == "1.1.1.1" ]] \
  || { echo "FAIL: trusted X-Forwarded-For was not applied (logged $observed)" >&2; exit 1; }

# 4) an untrusted source forging X-Forwarded-For keeps its own address.
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
