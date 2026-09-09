#!/usr/bin/env bash
# Regression test for the production Grafana upstream refresh contract.
#
# A frontend nginx process resolves the literal grafana service name when it
# starts. Recreating Grafana must therefore be followed by a frontend restart
# (or equivalent reload) before the public monitor route is considered healthy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
  docker inspect "$OLD_GRAFANA" "$NEW_GRAFANA" \
    --format '{{.Name}} status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}' \
    2>/dev/null || true
  docker logs "$OLD_GRAFANA" "$NEW_GRAFANA" 2>&1 || true
  docker network inspect "$NETWORK" 2>&1 || true
}

docker network create --driver bridge --subnet 172.29.0.0/16 --gateway 172.29.0.1 "$NETWORK" >/dev/null

start_grafana_stub() {
  local name="$1" ip="$2" marker="$3"
  docker run -d --name "$name" --network bridge \
    alpine:3.22 sh -c \
    "mkdir -p /www/api; printf '{\"database\":\"ok\",\"marker\":\"$marker\"}\\n' > /www/api/health; exec busybox httpd -f -p 3000 -h /www" \
    >/dev/null
  docker network connect --ip "$ip" --alias grafana --alias wotb-backend --alias keycloak \
    "$NETWORK" "$name"
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
  echo "FAIL: Docker DNS did not publish the grafana alias" >&2
  return 1
}

start_grafana_stub "$OLD_GRAFANA" 172.29.0.10 old
wait_for_grafana_dns
docker run -d --name "$NGINX" --network "$NETWORK" -p "127.0.0.1:${PORT}:80" \
  --add-host wotb-backend:172.29.0.10 --add-host keycloak:172.29.0.10 \
  -v "$CFG:/etc/nginx/conf.d/default.conf:ro" nginx:alpine >/dev/null

for i in $(seq 1 30); do
  if docker exec "$NGINX" nginx -t >/dev/null 2>&1 \
      && curl -fsS -H 'Host: monitor.wotbtools.com' \
      "http://127.0.0.1:${PORT}/api/health" | grep -Fq '"marker":"old"'; then
    break
  fi
  [ "$i" -lt 30 ] && sleep 1
done

curl -fsS -H 'Host: monitor.wotbtools.com' "http://127.0.0.1:${PORT}/api/health" \
  | grep -Fq '"marker":"old"' \
  || { nginx_diagnostics; echo "FAIL: frontend nginx did not reach the initial Grafana stub" >&2; exit 1; }

# Recreate Grafana at a different address. The still-running nginx process must
# not be considered healthy until its upstream resolution is refreshed.
docker rm -f "$OLD_GRAFANA" >/dev/null
start_grafana_stub "$NEW_GRAFANA" 172.29.0.11 new
wait_for_grafana_dns
if curl -fsS -H 'Host: monitor.wotbtools.com' "http://127.0.0.1:${PORT}/api/health" \
    | grep -Fq '"marker":"new"'; then
  echo "FAIL: nginx followed a recreated Grafana without the required refresh" >&2
  exit 1
fi

docker restart "$NGINX" >/dev/null
for i in $(seq 1 30); do
  if curl -fsS -H 'Host: monitor.wotbtools.com' \
      "http://127.0.0.1:${PORT}/api/health" | grep -Fq '"marker":"new"'; then
    break
  fi
  [ "$i" -lt 30 ] && sleep 1
done

curl -fsS -H 'Host: monitor.wotbtools.com' "http://127.0.0.1:${PORT}/api/health" \
  | grep -Fq '"marker":"new"' \
  || { echo "FAIL: refreshed frontend nginx did not reach recreated Grafana" >&2; exit 1; }

grep -q 'proxy_http_version 1.1;' "$CFG" \
  || { echo "FAIL: Grafana proxy must keep HTTP/1.1 for Live WebSocket" >&2; exit 1; }
grep -q 'proxy_set_header Upgrade \$http_upgrade;' "$CFG" \
  || { echo "FAIL: Grafana proxy must preserve WebSocket Upgrade" >&2; exit 1; }
grep -q 'proxy_set_header Connection "upgrade";' "$CFG" \
  || { echo "FAIL: Grafana proxy must preserve WebSocket Connection" >&2; exit 1; }

echo "OK: Grafana recreate requires and passes frontend nginx refresh; monitor proxy and WebSocket directives remain intact"
