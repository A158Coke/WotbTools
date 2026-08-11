#!/usr/bin/env bash
#
# Production deploy script (invoked by .github/workflows/deploy.yml via SSH).
# Requires the following env vars (forwarded by the workflow step `envs`):
#   TAG, DB_PASSWORD, KC_ADMIN_PASSWORD, WG_APPLICATION_ID, KEYCLOAK_ADMIN_CLIENT_SECRET,
#   AI_API_KEY, GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD, GRAFANA_MCP_TOKEN
# Optional vars carry the same defaults as the previous inline workflow script.
# Flow: pre-deploy backup -> write .env -> stage docker-compose.prod.yml as next ->
# pull -> promote to docker-compose.yml -> compose up -> health checks -> rollback.
#
set -e

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name secret is not configured." >&2
    exit 1
  fi
}

require_env TAG
require_env DB_PASSWORD
require_env KC_ADMIN_PASSWORD
require_env WG_APPLICATION_ID
require_env KEYCLOAK_ADMIN_CLIENT_SECRET
require_env AI_API_KEY
require_env GRAFANA_ADMIN_USER
require_env GRAFANA_ADMIN_PASSWORD
require_env GRAFANA_MCP_TOKEN

mkdir -p /opt/wotb
cd /opt/wotb
mkdir -p config/sponsor
if [ ! -e config/sponsor-config.json ] && [ ! -L config/sponsor-config.json ]; then
  install -m 644 deploy/sponsor-config.example.json config/sponsor-config.json
fi
chmod 700 deploy/postgres-backup.sh deploy/postgres-backup-inspect.sh deploy/postgres-restore.sh
if [ -f docker-compose.yml ]; then
  deploy/postgres-backup.sh --database wotb
  deploy/postgres-backup.sh --database keycloak
else
  echo "No existing deployment; skipping pre-deploy backup."
fi
# Observability: Grafana 凭据写入权限 600 的 .env（不落入 compose 文件本身）
umask 177
printf 'GRAFANA_ADMIN_USER=%s\nGRAFANA_MCP_TOKEN=%s\nGRAFANA_ADMIN_PASSWORD=%s\n' \
  "$GRAFANA_ADMIN_USER" "$GRAFANA_MCP_TOKEN" "$GRAFANA_ADMIN_PASSWORD" > .env
chmod 600 .env
# 新 compose 先写入 next 文件：pull 成功后才替换正式 docker-compose.yml，
# pull 失败时服务器上的正式 compose 保持旧版本（旧栈不受影响）。
cp -f deploy/docker-compose.prod.yml docker-compose.next.yml


pull_compose() {
  local compose_file="$1"
  for attempt in 1 2 3; do
    if docker compose -f "$compose_file" pull; then
      return 0
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "docker compose pull failed (${compose_file}, attempt $attempt), retrying in 10s..."
      sleep 10
    fi
  done
  return 1
}

# Health checks: backend /api/health, frontend nginx E2E, Keycloak realm availability
wait_healthy() {
  for i in $(seq 1 60); do
    if docker compose ps | grep -E "wotb-backend|wotb-frontend|keycloak" | grep -qE "Restarting|Exited"; then
      sleep 2
      continue
    fi
    ok=true
    if ! docker compose exec -T wotb-backend wget -qO- http://127.0.0.1:8087/api/health >/dev/null 2>&1; then
      ok=false
    fi
    if [ "$ok" = true ] && ! docker compose exec -T wotb-frontend wget -qO- http://127.0.0.1:80/api/health >/dev/null 2>&1; then
      ok=false
    fi
    if [ "$ok" = true ] && ! docker compose exec -T wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration >/dev/null 2>&1; then
      ok=false
    fi
    if [ "$ok" = true ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

dump_logs() {
  docker compose ps || true
  echo "== backend logs =="
  docker compose logs --tail 160 wotb-backend || true
  echo "== frontend logs =="
  docker compose logs --tail 80 wotb-frontend || true
  echo "== keycloak logs =="
  docker compose logs --tail 80 keycloak || true
}

if ! pull_compose docker-compose.next.yml; then
  echo "ERROR: docker compose pull failed after 3 attempts (docker-compose.next.yml)." >&2
  echo "The running stack and docker-compose.yml are untouched; fix the images before the next deploy." >&2
  exit 1
fi

# pull 成功后才备份当前正式 compose（回滚目标）并提升 next 为正式。
# 只有当前 compose 引用的镜像本地存在（即上一次部署真实可运行）才覆盖 prev，
# 避免把历史失败部署留下的坏 compose 存成回滚目标。
if [ -f docker-compose.yml ] && docker compose -f docker-compose.yml config --images 2>/dev/null \
    | xargs -r docker image inspect >/dev/null 2>&1; then
  cp -f docker-compose.yml docker-compose.prev.yml
  echo "Previous compose saved (PREV_SHA=${PREV_SHA:-unknown})."
elif [ -f docker-compose.yml ]; then
  echo "Current docker-compose.yml references images unavailable locally; keeping existing docker-compose.prev.yml as rollback target."
else
  echo "No previous compose found; first deployment."
fi
mv -f docker-compose.next.yml docker-compose.yml

rollback_needed=false
if ! docker compose up -d --remove-orphans; then
  echo "ERROR: docker compose up failed; attempting rollback." >&2
  rollback_needed=true
else
  docker compose exec -T postgres psql -U wotb -d wotb -c "CREATE DATABASE keycloak;" 2>/dev/null || true
  if wait_healthy; then
    echo ""$TAG"" > DEPLOYED_SHA
    docker image prune -af
    docker builder prune -af
    echo "== DEPLOY OK: "$TAG" =="
    exit 0
  fi
  rollback_needed=true
fi

if [ "$rollback_needed" = true ]; then
  echo "== DEPLOY FAILED: rolling back to previous deployment =="
  if [ -f docker-compose.prev.yml ]; then
    cp -f docker-compose.prev.yml docker-compose.yml
    rm -f docker-compose.next.yml
    if pull_compose docker-compose.yml && docker compose up -d --remove-orphans; then
      if wait_healthy; then
        if [ -n "$PREV_SHA" ]; then
          echo "$PREV_SHA" > DEPLOYED_SHA
          echo "== ROLLBACK OK: back to $PREV_SHA =="
        else
          echo "== ROLLBACK OK: previous compose (SHA unknown) =="
        fi
        docker image prune -af
        docker builder prune -af
      else
        echo "== ROLLBACK FAILED: previous deployment also unhealthy; manual intervention required =="
        dump_logs
      fi
    else
      echo "== ROLLBACK FAILED: could not start previous compose; manual intervention required =="
      dump_logs
    fi
  else
    echo "== No previous compose found; manual intervention required =="
    dump_logs
  fi
  exit 1
fi