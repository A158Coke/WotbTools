#!/usr/bin/env bash
# Production observability gate. Run from the deployment directory after the
# application stack is healthy. It fails closed and never prints credentials.
set -euo pipefail

readonly RETRIES="${WOTB_OBSERVABILITY_RETRIES:-20}"
readonly INTERVAL_SEC="${WOTB_OBSERVABILITY_INTERVAL_SEC:-3}"

if [[ ! "$RETRIES" =~ ^[1-9][0-9]*$ || ! "$INTERVAL_SEC" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: WOTB_OBSERVABILITY_RETRIES and WOTB_OBSERVABILITY_INTERVAL_SEC must be positive integers." >&2
  exit 2
fi

fail() {
  echo "OBSERVABILITY FAIL: $*" >&2
  exit 1
}

compose_exec() {
  docker compose exec -T wotb-backend wget -qO- "$1"
}

wait_for_http() {
  local name="$1" url="$2" body="" attempt
  shift 2
  for attempt in $(seq 1 "$RETRIES"); do
    if body="$(compose_exec "$url" 2>/dev/null)" && [ -n "$body" ]; then
      if [ "$#" -eq 0 ]; then
        echo "PASS: $name"
        return 0
      fi
      local needle
      for needle in "$@"; do
        if ! grep -Fq "$needle" <<<"$body"; then
          body=""
          break
        fi
      done
      if [ -n "$body" ]; then
        echo "PASS: $name"
        return 0
      fi
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  done
  fail "$name did not return the expected response"
}

query_prometheus() {
  local query="$1"
  # The backend image is the existing deployment probe image and has wget;
  # keeping probes there avoids adding a public management port.
  local encoded
  encoded="${query// /%20}"
  encoded="${encoded//\"/%22}"
  encoded="${encoded//\{/%7B}"
  encoded="${encoded//\}/%7D}"
  compose_exec "http://prometheus:9090/api/v1/query?query=${encoded}"
}

prometheus_value_is_one() {
  grep -Eq '"value"[[:space:]]*:[[:space:]]*\[[^]]*,[[:space:]]*"1"[[:space:]]*\]'
}

wait_for_prometheus_target_up() {
  local job="$1" job_sample attempt
  for attempt in $(seq 1 "$RETRIES"); do
    if job_sample="$(query_prometheus "min(up{job=\"$job\"})" 2>/dev/null)" \
      && prometheus_value_is_one <<<"$job_sample"; then
      return 0
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  done
  fail "Prometheus target is not healthy (up != 1) for job=$job"
}

echo "== Verifying observability data path =="
wait_for_http "backend metrics endpoint" \
  "http://127.0.0.1:8087/actuator/prometheus" "jvm_" "http_server_requests"
wait_for_http "keycloak metrics endpoint" \
  "http://keycloak:9000/metrics" "process_" 
wait_for_http "node exporter metrics endpoint" \
  "http://node-exporter:9100/metrics" "node_"
wait_for_http "grafana health endpoint" \
  "http://grafana:3000/api/health" '"database":"ok"'

targets="$(wait_for_http "prometheus target API" "http://prometheus:9090/api/v1/targets" '"status":"success"' '"job":"wotb-backend"' '"job":"keycloak"' '"job":"node-exporter"' >/dev/null && compose_exec "http://prometheus:9090/api/v1/targets")" \
  || fail "Prometheus target API unavailable"
for job in wotb-backend keycloak node-exporter; do
  grep -Fq "\"job\":\"$job\"" <<<"$targets" \
    || fail "Prometheus target missing job=$job"
  wait_for_prometheus_target_up "$job"
done
echo "PASS: Prometheus targets up (backend/keycloak/node-exporter)"

prom_query="$(query_prometheus 'min(up{job="wotb-backend"})')" \
  || fail "Prometheus data query failed"
prometheus_value_is_one <<<"$prom_query" \
  || fail "Prometheus backend up query is not healthy (up != 1)"
echo "PASS: Prometheus data query"

canary_started_at="$(date +%s)"
canary_name="wotb-backend-observability-canary-${canary_started_at}-$$"
canary_marker="wotb-observability-canary-${canary_started_at}-$$"
cleanup_canary() {
  docker rm -f "$canary_name" >/dev/null 2>&1 || true
}
trap cleanup_canary EXIT
export WOTB_OBSERVABILITY_CANARY_MARKER="$canary_marker"
docker compose run -d --no-deps --name "$canary_name" wotb-backend \
  sh -c "printf '%s\\n' '$canary_marker'; sleep $((RETRIES * INTERVAL_SEC + 30))" >/dev/null \
  || fail "could not start deployment observability canary"

for attempt in $(seq 1 "$RETRIES"); do
  now="$(date +%s)"
  start_ns="$((canary_started_at - 5))000000000"
  end_ns="$((now + 1))000000000"
  loki_query="http://loki:3100/loki/api/v1/query_range?query=%7Bcontainer_name%3D%22wotb-backend%22%7D%20%7C%3D%20%22${canary_marker}%22&start=${start_ns}&end=${end_ns}&limit=1"
  if loki_body="$(compose_exec "$loki_query" 2>/dev/null)" \
    && grep -Fq '"status":"success"' <<<"$loki_body" \
    && grep -Fq "$canary_marker" <<<"$loki_body"; then
    echo "PASS: Loki deployment canary ingestion"
    break
  fi
  if [ "$attempt" -eq "$RETRIES" ]; then
    fail "Loki deployment canary was not ingested"
  fi
  sleep "$INTERVAL_SEC"
done

echo "== Observability verification passed =="
