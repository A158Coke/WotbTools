#!/usr/bin/env bash
# Deploy/rollback smoke test (CI-safe, no production access).
#
# Simulates deployments against a sandbox dir with a fake `docker` shim and
# asserts the validated LKG contract:
#   1. deploy A succeeds and the formal docker-compose.yml pins sha-A images;
#   2. deploy B starts and its health check fails;
#   3. rollback restores the validated LKG (A), not the failed B tag;
#   4. DEPLOYED_SHA and DEPLOYED_SHA.lkg remain at A;
#   5. with the deploy env cleared, `docker compose config` and the daily backup
#      script still parse the formal deployment.
set -euo pipefail

if [ -n "${WOTB_TEST_ROOT:-}" ]; then
  ROOT="$WOTB_TEST_ROOT"
else
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/deploy.incoming/deploy" "$WORK/bin"
cp "$ROOT/deploy/docker-compose.prod.yml" "$WORK/deploy.incoming/deploy/docker-compose.prod.yml"
cp "$ROOT/deploy/deploy.sh" "$WORK/deploy.incoming/deploy/deploy.sh"
cp "$ROOT/deploy/validate-alloy-config.sh" "$WORK/deploy.incoming/deploy/validate-alloy-config.sh"
cp "$ROOT/deploy/verify-observability.sh" "$WORK/deploy.incoming/deploy/verify-observability.sh"
cp "$ROOT/deploy/grafana-api-request.sh" "$WORK/deploy.incoming/deploy/grafana-api-request.sh"
cp "$ROOT/deploy/sponsor-config.example.json" "$WORK/deploy.incoming/deploy/sponsor-config.example.json"
cp "$ROOT/deploy/postgres-backup.sh" "$WORK/deploy.incoming/deploy/postgres-backup.sh"
cp "$ROOT/deploy/postgres-backup-inspect.sh" "$WORK/deploy.incoming/deploy/postgres-backup-inspect.sh"
cp "$ROOT/deploy/postgres-restore.sh" "$WORK/deploy.incoming/deploy/postgres-restore.sh"
cp -a "$ROOT/deploy/observability" "$WORK/deploy.incoming/deploy/observability"
printf 'stable prometheus config\n' > "$WORK/deploy.incoming/deploy/observability/prometheus/prometheus.yml"
cp "$ROOT/deploy/observability/alloy/config.alloy" "$WORK/deploy.incoming/deploy/observability/alloy/config.alloy"
printf '\n// stable alloy config\n' >> "$WORK/deploy.incoming/deploy/observability/alloy/config.alloy"
# Normalize line endings so the sandbox runs identically on CRLF checkouts
# (CI/ubuntu checkouts are LF; this keeps the smoke test portable).
  sed -i 's/\r$//' \
  "$WORK/deploy.incoming/deploy/docker-compose.prod.yml" \
  "$WORK/deploy.incoming/deploy/deploy.sh" \
  "$WORK/deploy.incoming/deploy/validate-alloy-config.sh" \
  "$WORK/deploy.incoming/deploy/verify-observability.sh" \
  "$WORK/deploy.incoming/deploy/grafana-api-request.sh" \
  "$WORK/deploy.incoming/deploy/postgres-backup.sh" \
  "$WORK/deploy.incoming/deploy/postgres-backup-inspect.sh" \
  "$WORK/deploy.incoming/deploy/postgres-restore.sh" \
  "$WORK/deploy.incoming/deploy/sponsor-config.example.json"

cat > "$WORK/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
# Fake docker shim for the deploy rollback smoke test.
# - `compose config` resolves ${VAR} / ${VAR:?msg} / ${VAR:-default} from env,
#   mirroring what `docker compose config` does during the real deploy.
# - health checks (`compose exec ... wget`) succeed only when the active compose
#   file references the sha-A backend image, so deploy B fails and rolls back to A.
set -euo pipefail

resolve_line() {
  local line="$1" out expr name dflt val
  out="$line"
  while [[ "$out" =~ \$\{([^}]+)\} ]]; do
    expr="${BASH_REMATCH[1]}"
    if [[ "$expr" == *":-"* ]]; then
      name="${expr%%:-*}"; dflt="${expr#*:-}"
      val="${!name:-$dflt}"
    elif [[ "$expr" == *":?"* ]]; then
      name="${expr%%:?*}"; dflt="${expr#*:?}"
      if [[ -z "${!name:-}" ]]; then echo "ERROR: $dflt" >&2; return 1; fi
      val="${!name}"
    else
      val="${!expr:-}"
    fi
    out="${out//"\${$expr}"/$val}"
  done
  printf '%s\n' "$out"
}

active_tag_healthy() {
  local file="${COMPOSE_FILE:-docker-compose.yml}"
  [ "${FAKE_FORCE_UNHEALTHY:-0}" = 1 ] && return 1
  [[ -f "$file" ]] || return 0
  grep -q 'wotbtools-backend:sha-A' "$file" \
    || { [ -n "${FAKE_HEALTHY_BACKEND_TAG:-}" ] && grep -q "wotbtools-backend:${FAKE_HEALTHY_BACKEND_TAG}" "$file"; }
}

app_tag_unhealthy() {
  local service="$1" file="${COMPOSE_FILE:-docker-compose.yml}"
  [ -n "${FAKE_APP_UNHEALTHY_TAG:-}" ] \
    && grep -q "wotbtools-backend:${FAKE_APP_UNHEALTHY_TAG}" "$file" \
    && { [ -z "${FAKE_APP_UNHEALTHY_SERVICE:-}" ] || [ "$FAKE_APP_UNHEALTHY_SERVICE" = "$service" ]; }
}

COMPOSE_FILE=""
cmd="${1:-}"; shift || true
case "$cmd" in
  compose)
    compose_args=("$@")
    sub=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -f) COMPOSE_FILE="$2"; shift 2 ;;
        -d|--no-deps|--remove-orphans|-T) shift ;;
        config|pull|up|ps|exec|logs|kill|restart|run) sub="$1"; shift ;;
        *) shift ;;
      esac
    done
    case "$sub" in
      config)
        while IFS= read -r line || [[ -n "$line" ]]; do resolve_line "$line"; done < "$COMPOSE_FILE"
        ;;
      pull)
        if [[ " ${compose_args[*]} " == *" pull all "* ]]; then
          printf 'FAIL: docker compose pull must omit a service to pull all, never use service=all\n' >&2
          exit 64
        fi
        if [ -n "${FAKE_DOCKER_PULL_LOG:-}" ]; then
          printf 'compose %s\n' "${compose_args[*]}" >> "$FAKE_DOCKER_PULL_LOG"
        fi
        exit 0
        ;;
      up)
        active_compose_file="${COMPOSE_FILE:-docker-compose.yml}"
        if [ -n "${FAKE_DOCKER_UP_LOG:-}" ]; then
          printf 'compose %s\n' "${compose_args[*]}" >> "$FAKE_DOCKER_UP_LOG"
        fi
        if [ -n "${FAKE_LIVE_ALLOY_UNHEALTHY_FILE:-}" ] \
            && [[ "${compose_args[*]}" != *"postgres"* ]]; then
          rm -f "$FAKE_LIVE_ALLOY_UNHEALTHY_FILE"
        fi
        if [ -n "${FAKE_ROLLBACK_UP_LOG:-}" ] \
            && grep -q 'wotbtools-backend:sha-A' "$active_compose_file"; then
          printf '%s\n' "$COMPOSE_FILE" >> "$FAKE_ROLLBACK_UP_LOG"
        fi
        if [ "${FAKE_CORRUPT_PREV:-0}" = 1 ] && ! active_tag_healthy \
            && [ -n "${FAKE_PREV_ALLOY:-}" ]; then
          printf 'legacy known-bad selector [^ ]+\\.apk\n' > "$FAKE_PREV_ALLOY"
        fi
        if [ "${FAKE_CORRUPT_LKG:-0}" = 1 ] && ! active_tag_healthy \
            && [ -n "${FAKE_LKG_ALLOY:-}" ]; then
          printf 'known-bad selector [^ ]+\\.apk\n' > "$FAKE_LKG_ALLOY"
        fi
        exit 0
        ;;
      ps)
        printf 'wotb-backend Up\nwotb-frontend Up\nkeycloak Up\nprometheus Up\nloki Up\n'
        if [ "${FAKE_ALLOY_UNHEALTHY:-0}" = 1 ] || [ -n "${FAKE_LIVE_ALLOY_UNHEALTHY_FILE:-}" ] \
            && [ -f "$FAKE_LIVE_ALLOY_UNHEALTHY_FILE" ]; then
          printf 'alloy Restarting (1)\n'
        else
          printf 'alloy Up\n'
        fi
         if [ "${FAKE_GRAFANA_UNHEALTHY:-0}" = 1 ]; then
           printf 'grafana Exited (1)\n'
         else
           printf 'grafana Up\n'
         fi
         printf 'test Up\n'
        ;;
      exec)
        request="${compose_args[*]}"
        if [[ "$request" == *"pg_isready"* || "$request" == *"pg_dump"* || \
              "$request" == *"pg_restore"* || "$request" == *"psql"* ]]; then
          printf 'mock-pg-dump-data\n'
          exit 0
        fi
        if [ "${FAKE_ALLOY_UNHEALTHY:-0}" = 1 ] \
            && [[ "$request" == *"metrics"* || "$request" == *"/api/v1/"* ]]; then
          exit 1
        fi
        if active_tag_healthy; then
          if [[ "$request" == *"/loki/api/v1/query_range"* ]]; then
            query_log="${FAKE_QUERY_STARTS:-}"
            if [ -n "$query_log" ]; then
              start_value="${request#*start=}"
              start_value="${start_value%%&*}"
              printf '%s\n' "$start_value" >> "$query_log"
            fi
            query_count_file="${FAKE_QUERY_COUNT_FILE:-}"
            query_count=0
            if [ -n "$query_count_file" ]; then
              query_count="$(cat "$query_count_file" 2>/dev/null || printf '0')"
              query_count=$((query_count + 1))
              printf '%s\n' "$query_count" > "$query_count_file"
            fi
            if [[ "$request" == *"container_name%3D%22wotb-backend%22"* && "$request" == *"${WOTB_OBSERVABILITY_CANARY_MARKER:-stable-canary}"* ]]; then
              loki_line="backend-canary ${WOTB_OBSERVABILITY_CANARY_MARKER:-stable-canary}"
            elif [[ "$request" == *"container_name%3D%22keycloak%22"* && "$request" == *"${WOTB_KEYCLOAK_CANARY_MARKER:-stable-keycloak}"* ]]; then
              loki_line="keycloak-canary ${WOTB_KEYCLOAK_CANARY_MARKER:-stable-keycloak}"
            elif [[ "$request" == *"container_name%3D%22wotb-frontend%22"* && "$request" == *"${WOTB_FRONTEND_CANARY_APK:-stable.apk}"* ]]; then
              loki_line="event=android_apk_download apk=${WOTB_FRONTEND_CANARY_APK:-stable.apk} status=404 bytes=42"
            else
              exit 1
            fi
            if [ "${FAKE_LOKI_EMPTY:-0}" = 1 ] || \
               { [ "${FAKE_LOKI_DELAYED:-0}" = 1 ] && [ "$query_count" -le 2 ]; }; then
              printf '{"status":"success","data":{"result":[]}}\n'
            else
              printf '{"status":"success","data":{"result":[{"stream":{},"values":[["0","%s"]]}]}}\n' "$loki_line"
            fi
            exit 0
          fi
          if [[ "$request" == *"/api/v1/query?"* ]]; then
            printf '{"status":"success","data":{"resultType":"vector","result":[{"value":[0,"%s"]}]}}\n' "${FAKE_PROMETHEUS_UP:-1}"
            exit 0
          fi
          if [[ "$request" == *"/api/v1/targets"* ]]; then
            printf '{"status":"success","data":{"activeTargets":[{"labels":{"job":"wotb-backend"}},{"labels":{"job":"node-exporter"}},{"labels":{"job":"prometheus"}},{"labels":{"job":"loki"}},{"labels":{"job":"grafana"}}]}}\n'
            exit 0
          fi
          if [[ "$request" == *"/api/datasources"* || "$request" == *"/api/dashboards"* ]]; then
            api_path=""
            for arg in "${compose_args[@]}"; do
              [[ "$arg" == /api/* ]] && api_path="$arg"
            done
            [ -n "$api_path" ] || exit 1
            helper_script="$(cat)"
            grep -Fq 'url="http://grafana:3000${path}"' <<<"$helper_script" || exit 1
            grep -Fq 'wget --header="Authorization: Basic $token"' <<<"$helper_script" || exit 1
            [ "${FAKE_GRAFANA_AUTH:-1}" = 1 ] || exit 1
            if [[ "$request" == *"/api/datasources"* ]]; then
              printf '{"status":"OK"}\n'
            else
              printf '{"dashboard":{"uid":"wotbtools-production-overview wotbtools-backend-overview wotbtools-error-explorer wotbtools-ai-review wotbtools-keycloak wotbtools-usage"}}\n'
            fi
            exit 0
          fi
           if [[ "$request" == *"wotb-frontend"* && "$request" == *"grafana:3000/api/health"* ]]; then
             if [ "${FAKE_GRAFANA_NEVER_READY:-0}" = 1 ]; then
               exit 1
             fi
             if [ -n "${FAKE_GRAFANA_PROBE_FILE:-}" ]; then
               probe_count="$(cat "$FAKE_GRAFANA_PROBE_FILE" 2>/dev/null || printf '0')"
               probe_count=$((probe_count + 1))
               printf '%s\n' "$probe_count" > "$FAKE_GRAFANA_PROBE_FILE"
               if [ "$probe_count" -lt "${FAKE_GRAFANA_READY_AFTER:-1}" ]; then
                 exit 1
               fi
             fi
             printf '{"database":"ok"}\n'
           elif [[ "$request" == *"wotb-frontend"*"/api/health"* ]]; then
            if [[ "$request" == *"--header=Host: monitor.wotbtools.com"* ]]; then
              printf '{"database":"ok"}\n'
            else
              [[ "$request" == *"--header=Host: wotbtools.com"* ]] || exit 1
              app_tag_unhealthy frontend && exit 1
              printf '{"status":"UP"}\n'
            fi
          elif [[ "$request" == *"8088/actuator/prometheus"* ]]; then
            printf 'jvm_ process_ system_ http_server_requests wotb_replay_parse_active wotb_replay_parse_queue_depth wotb_ai_review_in_flight wotb_ai_review_queue_depth hikaricp_connections_active\n'
          elif [[ "$request" == *"keycloak:8080/realms/wotbtools/.well-known/openid-configuration"* ]]; then
            app_tag_unhealthy keycloak && exit 1
            printf '{"issuer":"http://keycloak:8080/realms/wotbtools"}\n'
          elif [[ "$request" == *"node-exporter:9100/metrics"* ]]; then
            printf 'node_\n'
          elif [[ "$request" == *"prometheus:9090/metrics"* ]]; then
            printf 'prometheus_\n'
          elif [[ "$request" == *"loki:3100/metrics"* ]]; then
            printf 'loki_\n'
          elif [[ "$request" == *"grafana:3000/metrics"* ]]; then
            printf 'grafana_\n'
          elif [[ "$request" == *"grafana:3000/api/health"* ]]; then
            printf '{"database":"ok"}\n'
          else
            if [[ "$request" == *"127.0.0.1:8087/api/health"* ]]; then
              app_tag_unhealthy backend && exit 1
              printf '{"status":"UP"}\n'
              exit 0
            fi
            printf 'mock-pg-dump-data\n'
          fi
          exit 0
        fi
        exit 1
        ;;
      kill) exit 0 ;;
      run)
        if [ -n "${FAKE_DOCKER_RUN_LOG:-}" ]; then
          printf 'compose %s\n' "${compose_args[*]}" >> "$FAKE_DOCKER_RUN_LOG"
        fi
        exit 0
        ;;
      restart)
        if [ -n "${FAKE_DOCKER_RESTART_LOG:-}" ]; then
          printf 'compose %s\n' "${compose_args[*]}" >> "$FAKE_DOCKER_RESTART_LOG"
        fi
        exit 0
        ;;
      logs) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
  image) exit 0 ;;
  builder) exit 0 ;;
  run)
    if [ -n "${FAKE_DOCKER_RUN_LOG:-}" ]; then
      printf '%s\n' "$*" >> "$FAKE_DOCKER_RUN_LOG"
    fi
    exit 0
    ;;
  rm) exit 0 ;;
  *) exit 0 ;;
esac
FAKE_DOCKER
chmod +x "$WORK/bin/docker"

export PATH="$WORK/bin:$PATH"
export WOTB_DIR="$WORK"
export WOTB_INCOMING_DIR="$WORK/deploy.incoming"
export WOTB_COMPOSE_DIR="$WORK"
export WOTB_BACKUP_ROOT="$WORK/backups"
export WOTB_HEALTH_RETRIES="${WOTB_HEALTH_RETRIES:-3}"
export FAKE_DOCKER_RUN_LOG="$WORK/docker-run.log"
export FAKE_DOCKER_RESTART_LOG="$WORK/docker-restart.log"
export DB_PASSWORD=db-secret KC_ADMIN_PASSWORD=kc-secret WG_APPLICATION_ID=wg-id \
       KEYCLOAK_ADMIN_CLIENT_SECRET=kc-client-secret AI_API_KEY=ai-key \
       GRAFANA_ADMIN_USER=admin GRAFANA_ADMIN_PASSWORD=grafana-secret

fail() { echo "FAIL: $*" >&2; exit 1; }

stage_candidate_b() {
  rm -rf "$WORK/deploy.incoming/deploy"
  mkdir -p "$WORK/deploy.incoming/deploy"
  cp -a "$WORK/deploy/." "$WORK/deploy.incoming/deploy/"
  cp "$ROOT/deploy/validate-alloy-config.sh" "$WORK/deploy.incoming/deploy/validate-alloy-config.sh"
  cp "$ROOT/deploy/verify-observability.sh" "$WORK/deploy.incoming/deploy/verify-observability.sh"
  cp "$ROOT/deploy/grafana-api-request.sh" "$WORK/deploy.incoming/deploy/grafana-api-request.sh"
  sed -i 's/\r$//' "$WORK/deploy.incoming/deploy/validate-alloy-config.sh"
  sed -i 's/\r$//' \
    "$WORK/deploy.incoming/deploy/verify-observability.sh" \
    "$WORK/deploy.incoming/deploy/grafana-api-request.sh"
  printf 'new prometheus config\n' > "$WORK/deploy.incoming/deploy/observability/prometheus/prometheus.yml"
  cp "$ROOT/deploy/observability/alloy/config.alloy" "$WORK/deploy.incoming/deploy/observability/alloy/config.alloy"
  printf '\n// new alloy config\n' >> "$WORK/deploy.incoming/deploy/observability/alloy/config.alloy"
}

run_manual_latest_case() {
  local rejected_output rejected_rc manual_backend_output stale_output stale_rc
  local automatic_output automatic_backend_sha manual_latest_output manual_latest_up_line

  mkdir -p "$WORK/deployed-state"
  for service in wotb-backend wotb-frontend keycloak; do
    printf '600\n' > "$WORK/deployed-state/$service.run"
    printf 'sha-automatic-600\n' > "$WORK/deployed-state/$service.sha"
  done

  set +e
  rejected_output="$(env TAG=latest WOTB_DEPLOY_SERVICE=postgres \
    FAKE_HEALTHY_BACKEND_TAG=latest \
    WOTB_BACKUP_ROOT="$WORK/backups-manual-latest-rejected" \
    bash "$WORK/deploy/deploy.sh" 2>&1)"
  rejected_rc=$?
  set -e
  [[ $rejected_rc -ne 0 ]] \
    || fail "manual latest must reject a low-level Compose service"
  grep -q "manual latest deployment only supports application services" <<<"$rejected_output" \
    || fail "manual latest low-level service rejection marker missing: $rejected_output"

  stage_candidate_b
  : > "$WORK/docker-pull-manual-backend.log"
  : > "$WORK/docker-up-manual-backend.log"
  manual_backend_output="$(env TAG=latest WOTB_DEPLOY_SERVICES=wotb-backend \
    WOTB_DEPLOY_IMAGE_SERVICES=wotb-backend \
    FAKE_HEALTHY_BACKEND_TAG=latest \
    FAKE_DOCKER_PULL_LOG="$WORK/docker-pull-manual-backend.log" \
    FAKE_DOCKER_UP_LOG="$WORK/docker-up-manual-backend.log" \
    WOTB_BACKUP_ROOT="$WORK/backups-manual-backend" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)" \
    || fail "manual latest backend deploy must succeed: $manual_backend_output"
  grep -Eq ' pull .*wotb-backend$' "$WORK/docker-pull-manual-backend.log" \
    || fail "manual latest backend deploy must pull only the backend image"
  [[ "$(cat "$WORK/deployed-state/wotb-backend.run")" == 600 ]] \
    || fail "manual latest backend deploy must preserve backend automatic run generation"
  [[ "$(cat "$WORK/deployed-state/wotb-backend.sha")" == sha-automatic-600 ]] \
    || fail "manual latest backend deploy must preserve backend automatic identity"
  for service in wotb-frontend keycloak; do
    [[ "$(cat "$WORK/deployed-state/$service.run")" == 600 ]] \
      || fail "manual latest backend deploy must preserve $service automatic run generation"
    [[ "$(cat "$WORK/deployed-state/$service.sha")" == sha-automatic-600 ]] \
      || fail "manual latest backend deploy must preserve $service automatic identity"
  done

  stage_candidate_b
  : > "$WORK/docker-up-manual-stale.log"
  set +e
  stale_output="$(env TAG=sha-cccccccccccc \
    RELEASE_SHA=cccccccccccccccccccccccccccccccccccccccc \
    RELEASE_RUN_NUMBER=500 WOTB_STALE_RELEASE_GUARD=1 WOTB_DEPLOY_SERVICE=wotb-backend \
    FAKE_DOCKER_UP_LOG="$WORK/docker-up-manual-stale.log" \
    WOTB_BACKUP_ROOT="$WORK/backups-manual-stale" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
  stale_rc=$?
  set -e
  [[ $stale_rc -ne 0 ]] || fail "automatic run 500 must remain stale after manual latest backend deploy"
  grep -q 'stale release run 500 cannot overwrite deployed wotb-backend run 600' <<<"$stale_output" \
    || fail "manual latest must preserve the automatic stale guard: $stale_output"
  [[ ! -s "$WORK/docker-up-manual-stale.log" ]] \
    || fail "stale automatic run must be rejected before compose up"

  stage_candidate_b
  automatic_output="$(env TAG=sha-aaaaaaaaaaaa \
    RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    RELEASE_RUN_NUMBER=601 WOTB_STALE_RELEASE_GUARD=1 WOTB_DEPLOY_SERVICE=wotb-backend \
    WOTB_DEPLOY_IMAGE_SERVICES=wotb-backend FAKE_HEALTHY_BACKEND_TAG=sha-aaaaaaaaaaaa \
    WOTB_BACKUP_ROOT="$WORK/backups-manual-generation-601" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)" \
    || fail "automatic run 601 must remain deployable after manual latest backend deploy: $automatic_output"
  [[ "$(cat "$WORK/deployed-state/wotb-backend.run")" == 601 ]] \
    || fail "automatic run 601 must advance backend generation"
  automatic_backend_sha="$(cat "$WORK/deployed-state/wotb-backend.sha")"

  stage_candidate_b
  : > "$WORK/docker-pull-manual-latest.log"
  : > "$WORK/docker-up-manual-latest.log"
  manual_latest_output="$(env TAG=latest WOTB_DEPLOY_SERVICES=all \
    WOTB_DEPLOY_IMAGE_SERVICES=wotb-backend,wotb-frontend,keycloak \
    FAKE_HEALTHY_BACKEND_TAG=latest \
    FAKE_DOCKER_PULL_LOG="$WORK/docker-pull-manual-latest.log" \
    FAKE_DOCKER_UP_LOG="$WORK/docker-up-manual-latest.log" \
    WOTB_BACKUP_ROOT="$WORK/backups-manual-latest" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)" \
    || fail "manual latest full deploy must succeed: $manual_latest_output"
  grep -Eq ' pull .*wotb-backend wotb-frontend keycloak$' "$WORK/docker-pull-manual-latest.log" \
    || fail "manual latest full deploy must pull all application images only"
  manual_latest_up_line="$(grep -E 'compose up .*keycloak wotb-backend wotb-frontend$' "$WORK/docker-up-manual-latest.log" | head -n 1)"
  [ -n "$manual_latest_up_line" ] \
    || fail "manual latest full deploy must explicitly start only application services"
  for forbidden_service in postgres node-exporter prometheus loki alloy grafana; do
    ! grep -Eq " $forbidden_service( |$)" <<<"$manual_latest_up_line" \
      || fail "manual latest full deploy must not explicitly start $forbidden_service"
  done
  ! grep -q 'OBSERVABILITY DEGRADED' <<<"$manual_latest_output" \
    || fail "manual latest full deploy must not run the automatic observability maintenance path"
  [[ "$(cat "$WORK/deployed-state/wotb-backend.run")" == 601 ]] \
    || fail "manual latest Deploy All must preserve backend automatic run generation"
  [[ "$(cat "$WORK/deployed-state/wotb-backend.sha")" == "$automatic_backend_sha" ]] \
    || fail "manual latest Deploy All must preserve backend automatic identity"
  for service in wotb-frontend keycloak; do
    [[ "$(cat "$WORK/deployed-state/$service.run")" == 600 ]] \
      || fail "manual latest Deploy All must preserve $service automatic run generation"
    [[ "$(cat "$WORK/deployed-state/$service.sha")" == sha-automatic-600 ]] \
      || fail "manual latest Deploy All must preserve $service automatic identity"
  done
}

# A healthy existing deployment is the normal first-LKG path. The deployment
# under test can then proceed without an emergency bypass or legacy rollback.
mkdir -p "$WORK/deploy"
cp -a "$WORK/deploy.incoming/deploy/." "$WORK/deploy/"
TAG=sha-A docker compose -f "$WORK/deploy/docker-compose.prod.yml" config > "$WORK/docker-compose.yml"
printf 'sha-A\n' > "$WORK/DEPLOYED_SHA"

lkg_state_checksum() {
  (
    cd "$WORK"
    find deploy.lkg -type f -print0 | sort -z | xargs -0 sha256sum
    sha256sum docker-compose.lkg.yml DEPLOYED_SHA.lkg
  )
}

# WG application ID remains a Keycloak IdP setting; backend no longer calls WG stats.
wg_application_id_injections="$(grep -Fc 'WG_APPLICATION_ID: ${WG_APPLICATION_ID:?WG_APPLICATION_ID is required}' \
  "$WORK/deploy.incoming/deploy/docker-compose.prod.yml")"
[[ "$wg_application_id_injections" == "1" ]] \
  || fail "production compose must inject WG_APPLICATION_ID into keycloak only"

# ---- deadline alignment guard: 400 must fail fast with a clean error; 1100 must pass ----
export TAG=sha-A
set +e
guard_output=$(AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=400 bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)
guard_rc=$?
set -e
[[ $guard_rc -ne 0 ]] || fail "deadline=400 must fail the alignment guard"
[[ $guard_rc -eq 3 ]] || fail "deadline=400 must exit with the controlled code 3, got $guard_rc"
grep -q "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC must be 1100" <<<"$guard_output" \
  || fail "deadline=400 error message missing: $guard_output"
if grep -q "command not found\|No such file or directory" <<<"$guard_output"; then
  fail "deadline=400 must not produce shell errors: $guard_output"
fi

# AI_API_KEY must be rejected before any deployment work when it contains an
# HTTP-header control character; the value itself must never appear in output.
set +e
guard_output=$(AI_API_KEY=$'ai-key\n' bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)
guard_rc=$?
set -e
[[ $guard_rc -ne 0 ]] || fail "AI_API_KEY containing LF must fail the deployment guard"
grep -q "AI_API_KEY contains invalid control characters" <<<"$guard_output" \
  || fail "AI_API_KEY control-character error message missing: $guard_output"
! grep -q "ai-key" <<<"$guard_output" \
  || fail "AI_API_KEY value must not be printed by the validation guard"

# ---- deploy A (success) ----
export AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100
: > "$WORK/docker-pull.log"
export FAKE_DOCKER_PULL_LOG="$WORK/docker-pull.log"
bash "$WORK/deploy.incoming/deploy/deploy.sh"
[[ -f "$WORK/DEPLOYED_SHA" ]] || fail "DEPLOYED_SHA missing after deploy A"
[[ "$(cat "$WORK/DEPLOYED_SHA")" == "sha-A" ]] || fail "DEPLOYED_SHA != sha-A after deploy A"
[[ -f "$WORK/DEPLOYED_SHA.lkg" ]] || fail "DEPLOYED_SHA.lkg missing after deploy A"
[[ "$(cat "$WORK/DEPLOYED_SHA.lkg")" == "sha-A" ]] || fail "DEPLOYED_SHA.lkg != sha-A after deploy A"
[[ -d "$WORK/deploy.lkg" ]] || fail "deploy.lkg missing after deploy A"
[[ -f "$WORK/docker-compose.lkg.yml" ]] || fail "docker-compose.lkg.yml missing after deploy A"
grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.yml" || fail "formal compose does not pin sha-A images"
grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.lkg.yml" || fail "LKG compose does not pin sha-A images"
grep -q '\${' "$WORK/docker-compose.yml" && fail "formal compose still contains unresolved \${...}"
grep -Eq 'compose .* pull$' "$WORK/docker-pull.log" \
  || fail "full deployment must pull all services by omitting the service argument"
! grep -q ' pull all' "$WORK/docker-pull.log" \
  || fail "full deployment must never invoke docker compose pull all"
grep -Eq 'keycloak-observability-canary-.*alpine:3\.22' "$WORK/docker-run.log" \
  || fail "Keycloak canary must use an independent Alpine 3.22 emitter"
if grep -Eq 'compose.*run.*keycloak.*sh -c' "$WORK/docker-run.log"; then
  fail "Keycloak canary must not invoke the Keycloak image entrypoint as a shell"
fi
if [ -f "$WORK/docker-restart.log" ]; then
  ! grep -q 'compose restart wotb-frontend' "$WORK/docker-restart.log" \
    || fail "successful deployment must not restart frontend nginx for Grafana recreation"
fi

if [ "${WOTB_TEST_MANUAL_LATEST_ONLY:-0}" = 1 ]; then
  run_manual_latest_case
  echo "manual latest full deployment contract OK"
  exit 0
fi

# ---- per-service release generations: failure and retry are independent ----
mkdir -p "$WORK/deployed-state"
printf '90\n' > "$WORK/deployed-state/wotb-backend.run"
printf 'sha-backend-90\n' > "$WORK/deployed-state/wotb-backend.sha"
printf '90\n' > "$WORK/deployed-state/wotb-frontend.run"
printf 'sha-frontend-90\n' > "$WORK/deployed-state/wotb-frontend.sha"
printf '90\n' > "$WORK/deployed-state/keycloak.run"
printf 'sha-keycloak-90\n' > "$WORK/deployed-state/keycloak.sha"

run_generation_case() {
  local service="$1" run_number="$2" commit_sha="$3" unhealthy_tag="${4:-}" output rc
  stage_candidate_b
  export TAG="sha-${commit_sha:0:12}" RELEASE_SHA="$commit_sha" RELEASE_RUN_NUMBER="$run_number"
  export WOTB_STALE_RELEASE_GUARD=1 WOTB_DEPLOY_SERVICE="$service"
  unset WOTB_DEPLOY_SERVICES WOTB_DEPLOY_IMAGE_SERVICES
  if [ -n "$unhealthy_tag" ]; then
    export FAKE_APP_UNHEALTHY_TAG="$TAG" FAKE_APP_UNHEALTHY_SERVICE=backend
    unset FAKE_HEALTHY_BACKEND_TAG
  else
    unset FAKE_APP_UNHEALTHY_TAG FAKE_APP_UNHEALTHY_SERVICE
    export FAKE_HEALTHY_BACKEND_TAG="$TAG"
  fi
  set +e
  output="$(WOTB_BACKUP_ROOT="$WORK/backups-generation-$service-$run_number" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
  rc=$?
  set -e
  if [ -n "$unhealthy_tag" ]; then
    [[ $rc -ne 0 ]] || fail "failed $service generation must reject the candidate"
    grep -q 'TARGETED ROLLBACK OK' <<<"$output" || fail "failed generation must roll back"
  else
    [[ $rc -eq 0 ]] || fail "successful $service generation failed: $output"
  fi
}

backend_run_100='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
frontend_run_101='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
run_generation_case wotb-backend 100 "$backend_run_100" failed
run_generation_case wotb-frontend 101 "$frontend_run_101"
run_generation_case wotb-backend 100 "$backend_run_100"
[[ "$(cat "$WORK/deployed-state/wotb-backend.run")" == 100 ]] \
  || fail "backend retry must update only backend generation"
[[ "$(cat "$WORK/deployed-state/wotb-frontend.run")" == 101 ]] \
  || fail "frontend generation must remain independently newer"

# Same-service stale release is rejected before any production mutation.
stage_candidate_b
before_stale_compose="$(sha256sum "$WORK/docker-compose.yml")"
: > "$WORK/docker-up-generation-stale.log"
set +e
stale_output="$(env TAG=sha-cccccccccccc \
  RELEASE_SHA=cccccccccccccccccccccccccccccccccccccccc \
  RELEASE_RUN_NUMBER=99 WOTB_STALE_RELEASE_GUARD=1 WOTB_DEPLOY_SERVICE=wotb-backend \
  FAKE_DOCKER_UP_LOG="$WORK/docker-up-generation-stale.log" \
  WOTB_BACKUP_ROOT="$WORK/backups-generation-stale" \
  bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
stale_rc=$?
set -e
[[ $stale_rc -ne 0 ]] || fail "same-service stale generation must reject"
grep -q 'stale release run 99 cannot overwrite deployed wotb-backend run 100' <<<"$stale_output" \
  || fail "same-service stale error missing: $stale_output"
[[ "$(sha256sum "$WORK/docker-compose.yml")" == "$before_stale_compose" ]] \
  || fail "same-service stale precheck mutated production compose"
[[ ! -s "$WORK/docker-up-generation-stale.log" ]] \
  || fail "same-service stale precheck reached docker compose up"

# Multi-service stale precheck is atomic: neither target may mutate first.
printf '90\n' > "$WORK/deployed-state/wotb-backend.run"
stage_candidate_b
before_multi_compose="$(sha256sum "$WORK/docker-compose.yml")"
: > "$WORK/docker-up-generation-multi.log"
set +e
multi_output="$(env TAG=sha-dddddddddddd \
  RELEASE_SHA=dddddddddddddddddddddddddddddddddddddddd \
  RELEASE_RUN_NUMBER=99 WOTB_STALE_RELEASE_GUARD=1 \
  WOTB_DEPLOY_SERVICES=wotb-backend,wotb-frontend \
  WOTB_DEPLOY_IMAGE_SERVICES=wotb-backend,wotb-frontend \
  FAKE_DOCKER_UP_LOG="$WORK/docker-up-generation-multi.log" \
  WOTB_BACKUP_ROOT="$WORK/backups-generation-multi" \
  bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
multi_rc=$?
set -e
[[ $multi_rc -ne 0 ]] || fail "multi-service stale generation must reject"
grep -q 'stale release run 99 cannot overwrite deployed wotb-frontend run 101' <<<"$multi_output" \
  || fail "multi-service stale error missing"
[[ "$(sha256sum "$WORK/docker-compose.yml")" == "$before_multi_compose" ]] \
  || fail "multi-service stale precheck mutated production compose"
[[ ! -s "$WORK/docker-up-generation-multi.log" ]] \
  || fail "multi-service stale precheck reached docker compose up"
unset WOTB_STALE_RELEASE_GUARD WOTB_DEPLOY_SERVICE WOTB_DEPLOY_SERVICES WOTB_DEPLOY_IMAGE_SERVICES
unset RELEASE_SHA RELEASE_RUN_NUMBER TAG

# ---- observability gates must fail closed on up=0 and an empty Loki result ----
set +e
up_zero_output="$(env FAKE_PROMETHEUS_UP=0 WOTB_OBSERVABILITY_RETRIES=1 \
  WOTB_OBSERVABILITY_INTERVAL_SEC=1 bash "$WORK/deploy/verify-observability.sh" 2>&1)"
up_zero_rc=$?
set -e
[[ $up_zero_rc -ne 0 ]] || fail "Prometheus up=0 must fail the observability gate"
grep -q "up != 1" <<<"$up_zero_output" || fail "up=0 failure must explain the unhealthy target"

set +e
core_failure_output="$(env FAKE_FORCE_UNHEALTHY=1 \
  WOTB_OBSERVABILITY_RETRIES=1 WOTB_OBSERVABILITY_INTERVAL_SEC=1 \
  bash "$WORK/deploy/verify-observability.sh" 2>&1)"
core_failure_rc=$?
set -e
[[ $core_failure_rc -ne 0 ]] || fail "rollback core health failure must fail closed"
grep -q "OBSERVABILITY FAIL" <<<"$core_failure_output" \
  || fail "observability failure must identify the failed gate"

set +e
empty_loki_output="$(env FAKE_LOKI_EMPTY=1 WOTB_OBSERVABILITY_RETRIES=1 \
  WOTB_OBSERVABILITY_INTERVAL_SEC=1 bash "$WORK/deploy/verify-observability.sh" 2>&1)"
empty_loki_rc=$?
set -e
[[ $empty_loki_rc -ne 0 ]] || fail "empty Loki result must fail the observability gate"
grep -q "backend or Keycloak canary was not ingested" <<<"$empty_loki_output" \
  || fail "empty Loki failure must identify the deployment canary"

set +e
wrong_grafana_output="$(env FAKE_GRAFANA_AUTH=0 WOTB_OBSERVABILITY_RETRIES=1 \
  WOTB_OBSERVABILITY_INTERVAL_SEC=1 bash "$WORK/deploy/verify-observability.sh" 2>&1)"
wrong_grafana_rc=$?
set -e
[[ $wrong_grafana_rc -ne 0 ]] || fail "wrong Grafana credentials must fail the observability gate"
grep -q "Grafana Prometheus datasource" <<<"$wrong_grafana_output" \
  || fail "wrong Grafana credential failure must identify the datasource auth check"

: > "$WORK/query-starts"
: > "$WORK/query-count"
delayed_loki_output="$(env FAKE_LOKI_DELAYED=1 \
  FAKE_QUERY_STARTS="$WORK/query-starts" \
  FAKE_QUERY_COUNT_FILE="$WORK/query-count" \
  WOTB_OBSERVABILITY_RETRIES=2 WOTB_OBSERVABILITY_INTERVAL_SEC=1 \
  bash "$WORK/deploy/verify-observability.sh" 2>&1)" \
  || fail "delayed Loki ingestion should pass after a later retry"
[[ "$(head -4 "$WORK/query-starts" | sort -u | wc -l)" -eq 1 ]] \
  || fail "backend/Keycloak Loki retries must keep a fixed query start"

# The previous live tree owns rollback. Stage a second tree with different
# observability files before deploy B.
stage_candidate_b

# Simulate a historical LKG generated before the deployment-owned verifier and
# Keycloak management capability existed.
cp -a "$WORK/deploy.lkg" "$WORK/deploy.lkg.retiring"
cp "$WORK/docker-compose.lkg.yml" "$WORK/docker-compose.lkg.retiring.yml"
cp "$WORK/DEPLOYED_SHA.lkg" "$WORK/DEPLOYED_SHA.lkg.retiring"
rm -f "$WORK/deploy.lkg/verify-observability.sh" "$WORK/deploy.lkg/validate-alloy-config.sh" \
  "$WORK/deploy.lkg/grafana-api-request.sh"

# ---- deploy B (health fails) -> must roll back to A ----
export LKG_STATE_BEFORE="$(lkg_state_checksum)"

# ---- partial LKG retirement faults -> old bundle remains intact ----
for fault in compose-retire sha-retire; do
  stage_candidate_b
  export TAG=sha-B FAKE_HEALTHY_BACKEND_TAG=sha-B WOTB_BACKUP_ROOT="$WORK/backups-$fault"
  unset WOTB_TEST_FAIL_LKG_DEPLOY_RETIRE WOTB_TEST_FAIL_LKG_COMPOSE_RETIRE WOTB_TEST_FAIL_LKG_SHA_RETIRE
  case "$fault" in
    compose-retire) export WOTB_TEST_FAIL_LKG_COMPOSE_RETIRE=1 ;;
    sha-retire) export WOTB_TEST_FAIL_LKG_SHA_RETIRE=1 ;;
  esac
  set +e
  retirement_output="$(bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
  retirement_rc=$?
  set -e
  [[ $retirement_rc -ne 0 ]] || fail "$fault must fail closed"
  grep -q "TEST INJECTION: refusing LKG retirement move" <<<"$retirement_output" \
    || fail "$fault must report the injected retirement failure"
  grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.yml" \
    || fail "$fault must not leave the candidate live"
  [[ "$(cat "$WORK/DEPLOYED_SHA")" == "sha-A" ]] || fail "$fault changed DEPLOYED_SHA"
  [[ "$(cat "$WORK/DEPLOYED_SHA.lkg")" == "sha-A" ]] || fail "$fault changed DEPLOYED_SHA.lkg"
  [[ "$LKG_STATE_BEFORE" == "$(lkg_state_checksum)" ]] \
    || fail "$fault deleted or changed canonical LKG artifacts"
done
[[ ! -e "$WORK/deploy.lkg.retiring" && ! -e "$WORK/docker-compose.lkg.retiring.yml" \
  && ! -e "$WORK/DEPLOYED_SHA.lkg.retiring" ]] \
  || fail "stale LKG retirement artifacts were not recovered"
unset FAKE_HEALTHY_BACKEND_TAG WOTB_TEST_FAIL_LKG_DEPLOY_RETIRE \
  WOTB_TEST_FAIL_LKG_COMPOSE_RETIRE WOTB_TEST_FAIL_LKG_SHA_RETIRE
export WOTB_BACKUP_ROOT="$WORK/backups"

# The retirement fault cases consume the incoming candidate; recreate it for
# the original health-failure rollback scenario below.
stage_candidate_b

export FAKE_APP_UNHEALTHY_TAG=sha-B
export FAKE_PREV_ALLOY="$WORK/deploy.prev/observability/alloy/config.alloy"
export FAKE_CORRUPT_PREV=1
export TAG=sha-B
set +e
deploy_b_output="$(bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "deploy B must fail (health check)"
grep -q "== APPLICATION GATE FAILED ==" <<<"$deploy_b_output" \
  || fail "new deployment diagnostics marker missing before rollback"
grep -q "== service list (no container environment dump) ==" <<<"$deploy_b_output" \
  || fail "service diagnostics missing"
new_diag_line="$(grep -n "== APPLICATION GATE FAILED ==" <<<"$deploy_b_output" | head -1 | cut -d: -f1)"
rollback_line="$(grep -n "== DEPLOY FAILED: rolling back to LKG runtime ==" <<<"$deploy_b_output" | head -1 | cut -d: -f1)"
[[ "$new_diag_line" -lt "$rollback_line" ]] \
  || fail "new deployment diagnostics must precede rollback"
grep -q "== ROLLBACK OK: sha-A ==" <<<"$deploy_b_output" \
  || fail "LKG rollback must pass the application health gate"
if grep -q "verify-observability.sh: No such file\|validate-alloy-config.sh: No such file" <<<"$deploy_b_output"; then
  fail "rollback must not depend on historical LKG validation scripts"
fi
grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.yml" || fail "after rollback compose must reference sha-A"
grep -q 'wotbtools-backend:sha-B' "$WORK/docker-compose.yml" && fail "after rollback compose still references sha-B"
[[ "$(cat "$WORK/DEPLOYED_SHA")" == "sha-A" ]] || fail "DEPLOYED_SHA not restored to sha-A"
[[ "$(cat "$WORK/DEPLOYED_SHA.lkg")" == "sha-A" ]] || fail "failed deployment changed DEPLOYED_SHA.lkg"
[[ "$LKG_STATE_BEFORE" == "$(lkg_state_checksum)" ]] \
  || fail "failed deployment changed the validated LKG bundle"
grep -q 'stable prometheus config' "$WORK/deploy/observability/prometheus/prometheus.yml" \
  || fail "rollback did not restore previous Prometheus config"
grep -q 'stable alloy config' "$WORK/deploy/observability/alloy/config.alloy" \
  || fail "rollback did not restore previous Alloy config"
grep -q 'known-bad selector' "$WORK/deploy.prev/observability/alloy/config.alloy" \
  || fail "deploy.prev corruption fixture was not installed"
unset FAKE_APP_UNHEALTHY_TAG

# ---- restore transaction fault injection: failed copy preserves B ----
unset FAKE_CORRUPT_PREV FAKE_PREV_ALLOY
for fault in copy live-switch compose-install; do
  stage_candidate_b
  export TAG=sha-B WOTB_BACKUP_ROOT="$WORK/backups-restore-$fault"
  unset WOTB_TEST_FAIL_LKG_RESTORE_COPY WOTB_TEST_FAIL_LKG_RESTORE_LIVE_SWITCH WOTB_TEST_FAIL_LKG_RESTORE_COMPOSE_INSTALL
  case "$fault" in
    copy) export WOTB_TEST_FAIL_LKG_RESTORE_COPY=1 ;;
    live-switch) export WOTB_TEST_FAIL_LKG_RESTORE_LIVE_SWITCH=1 ;;
    compose-install) export WOTB_TEST_FAIL_LKG_RESTORE_COMPOSE_INSTALL=1 ;;
  esac
  set +e
  fault_output="$(bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
  fault_rc=$?
  set -e
  [[ $fault_rc -ne 0 ]] || fail "$fault restore fault must fail closed"
  grep -q "transactionally\|TEST INJECTION" <<<"$fault_output" \
    || fail "$fault restore fault must explain the injected failure"
  grep -q 'wotbtools-backend:sha-B' "$WORK/docker-compose.yml" \
    || fail "$fault restore failure must preserve the current live B compose"
  [[ "$(cat "$WORK/DEPLOYED_SHA")" == "sha-A" ]] \
    || fail "$fault restore failure changed DEPLOYED_SHA"
  [[ "$(cat "$WORK/DEPLOYED_SHA.lkg")" == "sha-A" ]] \
    || fail "$fault restore failure changed DEPLOYED_SHA.lkg"
  [[ "$LKG_STATE_BEFORE" == "$(lkg_state_checksum)" ]] \
    || fail "$fault restore failure changed the validated LKG bundle"
  grep -q "ROLLBACK ABORTED: LKG runtime could not be installed transactionally" <<<"$fault_output" \
    || fail "$fault restore failure must abort before compose recovery"
done
unset WOTB_TEST_FAIL_LKG_RESTORE_COPY WOTB_TEST_FAIL_LKG_RESTORE_LIVE_SWITCH WOTB_TEST_FAIL_LKG_RESTORE_COMPOSE_INSTALL FAKE_ROLLBACK_UP_LOG
export WOTB_BACKUP_ROOT="$WORK/backups"

# ---- LKG staging copy fault: old LKG is still restored transactionally ----
stage_candidate_b
: > "$WORK/rollback-up.log"
export FAKE_ROLLBACK_UP_LOG="$WORK/rollback-up.log"
export TAG=sha-B FAKE_HEALTHY_BACKEND_TAG=sha-B WOTB_TEST_FAIL_LKG_STAGE_COPY=1
set +e
stage_fault_output="$(bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
stage_fault_rc=$?
set -e
[[ $stage_fault_rc -ne 0 ]] || fail "LKG staging copy fault must fail closed"
grep -q "LKG staging failed" <<<"$stage_fault_output" \
  || fail "LKG staging copy fault marker missing"
grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.yml" \
  || fail "LKG staging copy fault must roll back to A"
grep -q 'wotbtools-backend:sha-B' "$WORK/docker-compose.yml" && fail "LKG staging copy fault left B live"
[[ "$(cat "$WORK/DEPLOYED_SHA.lkg")" == "sha-A" ]] \
  || fail "LKG staging copy fault changed DEPLOYED_SHA.lkg"
[[ "$LKG_STATE_BEFORE" == "$(lkg_state_checksum)" ]] \
  || fail "LKG staging copy fault changed the validated LKG bundle"
[[ -s "$FAKE_ROLLBACK_UP_LOG" ]] \
  || fail "LKG staging fault must perform rollback compose up"
unset FAKE_HEALTHY_BACKEND_TAG WOTB_TEST_FAIL_LKG_STAGE_COPY FAKE_ROLLBACK_UP_LOG

# ---- healthy application + broken observability remains a successful deploy ----
run_observability_case() {
  local case_name="$1" tag="$2" assignment="$3" output rc
  local -a env_args=() extra_env=()
  stage_candidate_b
  if [[ "$case_name" == grafana-* ]]; then
    : > "$WORK/docker-restart.log"
  fi
  if [ "$case_name" = "grafana-delayed-readiness" ]; then
    : > "$WORK/grafana-probes"
    extra_env+=("FAKE_GRAFANA_READY_AFTER=3" "FAKE_GRAFANA_PROBE_FILE=$WORK/grafana-probes"
      "WOTB_GRAFANA_READINESS_RETRIES=5" "WOTB_GRAFANA_READINESS_INTERVAL_SEC=1")
  elif [ "$case_name" = "grafana-readiness-timeout" ]; then
    extra_env+=("WOTB_GRAFANA_READINESS_RETRIES=3" "WOTB_GRAFANA_READINESS_INTERVAL_SEC=1")
  fi
  [ -n "$assignment" ] && env_args+=("$assignment")
  set +e
  output="$(env TAG="$tag" FAKE_HEALTHY_BACKEND_TAG="$tag" \
    WOTB_OBSERVABILITY_RETRIES=1 WOTB_OBSERVABILITY_INTERVAL_SEC=1 \
    WOTB_BACKUP_ROOT="$WORK/backups-$case_name" \
    "${env_args[@]}" "${extra_env[@]}" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
  rc=$?
  set -e
  [[ $rc -eq 0 ]] || fail "$case_name must keep the deployment successful: $output"
  grep -q "== DEPLOY OK: $tag ==" <<<"$output" || fail "$case_name missing DEPLOY OK"
  if [ "$case_name" != "grafana-delayed-readiness" ]; then
    grep -q "OBSERVABILITY DEGRADED" <<<"$output" || fail "$case_name missing OBSERVABILITY DEGRADED"
  else
    ! grep -q "OBSERVABILITY DEGRADED" <<<"$output" \
      || fail "$case_name unexpectedly reported OBSERVABILITY DEGRADED"
  fi
  ! grep -q "ROLLBACK" <<<"$output" || fail "$case_name unexpectedly rolled back"
  if [ "$case_name" = "grafana-delayed-readiness" ]; then
    [[ "$(cat "$WORK/grafana-probes")" -eq 3 ]] \
      || fail "$case_name must perform two failed probes before the successful probe"
  elif [ "$case_name" = "grafana-readiness-timeout" ]; then
    if [ -f "$WORK/docker-restart.log" ]; then
      ! grep -q 'compose restart wotb-frontend' "$WORK/docker-restart.log" \
        || fail "$case_name must never restart frontend nginx after readiness timeout"
    fi
  fi
}

run_observability_case grafana-broken sha-GRAFANA 'FAKE_GRAFANA_AUTH=0'
run_observability_case grafana-recreate-failed sha-GRAFANA-RECREATE 'FAKE_GRAFANA_UNHEALTHY=1'
run_observability_case grafana-delayed-readiness sha-GRAFANA-DELAYED ''
run_observability_case grafana-readiness-timeout sha-GRAFANA-TIMEOUT 'FAKE_GRAFANA_NEVER_READY=1'
run_observability_case prometheus-broken sha-PROM 'FAKE_PROMETHEUS_UP=0'
run_observability_case loki-broken sha-LOKI 'FAKE_LOKI_EMPTY=1'
run_observability_case alloy-broken sha-ALLOY 'FAKE_ALLOY_UNHEALTHY=1'

# ---- application failures reject the candidate and start rollback ----
run_application_failure_case() {
  local case_name="$1" tag="$2" service="$3" output rc
  stage_candidate_b
  set +e
  output="$(env TAG="$tag" FAKE_APP_UNHEALTHY_TAG="$tag" FAKE_APP_UNHEALTHY_SERVICE="$service" \
    WOTB_BACKUP_ROOT="$WORK/backups-$case_name" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
  rc=$?
  set -e
  [[ $rc -ne 0 ]] || fail "$case_name must reject the candidate"
  grep -q "APPLICATION GATE FAILED" <<<"$output" || fail "$case_name missing application gate failure"
  grep -q "== ROLLBACK OK:" <<<"$output" || fail "$case_name missing rollback success"
  ! grep -q "== ROLLBACK FAILED:" <<<"$output" || fail "$case_name reported rollback failure"
}

run_application_failure_case backend-unhealthy sha-BACKEND backend
run_application_failure_case frontend-unhealthy sha-FRONTEND frontend
run_application_failure_case keycloak-unhealthy sha-KEYCLOAK keycloak

# ---- targeted deployment recreates only the selected service and never dependencies ----
run_targeted_deploy_case() {
  local service="$1" tag="$2" output rc other_service targeted_up_line healthy_backend_tag
  local log="$WORK/docker-up-targeted-$service.log"
  stage_candidate_b
  healthy_backend_tag="$(sed -nE 's#.*wotbtools-backend:([^[:space:]]+).*#\1#p' "$WORK/docker-compose.yml" | head -n 1)"
  [ -n "$healthy_backend_tag" ] || fail "targeted $service test could not determine the current backend image tag"
  [ "$service" = wotb-backend ] && healthy_backend_tag="$tag"
  : > "$log"
  set +e
  output="$(env TAG="$tag" WOTB_DEPLOY_SERVICE="$service" \
    FAKE_HEALTHY_BACKEND_TAG="$healthy_backend_tag" FAKE_DOCKER_UP_LOG="$log" \
    WOTB_BACKUP_ROOT="$WORK/backups-targeted-$service" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
  rc=$?
  set -e
  [[ $rc -eq 0 ]] || fail "targeted $service deployment must succeed: $output"
  targeted_up_line="$(grep -E "compose up .*--no-deps.* $service$" "$log" || true)"
  if [ -z "$targeted_up_line" ] || \
      [ "$(grep -Ec "compose up .*--no-deps.* $service$" "$log")" -ne 1 ]; then
    fail "targeted $service deployment must use --no-deps; log: $(cat "$log" 2>/dev/null || true)"
  fi
  for other_service in postgres node-exporter prometheus loki alloy grafana keycloak wotb-backend wotb-frontend; do
    [ "$other_service" = "$service" ] && continue
    ! grep -Eq " $other_service( |$)" <<<"$targeted_up_line" \
      || fail "targeted $service deployment must not explicitly start $other_service"
  done
  grep -q "== TARGETED DEPLOY OK: $service ==" <<<"$output" \
    || fail "targeted $service deployment success marker missing"
}

run_targeted_deploy_case grafana sha-TARGETED-GRAFANA
run_targeted_deploy_case wotb-backend sha-TARGETED-BACKEND
run_targeted_deploy_case wotb-frontend sha-TARGETED-FRONTEND

# ---- manual latest full deploy pulls and starts application services only ----
manual_latest_output="$(env WOTB_TEST_MANUAL_LATEST_ONLY=1 WOTB_TEST_ROOT="$ROOT" \
  bash "${WOTB_TEST_SCRIPT_PATH:-$ROOT/deploy/test-deploy-rollback.sh}" 2>&1)" \
  || fail "manual latest isolated deployment contract must pass: $manual_latest_output"
grep -q 'manual latest full deployment contract OK' <<<"$manual_latest_output" \
  || fail "manual latest isolated deployment contract marker missing"

# ---- a targeted failure restores only its own pre-deploy runtime ----
targeted_pre_failure_backend_tag="$(sed -nE 's#.*wotbtools-backend:([^[:space:]]+).*#\1#p' "$WORK/docker-compose.yml" | head -n 1)"
[ -n "$targeted_pre_failure_backend_tag" ] \
  || fail "targeted rollback test could not determine the current backend image tag"
grep -q 'wotbtools-frontend:sha-TARGETED-FRONTEND' "$WORK/docker-compose.yml" \
  || fail "targeted frontend success must be present before the next targeted failure"
stage_candidate_b
: > "$WORK/docker-up-targeted-rollback.log"
set +e
targeted_rollback_output="$(env TAG=sha-TARGETED-BACKEND-FAIL WOTB_DEPLOY_SERVICE=wotb-backend \
  FAKE_HEALTHY_BACKEND_TAG="$targeted_pre_failure_backend_tag" \
  FAKE_APP_UNHEALTHY_TAG=sha-TARGETED-BACKEND-FAIL FAKE_APP_UNHEALTHY_SERVICE=backend \
  FAKE_DOCKER_UP_LOG="$WORK/docker-up-targeted-rollback.log" \
  WOTB_BACKUP_ROOT="$WORK/backups-targeted-rollback" \
  bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
targeted_rollback_rc=$?
set -e
[[ $targeted_rollback_rc -ne 0 ]] \
  || fail "targeted backend failure must reject the candidate"
grep -q '== TARGETED ROLLBACK OK: wotb-backend ==' <<<"$targeted_rollback_output" \
  || fail "targeted backend failure must restore its pre-deploy runtime"
! grep -q '== ROLLBACK OK:' <<<"$targeted_rollback_output" \
  || fail "targeted backend failure must not restore the full LKG"
grep -q 'wotbtools-frontend:sha-TARGETED-FRONTEND' "$WORK/docker-compose.yml" \
  || fail "targeted backend rollback must preserve the independently deployed frontend"
grep -q "wotbtools-backend:${targeted_pre_failure_backend_tag}" "$WORK/docker-compose.yml" \
  || fail "targeted backend rollback must restore the previous backend image tag"
! grep -Eq 'compose up .*postgres .*keycloak .*wotb-backend .*wotb-frontend' "$WORK/docker-up-targeted-rollback.log" \
  || fail "targeted backend rollback must not restart the full application stack"
[ ! -e "$WORK/deploy.targeted.failed" ] \
  || fail "successful targeted rollback must remove the failed candidate tree"
[ ! -e "$WORK/docker-compose.targeted.failed.yml" ] \
  || fail "successful targeted rollback must remove the failed candidate compose"

# A second targeted failure must be recoverable after the first forensic cleanup.
stage_candidate_b
: > "$WORK/docker-up-targeted-rollback-second.log"
set +e
second_targeted_rollback_output="$(env TAG=sha-TARGETED-BACKEND-FAIL-2 WOTB_DEPLOY_SERVICE=wotb-backend \
  FAKE_HEALTHY_BACKEND_TAG="$targeted_pre_failure_backend_tag" \
  FAKE_APP_UNHEALTHY_TAG=sha-TARGETED-BACKEND-FAIL-2 FAKE_APP_UNHEALTHY_SERVICE=backend \
  FAKE_DOCKER_UP_LOG="$WORK/docker-up-targeted-rollback-second.log" \
  WOTB_BACKUP_ROOT="$WORK/backups-targeted-rollback-second" \
  bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
second_targeted_rollback_rc=$?
set -e
[[ $second_targeted_rollback_rc -ne 0 ]] \
  || fail "second targeted backend failure must reject the candidate"
grep -q '== TARGETED ROLLBACK OK: wotb-backend ==' <<<"$second_targeted_rollback_output" \
  || fail "second targeted backend failure must restore its pre-deploy runtime"
! grep -q '== ROLLBACK OK:' <<<"$second_targeted_rollback_output" \
  || fail "second targeted backend failure must not restore the full LKG"
grep -q 'wotbtools-frontend:sha-TARGETED-FRONTEND' "$WORK/docker-compose.yml" \
  || fail "second targeted backend rollback must preserve the independently deployed frontend"
! grep -Eq 'compose up .*postgres .*keycloak .*wotb-backend .*wotb-frontend' "$WORK/docker-up-targeted-rollback-second.log" \
  || fail "second targeted backend rollback must not restart the full application stack"
[ ! -e "$WORK/deploy.targeted.failed" ] \
  || fail "second successful targeted rollback must remove the failed candidate tree"
[ ! -e "$WORK/docker-compose.targeted.failed.yml" ] \
  || fail "second successful targeted rollback must remove the failed candidate compose"

# ---- rollback application healthy + Grafana broken remains ROLLBACK OK ----
stage_candidate_b
: > "$WORK/docker-restart.log"
set +e
rollback_observability_output="$(env TAG=sha-ROLLBACK-GRAFANA \
  FAKE_HEALTHY_BACKEND_TAG=sha-ROLLBACK-GRAFANA \
  FAKE_APP_UNHEALTHY_TAG=sha-ROLLBACK-GRAFANA FAKE_GRAFANA_UNHEALTHY=1 \
  WOTB_OBSERVABILITY_RETRIES=1 WOTB_OBSERVABILITY_INTERVAL_SEC=1 \
  WOTB_BACKUP_ROOT="$WORK/backups-rollback-grafana" \
  bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
rollback_observability_rc=$?
set -e
[[ $rollback_observability_rc -ne 0 ]] || fail "rollback Grafana case must reject the candidate"
grep -q "== ROLLBACK OK:" <<<"$rollback_observability_output" \
  || fail "rollback Grafana case must report ROLLBACK OK"
grep -q "OBSERVABILITY DEGRADED" <<<"$rollback_observability_output" \
  || fail "rollback Grafana case must report degraded observability"
! grep -q "== ROLLBACK FAILED:" <<<"$rollback_observability_output" \
  || fail "Grafana failure must not make an application-healthy rollback fail"
if [ -f "$WORK/docker-restart.log" ]; then
  ! grep -q 'compose restart wotb-frontend' "$WORK/docker-restart.log" \
    || fail "Grafana failure during rollback must not refresh frontend nginx"
fi

# ---- rollback application failure remains a real rollback failure ----
stage_candidate_b
set +e
rollback_application_output="$(env TAG=sha-ROLLBACK-FAIL \
  FAKE_FORCE_UNHEALTHY=1 WOTB_BACKUP_ROOT="$WORK/backups-rollback-app" \
  bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
rollback_application_rc=$?
set -e
[[ $rollback_application_rc -ne 0 ]] || fail "broken rollback application must fail"
grep -q "== ROLLBACK FAILED:" <<<"$rollback_application_output" \
  || fail "broken rollback application must report ROLLBACK FAILED"

# ---- independent session: no GitHub Actions temporary env ----
env -i PATH="$PATH" HOME="$WORK" bash -c 'cd "$1" && docker compose -f docker-compose.yml config >/dev/null' _ "$WORK" \
  || fail "compose config fails without deploy env"

# ---- daily backup independent of GH temporary env ----
env -i PATH="$PATH" HOME="$WORK" WOTB_COMPOSE_DIR="$WORK" WOTB_BACKUP_ROOT="$WORK/backups" \
  bash "$WORK/deploy/postgres-backup.sh" --database wotb --skip-retention \
  || fail "postgres-backup.sh fails without deploy env"

# ---- full deploy state targets follow image services, not deploy scope ----
set_generation_state() {
  local run_number="$1" sha="$2" service
  mkdir -p "$WORK/deployed-state"
  for service in wotb-backend wotb-frontend keycloak; do
    printf '%s\n' "$run_number" > "$WORK/deployed-state/$service.run"
    printf '%s\n' "$sha" > "$WORK/deployed-state/$service.sha"
  done
}

run_full_generation_case() {
  local image_services="$1" run_number="$2" commit_sha="$3" output healthy_backend_tag
  stage_candidate_b
  export TAG="sha-${commit_sha:0:12}" RELEASE_SHA="$commit_sha" RELEASE_RUN_NUMBER="$run_number"
  export WOTB_STALE_RELEASE_GUARD=1 WOTB_DEPLOY_SERVICES=all
  export WOTB_DEPLOY_IMAGE_SERVICES="$image_services"
  unset WOTB_DEPLOY_SERVICE FAKE_APP_UNHEALTHY_TAG FAKE_APP_UNHEALTHY_SERVICE
  if [[ ",${image_services}," == *,wotb-backend,* ]]; then
    healthy_backend_tag="$TAG"
  else
    healthy_backend_tag="$(awk -F: '/wotbtools-backend:/ { print $NF; exit }' "$WORK/docker-compose.yml")"
  fi
  export FAKE_HEALTHY_BACKEND_TAG="$healthy_backend_tag"
  output="$(WOTB_BACKUP_ROOT="$WORK/backups-generation-all-$run_number" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)" \
    || fail "full generation $run_number failed: $output"
}

# all + frontend image only: frontend advances, backend/keycloak remain at 90.
state_sha_90='9090909090909090909090909090909090909090'
set_generation_state 90 "$state_sha_90"
full_frontend_sha='cccccccccccccccccccccccccccccccccccccccc'
backend_run_100_after_full='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
run_generation_case wotb-backend 100 "$backend_run_100_after_full" failed
run_full_generation_case wotb-frontend 101 "$full_frontend_sha"
[[ "$(cat "$WORK/deployed-state/wotb-frontend.run")" == 101 ]] \
  || fail "all + frontend image must advance frontend generation"
[[ "$(cat "$WORK/deployed-state/wotb-backend.run")" == 90 ]] \
  || fail "all + frontend image must not advance backend generation"
[[ "$(cat "$WORK/deployed-state/keycloak.run")" == 90 ]] \
  || fail "all + frontend image must not advance keycloak generation"
[[ "$(cat "$WORK/deployed-state/wotb-frontend.sha")" == "$full_frontend_sha" ]] \
  || fail "all + frontend image must write frontend commit state"

# A failed backend run 100 followed by all + frontend run 101 must still allow
# the backend run 100 retry: the full deploy did not claim backend generation.
run_generation_case wotb-backend 100 "$backend_run_100_after_full"
[[ "$(cat "$WORK/deployed-state/wotb-backend.run")" == 100 ]] \
  || fail "backend retry after partial full deploy must remain allowed"
[[ "$(cat "$WORK/deployed-state/wotb-frontend.run")" == 101 ]] \
  || fail "backend retry must preserve frontend generation"

# all + no image services is config-only and must not change application state.
config_only_sha='dddddddddddddddddddddddddddddddddddddddd'
set_generation_state 110 "$config_only_sha"
run_full_generation_case '' 111 "$config_only_sha"
for service in wotb-backend wotb-frontend keycloak; do
  [[ "$(cat "$WORK/deployed-state/$service.run")" == 110 ]] \
    || fail "config-only all must not advance $service generation"
  [[ "$(cat "$WORK/deployed-state/$service.sha")" == "$config_only_sha" ]] \
    || fail "config-only all must not change $service commit state"
done

# all + all images updates every application service.
all_images_sha='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
set_generation_state 120 "$config_only_sha"
run_full_generation_case wotb-backend,wotb-frontend,keycloak 121 "$all_images_sha"
for service in wotb-backend wotb-frontend keycloak; do
  [[ "$(cat "$WORK/deployed-state/$service.run")" == 121 ]] \
    || fail "all images must advance $service generation"
  [[ "$(cat "$WORK/deployed-state/$service.sha")" == "$all_images_sha" ]] \
    || fail "all images must write $service commit state"
done
unset FAKE_HEALTHY_BACKEND_TAG WOTB_STALE_RELEASE_GUARD WOTB_DEPLOY_SERVICES WOTB_DEPLOY_IMAGE_SERVICES
unset RELEASE_SHA RELEASE_RUN_NUMBER TAG

# ---- no LKG + no current deployment -> fail closed before promotion ----
stage_candidate_b
rm -rf "$WORK/deploy" "$WORK/docker-compose.yml" "$WORK/DEPLOYED_SHA" \
  "$WORK/deploy.lkg" "$WORK/docker-compose.lkg.yml" "$WORK/DEPLOYED_SHA.lkg"
export TAG=sha-C FAKE_HEALTHY_BACKEND_TAG=sha-C
export WOTB_BACKUP_ROOT="$WORK/backups-no-lkg"
set +e
no_lkg_output="$(bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
no_lkg_rc=$?
set -e
[[ $no_lkg_rc -ne 0 ]] || fail "no-LKG deployment must fail closed"
grep -q "NO_VALIDATED_LKG" <<<"$no_lkg_output" || fail "no-LKG failure marker missing: $no_lkg_output"
[[ ! -e "$WORK/deploy" ]] || fail "no-LKG failure must not promote the candidate"
[[ ! -e "$WORK/deploy.lkg" ]] || fail "no-LKG failure must not create an LKG"
unset FAKE_HEALTHY_BACKEND_TAG

echo "OK: application/observability gates, LKG promotion, failed-candidate isolation, no-LKG fail-closed, compose + backup contracts passed"
