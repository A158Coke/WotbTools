#!/usr/bin/env bash
stage_and_validate() {
  local source="$INCOMING_DIR/docker-compose.yml"
  readonly EFFECTIVE_COMPOSE="$INCOMING_DIR/$SERVICE_COMPOSE"
  [ -f "$source" ] || die "staged TX deployment tree is missing docker-compose.yml."
  [ -f "$INCOMING_DIR/common.compose.yml" ] || die "staged TX common compose is missing."
  [ -f "$EFFECTIVE_COMPOSE" ] || die "staged TX selected compose is missing: $SERVICE_COMPOSE"
  [ -f "$INCOMING_DIR/business-postgres.compose.yml" ] \
    || die "staged TX deployment tree is missing business-postgres.compose.yml."
  [ -f "$INCOMING_DIR/keycloak-postgres.compose.yml" ] \
    || die "staged TX deployment tree is missing keycloak-postgres.compose.yml."
  [ -f "$INCOMING_DIR/runtime-check.sh" ] || die "staged TX deployment tree is missing runtime-check.sh."
  [ -f "$INCOMING_DIR/runtime-check-lib.sh" ] || die "staged TX deployment tree is missing runtime-check-lib.sh."
  if is_selected wotb-frontend; then
    [ -f "$INCOMING_DIR/nginx/frontend.conf.template" ] || die "staged TX deployment tree is missing frontend nginx template."
    # The AI route is a routing boundary, not a tuning detail: it must stay a
    # more-specific ^~ prefix ahead of the generic /api/ route, must proxy to the
    # Yecao upstream without rewriting the path (public and controller paths are both
    # /api/ai/...), and the generic /api/ route must remain on the TX business runtime.
    grep -Fq 'location ^~ /api/ai/ {' "$INCOMING_DIR/nginx/frontend.conf.template" \
      || die "staged TX frontend template is missing the /api/ai/ route to the standalone AI service."
    grep -Fq 'proxy_pass ${AI_UPSTREAM};' "$INCOMING_DIR/nginx/frontend.conf.template" \
      || die "staged TX AI route must proxy to the AI upstream without rewriting /api/ai/."
    grep -Fq 'proxy_pass ${BACKEND_UPSTREAM}/api/;' "$INCOMING_DIR/nginx/frontend.conf.template" \
      || die "staged TX frontend template must keep the generic /api/ route on the TX business runtime."
  fi
  if is_selected caddy; then
    [ -f "$INCOMING_DIR/Caddyfile" ] || die "staged TX deployment tree is missing Caddyfile."
    [ -f "$INCOMING_DIR/assets/auth/.well-known/assetlinks.json" ] \
      || die "staged TX deployment tree is missing Caddy's assetlinks file."
  fi
  if is_selected alloy-tx; then
    [ -f "$INCOMING_DIR/alloy/config.alloy" ] || die "staged TX Alloy config is missing."
    local validator="$(dirname "$INCOMING_DIR")/validate-alloy-config.sh"
    [ -f "$validator" ] || die "staged Alloy validator is missing."
    bash "$validator" "$INCOMING_DIR/alloy/config.alloy" \
      || die "staged TX Alloy config validation failed; live TX deployment was not changed."
  fi
  if is_selected wotb-frontend; then
    # Android releases are optional runtime content. Sponsor QR content is not a
    # host mount anymore (published to the object-storage asset plane).
    mkdir -p "$TX_RUNTIME_ROOT/android-release"
  fi
  export TX_RUNTIME_ROOT
  export TX_BACKEND_UPSTREAM="$BACKEND_UPSTREAM_VALUE"
  export TX_AI_UPSTREAM="$AI_UPSTREAM_VALUE"
  export TX_BUSINESS_DB_HOST="$BUSINESS_DB_HOST_VALUE"
  export TX_BUSINESS_DB_PORT="$BUSINESS_DB_PORT_VALUE"
  export TX_KEYCLOAK_ADMIN_SERVER_URL="$KEYCLOAK_ADMIN_SERVER_URL_VALUE"
  export TX_KEYCLOAK_DB_HOST="$KEYCLOAK_DB_HOST_VALUE"
  export TX_KEYCLOAK_DB_PORT="$KEYCLOAK_DB_PORT_VALUE"
  export CADDY_FRONTEND_UPSTREAM="$CADDY_FRONTEND_UPSTREAM_VALUE"
  export CADDY_KEYCLOAK_UPSTREAM="$CADDY_KEYCLOAK_UPSTREAM_VALUE"
  assert_routing_boundary "$EFFECTIVE_COMPOSE"
  local compose_json
  compose_json="$(docker compose -p deploy -f "$INCOMING_DIR/common.compose.yml" -f "$EFFECTIVE_COMPOSE" config --format json)" \
    || die "staged TX compose config is invalid; live TX deployment was not changed."
  case "$DEPLOY_SERVICES_RAW" in
    wotb-frontend|business-api|keycloak|keycloak-postgres|business-postgres)
      source "$INCOMING_DIR/runtime-check-lib.sh"
      assert_tx_service_ports "$DEPLOY_SERVICES_RAW" <<< "$compose_json" \
        || die "staged TX service bindings are invalid; live TX deployment was not changed."
      ;;
  esac
  if is_selected caddy; then
    bash "$INCOMING_DIR/validate-caddy-config.sh" "$INCOMING_DIR" \
      || die "staged Caddy configuration is invalid; the live gateway was not changed."
  fi
}

assert_stateful_volume_identity() {
  local service="$DEPLOY_SERVICES_RAW" fragment volume_key volume_name volume_target container_id mounted_volume volume_project
  case "$service" in
    business-postgres)
      fragment="$INCOMING_DIR/business-postgres.compose.yml"
      volume_key=business_postgres_data
      volume_name=deploy_business_postgres_data
      volume_target=/var/lib/postgresql
      ;;
    keycloak-postgres)
      fragment="$INCOMING_DIR/keycloak-postgres.compose.yml"
      volume_key=keycloak_postgres_data
      volume_name=deploy_keycloak_postgres_data
      volume_target=/var/lib/postgresql
      ;;
    business-api)
      fragment="$INCOMING_DIR/business-api.compose.yml"
      volume_key=replay_data
      volume_name=deploy_replay_data
      volume_target=/data/replays
      ;;
    *) return 0 ;;
  esac

  if ! docker compose -p deploy -f "$fragment" config --format json | python3 -c '
import json
import sys

service, volume_key, volume_name, volume_target = sys.argv[1:]
data = json.load(sys.stdin)
valid = (
    data.get("name") == "deploy"
    and (data.get("volumes", {}).get(volume_key) or {}).get("name") == volume_name
    and (data.get("networks", {}).get("default") or {}).get("name") == "wotb_tx_internal"
    and any(
        mount.get("type") == "volume"
        and mount.get("source") == volume_key
        and mount.get("target") == volume_target
        for mount in data["services"][service].get("volumes", [])
    )
)
if not valid:
    raise SystemExit(1)
' "$service" "$volume_key" "$volume_name" "$volume_target"; then
    die "$service Compose project, network, or persistent volume identity is invalid."
  fi
  docker volume inspect "$volume_name" >/dev/null 2>&1 \
    || die "authoritative persistent volume is missing: $volume_name"
  volume_project="$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$volume_name")" \
    || die "could not inspect persistent volume ownership: $volume_name"
  local actual_volume_key
  actual_volume_key="$(docker volume inspect --format '{{ index .Labels "com.docker.compose.volume" }}' "$volume_name")" \
    || die "could not inspect persistent volume key: $volume_name"
  [ "$volume_project" = deploy ] && [ "$actual_volume_key" = "$volume_key" ] \
    || die "persistent volume ownership differs from the expected Compose identity: $volume_name"
  docker network inspect wotb_tx_internal >/dev/null 2>&1 \
    || die "TX runtime network is missing; refusing to create a separate network for $service."
  container_id="$(docker compose -p deploy -f "$fragment" ps -aq "$service")" \
    || die "could not inspect the current $service container."
  if [ -n "$container_id" ]; then
    mounted_volume="$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$volume_target\"}}{{.Name}}{{end}}{{end}}" "$container_id")" \
      || die "could not inspect the current $service volume mount."
    [ "$mounted_volume" = "$volume_name" ] \
      || die "$service is attached to a different data volume; refusing recreation."
  fi
}

# Fail closed on the production invariants this routing boundary establishes:
#   1. the frontend proxies public API traffic only to the reviewed logical
#      Business API endpoint while /api/ai/ goes to Yecao over WireGuard, and no
#      staged service references the retired Yecao backend endpoint;
#   2. the business runtime has no replay execution plane at all (replay parsing
#      runs in the browser), so a future edit cannot silently re-introduce a
#      server-side replay job switch in production.
assert_routing_boundary() {
  local compose_file="$1"
  if is_selected wotb-frontend; then
    grep -Fq 'BACKEND_UPSTREAM: ${TX_BACKEND_UPSTREAM:-http://business-api:8087}' "$compose_file" \
      || die "staged TX frontend must retain the Docker-local Business API default."
    grep -Fq 'AI_UPSTREAM: ${TX_AI_UPSTREAM:-http://10.20.0.2:8089}' "$compose_file" \
      || die "staged TX frontend must default /api/ai/ to the Yecao ai-service WireGuard endpoint."
  fi
  ! grep -Eq '10\.20\.0\.2:8087' "$compose_file" \
    || die "staged TX compose must not reference the retired Yecao backend endpoint."
  if is_selected business-api; then
    # 服务端没有回放解析：已退役的执行模式与 job 后端选择器开关都不得出现。
    ! grep -Fq 'WOTB_REPLAY_EXECUTION_MODE' "$compose_file" \
      || die "the retired replay execution-mode switch must not appear in production."
    ! grep -Fq 'WOTB_REPLAY_PROCESSING_JOB_REPOSITORY' "$compose_file" \
      || die "the retired replay job-repository switch must not appear in production."
  fi
}

pull_images() {
  docker compose -p deploy -f "$INCOMING_DIR/common.compose.yml" -f "$EFFECTIVE_COMPOSE" pull "$DEPLOY_SERVICES_RAW"
}
require_frontend_backend() {
  is_selected wotb-frontend || return 0
  local health
  # Check the validated upstream used by this frontend, before promoting any live
  # files. Do not wait under the shared deploy lock: the backend may be queued.
  if ! health="$(docker compose -p deploy -f "$INCOMING_DIR/common.compose.yml" -f "$EFFECTIVE_COMPOSE" \
    run --rm --no-deps health-probe --fail --silent --show-error \
    --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" --max-time "$PROBE_MAX_TIME_SEC" \
    "$BACKEND_UPSTREAM_VALUE/api/health")"; then
    die "Business API capability probe failed; live frontend was not changed. Rerun after backend readiness."
  fi
  assert_frontend_backend_capabilities <<< "$health" \
    || die "Business API is not ready for this frontend; live frontend was not changed."
}
promote_files() {
  local next_deploy="$WOTB_DIR/deploy.next.$$" old_deploy="$WOTB_DIR/deploy.old.$$"
  rm -rf -- "$next_deploy" || return 1
  mkdir -p "$next_deploy" || return 1
  if [ -d "$LIVE_DEPLOY_DIR" ]; then
    cp -a "$LIVE_DEPLOY_DIR/." "$next_deploy/" || return 1
  fi
  [ -f "$INCOMING_DIR/deploy.sh" ] || die "staged TX deployment script is missing."
  if is_selected wotb-frontend; then
    [ -f "$INCOMING_DIR/with-deploy-lock.sh" ] || die "staged TX deployment lock wrapper is missing."
  fi
  [ -f "$INCOMING_DIR/business-postgres.compose.yml" ] || die "staged Business PostgreSQL compose fragment is missing."
  [ -f "$INCOMING_DIR/keycloak-postgres.compose.yml" ] || die "staged Keycloak PostgreSQL compose fragment is missing."
  [ -f "$INCOMING_DIR/runtime-check.sh" ] || die "staged TX runtime check is missing."
  [ -f "$INCOMING_DIR/runtime-check-lib.sh" ] || die "staged TX runtime check library is missing."
  [ -f "$INCOMING_DIR/docker-compose.yml" ] || die "staged TX compose file is missing."
  cp -f "$INCOMING_DIR/deploy.sh" "$next_deploy/deploy.sh" || return 1
  cp -f "$INCOMING_DIR/deploy-stage.sh" "$next_deploy/deploy-stage.sh" || return 1
  cp -f "$INCOMING_DIR/deploy-health.sh" "$next_deploy/deploy-health.sh" || return 1
  if is_selected wotb-frontend; then
    cp -f "$INCOMING_DIR/with-deploy-lock.sh" "$next_deploy/with-deploy-lock.sh" || return 1
  fi
  cp -f "$INCOMING_DIR/runtime-check.sh" "$next_deploy/runtime-check.sh" || return 1
  cp -f "$INCOMING_DIR/runtime-check-lib.sh" "$next_deploy/runtime-check-lib.sh" || return 1
  cp -f "$INCOMING_DIR/runtime-business-probes.sh" "$next_deploy/runtime-business-probes.sh" || return 1
  cp -f "$INCOMING_DIR/docker-compose.yml" "$next_deploy/docker-compose.yml" || return 1
  cp -f "$INCOMING_DIR/common.compose.yml" "$next_deploy/common.compose.yml" || return 1
  for compose_fragment in frontend business-api keycloak caddy alloy-tx; do
    cp -f "$INCOMING_DIR/$compose_fragment.compose.yml" "$next_deploy/$compose_fragment.compose.yml" || return 1
  done
  if [ "$DEPLOY_SERVICES_RAW" = business-postgres ] || [ ! -f "$next_deploy/business-postgres.compose.yml" ]; then
    cp -f "$INCOMING_DIR/business-postgres.compose.yml" "$next_deploy/business-postgres.compose.yml" || return 1
  fi
  if [ "$DEPLOY_SERVICES_RAW" = keycloak-postgres ] || [ ! -f "$next_deploy/keycloak-postgres.compose.yml" ]; then
    cp -f "$INCOMING_DIR/keycloak-postgres.compose.yml" "$next_deploy/keycloak-postgres.compose.yml" || return 1
  fi
  chmod 600 "$next_deploy/docker-compose.yml" || return 1
  case "$DEPLOY_SERVICES_RAW" in
    wotb-frontend)
      mkdir -p "$next_deploy/nginx" || return 1
      cp -a "$INCOMING_DIR/nginx/." "$next_deploy/nginx/" || return 1
      ;;
    caddy)
      cp -f "$INCOMING_DIR/Caddyfile" "$next_deploy/Caddyfile" || return 1
      mkdir -p "$next_deploy/assets/auth/.well-known" || return 1
      cp -f "$INCOMING_DIR/assets/auth/.well-known/assetlinks.json" \
        "$next_deploy/assets/auth/.well-known/assetlinks.json" || return 1
      ;;
    keycloak)
      cp -f "$INCOMING_DIR/keycloak-tofu.sh" "$next_deploy/keycloak-tofu.sh" || return 1
      ;;
    business-postgres)
      cp -f "$INCOMING_DIR/business-postgres.tofurc" "$next_deploy/business-postgres.tofurc" || return 1
      ;;
    alloy-tx)
      mkdir -p "$next_deploy/alloy" || return 1
      cp -f "$INCOMING_DIR/alloy/config.alloy" "$next_deploy/alloy/config.alloy" || return 1
      ;;
  esac
  if [ -e "$LIVE_DEPLOY_DIR" ]; then
    mv -- "$LIVE_DEPLOY_DIR" "$old_deploy" || return 1
  fi
  if ! mv -- "$next_deploy" "$LIVE_DEPLOY_DIR"; then
    [ -e "$old_deploy" ] && mv -- "$old_deploy" "$LIVE_DEPLOY_DIR"
    return 1
  fi
  rm -rf -- "$old_deploy"
}

reload_frontend_trusted_peer() {
  local output
  if ! output="$(docker compose -p deploy -f "$LIVE_DEPLOY_DIR/frontend.compose.yml" exec -T wotb-frontend nginx -t 2>&1)"; then
    echo "ERROR: the running frontend nginx configuration is invalid; Caddy's trusted peer was not refreshed." >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
  if ! docker compose -p deploy -f "$LIVE_DEPLOY_DIR/frontend.compose.yml" exec -T wotb-frontend nginx -s reload; then
    echo "ERROR: the running frontend container could not reload nginx to re-resolve Caddy's address." >&2
    return 1
  fi
  echo "frontend-trusted-peer: PASS (nginx re-resolved Caddy in the running container)"
}

apply_services() {
  APPLY_SERVICES=("$DEPLOY_SERVICES_RAW")
  if ! docker compose -p deploy -f "$LIVE_COMMON" -f "$LIVE_COMPOSE" up -d --no-deps --force-recreate "$DEPLOY_SERVICES_RAW"; then
    FAILED_SERVICE="$DEPLOY_SERVICES_RAW"
    return 1
  fi
  if [ "$DEPLOY_SERVICES_RAW" = caddy ]; then
    reload_frontend_trusted_peer || return 1
  fi
}
