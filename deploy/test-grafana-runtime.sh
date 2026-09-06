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
TRACE_DIR="$(mktemp -d)"
TRACE_FILE=/tmp/grafana-api-trace/request-url

cleanup() {
  docker rm -f "$GRAFANA" "$LOKI" "$PROMETHEUS" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -rf "$TRACE_DIR"
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
  local url="$1" body
  for attempt in $(seq 1 30); do
    if body="$(curl -fsS -u "$ADMIN_USER:$ADMIN_PASSWORD" "$url" 2>/dev/null)" \
      && grep -Eq '"status"[[:space:]]*:[[:space:]]*"OK"' <<<"$body"; then
      return 0
    fi
    sleep 2
  done
  fail "Grafana datasource health is not successful: $url"
}

alpine_grafana_api() {
  local user="$1" password="$2" path="$3"
  docker run --rm --network "$NETWORK" \
    -v "$ROOT/deploy/grafana-api-request.sh:/usr/local/bin/grafana-api-request.sh:ro" \
    -v "$TRACE_DIR:/tmp/grafana-api-trace" \
    -e GRAFANA_VERIFY_USER="$user" \
    -e GRAFANA_VERIFY_PASSWORD="$password" \
    -e GRAFANA_API_TRACE_FILE="$TRACE_FILE" \
    alpine:3.22 sh /usr/local/bin/grafana-api-request.sh "$path"
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

for datasource_uid in prometheus loki; do
  body="$(alpine_grafana_api "$ADMIN_USER" "$ADMIN_PASSWORD" "/api/datasources/uid/${datasource_uid}/health")" \
    || fail "Alpine/BusyBox Grafana auth failed for datasource: $datasource_uid"
  grep -Eq '"status"[[:space:]]*:[[:space:]]*"OK"' <<<"$body" \
    || fail "Grafana datasource status is not exactly OK: $datasource_uid"
  if [ "$datasource_uid" = prometheus ]; then
    [ "$(cat "$TRACE_DIR/request-url")" = "http://grafana:3000/api/datasources/uid/prometheus/health" ] \
      || fail "production Grafana API path handling changed the requested URL"
    ! grep -Fq 'http://grafana:3000http://grafana:3000' "$TRACE_DIR/request-url" \
      || fail "production Grafana API request contains a double URL prefix"
  fi
done
dashboard_body="$(alpine_grafana_api "$ADMIN_USER" "$ADMIN_PASSWORD" "/api/dashboards/uid/wotbtools-production-overview")" \
  || fail "Alpine/BusyBox Grafana auth failed for dashboard API"
grep -Fq '"dashboard"' <<<"$dashboard_body" \
  || fail "Alpine/BusyBox dashboard API response was not valid"
if alpine_grafana_api wrong-user wrong-password "/api/datasources/uid/prometheus/health" >/dev/null 2>&1; then
  fail "Grafana accepted wrong credentials in Alpine/BusyBox auth path"
fi

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
