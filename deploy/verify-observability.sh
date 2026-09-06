#!/usr/bin/env bash
# Production observability gate. It fails closed and never prints credentials.
set -euo pipefail

readonly RETRIES="${WOTB_OBSERVABILITY_RETRIES:-20}"
readonly INTERVAL_SEC="${WOTB_OBSERVABILITY_INTERVAL_SEC:-3}"
readonly DASHBOARD_DIR="${WOTB_DASHBOARD_DIR:-deploy/observability/grafana/dashboards}"
if [[ ! "$RETRIES" =~ ^[1-9][0-9]*$ || ! "$INTERVAL_SEC" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: observability retry settings must be positive integers." >&2
  exit 2
fi

fail() { echo "OBSERVABILITY FAIL: $*" >&2; exit 1; }
compose_exec() { docker compose exec -T wotb-backend wget -qO- "$1"; }
frontend_exec() { docker compose exec -T wotb-frontend wget -qO- "$1"; }
grafana_api() {
  docker compose exec -T \
    -e GRAFANA_VERIFY_USER="$GRAFANA_ADMIN_USER" \
    -e GRAFANA_VERIFY_PASSWORD="$GRAFANA_ADMIN_PASSWORD" \
    wotb-backend sh -c '
      token="$(printf "%s:%s" "$GRAFANA_VERIFY_USER" "$GRAFANA_VERIFY_PASSWORD" | base64 | tr -d "\\r\\n")"
      wget --header="Authorization: Basic $token" -qO- "http://grafana:3000$1"
    ' _ "http://grafana:3000$1"
}

wait_for_http() {
  local name="$1" url="$2" body="" attempt needle
  shift 2
  for attempt in $(seq 1 "$RETRIES"); do
    if body="$(compose_exec "$url" 2>/dev/null)" && [ -n "$body" ]; then
      if [ "$#" -eq 0 ]; then echo "PASS: $name"; return 0; fi
      for needle in "$@"; do
        if ! grep -Fq "$needle" <<<"$body"; then body=""; break; fi
      done
      if [ -n "$body" ]; then echo "PASS: $name"; return 0; fi
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  done
  fail "$name did not return the expected response"
}

wait_for_grafana_api() {
  local name="$1" path="$2" body="" attempt needle
  shift 2
  for attempt in $(seq 1 "$RETRIES"); do
    if body="$(grafana_api "$path" 2>/dev/null)" && [ -n "$body" ]; then
      for needle in "$@"; do
        if ! grep -Fq "$needle" <<<"$body"; then body=""; break; fi
      done
      if [ -n "$body" ]; then echo "PASS: $name"; return 0; fi
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  done
  fail "$name did not return the expected response"
}

wait_for_grafana_datasource() {
  local name="$1" path="$2" body="" attempt
  for attempt in $(seq 1 "$RETRIES"); do
    if body="$(grafana_api "$path" 2>/dev/null)" \
      && grep -Eq '"status"[[:space:]]*:[[:space:]]*"OK"' <<<"$body"; then
      echo "PASS: $name"
      return 0
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  done
  fail "$name did not report a healthy datasource"
}

query_prometheus() {
  local query="$1" encoded
  encoded="${query// /%20}"
  encoded="${encoded//\"/%22}"
  encoded="${encoded//\{/%7B}"
  encoded="${encoded//\}/%7D}"
  encoded="${encoded//|/%7C}"
  compose_exec "http://prometheus:9090/api/v1/query?query=${encoded}"
}

prometheus_value_is_one() {
  grep -Eq '"value"[[:space:]]*:[[:space:]]*\[[^]]*,[[:space:]]*"1"[[:space:]]*\]'
}

wait_for_prometheus_target_up() {
  local job="$1" sample attempt
  for attempt in $(seq 1 "$RETRIES"); do
    if sample="$(query_prometheus "min(up{job=\"$job\"})" 2>/dev/null)" \
      && prometheus_value_is_one <<<"$sample"; then return 0; fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  done
  fail "Prometheus target is not healthy (up != 1) for job=$job"
}

echo "== Verifying observability data path =="
wait_for_http "backend metrics endpoint" \
  "http://127.0.0.1:8087/actuator/prometheus" "jvm_" "process_" "system_" "http_server_requests"
wait_for_http "backend replay and AI queue gauges" \
  "http://127.0.0.1:8087/actuator/prometheus" "wotb_replay_parse_active" "wotb_replay_parse_queue_depth" "wotb_ai_review_in_flight" "wotb_ai_review_queue_depth"
wait_for_http "backend Hikari metrics" \
  "http://127.0.0.1:8087/actuator/prometheus" "hikaricp_connections_active"
wait_for_http "keycloak metrics endpoint" "http://keycloak:9000/metrics" "process_"
wait_for_http "node exporter metrics endpoint" "http://node-exporter:9100/metrics" "node_"
wait_for_http "prometheus metrics endpoint" "http://prometheus:9090/metrics" "prometheus_"
wait_for_http "loki metrics endpoint" "http://loki:3100/metrics" "loki_"
wait_for_http "grafana metrics endpoint" "http://grafana:3000/metrics" "grafana_"
wait_for_http "grafana health endpoint" "http://grafana:3000/api/health" '"database":"ok"'

targets="$(wait_for_http "prometheus target API" "http://prometheus:9090/api/v1/targets" \
  '"status":"success"' '"job":"wotb-backend"' '"job":"keycloak"' '"job":"node-exporter"' \
  '"job":"prometheus"' '"job":"loki"' '"job":"grafana"' >/dev/null \
  && compose_exec "http://prometheus:9090/api/v1/targets")" || fail "Prometheus target API unavailable"
for job in wotb-backend keycloak node-exporter prometheus loki grafana; do
  grep -Fq "\"job\":\"$job\"" <<<"$targets" || fail "Prometheus target missing job=$job"
  wait_for_prometheus_target_up "$job"
done

echo "PASS: Prometheus required targets up (backend/keycloak/node-exporter/prometheus/loki/grafana)"

prom_query="$(query_prometheus 'min(up{job="wotb-backend"})')" || fail "Prometheus data query failed"
prometheus_value_is_one <<<"$prom_query" || fail "Prometheus backend up query is not healthy (up != 1)"
echo "PASS: Prometheus data query"

wait_for_grafana_datasource "Grafana Prometheus datasource" \
  "/api/datasources/uid/prometheus/health"
wait_for_grafana_datasource "Grafana Loki datasource" \
  "/api/datasources/uid/loki/health"

production_uid=""
for dashboard_file in "$DASHBOARD_DIR"/*.json; do
  [ -f "$dashboard_file" ] || continue
  uid="$(grep -m1 -oE '^[[:space:]]*"uid"[[:space:]]*:[[:space:]]*"[^" ]+"' "$dashboard_file" \
    | sed -E 's/.*"uid"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  [ -n "$uid" ] || fail "dashboard has no uid: $dashboard_file"
  [ "$(basename "$dashboard_file")" = "wotbtools-production-overview.json" ] && production_uid="$uid"
  wait_for_grafana_api "Grafana dashboard $(basename "$dashboard_file")" \
    "/api/dashboards/uid/$uid" '"dashboard"' "$uid"
done
[ -n "$production_uid" ] || fail "production overview dashboard file is missing"
wait_for_grafana_api "Grafana production overview home dashboard" \
  "/api/dashboards/uid/$production_uid" '"dashboard"' "$production_uid"
if docker compose logs --no-color --tail 200 grafana 2>/dev/null \
    | grep -Eiq 'provisioning.*(error|fail)|((error|fail).*)provisioning'; then
  fail "Grafana provisioning reported an error"
fi
echo "PASS: Grafana datasources and all provisioned dashboards"

canary_id="$(date +%s)-$$-${RANDOM:-0}"
backend_name="wotb-backend-observability-canary-${canary_id}"
keycloak_name="keycloak-observability-canary-${canary_id}"
backend_marker="wotb-backend-canary-${canary_id}"
keycloak_marker="wotb-keycloak-canary-${canary_id}"
frontend_apk="observability-canary-${canary_id}.apk"
canary_start_epoch="$(date +%s)"
canary_start_ns="${canary_start_epoch}000000000"
export WOTB_OBSERVABILITY_CANARY_MARKER="$backend_marker"
export WOTB_KEYCLOAK_CANARY_MARKER="$keycloak_marker"
export WOTB_FRONTEND_CANARY_APK="$frontend_apk"
cleanup_canaries() {
  docker rm -f "$backend_name" "$keycloak_name" >/dev/null 2>&1 || true
}
trap cleanup_canaries EXIT

docker compose run -d --no-deps --name "$backend_name" wotb-backend \
  sh -c "printf '%s\\n' '$backend_marker'; sleep $((RETRIES * INTERVAL_SEC + 30))" >/dev/null \
  || fail "could not start backend deployment canary"
docker run -d --network "${WOTB_OBSERVABILITY_NETWORK:-wotb_internal}" --name "$keycloak_name" alpine:3.22 \
  sh -c "printf '%s\\n' '$keycloak_marker'; sleep $((RETRIES * INTERVAL_SEC + 30))" >/dev/null \
  || fail "could not start Keycloak deployment canary"

query_range_has_values() {
  local body="$1" marker="$2"
    grep -Eq '"status"[[:space:]]*:[[:space:]]*"success"' <<<"$body" \
    && grep -Eq '"result"[[:space:]]*:[[:space:]]*\[[[:space:]]*\{' <<<"$body" \
    && grep -Eq '"values"[[:space:]]*:[[:space:]]*\[[[:space:]]*\[[[:space:]]*"[^" ]+"[[:space:]]*,[[:space:]]*"[^"]+"' <<<"$body" \
    && grep -Fq "$marker" <<<"$body"
}

for attempt in $(seq 1 "$RETRIES"); do
  end_ns="$(( $(date +%s) + 2 ))000000000"
  backend_query="http://loki:3100/loki/api/v1/query_range?query=%7Bcontainer_name%3D%22wotb-backend%22%7D%20%7C%3D%20%22${backend_marker}%22&start=${canary_start_ns}&end=${end_ns}&limit=1"
  keycloak_query="http://loki:3100/loki/api/v1/query_range?query=%7Bcontainer_name%3D%22keycloak%22%7D%20%7C%3D%20%22${keycloak_marker}%22&start=${canary_start_ns}&end=${end_ns}&limit=1"
  backend_body="$(compose_exec "$backend_query" 2>/dev/null || true)"
  keycloak_body="$(compose_exec "$keycloak_query" 2>/dev/null || true)"
  if query_range_has_values "$backend_body" "$backend_marker" \
    && query_range_has_values "$keycloak_body" "$keycloak_marker"; then
    echo "PASS: Loki backend and Keycloak deployment canaries"
    break
  fi
  [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  [ "$attempt" -eq "$RETRIES" ] && fail "Loki backend or Keycloak canary was not ingested"
done

# This request may return 404: it verifies the real nginx access-log path,
# while the Android dashboard counts only status=200.
frontend_canary_start_epoch="$(date +%s)"
frontend_canary_start_ns="${frontend_canary_start_epoch}000000000"
frontend_exec "http://127.0.0.1:80/download/android/$frontend_apk" >/dev/null 2>&1 || true
for attempt in $(seq 1 "$RETRIES"); do
  end_ns="$(( $(date +%s) + 2 ))000000000"
  frontend_query="http://loki:3100/loki/api/v1/query_range?query=%7Bcontainer_name%3D%22wotb-frontend%22%2Cevent%3D%22android_apk_download%22%7D%20%7C%3D%20%22${frontend_apk}%22&start=${frontend_canary_start_ns}&end=${end_ns}&limit=1"
  frontend_body="$(compose_exec "$frontend_query" 2>/dev/null || true)"
  if query_range_has_values "$frontend_body" 'event=android_apk_download' \
    && grep -Fq 'event=android_apk_download' <<<"$frontend_body" \
    && grep -Fq "apk=$frontend_apk" <<<"$frontend_body" \
    && grep -Fq 'status=404' <<<"$frontend_body" \
    && grep -Fq 'bytes=' <<<"$frontend_body" \
    && ! grep -Fq '127.0.0.1' <<<"$frontend_body" \
    && ! grep -Fq 'GET /download' <<<"$frontend_body" \
    && ! grep -Fq 'User-Agent' <<<"$frontend_body" \
    && ! grep -Fq 'Referer' <<<"$frontend_body"; then
    echo "PASS: Loki sanitized frontend nginx canary (404 excluded from download success)"
    break
  fi
  [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  [ "$attempt" -eq "$RETRIES" ] && fail "sanitized frontend nginx canary was not ingested"
done

echo "== Observability verification passed =="
