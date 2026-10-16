#!/usr/bin/env bash
# CI runtime smoke: Docker emitter -> production Alloy config -> Loki query.
# This deliberately uses the production Alloy config; it does not reproduce it
# in a test-only configuration.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="wotb-observability-e2e-${GITHUB_RUN_ID:-local}-$$"
LOKI="wotb-observability-loki-${GITHUB_RUN_ID:-local}-$$"
ALLOY="wotb-observability-alloy-${GITHUB_RUN_ID:-local}-$$"
ALLOY_TX="wotb-observability-alloy-tx-${GITHUB_RUN_ID:-local}-$$"
BACKEND="wotb-backend-smoke-${GITHUB_RUN_ID:-local}-$$"
BACKEND_TX="business-api-tx-smoke-${GITHUB_RUN_ID:-local}-$$"
AI="ai-service-smoke-${GITHUB_RUN_ID:-local}-$$"
KEYCLOAK="keycloak-smoke-${GITHUB_RUN_ID:-local}-$$"
FRONTEND="wotb-frontend-smoke-${GITHUB_RUN_ID:-local}-$$"
MARKER="observability-e2e-${GITHUB_RUN_ID:-local}-$$"
MARKER_TX="tx-alloy-e2e-${GITHUB_RUN_ID:-local}-$$"
KEYCLOAK_MARKER="keycloak-${MARKER}"
APK="observability-canary-${MARKER}.apk"
KEYCLOAK_TX="kc-events-tx-smoke-${GITHUB_RUN_ID:-local}-$$"
CADDY_TX="gateway-tx-smoke-${GITHUB_RUN_ID:-local}-$$"
# 合规分流的标记：每一条都必须能单独判定「该进 190 天留存」还是「只进 7 天」。
# 独立前缀（不复用 MARKER / MARKER_TX）是必须的：下面的「不得进 compliance」断言是
# 子串匹配，若这些标记里嵌了 MARKER_TX，后端 telemetry 的排除断言会被自己误伤。
COMPLIANCE_SCOPE="compliance-e2e-${GITHUB_RUN_ID:-local}-$$"
KC_LOGIN_MARKER="kc-login-${COMPLIANCE_SCOPE}"
KC_ADMIN_MARKER="kc-admin-${COMPLIANCE_SCOPE}"
KC_UNSELECTED_MARKER="kc-client-login-${COMPLIANCE_SCOPE}"
KC_RUNTIME_MARKER="kc-runtime-${COMPLIANCE_SCOPE}"
CADDY_API_MARKER="caddy-api-${COMPLIANCE_SCOPE}"
CADDY_AUTH_MARKER="caddy-auth-${COMPLIANCE_SCOPE}"
CADDY_RUNTIME_MARKER="caddy-runtime-${COMPLIANCE_SCOPE}"

cleanup() {
  docker rm -f "$ALLOY" "$ALLOY_TX" "$BACKEND" "$BACKEND_TX" "$KEYCLOAK" "$KEYCLOAK_TX" "$CADDY_TX" "$FRONTEND" "$AI" "$LOKI" >/dev/null 2>&1 || true
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

# 留存契约：普通日志 7 天、只有 {compliance="security"} 190 天。这里断言的是**两档同时
# 存在**——只 grep 4560h 会在有人把默认档也改成半年时通过，那正好是这次整改要避免的结果。
# 下面用真实 Loki 镜像加载同一个文件，所以语法层由 Loki 自己把关，这里只管语义。
python3 - "$ROOT/deploy/observability/loki/loki-config.yml" <<'PY_RETENTION'
import sys

import yaml

limits = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))["limits_config"]
assert limits["retention_period"] == "168h", limits.get("retention_period")
streams = limits["retention_stream"]
assert len(streams) == 1, streams
override = streams[0]
assert override["selector"] == '{compliance="security"}', override
# 4560h = 190 天：公安自评估的「不少于六个月」。
assert override["period"] == "4560h", override
assert int(override["priority"]) >= 1, override
# 回看窗口必须跟着延长，否则取证查询读不到旧块；单次查询长度仍然受限，避免一次 190 天的
# 范围查询把这台小机器打爆。
assert limits["max_query_lookback"] == "4560h", limits.get("max_query_lookback")
assert limits["max_query_length"] == "168h", limits.get("max_query_length")
print("PASS: Loki keeps ordinary logs 7 days and only the security stream 190 days")
PY_RETENTION

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

docker run -d --name "$AI" --network "$NETWORK" \
  --label com.docker.compose.service=ai-service \
  alpine:3.22 sh -c 'while true; do echo "{\"message\":\"event=ai_token_usage inputTokens=10 outputTokens=5 totalTokens=15 usageMissing=0\"}"; sleep 1; done' >/dev/null

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

ai_query() {
  body="$(query_range '{container_name="ai-service"} | json | line_format "{{.message}}" | logfmt | event="ai_token_usage"')"
  loki_response_has_sample "$body" && grep -Fq 'totalTokens=15' <<<"$body"
}
wait_until "AI production Compose-label stream reaches Loki" ai_query

wait_until "backend Docker stream reaches Loki" backend_query
wait_until "Keycloak Docker stream reaches Loki" keycloak_query
wait_until "sanitized Android frontend stream reaches Loki" frontend_query

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
# 合规分流的输入：形态照抄生产真实行（Keycloak jboss-logging 的文本行、Caddy filter
# 编码器的 JSON 行），因为分流判定就是在这些形态上做的。每个 lane 都带正反两例：
#   - Keycloak：受控事件（LOGIN）与 admin event 必须进 compliance；未入清单的事件类型
#     （CLIENT_LOGIN）与普通 runtime 日志必须留在 7 天档；
#   - Caddy：带 compliance 字段的受控访问日志必须进 compliance（并把 security_kind 提
#     升为标签）；TLS/ACME 之类的 runtime 行必须留在 7 天档。
# 容器名刻意不含 keycloak/wotb-frontend/wotb-backend：Yecao 车道按**容器名**匹配，这些
# 容器只应该被按 Compose 标签匹配的 TX 车道采到。
docker run -d --name "$KEYCLOAK_TX" --network "$NETWORK" \
  --label com.docker.compose.service=keycloak \
  alpine:3.22 sh -c "while true; do
    echo '2026-01-01 00:00:00,000 DEBUG [org.keycloak.events] (executor-thread-1) type=\"LOGIN\", realmId=\"r\", realmName=\"wotbtools\", clientId=\"wotbtools-web\", userId=\"u\", ipAddress=\"203.0.113.9\", username=\"$KC_LOGIN_MARKER\"'
    echo '2026-01-01 00:00:00,000 DEBUG [org.keycloak.events] (executor-thread-1) operationType=\"CREATE\", realmId=\"r\", realmName=\"wotbtools\", clientId=\"c\", userId=\"u\", ipAddress=\"203.0.113.9\", resourceType=\"USER\", resourcePath=\"users/$KC_ADMIN_MARKER\"'
    echo '2026-01-01 00:00:00,000 DEBUG [org.keycloak.events] (executor-thread-1) type=\"CLIENT_LOGIN\", realmId=\"r\", clientId=\"wotbtools-admin-api\", grant_type=\"client_credentials\", marker=\"$KC_UNSELECTED_MARKER\"'
    echo '2026-01-01 00:00:00,000 INFO  [io.quarkus] (main) Keycloak started in 9.9s marker=$KC_RUNTIME_MARKER'
    sleep 1
  done" >/dev/null
docker run -d --name "$CADDY_TX" --network "$NETWORK" \
  --label com.docker.compose.service=caddy \
  alpine:3.22 sh -c "while true; do
    echo '{\"level\":\"info\",\"ts\":1767225600.0,\"logger\":\"http.log.access.security_api\",\"msg\":\"handled request\",\"request\":{\"remote_ip\":\"203.0.113.9\",\"remote_port\":\"51000\",\"proto\":\"HTTP/1.1\",\"method\":\"GET\",\"host\":\"wotbtools.com\"},\"status\":200,\"ua\":\"$CADDY_API_MARKER\",\"path\":\"/api/hof/leaderboard\",\"security_kind\":\"api_access\",\"compliance\":\"security\"}'
    echo '{\"level\":\"info\",\"ts\":1767225600.0,\"logger\":\"http.log.access.log0\",\"msg\":\"handled request\",\"request\":{\"remote_ip\":\"203.0.113.9\",\"remote_port\":\"51001\",\"proto\":\"HTTP/1.1\",\"method\":\"GET\",\"host\":\"auth.wotbtools.com\",\"uri\":\"/realms/wotbtools/protocol/openid-connect/auth\"},\"status\":200,\"ua\":\"$CADDY_AUTH_MARKER\",\"security_kind\":\"auth_access\",\"compliance\":\"security\"}'
    echo '{\"level\":\"info\",\"ts\":1767225600.0,\"logger\":\"tls.obtain\",\"msg\":\"certificate obtained successfully\",\"identifier\":\"$CADDY_RUNTIME_MARKER\"}'
    sleep 1
  done" >/dev/null
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
  body="$(query_range '{container_name="wotb-backend"}')"
  loki_response_has_sample "$body" && grep -Fq "$MARKER_TX" <<<"$body"
}
unlabeled_stream_not_collected_by_tx_lane() {
  body="$(query_range '{container_name="keycloak"}')"
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
wait_until "Yecao name-matched Keycloak stream still reaches Loki" unlabeled_stream_not_collected_by_tx_lane

# --- the compliance split: only security logs reach the 190-day stream -------
stream_has() {
  local selector="$1" marker="$2" body
  body="$(query_range "$selector")"
  loki_response_has_sample "$body" && grep -Fq "$marker" <<<"$body"
}
wait_until "Keycloak LOGIN event is labelled compliance=security/auth" \
  stream_has '{compliance="security",security_kind="auth"}' "$KC_LOGIN_MARKER"
wait_until "Keycloak admin event is labelled compliance=security/auth" \
  stream_has '{compliance="security",security_kind="auth"}' "$KC_ADMIN_MARKER"
wait_until "Caddy API access log is labelled compliance=security/api_access" \
  stream_has '{compliance="security",security_kind="api_access"}' "$CADDY_API_MARKER"
wait_until "Caddy auth access log is labelled compliance=security/auth_access" \
  stream_has '{compliance="security",security_kind="auth_access"}' "$CADDY_AUTH_MARKER"
# 正向对照：下面「不进 compliance」的断言只有在这些行确实已经到达 Loki 之后才有意义，
# 否则缺席可能只是还没送到。
wait_until "a non-retained Keycloak event type still reaches the ordinary stream" \
  stream_has '{container_name="keycloak"}' "$KC_UNSELECTED_MARKER"
wait_until "ordinary Keycloak runtime output still reaches the ordinary stream" \
  stream_has '{container_name="keycloak"}' "$KC_RUNTIME_MARKER"
wait_until "ordinary Caddy runtime output still reaches the ordinary stream" \
  stream_has '{container_name="caddy"}' "$CADDY_RUNTIME_MARKER"

compliance_body="$(query_range '{compliance="security"}')"
loki_response_has_sample "$compliance_body" || fail "the compliance stream is empty"
# 这一组是整次整改的边界：普通产品日志绝不能被延长到 190 天。
for excluded in \
  "$KC_UNSELECTED_MARKER:a Keycloak event type outside the declared list" \
  "$KC_RUNTIME_MARKER:ordinary Keycloak runtime output" \
  "$CADDY_RUNTIME_MARKER:ordinary Caddy runtime output" \
  "$APK:an Android APK download" \
  "$MARKER_TX:backend product telemetry" \
  "$MARKER:backend debug output"; do
  marker="${excluded%%:*}"
  description="${excluded#*:}"
  if grep -Fq "$marker" <<<"$compliance_body"; then
    fail "$description must never be labelled compliance=security (190-day retention)"
  fi
done
echo "PASS: only the declared security logs carry compliance=security"

# Loki parses its metric and log queries, including variable interpolation.
# Prometheus targets are validated by promtool in the observability CI job.
python3 - "$ROOT" "$LOKI_PORT" <<'PYQUERY'
from pathlib import Path
import json, urllib.parse, urllib.request,sys,time
root = Path(sys.argv[1])
port = sys.argv[2]
api = "http://127.0.0.1:"+port+"/loki/api/v1/"
for file in (root / 'deploy/observability/grafana/dashboards').glob('*.json'):
 for panel in json.loads(file.read_text())['panels']:
  for target in panel.get('targets',[]):
   datasource=target.get('datasource') or panel.get('datasource') or {}
   if datasource.get('uid') != 'loki':
    continue
   expr=target['expr'].replace('$__range','1h').replace('$__interval','1m').replace('${service:raw}','.+').replace('${keyword:doublequote}','""').replace('${errorId:doublequote}','""')
   endpoint='query_range' if panel['type']=='logs' else 'query'
   try:
    with urllib.request.urlopen(api+endpoint+'?'+urllib.parse.urlencode({'query':expr}), timeout=30) as resp: result=json.load(resp)
    assert result['status']=='success'
    print('PASS',panel['title'])
   except urllib.error.HTTPError as err:
    print('FAIL',panel['title'],err.read().decode(),expr);raise

# Query semantics against deterministic fixtures, isolated from ongoing Docker emitters.
scope = "product-query-" + str(time.time_ns())
now = time.time_ns()
def line(message, level="INFO"):
    return json.dumps({"level": level, "message": message})
backend = []
for account in range(1000):
    for platform in ("web", "android"):
        backend.append(line(f"event=product_telemetry telemetry_event=active_user account_hash=user{account} platform={platform} error_code= error_id="))
backend += [line("event=product_telemetry telemetry_event=feature_open feature=armor platform=web event_id=open1 error_code= error_id="),
            line("event=product_telemetry telemetry_event=replay_parse feature=replay_parse platform=android event_id=start1 outcome=start error_code= error_id="),
            line("event=product_telemetry telemetry_event=replay_parse feature=replay_parse platform=android event_id=fail1 outcome=failure error_code=PARSE_FAILED error_id=safe-id"),
            line("api_request_failed path=/api/hof errorCode=INTERNAL_ERROR id=fixture-error", "ERROR"),
            line("api_request_failed path=/api/admin/users errorCode=INTERNAL_ERROR id=fixture-admin-error", "ERROR")]
ai = [line("event=ai_token_usage mode=SINGLE_PLAYER_BATTLE inputTokens=10 outputTokens=5 totalTokens=15 usageMissing=0"),
      line("event=ai_token_usage mode=SINGLE_PLAYER_BATTLE inputTokens=20 outputTokens=10 totalTokens=30 usageMissing=0"),
      line("event=ai_token_usage mode=TOURNAMENT_GROUP_RECOGNITION inputTokens=900 outputTokens=100 totalTokens=1000 usageMissing=0"),
      line("event=ai_token_usage mode=SINGLE_PLAYER_BATTLE inputTokens=0 outputTokens=0 totalTokens=0 usageMissing=1"),
      line("event=ai_review_usage inputTokens=30 outputTokens=15 totalTokens=45 calls=3 missingUsageCalls=1 result=success errorCode=none"),
      line("event=ai_review_usage inputTokens=0 outputTokens=0 totalTokens=0 calls=1 missingUsageCalls=1 result=failure errorCode=AI_TIMEOUT"),
      line("event=ai_review_error feature=ai_review errorCode=AI_TIMEOUT", "WARN")]
streams=[]
for name, values in [("wotb-backend",backend),("ai-service",ai)]:
    streams.append({"stream":{"container_name":name,"test_scope":scope},
                    "values":[[str(now - 1000000000 + i), value] for i,value in enumerate(values)]})
request=urllib.request.Request(api+"push", data=json.dumps({"streams":streams}).encode(),headers={"Content-Type":"application/json"})
with urllib.request.urlopen(request,timeout=30) as response:
    assert response.status==204

def run(uid,title,logs=False):
    d=json.loads((root/"deploy/observability/grafana/dashboards"/(uid+".json")).read_text(encoding="utf-8"))
    p=next(p for p in d["panels"] if p["title"]==title)
    expr=p["targets"][0]["expr"].replace("$__range","7d").replace("$__interval","1m")
    expr=expr.replace("${service:raw}",".+").replace("${keyword:doublequote}",'""').replace("${errorId:doublequote}",'""')
    expr=expr.replace("{container_name=",'{test_scope="'+scope+'",container_name=')
    started=time.monotonic()
    endpoint="query_range" if logs else "query"
    with urllib.request.urlopen(api+endpoint+"?"+urllib.parse.urlencode({"query":expr}),timeout=30) as response:
        result=json.load(response)
    assert result["status"]=="success",result
    print(f"PASS fixture {title} ({time.monotonic()-started:.3f}s)")
    return result["data"]["result"]
def scalar(uid,title):
    result=run(uid,title)
    assert len(result)==1,result
    return float(result[0]["value"][1])
assert scalar("wotbtools-active-users","所选时间内活跃登录用户")==1000
assert scalar("wotbtools-feature-usage","解析发起次数")==1
assert scalar("wotbtools-ai-token-usage","已知总 token")==45
assert scalar("wotbtools-ai-token-usage","平均每次完成复盘 token")==22.5
assert scalar("wotbtools-ai-token-usage","缺失 usage 调用数")==1
for title, expected in [("账号与登录 · 日志",1),("AI 复盘 · 日志",1),("名人堂 · 日志",1),("回放解析错误（客户端上报） · 日志",1),("其他后端错误 · 日志",0)]:
    result=run("wotbtools-backend-error-logs",title,True)
    values=[value for stream in result for value in stream["values"]]
    assert len(values)==expected,(title,values)
print("PASS: cross-platform dedup of 1000 accounts, seven-day query, parse counts, AI totals/average/missing usage, error-only rows")
PYQUERY

echo "OK: production Alloy Docker discovery, normalization, redaction, and Loki ingestion passed"
