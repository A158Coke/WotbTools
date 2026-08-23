#!/usr/bin/env bash
# Rate-limit real-IP smoke test (CI-safe, docker required).
#
# Simulates the real production chain:
#   host curl/Caddy -> 127.0.0.1 published port (loopback-bound Docker port)
#   -> frontend nginx container on a user-defined bridge network pinned to the
#      SAME subnet/gateway as deploy/docker-compose.prod.yml
#      (172.28.0.0/16, gateway 172.28.0.1).
#
# Uses the UNMODIFIED production nginx config (no sed, no 0.0.0.0/0) and asserts:
#   1. the source address nginx actually observes from the host matches the
#      trusted source (the pinned compose gateway 172.28.0.1);
#   2. two different X-Forwarded-For clients use separate rate-limit buckets;
#   3. the same client exceeding the burst is rejected with 429;
#   4. an untrusted source (another container on the same network, IP != gateway)
#      forging X-Forwarded-For cannot select the throttled bucket;
#   5. nginx -t passes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$ROOT/deploy/nginx/nginx.conf"
NETWORK=wotb-nginx-ratelimit-net
CONTAINER=wotb-nginx-ratelimit-test
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
grep -q 'location = /api/hof/hundred/submissions/wargaming {' "$CFG" \
  || { echo "FAIL: WG hundred-battle verification endpoint must have an exact rate-limited location" >&2; exit 1; }
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
     && curl -s -o /dev/null -H 'Host: wotbtools.com' "http://127.0.0.1:$PUB_PORT/api/preview"; then
    break
  fi
  sleep 1
done

# 2) the source nginx observes from the host must be the trusted gateway.
#    A request without X-Forwarded-For leaves remote_addr unchanged; the default
#    access log records it as the first field. nginx error log 行首是日期（如 2026/08/13）
#    且同样包含 request: "GET /api/preview"（后端不可达时），因此必须只取 IP 首字段，
#    避免把 error log 行误当 access log 导致偶发失败。
curl -s -o /dev/null -H 'Host: wotbtools.com' "http://127.0.0.1:$PUB_PORT/api/preview"
sleep 1
observed="$(docker logs "$CONTAINER" 2>&1 | grep 'GET /api/preview' \
  | awk '{print $1}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -n 1)"
[[ "$observed" == "172.28.0.1" ]] \
  || { echo "FAIL: observed host source $observed != trusted gateway 172.28.0.1" >&2; exit 1; }

code() { curl -s -o /dev/null -w '%{http_code}' -H 'Host: wotbtools.com' -H "X-Forwarded-For: $1" "http://127.0.0.1:$PUB_PORT/$2"; }

# 3) client A first request passes (backend unreachable -> 502, not 429)
a1="$(code 1.1.1.1 api/preview)"
[[ "$a1" != "429" ]] || { echo "FAIL: client A throttled on first request ($a1)" >&2; exit 1; }

# 4) client A exceeds burst -> 429
statuses=""
for i in $(seq 1 15); do statuses="$statuses $(code 1.1.1.1 api/preview)"; done
grep -q '429' <<<"$statuses" || { echo "FAIL: client A never got 429 after burst ($statuses)" >&2; exit 1; }
# bucket must still be exhausted immediately after the burst
throttled_now="$(code 1.1.1.1 api/preview)"
[[ "$throttled_now" == "429" ]] || { echo "FAIL: 1.1.1.1 bucket should still be throttled ($throttled_now)" >&2; exit 1; }

# 5) client B (different IP) starts a fresh bucket -> not 429
b1="$(code 2.2.2.2 api/preview)"
[[ "$b1" != "429" ]] || { echo "FAIL: client B shares the throttled bucket with A ($b1)" >&2; exit 1; }

# 6) untrusted source (another container on the same network, IP != gateway)
#    forging X-Forwarded-For must NOT be able to select the throttled 1.1.1.1
#    bucket: real_ip is not applied to untrusted sources, so its own
#    source-address bucket is used (502 from unreachable backend, not 429).
marker="untrusted-${RANDOM}-$$"
docker run --rm --network "$NETWORK" nginx:alpine wget -qO- \
  --header 'Host: wotbtools.com' \
  --header 'X-Forwarded-For: 1.1.1.1' \
  "http://$CONTAINER/api/preview?$marker" >/dev/null 2>&1 || true
sleep 1
untrusted_line="$(docker logs "$CONTAINER" 2>&1 | grep "$marker" | tail -n 1)"
if grep -q ' 429 ' <<<"$untrusted_line"; then
  echo "FAIL: untrusted source selected the throttled bucket via forged X-Forwarded-For" >&2
  exit 1
fi

echo "OK: nginx -t passed; observed host source is trusted gateway 172.28.0.1; two client IPs use separate buckets; burst yields 429; untrusted XFF ignored"
