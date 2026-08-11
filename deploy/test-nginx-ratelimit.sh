#!/usr/bin/env bash
# Rate-limit real-IP smoke test (CI-safe, docker required):
#   1) nginx -t on the production config;
#   2) run a test nginx (prod config but trusting every source so the container
#      test can drive X-Forwarded-For; prod trusts only 127.0.0.1 / ::1) and verify:
#      - two different client IPs use separate rate-limit buckets;
#      - the same client IP exceeding the burst is rejected with 429;
#      - a request without X-Forwarded-For is not throttled by the XFF buckets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$ROOT/deploy/nginx/nginx.conf"
TEST_CFG="$ROOT/deploy/nginx/nginx.ratelimit-test.conf"
CONTAINER=wotb-nginx-ratelimit-test

cleanup() {
  rm -f "$TEST_CFG"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1) production config syntax check
docker run --rm --add-host grafana:127.0.0.1 --add-host keycloak:127.0.0.1 --add-host wotb-backend:127.0.0.1 \
  -v "$CFG:/etc/nginx/conf.d/default.conf:ro" --entrypoint nginx nginx:alpine -t

# prod must trust only the host loopback (Caddy source), so spoofed XFF cannot
# bypass the limiter from other sources.
grep -q 'set_real_ip_from 127.0.0.1;' "$CFG" || { echo "FAIL: prod config must trust 127.0.0.1" >&2; exit 1; }
grep -q 'set_real_ip_from ::1;' "$CFG" || { echo "FAIL: prod config must trust ::1" >&2; exit 1; }

# 2) test config: same as prod but trust every source for the container sandbox
sed -e 's/^\( *\)set_real_ip_from 127\.0\.0\.1;/\1set_real_ip_from 0.0.0.0\/0;/' \
    -e '/set_real_ip_from ::1;/d' "$CFG" > "$TEST_CFG"

docker run -d --name "$CONTAINER" \
  --add-host grafana:127.0.0.1 --add-host keycloak:127.0.0.1 --add-host wotb-backend:127.0.0.1 \
  -v "$TEST_CFG:/etc/nginx/conf.d/default.conf:ro" -p 18080:80 nginx:alpine >/dev/null

for i in $(seq 1 30); do
  if docker exec "$CONTAINER" nginx -t >/dev/null 2>&1 \
     && curl -s -o /dev/null -H 'Host: wotbtools.com' http://127.0.0.1:18080/api/preview; then
    break
  fi
  sleep 1
done

code() { curl -s -o /dev/null -w '%{http_code}' -H 'Host: wotbtools.com' -H "X-Forwarded-For: $1" "http://127.0.0.1:18080/$2"; }

# client A first request passes the limiter (backend unreachable -> 502, not 429)
a1="$(code 1.1.1.1 api/preview)"
[[ "$a1" != "429" ]] || { echo "FAIL: client A throttled on first request ($a1)" >&2; exit 1; }

# client A exceeds burst -> 429
statuses=""
for i in $(seq 1 15); do statuses="$statuses $(code 1.1.1.1 api/preview)"; done
grep -q '429' <<<"$statuses" || { echo "FAIL: client A never got 429 after burst ($statuses)" >&2; exit 1; }

# client B (different IP) starts a fresh bucket -> not 429
b1="$(code 2.2.2.2 api/preview)"
[[ "$b1" != "429" ]] || { echo "FAIL: client B shares the throttled bucket with A ($b1)" >&2; exit 1; }

# no X-Forwarded-For -> own source-address bucket, not throttled
n1="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: wotbtools.com' http://127.0.0.1:18080/api/preview)"
[[ "$n1" != "429" ]] || { echo "FAIL: no-XFF request shares the throttled bucket ($n1)" >&2; exit 1; }

echo "OK: nginx -t passed; two client IPs use separate rate-limit buckets; burst yields 429"
