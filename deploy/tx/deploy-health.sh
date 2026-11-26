#!/usr/bin/env bash
sanitize_probe_error() {
  local error_file="$1" sanitized
  sanitized="$(LC_ALL=C tr '\r\n' ' ' < "$error_file" | LC_ALL=C tr -cd '[:print:][:space:]' | \
    sed -E -e 's/[[:space:]]+/ /g' -e 's#(https?://)[^/@[:space:]]+@#\1REDACTED@#g' \
      -e 's/([Aa]uthorization:[[:space:]]*)([Bb]earer[[:space:]]+)?[^[:space:]]+/\1REDACTED/g' \
      -e 's/([Tt]oken|[Ss]ecret|[Pp]assword|[Aa][Pp][Ii][-_]?[Kk]ey)[=:][^[:space:]]*/\1=REDACTED/g')"
  sanitized="${sanitized# }"
  sanitized="${sanitized% }"
  printf '%.500s' "${sanitized:-no stderr output}"
}

probe_http() {
  local service="$1" url="$2" host_header="${3:-}" output stderr_file exit_code stderr_output
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --output /dev/null --write-out '%{http_code}')
  local -a compose_args=(-p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE")
  if [ "${TX_DEPLOY_LIBRARY_ONLY:-0}" = 1 ]; then
    compose_args=(-f "$LIVE_COMPOSE")
  fi
  PROBE_LAST_SERVICE="$service"
  PROBE_LAST_URL="$url"
  PROBE_LAST_HTTP_STATUS="unavailable"
  PROBE_LAST_ERROR=""
  [ -n "$host_header" ] && args+=(--header "$host_header")
  args+=("$url")
  stderr_file="$(mktemp)" || { FAILED_SERVICE="$service"; return 1; }
  if output="$(docker compose "${compose_args[@]}" run --rm --no-deps health-probe "${args[@]}" 2>"$stderr_file")"; then
    exit_code=0
  else
    exit_code=$?
  fi
  stderr_output="$(sanitize_probe_error "$stderr_file")"
  rm -f -- "$stderr_file"
  [[ "$output" =~ ^[0-9]{3}$ ]] && PROBE_LAST_HTTP_STATUS="$output"
  if [ "$exit_code" -ne 0 ]; then
    PROBE_LAST_ERROR="compose/curl exited with status $exit_code: $stderr_output"
    FAILED_SERVICE="$service"
    return 1
  fi
  if [ "$PROBE_LAST_HTTP_STATUS" = unavailable ]; then
    PROBE_LAST_ERROR="curl stdout did not contain exactly one three-digit HTTP status: $stderr_output"
    FAILED_SERVICE="$service"
    return 1
  fi
  if [[ "$PROBE_LAST_HTTP_STATUS" =~ ^2[0-9]{2}$ ]]; then
    return 0
  fi
  PROBE_LAST_ERROR="HTTP status $PROBE_LAST_HTTP_STATUS is not 2xx: $stderr_output"
  FAILED_SERVICE="$service"
  return 1
}

wait_for_probe() {
  local service="$1" url="$2" host_header="${3:-}" attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if probe_http "$service" "$url" "$host_header"; then
      echo "$service: PASS"
      return 0
    fi
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "$service: FAIL" >&2
  return 1
}

wait_for_database() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if docker compose -p deploy -f "$LIVE_DEPLOY_DIR/keycloak-postgres.compose.yml" exec -T keycloak-postgres \
      pg_isready -U "$KC_POSTGRES_ADMIN_USER" -d postgres >/dev/null 2>&1; then
      echo "keycloak-postgres: PASS"
      return 0
    fi
    FAILED_SERVICE="keycloak-postgres"
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "keycloak-postgres: FAIL" >&2
  return 1
}

wait_for_business_database() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if docker compose -p deploy -f "$LIVE_DEPLOY_DIR/business-postgres.compose.yml" exec -T business-postgres \
      pg_isready -U "$TX_BUSINESS_POSTGRES_ADMIN_USER" -d postgres >/dev/null 2>&1; then
      echo "business-postgres: PASS"
      return 0
    fi
    FAILED_SERVICE="business-postgres"
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "business-postgres: FAIL" >&2
  return 1
}

tx_alloy_health() {
  local canary_id="deploy-$(date +%s)-$$"
  TX_ALLOY_BACKEND_CANARY="business-api-observability-canary-${canary_id}"
  TX_ALLOY_KEYCLOAK_CANARY="keycloak-observability-canary-${canary_id}"
  local backend_name="$TX_ALLOY_BACKEND_CANARY" keycloak_name="$TX_ALLOY_KEYCLOAK_CANARY"
  local backend_marker="wotb-backend-canary-${canary_id}"
  local keycloak_marker="wotb-keycloak-canary-${canary_id}"
  local frontend_apk="observability-canary-${canary_id}.apk"
  local start_ns="$(( $(date +%s) ))000000000"
  local end_ns body attempt
  cleanup_tx_alloy_canaries() {
    docker rm -f "$TX_ALLOY_BACKEND_CANARY" "$TX_ALLOY_KEYCLOAK_CANARY" >/dev/null 2>&1 || true
    TX_ALLOY_BACKEND_CANARY="" TX_ALLOY_KEYCLOAK_CANARY=""
  }
  trap cleanup_tx_alloy_canaries RETURN

  if ! docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" ps -a alloy-tx | grep -Eq 'Up|running'; then
    echo "alloy-tx: FAIL (container is not running)" >&2
    FAILED_SERVICE=alloy-tx
    return 1
  fi
  if ! docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" run --rm --no-deps health-probe \
    --silent --show-error --fail --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" http://10.20.0.2:3100/ready | grep -Fxq ready; then
    FAILED_SERVICE=alloy-tx
    return 1
  fi

  docker run -d --network wotb_tx_internal \
    --label com.docker.compose.service=business-api \
    --name "$backend_name" alpine:3.22 \
    sh -c "printf '%s\n' '$backend_marker'; sleep 90" >/dev/null \
    || { FAILED_SERVICE=alloy-tx; return 1; }
  docker run -d --network wotb_tx_internal \
    --label com.docker.compose.service=keycloak \
    --name "$keycloak_name" alpine:3.22 \
    sh -c "printf '%s\n' '$keycloak_marker'; sleep 90" >/dev/null \
    || { FAILED_SERVICE=alloy-tx; return 1; }
  probe_http frontend-canary "http://wotb-frontend/download/android/$frontend_apk" 'Host: wotbtools.com' >/dev/null 2>&1 || true
  FAILED_SERVICE=alloy-tx

  loki_query_body() {
    local selector="$1" marker="$2" range_start="$3" range_end="$4"
    docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" run --rm --no-deps health-probe \
      --silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
      --max-time "$PROBE_MAX_TIME_SEC" -G "http://10.20.0.2:3100/loki/api/v1/query_range" \
      --data-urlencode "query=${selector} |= \"${marker}\"" \
      --data-urlencode "start=${range_start}" \
      --data-urlencode "end=${range_end}" \
      --data-urlencode "limit=1" 2>/dev/null
  }
  loki_response_has_marker() {
    local body="$1" marker="$2"
    grep -Eq '"status"[[:space:]]*:[[:space:]]*"success"' <<<"$body" \
      && grep -Eq '"values"' <<<"$body" \
      && grep -Fq "$marker" <<<"$body"
  }
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    end_ns="$(( $(date +%s) + 2 ))000000000"
    backend_body="$(loki_query_body '{container_name="wotb-backend"}' "$backend_marker" "$start_ns" "$end_ns" || true)"
    keycloak_body="$(loki_query_body '{container_name="keycloak"}' "$keycloak_marker" "$start_ns" "$end_ns" || true)"
    frontend_body="$(loki_query_body '{container_name="wotb-frontend",event="android_apk_download"}' "$frontend_apk" "$start_ns" "$end_ns" || true)"
    if loki_response_has_marker "$backend_body" "$backend_marker" \
      && loki_response_has_marker "$keycloak_body" "$keycloak_marker" \
      && loki_response_has_marker "$frontend_body" "$frontend_apk" \
      && grep -Fq 'event=android_apk_download' <<<"$frontend_body" \
      && grep -Fq "apk=$frontend_apk" <<<"$frontend_body" \
      && grep -Fq 'status=404' <<<"$frontend_body" \
      && ! grep -Fq 'User-Agent' <<<"$frontend_body" \
      && ! grep -Fq 'Referer' <<<"$frontend_body"; then
      echo "alloy-tx: PASS (backend/keycloak/sanitized APK streams reached Loki over WireGuard)"
      return 0
    fi
    [ "$attempt" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL_SEC"
  done
  echo "alloy-tx: FAIL (business log streams did not reach the Yecao Loki)" >&2
  return 1
}

blocking_health() {
  if is_selected keycloak-postgres || is_selected keycloak; then
    wait_for_database || return 1
  fi
  if is_selected business-postgres; then
    wait_for_business_database || return 1
  fi
  if is_selected keycloak; then
    if [ "$BOOTSTRAP_KEYCLOAK" = 1 ]; then
      wait_for_probe keycloak http://keycloak:8080/realms/master/.well-known/openid-configuration || return 1
    else
      wait_for_probe keycloak http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration || return 1
    fi
  fi
  if is_selected business-api; then
    wait_for_probe tx-business-api http://business-api:8088/actuator/health || return 1
    wait_for_probe business-api-app http://business-api:8087/api/health || return 1
  fi
  if is_selected wotb-frontend; then
    docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" exec -T wotb-frontend nginx -t >/dev/null \
      || { FAILED_SERVICE=frontend-static; echo "frontend nginx config: FAIL" >&2; return 1; }
    wait_for_probe frontend-static http://wotb-frontend/ 'Host: wotbtools.com' || return 1
    wait_for_probe frontend-api http://wotb-frontend/api/health 'Host: wotbtools.com' || return 1
  fi
  if is_selected caddy; then
    wait_for_probe caddy-ready http://caddy/_wotb/ready || return 1
    wait_for_probe caddy-upstream-frontend http://caddy/_wotb/frontend/api/health || return 1
    wait_for_probe caddy-upstream-keycloak http://caddy/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration || return 1
    wait_for_probe caddy-upstream-monitor http://caddy/_wotb/monitor/api/health || return 1
  fi
  if is_selected alloy-tx; then
    tx_alloy_health || return 1
  fi
}
