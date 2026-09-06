#!/usr/bin/env bash
# Minimal CI runtime smoke for production Prometheus/Loki/Grafana provisioning.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUFFIX="${GITHUB_RUN_ID:-local}-$$"
NETWORK="wotb-grafana-runtime-${SUFFIX}"
PROMETHEUS="wotb-grafana-prometheus-${SUFFIX}"
LOKI="wotb-grafana-loki-${SUFFIX}"
GRAFANA="wotb-grafana-${SUFFIX}"
ADMIN_USER=ci-admin
ADMIN_PASSWORD=ci-password

cleanup() {
  docker rm -f "$GRAFANA" "$LOKI" "$PROMETHEUS" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; docker logs "$GRAFANA" 2>&1 | tail -100 >&2 || true; exit 1; }
wait_http() {
  local url="$1"; shift
  for attempt in $(seq 1 30); do
    if "$@" "$url" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  fail "runtime endpoint unavailable: $url"
}
wait_json_success() {
  local url="$1"
  for attempt in $(seq 1 30); do
    if curl -fsS -u "$ADMIN_USER:$ADMIN_PASSWORD" "$url" | grep -Fq '"status":"success"'; then
      return 0
    fi
    sleep 2
  done
  fail "Grafana datasource health is not successful: $url"
}

docker network create "$NETWORK" >/dev/null
docker run -d --name "$PROMETHEUS" --network "$NETWORK" --network-alias prometheus \
  -v "$ROOT/deploy/observability/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  prom/prometheus:v2.55.1 --config.file=/etc/prometheus/prometheus.yml >/dev/null
docker run -d --name "$LOKI" --network "$NETWORK" --network-alias loki \
  -v "$ROOT/deploy/observability/loki/loki-config.yml:/etc/loki/loki-config.yml:ro" \
  grafana/loki:3.3.2 -config.file=/etc/loki/loki-config.yml >/dev/null
docker run -d --name "$GRAFANA" --network "$NETWORK" --network-alias grafana \
  -p 127.0.0.1::3000 \
  -e GF_SECURITY_ADMIN_USER="$ADMIN_USER" \
  -e GF_SECURITY_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e GF_AUTH_ANONYMOUS_ENABLED=false \
  -e GF_USERS_ALLOW_SIGN_UP=false \
  -e GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/var/lib/grafana/dashboards/wotbtools-production-overview.json \
  -v "$ROOT/deploy/observability/grafana/provisioning:/etc/grafana/provisioning:ro" \
  -v "$ROOT/deploy/observability/grafana/dashboards:/var/lib/grafana/dashboards:ro" \
  grafana/grafana:11.6.16 >/dev/null

PORT="$(docker port "$GRAFANA" 3000/tcp | sed -E 's/.*://')"
[ -n "$PORT" ] || fail "Grafana port was not published"
wait_http "http://127.0.0.1:${PORT}/api/health" curl -fsS
wait_json_success "http://127.0.0.1:${PORT}/api/datasources/uid/prometheus/health"
wait_json_success "http://127.0.0.1:${PORT}/api/datasources/uid/loki/health"

production_uid=""
for dashboard_file in "$ROOT"/deploy/observability/grafana/dashboards/*.json; do
  uid="$(grep -m1 -oE '^[[:space:]]*"uid"[[:space:]]*:[[:space:]]*"[^" ]+"' "$dashboard_file" \
    | sed -E 's/.*"uid"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  [ -n "$uid" ] || fail "dashboard has no uid: $dashboard_file"
  [ "$(basename "$dashboard_file")" = "wotbtools-production-overview.json" ] && production_uid="$uid"
  response="$(curl -fsS -u "$ADMIN_USER:$ADMIN_PASSWORD" \
    "http://127.0.0.1:${PORT}/api/dashboards/uid/${uid}")" || fail "dashboard API fetch failed: $uid"
  grep -Fq '"dashboard"' <<<"$response" || fail "dashboard was not provisioned: $uid"
done
[ -n "$production_uid" ] || fail "production overview dashboard missing"
curl -fsS -u "$ADMIN_USER:$ADMIN_PASSWORD" \
  "http://127.0.0.1:${PORT}/api/dashboards/uid/${production_uid}" >/dev/null \
  || fail "production overview dashboard API fetch failed"
if docker logs "$GRAFANA" 2>&1 | grep -Eiq 'provisioning.*(error|fail)|((error|fail).*)provisioning'; then
  fail "Grafana provisioning emitted an error"
fi
echo "OK: Grafana health, datasource health, default-home file and all dashboard UIDs"
