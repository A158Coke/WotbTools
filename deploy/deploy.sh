#!/usr/bin/env bash
# Production deployment with staged validation, validated LKG promotion and fail-closed rollback.
set -euo pipefail

readonly WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
readonly INCOMING_DIR="${WOTB_INCOMING_DIR:-$WOTB_DIR/deploy.incoming}"
readonly LIVE_DEPLOY_DIR="$WOTB_DIR/deploy"
readonly PREV_DEPLOY_DIR="$WOTB_DIR/deploy.prev"
readonly LKG_DEPLOY_DIR="$WOTB_DIR/deploy.lkg"
readonly LKG_DEPLOY_NEXT_DIR="$WOTB_DIR/deploy.lkg.next"
readonly LKG_DEPLOY_RETIRING_DIR="$WOTB_DIR/deploy.lkg.retiring"
readonly LKG_COMPOSE="$WOTB_DIR/docker-compose.lkg.yml"
readonly LKG_COMPOSE_NEXT="$WOTB_DIR/docker-compose.lkg.next.yml"
readonly LKG_COMPOSE_INSTALLING="$WOTB_DIR/docker-compose.lkg.installing.yml"
readonly LKG_COMPOSE_RETIRING="$WOTB_DIR/docker-compose.lkg.retiring.yml"
readonly LKG_SHA="$WOTB_DIR/DEPLOYED_SHA.lkg"
readonly LKG_SHA_NEXT="$WOTB_DIR/DEPLOYED_SHA.lkg.next"
readonly LKG_SHA_RETIRING="$WOTB_DIR/DEPLOYED_SHA.lkg.retiring"
readonly HEALTH_RETRIES="${WOTB_HEALTH_RETRIES:-60}"
readonly BOOTSTRAP_ALLOWED="${WOTB_ALLOW_BOOTSTRAP_WITHOUT_LKG:-0}"

if [[ ! "$HEALTH_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: WOTB_HEALTH_RETRIES must be a positive integer." >&2
  exit 1
fi
if [ -z "$WOTB_DIR" ] || [ "$WOTB_DIR" = "/" ] || [ -z "$INCOMING_DIR" ] || [ "$INCOMING_DIR" = "/" ]; then
  echo "ERROR: refusing to operate on an unsafe deployment path." >&2
  exit 1
fi
if [ "$BOOTSTRAP_ALLOWED" != "0" ] && [ "$BOOTSTRAP_ALLOWED" != "1" ]; then
  echo "ERROR: WOTB_ALLOW_BOOTSTRAP_WITHOUT_LKG must be 0 or 1." >&2
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
if ! command -v flock >/dev/null 2>&1; then
  echo "ERROR: flock is required to serialize production deployments." >&2
  exit 1
fi
exec 9>"$WOTB_DIR/.deploy.lock"
if ! flock -n 9; then
  echo "ERROR: another production deployment is already running." >&2
  exit 1
fi
cd "$WOTB_DIR"
readonly STAGED_DEPLOY_DIR="$INCOMING_DIR/deploy"
readonly STAGED_COMPOSE="$INCOMING_DIR/docker-compose.next.yml"
readonly STAGED_RESOLVED_COMPOSE="$INCOMING_DIR/docker-compose.next.resolved.yml"
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
if [ -f DEPLOYED_SHA ]; then PREV_SHA=$(tr -d '\r\n' < DEPLOYED_SHA); fi

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
if ! docker compose -f "$STAGED_COMPOSE" config > "$STAGED_RESOLVED_COMPOSE"; then
  echo "ERROR: staged compose config is invalid; live deployment was not changed." >&2
  exit 1
fi
chmod 600 "$STAGED_RESOLVED_COMPOSE"

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
      sleep 2
      continue
    fi
    ok=true
    docker compose exec -T wotb-backend wget -qO- http://127.0.0.1:8087/api/health >/dev/null 2>&1 || ok=false
    [ "$ok" = true ] && docker compose exec -T wotb-frontend wget --header='Host: wotbtools.com' -qO- http://127.0.0.1:80/api/health >/dev/null 2>&1 || ok=false
    [ "$ok" = true ] && docker compose exec -T wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration >/dev/null 2>&1 || ok=false
    if [ "$ok" = true ]; then return 0; fi
    [ "$i" -lt "$HEALTH_RETRIES" ] && sleep 2
  done
  echo "Health check failed:" >&2
  report_health_status
  return 1
}

verify_observability() {
  bash "$LIVE_DEPLOY_DIR/verify-observability.sh"
}

report_health_status() {
  local running
  running="$(docker compose ps -a 2>/dev/null || true)"
  probe() {
    local label="$1" service="$2"
    shift 2
    if ! grep -qE "$service" <<<"$running"; then
      echo "  ${label}: SKIPPED (${service} container absent)"
    elif docker compose exec -T "$@" >/dev/null 2>&1; then
      echo "  ${label}: PASS"
    else
      echo "  ${label}: FAILED"
    fi
  }
  probe backend wotb-backend wotb-backend wget -qO- http://127.0.0.1:8087/api/health
  probe frontend wotb-frontend wotb-frontend wget --header='Host: wotbtools.com' -qO- http://127.0.0.1:80/api/health
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

rewrite_compose_tree_path() {
  local source_file="$1" destination_file="$2" from_tree="$3" to_tree="$4"
  local from_path="${WOTB_DIR%/}/${from_tree}/"
  local to_path="${WOTB_DIR%/}/${to_tree}/"
  sed "s|$from_path|$to_path|g; s|\./${from_tree}/|./${to_tree}/|g" \
    "$source_file" > "$destination_file"
}

lkg_bundle_present() {
  [ -e "$LKG_DEPLOY_DIR" ] || [ -e "$LKG_COMPOSE" ] || [ -e "$LKG_SHA" ]
}

validate_lkg_bundle() {
  local deploy_dir="$1" compose_file="$2" sha_file="$3" label="$4" sha service
  if [ ! -d "$deploy_dir" ] || [ ! -f "$compose_file" ] || [ ! -f "$sha_file" ]; then
    echo "${label}: LKG bundle is incomplete." >&2
    return 1
  fi
  sha="$(tr -d '\r\n' < "$sha_file")"
  if [ -z "$sha" ] || [[ "$sha" =~ [[:space:]] ]]; then
    echo "${label}: LKG SHA metadata is invalid." >&2
    return 1
  fi
  if ! docker compose -f "$compose_file" config >/dev/null 2>&1; then
    echo "${label}: LKG compose parse failed." >&2
    return 1
  fi
  if ! bash "$deploy_dir/validate-alloy-config.sh" "$deploy_dir/observability/alloy/config.alloy" >/dev/null; then
    echo "${label} [ALLOY]: LKG Alloy validation failed." >&2
    return 1
  fi
  for service in backend frontend keycloak; do
    if ! grep -Eq "wotbtools-${service}:${sha}([[:space:]]|$)" "$compose_file"; then
      echo "${label}: LKG tag mismatch for ${service}." >&2
      return 1
    fi
  done
}

stage_lkg_snapshot() {
  local source_dir="$1" source_compose="$2" sha="$3"
  rm -rf -- "$LKG_DEPLOY_NEXT_DIR" "$LKG_COMPOSE_NEXT" "$LKG_SHA_NEXT"
  cp -a "$source_dir" "$LKG_DEPLOY_NEXT_DIR"
  rewrite_compose_tree_path "$source_compose" "$LKG_COMPOSE_NEXT" deploy deploy.lkg.next
  printf '%s\n' "$sha" > "$LKG_SHA_NEXT"
  chmod 600 "$LKG_COMPOSE_NEXT" "$LKG_SHA_NEXT"
}

validate_lkg_candidate() {
  validate_lkg_bundle \
    "$LKG_DEPLOY_NEXT_DIR" "$LKG_COMPOSE_NEXT" "$LKG_SHA_NEXT" \
    "LKG candidate"
}

promote_lkg_candidate() {
  local restore_failed=false
  validate_lkg_candidate || return 1
  if [ -e "$LKG_DEPLOY_RETIRING_DIR" ] || [ -e "$LKG_COMPOSE_RETIRING" ] || [ -e "$LKG_SHA_RETIRING" ]; then
    echo "ERROR: incomplete prior LKG promotion found; refusing to overwrite it." >&2
    return 1
  fi

  restore_retired_lkg() {
    rm -rf -- "$LKG_DEPLOY_DIR"
    rm -f -- "$LKG_COMPOSE" "$LKG_SHA" "$LKG_COMPOSE_INSTALLING"
    if [ -e "$LKG_DEPLOY_RETIRING_DIR" ] && ! mv -- "$LKG_DEPLOY_RETIRING_DIR" "$LKG_DEPLOY_DIR"; then
      restore_failed=true
    fi
    if [ -e "$LKG_COMPOSE_RETIRING" ] && ! mv -- "$LKG_COMPOSE_RETIRING" "$LKG_COMPOSE"; then
      restore_failed=true
    fi
    if [ -e "$LKG_SHA_RETIRING" ] && ! mv -- "$LKG_SHA_RETIRING" "$LKG_SHA"; then
      restore_failed=true
    fi
    if [ "$restore_failed" = true ]; then
      echo "ERROR: failed to restore the previous validated LKG after promotion failure." >&2
      return 1
    fi
    return 0
  }

  if [ -e "$LKG_DEPLOY_DIR" ] && ! mv -- "$LKG_DEPLOY_DIR" "$LKG_DEPLOY_RETIRING_DIR"; then
    return 1
  fi
  if [ -e "$LKG_COMPOSE" ] && ! mv -- "$LKG_COMPOSE" "$LKG_COMPOSE_RETIRING"; then
    restore_retired_lkg || true
    return 1
  fi
  if [ -e "$LKG_SHA" ] && ! mv -- "$LKG_SHA" "$LKG_SHA_RETIRING"; then
    restore_retired_lkg || true
    return 1
  fi
  if ! mv -- "$LKG_DEPLOY_NEXT_DIR" "$LKG_DEPLOY_DIR"; then
    restore_retired_lkg || true
    return 1
  fi
  if ! sed 's|deploy\.lkg\.next/|deploy.lkg/|g' "$LKG_COMPOSE_NEXT" > "$LKG_COMPOSE_INSTALLING" \
      || ! chmod 600 "$LKG_COMPOSE_INSTALLING" \
      || ! mv -- "$LKG_COMPOSE_INSTALLING" "$LKG_COMPOSE"; then
    restore_retired_lkg || true
    return 1
  fi
  if ! mv -- "$LKG_SHA_NEXT" "$LKG_SHA"; then
    restore_retired_lkg || true
    return 1
  fi
  if ! validate_lkg_bundle "$LKG_DEPLOY_DIR" "$LKG_COMPOSE" "$LKG_SHA" "Promoted LKG"; then
    restore_retired_lkg || true
    return 1
  fi
  rm -f -- "$LKG_COMPOSE_NEXT" "$LKG_COMPOSE_RETIRING" "$LKG_SHA_RETIRING"
  rm -rf -- "$LKG_DEPLOY_RETIRING_DIR"
  return 0
}

seed_current_lkg() {
  [ -d "$LIVE_DEPLOY_DIR" ] || return 1
  [ -f docker-compose.yml ] || return 1
  [ -n "$PREV_SHA" ] || return 1
  echo "== Validating current deployment as a possible initial LKG =="
  docker compose -f docker-compose.yml config >/dev/null 2>&1 || return 1
  bash "$LIVE_DEPLOY_DIR/validate-alloy-config.sh" \
    "$LIVE_DEPLOY_DIR/observability/alloy/config.alloy" >/dev/null || return 1
  wait_healthy || return 1
  verify_observability || return 1
  stage_lkg_snapshot "$LIVE_DEPLOY_DIR" docker-compose.yml "$PREV_SHA"
  promote_lkg_candidate
}

restore_lkg_to_live() {
  rm -rf -- "$LIVE_DEPLOY_DIR"
  cp -a "$LKG_DEPLOY_DIR" "$LIVE_DEPLOY_DIR"
  rewrite_compose_tree_path "$LKG_COMPOSE" docker-compose.yml deploy.lkg deploy
  chmod 600 docker-compose.yml
}

rollback_to_lkg() {
  echo "== DEPLOY FAILED: rolling back to validated LKG =="
  if ! validate_lkg_bundle "$LKG_DEPLOY_DIR" "$LKG_COMPOSE" "$LKG_SHA" "ROLLBACK ABORTED"; then
    echo "ROLLBACK ABORTED: validated LKG is unavailable or corrupted" >&2
    echo "manual intervention required; current live tree was not destroyed" >&2
    return 1
  fi
  restore_lkg_to_live
  if pull_compose docker-compose.yml \
      && docker compose up -d --remove-orphans \
      && apply_observability_services; then
    if wait_healthy && verify_observability; then
      cp -f "$LKG_SHA" DEPLOYED_SHA
      echo "== ROLLBACK OK: validated LKG $(cat "$LKG_SHA") =="
      return 0
    fi
  fi
  echo "== ROLLBACK FAILED: validated LKG could not pass the full gate; manual intervention required ==" >&2
  dump_logs
  return 1
}

rollback_to_legacy_previous() {
  # This best-effort path is only reachable after explicit bootstrap mode;
  # normal no-LKG deployments exit before moving the live tree.
  echo "== DEPLOY FAILED: no validated LKG; attempting legacy previous recovery =="
  if [ -f docker-compose.prev.yml ] && [ -d "$PREV_DEPLOY_DIR" ]; then
    rm -rf -- "$LIVE_DEPLOY_DIR"
    mv -- "$PREV_DEPLOY_DIR" "$LIVE_DEPLOY_DIR"
    cp -f docker-compose.prev.yml docker-compose.yml
    if pull_compose docker-compose.yml \
        && docker compose up -d --remove-orphans \
        && apply_observability_services; then
      if wait_healthy; then
        if [ -n "$PREV_SHA" ]; then echo "$PREV_SHA" > DEPLOYED_SHA; fi
        echo "CORE ROLLBACK OK: restored legacy previous deployment"
        if verify_observability; then
          echo "OBSERVABILITY ROLLBACK DEGRADED: restored legacy previous without a validated LKG" >&2
        else
          echo "OBSERVABILITY ROLLBACK DEGRADED: legacy previous failed observability verification" >&2
          dump_logs
        fi
      else
        echo "CORE ROLLBACK FAILED: legacy previous is not healthy" >&2
        dump_logs
      fi
    else
      echo "CORE ROLLBACK FAILED: could not recreate legacy previous deployment" >&2
      dump_logs
    fi
  else
    echo "CORE ROLLBACK UNAVAILABLE: no legacy previous deployment tree found" >&2
    dump_logs
  fi
  return 1
}

if ! pull_compose "$STAGED_COMPOSE"; then
  echo "ERROR: staged docker compose pull failed after 3 attempts; live deployment was not changed." >&2
  exit 1
fi

if ! bash "$STAGED_DEPLOY_DIR/validate-alloy-config.sh" \
    "$STAGED_DEPLOY_DIR/observability/alloy/config.alloy"; then
  echo "ERROR [ALLOY]: staged Alloy config validation failed; live deployment was not changed." >&2
  exit 1
fi

if lkg_bundle_present; then
  if ! validate_lkg_bundle "$LKG_DEPLOY_DIR" "$LKG_COMPOSE" "$LKG_SHA" "Existing LKG"; then
    echo "ROLLBACK ABORTED: existing LKG is unavailable or corrupted; live deployment was not changed." >&2
    exit 1
  fi
else
  if seed_current_lkg; then
    echo "== Current deployment promoted as initial LKG =="
  elif [ "$BOOTSTRAP_ALLOWED" != "1" ]; then
    echo "ERROR: No validated LKG exists." >&2
    echo "Current deployment cannot be promoted to LKG." >&2
    echo "Use explicit workflow_dispatch bootstrap only after reviewing production state." >&2
    echo "NO_VALIDATED_LKG: live deployment was not changed." >&2
    exit 1
  else
    echo "WARNING: BOOTSTRAP MODE" >&2
    echo "WARNING: No validated LKG exists." >&2
    echo "WARNING: This deployment has no guaranteed full-stack rollback target." >&2
  fi
fi

rollback_needed=false
# Same-filesystem moves make promotion preserve the previous tree for forensics.
if [ -d "$LIVE_DEPLOY_DIR" ]; then
  if [ -f docker-compose.yml ]; then cp -f docker-compose.yml docker-compose.prev.yml; fi
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

if [ "$rollback_needed" = false ]; then
  if ! docker compose up -d --remove-orphans; then
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
        stage_lkg_snapshot "$LIVE_DEPLOY_DIR" docker-compose.yml "$TAG"
        if promote_lkg_candidate; then
          echo "$TAG" > DEPLOYED_SHA
          docker image prune -af
          docker builder prune -af
          echo "== DEPLOY OK: $TAG =="
          exit 0
        fi
        echo "ERROR: deployment passed the full gate but LKG promotion failed; attempting rollback." >&2
        rollback_needed=true
      else
        echo "== NEW DEPLOY HEALTH CHECK FAILED =="
        dump_logs
        rollback_needed=true
      fi
    fi
  fi
fi

if [ "$rollback_needed" = true ]; then
  if lkg_bundle_present; then
    rollback_to_lkg || true
  else
    rollback_to_legacy_previous || true
  fi
  exit 1
fi
