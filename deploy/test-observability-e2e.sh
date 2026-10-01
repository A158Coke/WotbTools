#!/usr/bin/env bash
# CI runtime smoke: Docker emitter -> production Alloy config -> Loki query.
# This deliberately uses the production Alloy config; it does not reproduce it
# in a test-only configuration.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Smoke settings below must remain the settings enabled by the production owner.
for setting in 'KC_LOG_CONSOLE_OUTPUT: json' 'KC_LOG_MDC_ENABLED: "true"' 'KC_LOG_CONSOLE_INCLUDE_MDC: "true"' 'KC_LOG_MDC_KEYS: realmName,clientId'; do
  grep -Fq "$setting" "$ROOT/deploy/tx/keycloak.compose.yml" \
    || { echo "FAIL: production Keycloak MDC configuration drift: $setting" >&2; exit 1; }
done
NETWORK="wotb-observability-e2e-${GITHUB_RUN_ID:-local}-$$"
LOKI="wotb-observability-loki-${GITHUB_RUN_ID:-local}-$$"
ALLOY="wotb-observability-alloy-${GITHUB_RUN_ID:-local}-$$"
ALLOY_TX="wotb-observability-alloy-tx-${GITHUB_RUN_ID:-local}-$$"
BACKEND="wotb-backend-smoke-${GITHUB_RUN_ID:-local}-$$"
BACKEND_TX="business-api-tx-smoke-${GITHUB_RUN_ID:-local}-$$"
KEYCLOAK="parser-worker-smoke-${GITHUB_RUN_ID:-local}-$$"
FRONTEND="wotb-frontend-smoke-${GITHUB_RUN_ID:-local}-$$"
MARKER="observability-e2e-${GITHUB_RUN_ID:-local}-$$"
MARKER_TX="tx-alloy-e2e-${GITHUB_RUN_ID:-local}-$$"
KEYCLOAK_MARKER="keycloak-${MARKER}"
APK="observability-canary-${MARKER}.apk"
AUTH="keycloak-auth-smoke-${GITHUB_RUN_ID:-local}-$$"
AUTH_DB="keycloak-postgres-smoke-${GITHUB_RUN_ID:-local}-$$"

cleanup() {
  docker rm -f "$ALLOY" "$ALLOY_TX" "$BACKEND" "$BACKEND_TX" "$KEYCLOAK" "$AUTH" "$AUTH_DB" "$FRONTEND" "$LOKI" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  echo "== Alloy diagnostics ==" >&2
  docker logs "$ALLOY" 2>&1 | tail -80 >&2 || true
  echo "== Loki diagnostics ==" >&2
  docker logs "$LOKI" 2>&1 | tail -80 >&2 || true
  echo "== Keycloak diagnostics ==" >&2
  docker logs "$AUTH" 2>&1 | tail -80 >&2 || true
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

docker run -d --name "$BACKEND" --network "$NETWORK" --label com.docker.compose.service=ai-service \
  alpine:3.22 sh -c "while true; do echo event=backend_smoke marker=$MARKER; sleep 1; done" >/dev/null
docker run -d --name "$KEYCLOAK" --network "$NETWORK" --label com.docker.compose.service=parser-worker \
  alpine:3.22 sh -c "while true; do echo event=keycloak_smoke marker=$KEYCLOAK_MARKER; sleep 1; done" >/dev/null
docker run -d --name "$FRONTEND" --network "$NETWORK" --label com.docker.compose.service=wotb-frontend -p 127.0.0.1::80 \
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
  body="$(query_range '{service="ai-service"}')"
  loki_response_has_sample "$body" && grep -Fq "$MARKER" <<<"$body"
}
keycloak_query() {
  body="$(query_range '{service="parser-worker"}')"
  loki_response_has_sample "$body" && grep -Fq "$KEYCLOAK_MARKER" <<<"$body"
}
frontend_query() {
  body="$(query_range '{service="web",container_name="wotb-frontend",event="android_apk_download"}')"
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

wait_until "Yecao AI Docker stream reaches Loki" backend_query
wait_until "Yecao parser Docker stream reaches Loki" keycloak_query

# TX lane: the production TX config matches by Compose service label (container
# names are project-prefixed there) and must normalize the stream to the legacy
# {container_name="wotb-backend"} identity every dashboard queries. The emitter
# starts BEFORE the TX Alloy instance on purpose: discovery.docker snapshots the
# container list on startup and refreshes on a 60s interval, so starting the
# emitter first keeps target discovery deterministic inside the assertion
# window instead of racing the refresh timer.
docker run -d --name "$BACKEND_TX" --network "$NETWORK" \
  --label com.docker.compose.service=business-api \
  alpine:3.22 sh -c "while true; do echo event=backend_tx_smoke marker=$MARKER_TX; sleep 1; done" >/dev/null
# Build the repository's production image, then add an isolated CI-only logger hook.
PRODUCTION_IMAGE="wotbtools-keycloak:observability-production"
SMOKE_IMAGE="wotbtools-keycloak:observability-smoke"
docker build --build-arg BUILD_COMMIT=runtime-contract -f "$ROOT/docker/Dockerfile.keycloak" -t "$PRODUCTION_IMAGE" "$ROOT" >/dev/null
docker build --build-arg PRODUCTION_IMAGE="$PRODUCTION_IMAGE" -t "$SMOKE_IMAGE" "$ROOT/deploy/observability/keycloak-smoke" >/dev/null
docker run -d --name "$AUTH" --network "$NETWORK" --label com.docker.compose.service=keycloak \
  -e KC_DB=postgres -e KC_DB_URL="jdbc:postgresql://$AUTH_DB:5432/keycloak" \
  -e KC_DB_USERNAME=smoke -e KC_DB_PASSWORD=smoke-runtime-password \
  -e KC_HTTP_ENABLED=true -e KC_HOSTNAME_STRICT=false \
  -e KC_LOG_CONSOLE_OUTPUT=json -e KC_LOG_MDC_ENABLED=true \
  -e KC_LOG_CONSOLE_INCLUDE_MDC=true -e KC_LOG_MDC_KEYS=realmName,clientId \
  "$SMOKE_IMAGE" start --optimized >/dev/null
docker run -d --name "$AUTH_DB" --network "$NETWORK" --label com.docker.compose.service=keycloak-postgres \
  -e POSTGRES_DB=keycloak -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke-runtime-password postgres:18-alpine >/dev/null
docker run -d --name "$ALLOY_TX" --network "$NETWORK" \
  -p 127.0.0.1::12345 \
  -e WOTB_LOKI_URL="http://loki:3100/loki/api/v1/push" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$ROOT/deploy/tx/alloy/config.alloy:/etc/alloy/config.alloy:ro" \
  grafana/alloy:v1.4.2 run --server.http.listen-addr=0.0.0.0:12345 \
  /etc/alloy/config.alloy >/dev/null
ALLOY_TX_PORT="$(docker port "$ALLOY_TX" 12345/tcp | sed -E 's/.*://')"
[[ -n "$ALLOY_TX_PORT" ]] || fail "TX Alloy HTTP port was not published"

# Inspect what the label relabel actually discovered: every emitter container
# this lane depends on must appear with the exact Compose service label. The
# /api/v0/web/components payload carries each discovery.relabel component's
# debug data (its processed targets); /metrics carries the discovery target
# counters as a cross-check.
dump_tx_relabel_targets() {
  local raw
  raw="$(curl -sS --max-time 5 "http://127.0.0.1:${ALLOY_TX_PORT}/api/v0/web/components" 2>&1 || echo "CURL_FAILED")"
  if [ "$raw" = "CURL_FAILED" ]; then
    echo "FAIL: could not reach the TX Alloy HTTP API on ${ALLOY_TX_PORT}" >&2
  else
    printf '%s' "$raw" | jq -c '.. | objects | select((.id? // "") | test("^discovery\\.(docker|relabel)")) | {id: .id, health: (.health // .state // empty), debugInfo: (.debugInfo // empty), exports: (.exports // empty)}' 2>/dev/null >&2 \
      || { echo "== raw components payload (first 20KB) ==" >&2; printf '%s' "$raw" | head -c 20000 >&2; echo >&2; }
  fi
  echo "== discovery counters ==" >&2
  curl -sS --max-time 5 "http://127.0.0.1:${ALLOY_TX_PORT}/metrics" 2>/dev/null \
    | grep -Ei 'docker|discovery.*target|loki_source_docker|loki_write|drop' | head -60 >&2 || true
  echo "== emitter liveness (docker logs --tail 2) ==" >&2
  docker logs --tail 2 "$BACKEND_TX" >&2 2>&1 || true
  local entries_first entries_second
  entries_first="$(curl -sS --max-time 5 "http://127.0.0.1:${ALLOY_TX_PORT}/metrics" 2>/dev/null \
    | grep '^loki_source_docker_target_entries_total{component_id="loki.source.docker.backend"' | grep -oE '[0-9]+$')"
  sleep 10
  entries_second="$(curl -sS --max-time 5 "http://127.0.0.1:${ALLOY_TX_PORT}/metrics" 2>/dev/null \
    | grep '^loki_source_docker_target_entries_total{component_id="loki.source.docker.backend"' | grep -oE '[0-9]+$')"
  echo "== backend entries growth over 10s: ${entries_first:-unknown} -> ${entries_second:-unknown} ==" >&2
  echo "== Loki streams / labels ==" >&2
  curl -sS --max-time 5 -G "http://127.0.0.1:${LOKI_PORT}/loki/api/v1/labels" 2>/dev/null | head -c 2000 >&2; echo >&2
  curl -sS --max-time 5 -G "http://127.0.0.1:${LOKI_PORT}/loki/api/v1/series" \
    --data-urlencode 'match[]={container_name=~".+"}' 2>/dev/null | head -c 4000 >&2; echo >&2
}

backend_tx_query() {
  body="$(query_range '{service="business-api",container_name="wotb-backend"}')"
  loki_response_has_sample "$body" && grep -Fq "$MARKER_TX" <<<"$body"
}
unlabeled_stream_not_collected_by_tx_lane() {
  body="$(query_range '{service="parser-worker"}')"
  loki_response_has_sample "$body" && grep -Fq "$KEYCLOAK_MARKER" <<<"$body"
}
backend_tx_seen=0
for attempt in $(seq 1 30); do
  if backend_tx_query; then
    backend_tx_seen=1
    echo "PASS: TX Compose-label stream reaches Loki as wotb-backend"
    break
  fi
  [ "$attempt" -lt 30 ] && sleep 2
done
if [ "$backend_tx_seen" != 1 ]; then
  # Dump the relabel components' real discovered targets so a failing run shows
  # whether the emitter's com.docker.compose.service label was even seen.
  dump_tx_relabel_targets
  fail "TX Compose-label stream reaches Loki as wotb-backend"
fi
wait_until "Yecao parser stream still reaches Loki" unlabeled_stream_not_collected_by_tx_lane
wait_until "TX sanitized frontend stream reaches Loki" frontend_query

auth_query() {
  body="$(query_range '{service="keycloak"} | json | event="auth_failure" | provider="qq" | stage="runtime_smoke" | errorCode="QQ_UPSTREAM_FAILURE"')"
  loki_response_has_sample "$body" && grep -Fq 'runtime_smoke' <<<"$body" \
    && grep -Fq 'exception' <<<"$body" && grep -Fq 'java.io.IOException' <<<"$body" \
    && grep -Fq 'AuthEventLog' <<<"$body"
}
wait_until "TX Keycloak canonical stream reaches Loki" auth_query
keycloak_oidc_ready() {
  docker run --rm --network "$NETWORK" alpine:3.22 wget -qO- \
    "http://$AUTH:8080/realms/master/.well-known/openid-configuration" | grep -Fq '"issuer"'
}
wait_until "Real production Keycloak OIDC runtime is ready" keycloak_oidc_ready
# Assert native Keycloak JSON, before Alloy flattening. This is not a hand-written emitter.
docker logs "$AUTH" 2>&1 | jq -R -s -e 'split("\n") | map(fromjson? | select(.mdc.event? == "auth_failure" and .mdc.provider == "qq" and .mdc.stage == "runtime_smoke" and .mdc.service == "keycloak" and .mdc.errorCode == "QQ_UPSTREAM_FAILURE" and (.mdc.outcome | length > 0))) | length > 0' >/dev/null \
  || fail "real Keycloak JSON did not include provider JBoss MDC"
body="$(query_range '{service="keycloak"}')"
! grep -Fq 'database system is ready' <<<"$body" || fail "Keycloak PostgreSQL logs leaked into auth stream"
echo "OK: production Alloy Docker discovery, normalization, redaction, and Loki ingestion passed"
