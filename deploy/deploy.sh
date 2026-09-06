#!/usr/bin/env bash
# Production deployment with staged validation, atomic tree promotion and full rollback.
set -euo pipefail

readonly WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
readonly INCOMING_DIR="${WOTB_INCOMING_DIR:-$WOTB_DIR/deploy.incoming}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
readonly PREV_DEPLOY_DIR="$WOTB_DIR/deploy.prev"
readonly HEALTH_RETRIES="${WOTB_HEALTH_RETRIES:-60}"

if [[ ! "$HEALTH_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: WOTB_HEALTH_RETRIES must be a positive integer." >&2
  exit 1
fi
if [ -z "$WOTB_DIR" ] || [ "$WOTB_DIR" = "/" ] || [ -z "$INCOMING_DIR" ] || [ "$INCOMING_DIR" = "/" ]; then
  echo "ERROR: refusing to operate on an unsafe deployment path." >&2
  exit 1
fi

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name secret is not configured." >&2
    exit 1
  fi
}
for required in TAG DB_PASSWORD KC_ADMIN_PASSWORD WG_APPLICATION_ID KEYCLOAK_ADMIN_CLIENT_SECRET AI_API_KEY GRAFANA_ADMIN_USER GRAFANA_ADMIN_PASSWORD; do
  require_env "$required"
done

if [ -n "${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:-}" ] \
    && [ "$AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC" != "1100" ]; then
  printf 'ERROR: AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC must be 1100 to stay aligned with frontend(1100s)/nginx(1120s); got %s\n' \
    "$AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC" >&2
  exit 3
fi

mkdir -p "$WOTB_DIR"
cd "$WOTB_DIR"
readonly STAGED_DEPLOY_DIR="$INCOMING_DIR/deploy"
readonly STAGED_COMPOSE="$INCOMING_DIR/docker-compose.next.yml"
if [ ! -f "$STAGED_DEPLOY_DIR/docker-compose.prod.yml" ]; then
  echo "ERROR: staged deployment tree is missing: $STAGED_DEPLOY_DIR/docker-compose.prod.yml" >&2
  exit 1
fi

# Compose paths are relative to the incoming project root. Application data is
# shared explicitly; deployment/config files remain inside the staged tree.
mkdir -p "$INCOMING_DIR" "$WOTB_DIR/config/sponsor" "$WOTB_DIR/android-release"
ln -sfn "$WOTB_DIR/config" "$INCOMING_DIR/config"
ln -sfn "$WOTB_DIR/android-release" "$INCOMING_DIR/android-release"
if [ ! -e "$WOTB_DIR/config/sponsor-config.json" ] && [ -f "$STAGED_DEPLOY_DIR/sponsor-config.example.json" ]; then
  install -m 644 "$STAGED_DEPLOY_DIR/sponsor-config.example.json" "$WOTB_DIR/config/sponsor-config.json"
fi

PREV_SHA=""
if [ -f DEPLOYED_SHA ]; then PREV_SHA=$(cat DEPLOYED_SHA); fi
if [ -f docker-compose.yml ] && [ -x "$LIVE_DEPLOY_DIR/postgres-backup.sh" ]; then
  "$LIVE_DEPLOY_DIR/postgres-backup.sh" --database wotb
  "$LIVE_DEPLOY_DIR/postgres-backup.sh" --database keycloak
else
  echo "No existing deployment; skipping pre-deploy backup."
fi

umask 177
printf 'GRAFANA_ADMIN_USER=%s\nGRAFANA_ADMIN_PASSWORD=%s\n' \
  "$GRAFANA_ADMIN_USER" "$GRAFANA_ADMIN_PASSWORD" > .env
chmod 600 .env

cp -f "$STAGED_DEPLOY_DIR/docker-compose.prod.yml" "$STAGED_COMPOSE"
if ! docker compose -f "$STAGED_COMPOSE" config > "$INCOMING_DIR/docker-compose.next.resolved.yml"; then
  echo "ERROR: staged compose config is invalid; live deployment was not changed." >&2
  exit 1
fi
chmod 600 "$INCOMING_DIR/docker-compose.next.resolved.yml"

pull_compose() {
  local compose_file="$1" attempt
  for attempt in 1 2 3; do
    if docker compose -f "$compose_file" pull; then return 0; fi
    if [ "$attempt" -lt 3 ]; then
      echo "docker compose pull failed (${compose_file}, attempt $attempt), retrying in 10s..."
      sleep 10
    fi
  done
  return 1
}

assert_service_running() {
  local service="$1" label="$2" status
  status="$(docker compose ps -a "$service" 2>/dev/null || true)"
  if ! grep -qE "Up|running" <<<"$status" || grep -qE "Restarting|Exited|Dead" <<<"$status"; then
    echo "ERROR: ${label} is not running." >&2
    return 1
  fi
}

apply_observability_services() {
  echo "== Recreating Prometheus/Loki/Alloy/Grafana with promoted configuration =="
  docker compose up -d --force-recreate prometheus loki alloy grafana
  assert_service_running prometheus Prometheus
  assert_service_running loki Loki
  assert_service_running alloy Alloy
  assert_service_running grafana Grafana
}

wait_healthy() {
  local i ok
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if docker compose ps -a | grep -E "wotb-backend|wotb-frontend|keycloak|prometheus|loki|alloy|grafana" | grep -qE "Restarting|Exited|Dead"; then
      sleep 2; continue
    fi
    ok=true
    docker compose exec -T wotb-backend wget -qO- http://127.0.0.1:8087/api/health >/dev/null 2>&1 || ok=false
    [ "$ok" = true ] && docker compose exec -T wotb-frontend wget -qO- http://127.0.0.1:80/api/health >/dev/null 2>&1 || ok=false
    [ "$ok" = true ] && docker compose exec -T wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration >/dev/null 2>&1 || ok=false
    if [ "$ok" = true ]; then return 0; fi
    [ "$i" -lt "$HEALTH_RETRIES" ] && sleep 2
  done
  echo "Health check failed:" >&2
  report_health_status
  return 1
}

verify_observability() { bash "$LIVE_DEPLOY_DIR/verify-observability.sh"; }

report_health_status() {
  local running
  running="$(docker compose ps -a 2>/dev/null || true)"
  probe() {
    local label="$1" service="$2"; shift 2
    if ! grep -qE "$service" <<<"$running"; then
      echo "  ${label}: SKIPPED (${service} container absent)"
    elif docker compose exec -T "$@" >/dev/null 2>&1; then
      echo "  ${label}: PASS"
    else
      echo "  ${label}: FAILED"
    fi
  }
  probe backend wotb-backend wotb-backend wget -qO- http://127.0.0.1:8087/api/health
  probe frontend wotb-frontend wotb-frontend wget -qO- http://127.0.0.1:80/api/health
  probe keycloak keycloak wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration
}

dump_logs() {
  docker compose ps -a || true
  echo "== service list (no container environment dump) =="
  docker compose config --services || true
  for service in wotb-backend wotb-frontend keycloak prometheus loki alloy grafana; do
    echo "== ${service} logs =="
    docker compose logs --tail 120 "$service" || true
  done
}

if ! pull_compose "$STAGED_COMPOSE"; then
  echo "ERROR: staged docker compose pull failed after 3 attempts; live deployment was not changed." >&2
  exit 1
fi

if ! bash "$STAGED_DEPLOY_DIR/validate-alloy-config.sh" \
    "$STAGED_DEPLOY_DIR/observability/alloy/config.alloy"; then
  echo "ERROR: staged Alloy config validation failed; live deployment was not changed." >&2
  exit 1
fi

rollback_needed=false
# Same-filesystem moves make promotion and rollback cover the full deploy tree.
if [ -d "$LIVE_DEPLOY_DIR" ]; then
  if [ -f docker-compose.yml ]; then
    cp -f docker-compose.yml docker-compose.prev.yml
  fi
  rm -rf -- "$PREV_DEPLOY_DIR"
  mv -- "$LIVE_DEPLOY_DIR" "$PREV_DEPLOY_DIR"
  echo "Previous deployment tree saved (PREV_SHA=${PREV_SHA:-unknown})."
fi
mv -- "$STAGED_DEPLOY_DIR" "$LIVE_DEPLOY_DIR"
cp -f "$LIVE_DEPLOY_DIR/docker-compose.prod.yml" docker-compose.next.yml
if ! docker compose -f docker-compose.next.yml config > docker-compose.next.resolved.yml; then
  echo "ERROR: promoted compose render failed; attempting rollback." >&2
  rollback_needed=true
else
  mv -f docker-compose.next.resolved.yml docker-compose.yml
  chmod 600 docker-compose.yml
fi

if [ "$rollback_needed" = true ]; then
  :
elif ! docker compose up -d --remove-orphans; then
  echo "ERROR: docker compose up failed; attempting rollback." >&2
  rollback_needed=true
else
  apply_ok=true
  apply_observability_services || apply_ok=false
  if [ "$apply_ok" != true ]; then
    echo "ERROR: observability service recreation failed; attempting rollback." >&2
    dump_logs
    rollback_needed=true
  else
    docker compose exec -T postgres psql -U wotb -d wotb -c "CREATE DATABASE keycloak;" 2>/dev/null || true
    if wait_healthy && verify_observability; then
      echo "$TAG" > DEPLOYED_SHA
      docker image prune -af
      docker builder prune -af
      echo "== DEPLOY OK: $TAG =="
      exit 0
    fi
    echo "== NEW DEPLOY HEALTH CHECK FAILED =="
    dump_logs
    rollback_needed=true
  fi
fi

if [ "$rollback_needed" = true ]; then
  echo "== DEPLOY FAILED: rolling back to previous deployment =="
  if [ -f docker-compose.prev.yml ] && [ -d "$PREV_DEPLOY_DIR" ]; then
    rm -rf -- "$LIVE_DEPLOY_DIR"
    mv -- "$PREV_DEPLOY_DIR" "$LIVE_DEPLOY_DIR"
    cp -f docker-compose.prev.yml docker-compose.yml
    if pull_compose docker-compose.yml \
      && docker compose up -d --remove-orphans \
      && apply_observability_services; then
      if wait_healthy && verify_observability; then
        if [ -n "$PREV_SHA" ]; then
          echo "$PREV_SHA" > DEPLOYED_SHA
          echo "== ROLLBACK OK: back to $PREV_SHA =="
        else
          echo "== ROLLBACK OK: previous compose (SHA unknown) =="
        fi
      else
        echo "== ROLLBACK FAILED: previous deployment also unhealthy; manual intervention required ==" >&2
        dump_logs
      fi
    else
      echo "== ROLLBACK FAILED: could not recreate previous deployment; manual intervention required ==" >&2
      dump_logs
    fi
  else
    echo "== No previous deployment tree found; manual intervention required ==" >&2
    dump_logs
  fi
  exit 1
fi
