#!/usr/bin/env bash
#
# Production deploy script (invoked by .github/workflows/deploy.yml via SSH).
# Requires the following env vars (forwarded by the workflow step `envs`):
#   TAG, DB_PASSWORD, KC_ADMIN_PASSWORD, WG_APPLICATION_ID, KEYCLOAK_ADMIN_CLIENT_SECRET,
#   AI_API_KEY, GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD
# Optional vars carry the same defaults as the previous inline workflow script.
# Flow: pre-deploy backup -> write .env -> render docker-compose.prod.yml -> pull ->
# promote to docker-compose.yml -> compose up -> reload Alloy -> health checks -> rollback.
#
# The formal docker-compose.yml is RENDERED (all ${...} resolved to concrete values)
# so later independent SSH sessions (daily DB backup, diagnostics, manual ops) never
# depend on GitHub Actions temporary environment variables. Rollback targets
# (docker-compose.prev.yml) therefore pin the previous image tag instead of the
# current (failed) one.
#
set -e

readonly WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
readonly HEALTH_RETRIES="${WOTB_HEALTH_RETRIES:-60}"

if [[ ! "$HEALTH_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: WOTB_HEALTH_RETRIES must be a positive integer." >&2
  exit 1
fi

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

# AI Review 整体 deadline 必须与前端(1100s)/nginx(1120s) 固定链路对齐：
# 不允许通过环境变量把旧 400 静默带进生产（前端先掐断、后端继续计费）。
if [ -n "${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:-}" ] \
    && [ "$AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC" != "1100" ]; then
  printf 'ERROR: AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC must be 1100 to stay aligned with frontend(1100s)/nginx(1120s); got %s\n' \
    "$AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC" >&2
  exit 3
fi

mkdir -p "$WOTB_DIR"
cd "$WOTB_DIR"

# Previous deployment info (rollback target)
PREV_SHA=""
if [ -f DEPLOYED_SHA ]; then
  PREV_SHA=$(cat DEPLOYED_SHA)
fi

mkdir -p config/sponsor
mkdir -p android-release
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
printf 'GRAFANA_ADMIN_USER=%s\nGRAFANA_ADMIN_PASSWORD=%s\n' \
  "$GRAFANA_ADMIN_USER" "$GRAFANA_ADMIN_PASSWORD" > .env
chmod 600 .env
# 新 compose 先写入 next 文件：pull 成功后才替换正式 docker-compose.yml，
# pull 失败时服务器上的正式 compose 保持旧版本（旧栈不受影响）。
# 模板中的 ${TAG}/${DB_PASSWORD} 等通过 `docker compose config` 渲染为具体值：
# 正式文件自包含，后续独立 SSH 会话与每日备份不依赖 GitHub Actions 临时环境变量。
cp -f deploy/docker-compose.prod.yml docker-compose.next.yml
docker compose -f docker-compose.next.yml config > docker-compose.next.resolved.yml
mv -f docker-compose.next.resolved.yml docker-compose.next.yml
chmod 600 docker-compose.next.yml

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

# bind-mounted Alloy 配置内容变化不会让 `docker compose up -d` 自动重建容器。
# Alloy 官方支持 SIGHUP 重新读取配置；显式触发，确保本次 deploy 的观测配置真正生效。
reload_alloy_config() {
  echo "== Reloading Alloy config =="
  if ! docker compose kill -s HUP alloy; then
    echo "ERROR: failed to send SIGHUP to Alloy; observability config was not reloaded." >&2
    return 1
  fi
  sleep 1
  if docker compose ps -a alloy | grep -qE "Restarting|Exited"; then
    echo "ERROR: Alloy is not running after config reload." >&2
    return 1
  fi
  echo "Alloy config reload requested."
}

# Health checks: backend /api/health, frontend nginx E2E, Keycloak realm availability,
# plus Alloy process state so an observability failure cannot be silently deployed.
wait_healthy() {
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if docker compose ps -a | grep -E "wotb-backend|wotb-frontend|keycloak|alloy" | grep -qE "Restarting|Exited"; then
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
    if [ "$i" -eq "$HEALTH_RETRIES" ]; then
      echo "Health check failed:"
      report_health_status
      return 1
    fi
    sleep 2
  done
  return 1
}

report_health_status() {
  local running
  running="$(docker compose ps -a 2>/dev/null || true)"
  probe() {
    local state label="$1" service="$2"
    shift 2
    if ! grep -qE "${service}" <<<"$running"; then
      state=SKIPPED
      echo "  ${label}: ${state} (${service} container absent)"
    elif docker compose exec -T "$@" >/dev/null 2>&1; then
      state=PASS
      echo "  ${label}: ${state}"
    else
      state=FAILED
      echo "  ${label}: ${state}"
    fi
  }
  probe backend wotb-backend wotb-backend wget -qO- http://127.0.0.1:8087/api/health
  probe frontend wotb-frontend wotb-frontend wget -qO- http://127.0.0.1:80/api/health
  probe keycloak keycloak wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration
}

dump_logs() {
  docker compose ps -a || true
  echo "== container inspect =="
  docker compose ps -aq | xargs -r docker inspect || true
  echo "== backend logs =="
  docker compose logs --tail 160 wotb-backend || true
  echo "== frontend logs =="
  docker compose logs --tail 80 wotb-frontend || true
  echo "== keycloak logs =="
  docker compose logs --tail 80 keycloak || true
  echo "== alloy logs =="
  docker compose logs --tail 120 alloy || true
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
chmod 600 docker-compose.yml

rollback_needed=false
if ! docker compose up -d --remove-orphans; then
  echo "ERROR: docker compose up failed; attempting rollback." >&2
  rollback_needed=true
elif ! reload_alloy_config; then
  echo "ERROR: Alloy config reload failed; attempting rollback." >&2
  dump_logs
  rollback_needed=true
else
  docker compose exec -T postgres psql -U wotb -d wotb -c "CREATE DATABASE keycloak;" 2>/dev/null || true
  if wait_healthy; then
    echo "$TAG" > DEPLOYED_SHA
    docker image prune -af
    docker builder prune -af
    echo "== DEPLOY OK: $TAG =="
    exit 0
  else
    echo "== NEW DEPLOY HEALTH CHECK FAILED =="
    dump_logs
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