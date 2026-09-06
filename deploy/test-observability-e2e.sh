#!/usr/bin/env bash
# CI runtime smoke: Docker emitter -> production Alloy config -> Loki query.
# This deliberately uses the production Alloy config; it does not reproduce it
# in a test-only configuration.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="wotb-observability-e2e-${GITHUB_RUN_ID:-local}-$$"
LOKI="wotb-observability-loki-${GITHUB_RUN_ID:-local}-$$"
ALLOY="wotb-observability-alloy-${GITHUB_RUN_ID:-local}-$$"
BACKEND="wotb-backend-smoke-${GITHUB_RUN_ID:-local}-$$"
KEYCLOAK="keycloak-smoke-${GITHUB_RUN_ID:-local}-$$"
FRONTEND="wotb-frontend-smoke-${GITHUB_RUN_ID:-local}-$$"
MARKER="observability-e2e-${GITHUB_RUN_ID:-local}-$$"
KEYCLOAK_MARKER="keycloak-${MARKER}"
APK="observability-canary-${MARKER}.apk"

cleanup() {
  docker rm -f "$ALLOY" "$BACKEND" "$KEYCLOAK" "$FRONTEND" "$LOKI" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  echo "== Alloy diagnostics ==" >&2
  docker logs "$ALLOY" 2>&1 | tail -80 >&2 || true
  echo "== Loki diagnostics ==" >&2
  docker logs "$LOKI" 2>&1 | tail -80 >&2 || true
  exit 1
}

wait_until() {
  local description="$1"; shift
  for attempt in $(seq 1 30); do
    if "$@"; then
      echo "PASS: $description"
      return 0
    fi
    sleep 2
  done
  fail "$description"
}

docker network create "$NETWORK" >/dev/null
docker run -d --name "$LOKI" --network "$NETWORK" --network-alias loki \
  -p 127.0.0.1::3100 \
  -v "$ROOT/deploy/observability/loki/loki-config.yml:/etc/loki/loki-config.yml:ro" \
  grafana/loki:3.3.2 -config.file=/etc/loki/loki-config.yml >/dev/null

docker run -d --name "$BACKEND" --network "$NETWORK" \
  alpine:3.22 sh -c "while true; do echo event=backend_smoke marker=$MARKER; sleep 1; done" >/dev/null
docker run -d --name "$KEYCLOAK" --network "$NETWORK" \
  alpine:3.22 sh -c "while true; do echo event=keycloak_smoke marker=$KEYCLOAK_MARKER; sleep 1; done" >/dev/null
docker run -d --name "$FRONTEND" --network "$NETWORK" -p 127.0.0.1::80 \
  nginx:1.27-alpine >/dev/null

docker run -d --name "$ALLOY" --network "$NETWORK" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$ROOT/deploy/observability/alloy/config.alloy:/etc/alloy/config.alloy:ro" \
  grafana/alloy:v1.4.2 run --server.http.listen-addr=0.0.0.0:12345 \
  /etc/alloy/config.alloy >/dev/null

LOKI_PORT="$(docker port "$LOKI" 3100/tcp | sed -E 's/.*://')"
[[ -n "$LOKI_PORT" ]] || fail "Loki port was not published"
wait_until "Loki readiness" curl -fsS "http://127.0.0.1:${LOKI_PORT}/ready"
FRONTEND_PORT="$(docker port "$FRONTEND" 80/tcp | sed -E 's/.*://')"
[[ -n "$FRONTEND_PORT" ]] || fail "frontend port was not published"
wait_until "frontend nginx readiness" curl -sS -o /dev/null "http://127.0.0.1:${FRONTEND_PORT}/"
curl -sS -o /dev/null "http://127.0.0.1:${FRONTEND_PORT}/download/android/${APK}" || true

query_range() {
  local selector="$1"
  curl -fsS -G "http://127.0.0.1:${LOKI_PORT}/loki/api/v1/query_range" \
    --data-urlencode "query=${selector}" \
    --data-urlencode "limit=20" \
    --data-urlencode "start=$(($(date +%s)-180))000000000" \
    --data-urlencode "end=$(date +%s)000000000"
}

loki_response_has_sample() {
  local body="$1"
  grep -Eq '"status"[[:space:]]*:[[:space:]]*"success"' <<<"$body" \
    && grep -Eq '"result"[[:space:]]*:[[:space:]]*\[[[:space:]]*\{' <<<"$body" \
    && grep -Eq '"values"[[:space:]]*:[[:space:]]*\[[[:space:]]*\[[[:space:]]*"[^" ]+"[[:space:]]*,[[:space:]]*"[^"]+"' <<<"$body"
}

backend_query() {
  body="$(query_range '{container_name="wotb-backend"}')"
  loki_response_has_sample "$body" && grep -Fq "$MARKER" <<<"$body"
}
keycloak_query() {
  body="$(query_range '{container_name="keycloak"}')"
  loki_response_has_sample "$body" && grep -Fq "$KEYCLOAK_MARKER" <<<"$body"
}
frontend_query() {
  body="$(query_range '{container_name="wotb-frontend",event="android_apk_download"}')"
  loki_response_has_sample "$body" \
    && grep -Fq 'event=android_apk_download' <<<"$body" \
    && grep -Fq "apk=$APK" <<<"$body" \
    && grep -Fq 'status=404' <<<"$body" \
    && grep -Fq 'bytes=' <<<"$body" \
    && ! grep -Fq '127.0.0.1' <<<"$body" \
    && ! grep -Fq 'GET /download' <<<"$body" \
    && ! grep -Fq 'User-Agent' <<<"$body" \
    && ! grep -Fq 'Referer' <<<"$body"
}

wait_until "backend Docker stream reaches Loki" backend_query
wait_until "Keycloak Docker stream reaches Loki" keycloak_query
wait_until "sanitized Android frontend stream reaches Loki" frontend_query
echo "OK: production Alloy Docker discovery, normalization, redaction, and Loki ingestion passed"
