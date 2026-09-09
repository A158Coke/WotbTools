#!/usr/bin/env bash
# Regression test for the production Grafana upstream refresh contract.
#
# A frontend nginx process must not require Grafana to exist while nginx starts.
# The monitor upstream is resolved through Docker embedded DNS at request time,
# so Grafana failure remains isolated to monitor traffic.
set -euo pipefail

if [ -n "${WOTB_TEST_ROOT:-}" ]; then
  ROOT="$WOTB_TEST_ROOT"
else
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
CFG="$ROOT/deploy/nginx/nginx.conf"
NETWORK="wotb-nginx-grafana-recreate-${RANDOM}-$$"
NGINX="wotb-nginx-grafana-nginx-${RANDOM}-$$"
OLD_GRAFANA="wotb-nginx-grafana-old-${RANDOM}-$$"
NEW_GRAFANA="wotb-nginx-grafana-new-${RANDOM}-$$"
PORT="${WOTB_NGINX_GRAFANA_TEST_PORT:-18082}"

cleanup() {
  docker rm -f "$NGINX" "$OLD_GRAFANA" "$NEW_GRAFANA" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

nginx_diagnostics() {
  docker inspect "$NGINX" --format 'nginx status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}' \
    2>/dev/null || true
  docker logs "$NGINX" 2>&1 || true
}

grafana_diagnostics() {
  local container
  for container in "$OLD_GRAFANA" "$NEW_GRAFANA"; do
    docker inspect "$container" \
      --format '{{.Name}} status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}' \
      2>/dev/null || true
    docker logs "$container" 2>&1 || true
  done
  docker network inspect "$NETWORK" 2>&1 || true
}

docker network create --driver bridge --subnet 172.29.0.0/16 --gateway 172.29.0.1 "$NETWORK" >/dev/null

start_grafana_stub() {
  local name="$1" ip="$2" marker="$3"
  docker create --name "$name" python:3.12-alpine sh -c \
    "mkdir -p /www/api; printf '{\"database\":\"ok\",\"marker\":\"$marker\"}\\n' > /www/api/health; exec python -m http.server 3000 --directory /www" \
    >/dev/null
  docker network connect --ip "$ip" --alias grafana --alias wotb-backend --alias keycloak \
    "$NETWORK" "$name"
  docker start "$name" >/dev/null
}

wait_for_grafana_dns() {
  for i in $(seq 1 30); do
    if docker run --rm --network "$NETWORK" alpine:3.22 \
        wget -qO- http://grafana:3000/api/health \
        >/dev/null 2>&1; then
      return 0
    fi
    [ "$i" -lt 30 ] && sleep 1
  done
  grafana_diagnostics
  echo "FAIL: Grafana alias did not resolve to a healthy HTTP stub" >&2
  return 1
}

assert_monitor_health() {
  local marker="$1" body_file status
  body_file="$(mktemp)"
  if ! status="$(curl --connect-timeout 2 --max-time 5 -sS \
      -H 'Host: monitor.wotbtools.com' \
      -o "$body_file" -w '%{http_code}' \
      "http://127.0.0.1:${PORT}/api/health")"; then
    rm -f -- "$body_file"
    return 1
  fi
  if [ "$status" != 200 ] \
      || ! grep -Fq '"database":"ok"' "$body_file" \
      || ! grep -Fq "\"marker\":\"$marker\"" "$body_file"; then
    rm -f -- "$body_file"
    return 1
  fi
  rm -f -- "$body_file"
}

docker run -d --name "$NGINX" --network "$NETWORK" -p "127.0.0.1:${PORT}:80" \
  --add-host wotb-backend:172.29.0.10 --add-host keycloak:172.29.0.10 \
  -v "$CFG:/etc/nginx/conf.d/default.conf:ro" nginx:alpine >/dev/null

# The frontend nginx must start successfully while Grafana is absent. A
# request to the monitor host is allowed to be a temporary 502 at this point.
docker exec "$NGINX" nginx -t >/dev/null 2>&1 \
  || { nginx_diagnostics; echo "FAIL: nginx could not start without Grafana" >&2; exit 1; }
docker inspect "$NGINX" --format '{{.State.Status}}' | grep -Fxq running \
  || { nginx_diagnostics; echo "FAIL: nginx is not running without Grafana" >&2; exit 1; }

start_grafana_stub "$OLD_GRAFANA" 172.29.0.10 old
wait_for_grafana_dns

for i in $(seq 1 30); do
  if docker exec "$NGINX" nginx -t >/dev/null 2>&1 \
      && assert_monitor_health old; then
    break
  fi
  [ "$i" -lt 30 ] && sleep 1
done

assert_monitor_health old \
  || { nginx_diagnostics; echo "FAIL: monitor proxy did not return HTTP 200/database=ok for the initial Grafana container" >&2; exit 1; }

# Recreate Grafana at a different address. The still-running nginx process must
# discover the new address through runtime Docker DNS without a restart.
docker rm -f "$OLD_GRAFANA" >/dev/null
start_grafana_stub "$NEW_GRAFANA" 172.29.0.11 new
wait_for_grafana_dns
for i in $(seq 1 30); do
  if assert_monitor_health new; then
    break
  fi
  [ "$i" -lt 30 ] && sleep 1
done

assert_monitor_health new \
  || { echo "FAIL: recreated Grafana monitor proxy did not return HTTP 200/database=ok without frontend restart" >&2; exit 1; }

grep -q 'resolver 127.0.0.11 valid=1s ipv6=off;' "$CFG" \
  || { echo "FAIL: Grafana proxy must use Docker runtime DNS" >&2; exit 1; }
grep -q 'set \$grafana_upstream grafana:3000;' "$CFG" \
  || { echo "FAIL: Grafana proxy must use a runtime upstream variable" >&2; exit 1; }
grep -q 'proxy_pass http://\$grafana_upstream;' "$CFG" \
  || { echo "FAIL: Grafana proxy must not resolve the upstream at nginx startup" >&2; exit 1; }
grep -q 'proxy_http_version 1.1;' "$CFG" \
  || { echo "FAIL: Grafana proxy must keep HTTP/1.1 for Live WebSocket" >&2; exit 1; }
grep -q 'proxy_set_header Upgrade \$http_upgrade;' "$CFG" \
  || { echo "FAIL: Grafana proxy must preserve WebSocket Upgrade" >&2; exit 1; }
grep -q 'proxy_set_header Connection "upgrade";' "$CFG" \
  || { echo "FAIL: Grafana proxy must preserve WebSocket Connection" >&2; exit 1; }

echo "OK: nginx starts without Grafana and follows recreated Grafana through runtime DNS; WebSocket directives remain intact"
