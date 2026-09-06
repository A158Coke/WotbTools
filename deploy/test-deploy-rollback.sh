#!/usr/bin/env bash
# Deploy/rollback smoke test (CI-safe, no production access).
#
# Simulates two deployments against a sandbox dir with a fake `docker` shim and
# asserts the original contract:
#   1. deploy A succeeds and the formal docker-compose.yml pins sha-A images;
#   2. deploy B starts and its health check fails;
#   3. rollback restores the previous (A) compose, not the failed B tag;
#   4. DEPLOYED_SHA is restored to A;
#   5. with the deploy env cleared, `docker compose config` and the daily backup
#      script still parse the formal deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/deploy.incoming/deploy" "$WORK/bin"
cp "$ROOT/deploy/docker-compose.prod.yml" "$WORK/deploy.incoming/deploy/docker-compose.prod.yml"
cp "$ROOT/deploy/deploy.sh" "$WORK/deploy.incoming/deploy/deploy.sh"
cp "$ROOT/deploy/verify-observability.sh" "$WORK/deploy.incoming/deploy/verify-observability.sh"
cp "$ROOT/deploy/sponsor-config.example.json" "$WORK/deploy.incoming/deploy/sponsor-config.example.json"
cp "$ROOT/deploy/postgres-backup.sh" "$WORK/deploy.incoming/deploy/postgres-backup.sh"
cp "$ROOT/deploy/postgres-backup-inspect.sh" "$WORK/deploy.incoming/deploy/postgres-backup-inspect.sh"
cp "$ROOT/deploy/postgres-restore.sh" "$WORK/deploy.incoming/deploy/postgres-restore.sh"
cp -a "$ROOT/deploy/observability" "$WORK/deploy.incoming/deploy/observability"
# Normalize line endings so the sandbox runs identically on CRLF checkouts
# (CI/ubuntu checkouts are LF; this keeps the smoke test portable).
  sed -i 's/\r$//' \
  "$WORK/deploy.incoming/deploy/docker-compose.prod.yml" \
  "$WORK/deploy.incoming/deploy/deploy.sh" \
  "$WORK/deploy.incoming/deploy/verify-observability.sh" \
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
  [[ -f "$file" ]] || return 0
  grep -q 'wotbtools-backend:sha-A' "$file"
}

COMPOSE_FILE=""
cmd="${1:-}"; shift || true
case "$cmd" in
  compose)
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
      up) exit 0 ;;
      ps) printf 'wotb-backend Up\nwotb-frontend Up\nkeycloak Up\nprometheus Up\nloki Up\nalloy Up\ngrafana Up\ntest Up\n' ;;
      exec)
        if active_tag_healthy; then
          # Non-empty stdout keeps backup probes valid; stable observability
          # tokens satisfy the gate without exposing any secret.
          up="${FAKE_PROMETHEUS_UP:-1}"
          if [ "${FAKE_LOKI_EMPTY:-0}" = 1 ]; then
            loki_result='"result":[],"values":[]'
          else
            loki_result="\"result\":[{\"line\":\"event=android_apk_download apk=${WOTB_FRONTEND_CANARY_APK:-stable.apk} status=404 bytes=42 ${WOTB_OBSERVABILITY_CANARY_MARKER:-stable-canary} ${WOTB_KEYCLOAK_CANARY_MARKER:-stable-keycloak}\"}],\"values\":[[0,\"${WOTB_OBSERVABILITY_CANARY_MARKER:-stable-canary}\"]]"
          fi
          printf 'mock-pg-dump-data jvm_ process_ system_ http_server_requests wotb_replay_parse_active wotb_replay_parse_queue_depth wotb_ai_review_in_flight wotb_ai_review_queue_depth node_ prometheus_ loki_ grafana_ "database":"ok" "status":"success" "job":"wotb-backend" "job":"keycloak" "job":"node-exporter" "job":"prometheus" "job":"loki" "job":"grafana" "value":[0,"%s"] "dashboard":"ok" wotbtools-production-overview wotbtools-backend-overview wotbtools-http-errors wotbtools-replay-parser wotbtools-ai-review wotbtools-keycloak wotbtools-error-explorer wotbtools-android-downloads wotbtools-usage %s\n' "$up" "$loki_result"
          exit 0
        fi
        exit 1
        ;;
      kill|run) exit 0 ;;
      logs) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
  image) exit 0 ;;
  builder) exit 0 ;;
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
export WOTB_HEALTH_RETRIES=3
export DB_PASSWORD=db-secret KC_ADMIN_PASSWORD=kc-secret WG_APPLICATION_ID=wg-id \
       KEYCLOAK_ADMIN_CLIENT_SECRET=kc-client-secret AI_API_KEY=ai-key \
       GRAFANA_ADMIN_USER=admin GRAFANA_ADMIN_PASSWORD=grafana-secret

fail() { echo "FAIL: $*" >&2; exit 1; }

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
grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.yml" || fail "formal compose does not pin sha-A images"
grep -q '\${' "$WORK/docker-compose.yml" && fail "formal compose still contains unresolved \${...}"

# ---- observability gates must fail closed on up=0 and an empty Loki result ----
set +e
up_zero_output="$(FAKE_PROMETHEUS_UP=0 WOTB_OBSERVABILITY_RETRIES=1 \
  WOTB_OBSERVABILITY_INTERVAL_SEC=1 bash "$WORK/deploy/verify-observability.sh" 2>&1)"
up_zero_rc=$?
set -e
[[ $up_zero_rc -ne 0 ]] || fail "Prometheus up=0 must fail the observability gate"
grep -q "up != 1" <<<"$up_zero_output" || fail "up=0 failure must explain the unhealthy target"

set +e
empty_loki_output="$(FAKE_LOKI_EMPTY=1 WOTB_OBSERVABILITY_RETRIES=1 \
  WOTB_OBSERVABILITY_INTERVAL_SEC=1 bash "$WORK/deploy/verify-observability.sh" 2>&1)"
empty_loki_rc=$?
set -e
[[ $empty_loki_rc -ne 0 ]] || fail "empty Loki result must fail the observability gate"
grep -q "backend or Keycloak canary was not ingested" <<<"$empty_loki_output" \
  || fail "empty Loki failure must identify the deployment canary"

# The previous live tree owns rollback. Make it visibly stable, then stage a
# second tree with different observability files before deploy B.
printf 'stable prometheus config\n' > "$WORK/deploy/observability/prometheus/prometheus.yml"
printf 'stable alloy config\n' > "$WORK/deploy/observability/alloy/config.alloy"
mkdir -p "$WORK/deploy.incoming/deploy"
cp -a "$WORK/deploy/." "$WORK/deploy.incoming/deploy/"
printf 'new prometheus config\n' > "$WORK/deploy.incoming/deploy/observability/prometheus/prometheus.yml"
printf 'new alloy config\n' > "$WORK/deploy.incoming/deploy/observability/alloy/config.alloy"

# ---- deploy B (health fails) -> must roll back to A ----
export TAG=sha-B
set +e
deploy_b_output="$(bash "$WORK/deploy.incoming/deploy/deploy.sh" 2>&1)"
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "deploy B must fail (health check)"
grep -q "== NEW DEPLOY HEALTH CHECK FAILED ==" <<<"$deploy_b_output" \
  || fail "new deployment diagnostics marker missing before rollback"
grep -q "== service list (no container environment dump) ==" <<<"$deploy_b_output" \
  || fail "service diagnostics missing"
new_diag_line="$(grep -n "== NEW DEPLOY HEALTH CHECK FAILED ==" <<<"$deploy_b_output" | head -1 | cut -d: -f1)"
rollback_line="$(grep -n "== DEPLOY FAILED: rolling back to previous deployment ==" <<<"$deploy_b_output" | head -1 | cut -d: -f1)"
[[ "$new_diag_line" -lt "$rollback_line" ]] \
  || fail "new deployment diagnostics must precede rollback"
grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.yml" || fail "after rollback compose must reference sha-A"
grep -q 'wotbtools-backend:sha-B' "$WORK/docker-compose.yml" && fail "after rollback compose still references sha-B"
[[ "$(cat "$WORK/DEPLOYED_SHA")" == "sha-A" ]] || fail "DEPLOYED_SHA not restored to sha-A"
grep -q 'stable prometheus config' "$WORK/deploy/observability/prometheus/prometheus.yml" \
  || fail "rollback did not restore previous Prometheus config"
grep -q 'stable alloy config' "$WORK/deploy/observability/alloy/config.alloy" \
  || fail "rollback did not restore previous Alloy config"

# ---- independent session: no GitHub Actions temporary env ----
env -i PATH="$PATH" HOME="$WORK" bash -c 'cd "$1" && docker compose -f docker-compose.yml config >/dev/null' _ "$WORK" \
  || fail "compose config fails without deploy env"

# ---- daily backup independent of GH temporary env ----
env -i PATH="$PATH" HOME="$WORK" WOTB_COMPOSE_DIR="$WORK" WOTB_BACKUP_ROOT="$WORK/backups" \
  bash "$WORK/deploy/postgres-backup.sh" --database wotb --skip-retention \
  || fail "postgres-backup.sh fails without deploy env"

echo "OK: deploy A ok; deploy B health failure rolled back to sha-A; compose + backup self-contained"
