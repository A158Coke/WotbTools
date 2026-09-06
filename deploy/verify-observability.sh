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
  job_sample="$(query_prometheus "up{job=\"$job\"}")" \
    || fail "Prometheus target query failed for job=$job"
  grep -Fq '"value"' <<<"$job_sample" \
    || fail "Prometheus has no healthy target sample for job=$job"
done
echo "PASS: Prometheus targets up (backend/keycloak/node-exporter)"

prom_query="$(query_prometheus 'up{job="wotb-backend"}')" \
  || fail "Prometheus data query failed"
grep -Fq '"value"' <<<"$prom_query" || fail "Prometheus backend up query returned no sample"
echo "PASS: Prometheus data query"

now="$(date +%s)"
start_ns="$((now - 900))000000000"
end_ns="${now}000000000"
loki_query="http://loki:3100/loki/api/v1/query_range?query=%7Bcontainer_name%3D%22wotb-backend%22%7D&start=${start_ns}&end=${end_ns}&limit=1"
loki_body="$(compose_exec "$loki_query" 2>/dev/null)" \
  || fail "Loki query API unavailable"
grep -Fq '"status":"success"' <<<"$loki_body" \
  || fail "Loki query API did not return success"
grep -Fq '"result"' <<<"$loki_body" \
  || fail "Loki query API returned no result field"
echo "PASS: Loki backend stream query"

echo "== Observability verification passed =="
