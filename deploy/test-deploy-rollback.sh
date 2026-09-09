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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
        -d|--remove-orphans|-T) shift ;;
        config|pull|up|ps|exec|logs|kill|run) sub="$1"; shift ;;
        *) shift ;;
      esac
    done
    case "$sub" in
      config)
        while IFS= read -r line || [[ -n "$line" ]]; do resolve_line "$line"; done < "$COMPOSE_FILE"
        ;;
      pull) exit 0 ;;
      up)
        active_compose_file="${COMPOSE_FILE:-docker-compose.yml}"
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
        printf 'grafana Up\ntest Up\n'
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
              printf '{"dashboard":{"uid":"wotbtools-production-overview wotbtools-backend-overview wotbtools-http-errors wotbtools-replay-parser wotbtools-ai-review wotbtools-keycloak wotbtools-error-explorer wotbtools-android-downloads wotbtools-usage"}}\n'
            fi
            exit 0
          fi
          if [[ "$request" == *"wotb-frontend"*"/api/health"* ]]; then
            [[ "$request" == *"--header=Host: wotbtools.com"* ]] || exit 1
            app_tag_unhealthy frontend && exit 1
            printf '{"status":"UP"}\n'
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

# ---- deploy A (success) ----
export AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100
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
grep -Eq 'keycloak-observability-canary-.*alpine:3\.22' "$WORK/docker-run.log" \
  || fail "Keycloak canary must use an independent Alpine 3.22 emitter"
if grep -Eq 'compose.*run.*keycloak.*sh -c' "$WORK/docker-run.log"; then
  fail "Keycloak canary must not invoke the Keycloak image entrypoint as a shell"
fi

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
  stage_candidate_b
  set +e
  output="$(env TAG="$tag" FAKE_HEALTHY_BACKEND_TAG="$tag" \
    WOTB_OBSERVABILITY_RETRIES=1 WOTB_OBSERVABILITY_INTERVAL_SEC=1 \
    WOTB_BACKUP_ROOT="$WORK/backups-$case_name" "$assignment" \
    bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
  rc=$?
  set -e
  [[ $rc -eq 0 ]] || fail "$case_name must keep the deployment successful: $output"
  grep -q "== DEPLOY OK: $tag ==" <<<"$output" || fail "$case_name missing DEPLOY OK"
  grep -q "OBSERVABILITY DEGRADED" <<<"$output" || fail "$case_name missing OBSERVABILITY DEGRADED"
  ! grep -q "ROLLBACK" <<<"$output" || fail "$case_name unexpectedly rolled back"
}

run_observability_case grafana-broken sha-GRAFANA 'FAKE_GRAFANA_AUTH=0'
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

# ---- rollback application healthy + Grafana broken remains ROLLBACK OK ----
stage_candidate_b
set +e
rollback_observability_output="$(env TAG=sha-ROLLBACK-GRAFANA \
  FAKE_HEALTHY_BACKEND_TAG=sha-ROLLBACK-GRAFANA \
  FAKE_APP_UNHEALTHY_TAG=sha-ROLLBACK-GRAFANA FAKE_GRAFANA_AUTH=0 \
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
