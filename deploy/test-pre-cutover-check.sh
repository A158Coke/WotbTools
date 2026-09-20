#!/usr/bin/env bash
# Contract for the read-only PRE_CUTOVER_READY entrypoint. Business PostgreSQL is
# authoritative business state, so the gate must refuse readiness when its
# runtime, loopback administration port, or TX-local OpenTofu marker is wrong.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/deploy/tx/pre-cutover-check.sh"
DEPLOY="$ROOT/deploy/tx/deploy.sh"

grep -Fq 'TX_DEPLOY_LIBRARY_ONLY=1' "$CHECK"
grep -Fq 'DEPLOY_SH="$SCRIPT_DIR/deploy.sh"' "$CHECK"
grep -Fq 'source "$DEPLOY_SH"' "$CHECK"
grep -Fq 'pre_cutover_check' "$CHECK"
grep -Fq 'PRE_CUTOVER_READY' "$DEPLOY"
grep -Fq 'DNS_CUTOVER_NOT_PERFORMED' "$DEPLOY"
grep -Fq 'WAITING_FOR_OPERATOR_APPROVAL' "$DEPLOY"
grep -Fq 'PRE_CUTOVER_NOT_READY' "$DEPLOY"
grep -Fq 'QQ_IDP_STATUS=idp-qq=READY' "$DEPLOY"
grep -Fq 'qq_identity_provider_ready' "$DEPLOY"
grep -Fq 'identity-provider/instances' "$DEPLOY"
grep -Fq 'clientAuthMethod' "$DEPLOY"
grep -Fq 'https://graph.qq.com/oauth2.0/authorize' "$DEPLOY"
grep -Fq 'https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1' "$DEPLOY"
grep -Fq 'https://graph.qq.com/user/get_user_info' "$DEPLOY"
grep -Fq 'tx-internal-api-route: PASS' "$DEPLOY"
grep -Fq 'distributed-execution-plane: PASS' "$DEPLOY"
! grep -Fq 'wireguard-backend' "$DEPLOY"
grep -Fq 'keycloak-qq-provider.jar' "$DEPLOY"
grep -Fq 'keycloak-wargaming-provider.jar' "$DEPLOY"
grep -Fq 'com.wotbtools.app' "$DEPLOY"
! grep -Eiq '(nsupdate|route53|cloudflare|gcloud dns|az network dns)' "$CHECK"
! grep -Eiq 'docker compose .* (stop|rm|down).*yecao' "$CHECK"

# Business PostgreSQL is authoritative state: the gate must own its health,
# loopback binding, and provisioning marker before it may report readiness.
grep -Fq 'TX_BUSINESS_POSTGRES_ADMIN_USER' "$DEPLOY"
grep -Fq 'TX_BUSINESS_POSTGRES_ADMIN_PASSWORD' "$DEPLOY"
grep -Fq 'business-postgres-loopback: PASS' "$DEPLOY"
grep -Fq 'business-postgres-loopback: FAIL (management port must be 127.0.0.1:25432:5432 only)' "$DEPLOY"
grep -Fq 'business-postgres: PASS' "$DEPLOY"
grep -Fq 'business-postgres: FAIL (container is missing or not healthy)' "$DEPLOY"
grep -Fq 'business-postgres-provisioning: PASS' "$DEPLOY"
grep -Fq 'business-postgres-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)' "$DEPLOY"
grep -Fq 'tx-local-opentofu-business-postgres' "$DEPLOY"
grep -Fq 'BUSINESS_POSTGRES_TOFU_PROVISION_MARKER' "$DEPLOY"
# The new checks must be read-only: no DDL/DML against the business database.
! grep -Eiq '(drop|truncate|delete[[:space:]]+from|create[[:space:]]+database|alter[[:space:]]+database)' "$DEPLOY"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/deploy" "$WORK/bin" "$WORK/runtime/config/sponsor" "$WORK/runtime/android-release"
cp "$ROOT/deploy/tx/docker-compose.yml" "$WORK/deploy/docker-compose.yml"
cp "$ROOT/deploy/tx/yecao-backend-contract.json" "$WORK/deploy/yecao-backend-contract.json"
printf '{}\n' > "$WORK/runtime/config/sponsor-config.json"
printf 'tx-local-opentofu-rabbitmq\n' > "$WORK/rabbitmq.tofu-provisioned"
cat > "$WORK/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
business_ports='[{"host_ip":"127.0.0.1","published":25432,"target":5432}]'
if [ "${FAKE_BUSINESS_PORT_EXPOSED:-0}" = 1 ]; then
  business_ports='[{"host_ip":"0.0.0.0","published":25432,"target":5432}]'
fi
frontend_upstream="${FAKE_FRONTEND_UPSTREAM:-http://business-api:8087}"
execution_mode="${FAKE_EXECUTION_MODE:-distributed}"
job_repository="${FAKE_JOB_REPOSITORY:-jdbc}"
business_api_ports="${FAKE_BUSINESS_API_PUBLISHED_PORT:-[]}"
case "${1:-}" in
  config)
    printf '{"services":{"keycloak-postgres":{"ports":[{"host_ip":"127.0.0.1","published":15432,"target":5432}]},"business-postgres":{"ports":%s},"rabbitmq":{"ports":[{"host_ip":"10.20.0.1","published":5672,"target":5672},{"host_ip":"127.0.0.1","published":15672,"target":15672}]},"keycloak":{"ports":[{"host_ip":"127.0.0.1","published":18080,"target":8080}]},"wotb-frontend":{"environment":{"BACKEND_UPSTREAM":"%s"}},"business-api":{"ports":%s,"environment":{"WOTB_REPLAY_EXECUTION_MODE":"%s","WOTB_REPLAY_PROCESSING_JOB_REPOSITORY":"%s"}}}}\n' \
      "$business_ports" "$frontend_upstream" "$business_api_ports" "$execution_mode" "$job_repository"
    ;;
  ps)
    if [[ "$*" == *business-postgres* ]]; then
      if [ "${FAKE_BUSINESS_MISSING:-0}" = 1 ]; then
        exit 0
      fi
      if [ "${FAKE_BUSINESS_UNHEALTHY:-0}" = 1 ]; then
        if [[ "$*" == *"-q"* ]]; then printf 'deadbeef\n'; else printf 'unhealthy\n'; fi
        exit 0
      fi
    fi
    printf 'healthy\n'
    ;;
  exec)
    if [[ "$*" == *list_queues* ]]; then
      printf 'wotb.parser\t%s\t0\nwotb.parser.result\t1\t0\nwotb.parser.dlq\t0\t0\n' \
        "${FAKE_PARSER_CONSUMERS:-2}"
      exit 0
    fi
    if [[ "$*" == *"select count(*)"* ]]; then
      printf '%s\n' "${FAKE_INTEGRITY_COUNT:-348}"
      exit 0
    fi
    if [[ "$*" == *"coalesce(max(id)"* ]]; then
      printf '355\n'
      exit 0
    fi
    if [[ "$*" == *pg_sequences* ]]; then
      printf '355\n'
      exit 0
    fi
    if [[ "$*" == *business-postgres* ]] && [ "${FAKE_BUSINESS_PG_NOT_READY:-0}" = 1 ]; then
      exit 1
    fi
    exit 0
    ;;
  run)
    # The gate asks curl for a body + status; the older probes ask for the status
    # only. Detect the write-out contract so both keep working.
    write_out=""
    previous=""
    for argument in "$@"; do
      if [ "$previous" = "--write-out" ] || [ "$previous" = "-w" ]; then write_out="$argument"; fi
      previous="$argument"
    done
    with_body=0
    [ "$write_out" = $'\n%{http_code}' ] && with_body=1
    respond() {
      if [ "$with_body" = 1 ]; then
        printf '%s\n%s\n' "$1" "$2"
      elif [ -z "${3:-}" ]; then
        printf '%s\n' "$2"
      else
        printf '%s\n' "$1"
      fi
    }
    authenticated=0
    [[ "$*" == *"Authorization: Bearer"* ]] && authenticated=1
    if [[ "$*" == *realms/wotbtools/protocol/openid-connect/token* ]]; then
      respond '{"access_token":"fake-e2e-token"}' 200
    elif [[ "$*" == *protocol/openid-connect/token* ]]; then
      respond '{"access_token":"fake-admin-token"}' 200 token-only
    elif [[ "$*" == *identity-provider/instances* ]]; then
      if [ "${FAKE_QQ_IDP_INVALID:-0}" = 1 ]; then
        respond '[]' 200 token-only
      else
        respond '[{"alias":"idp-qq","providerId":"qq","enabled":true,"config":{"clientId":"fake-qq-client-id","authorizationUrl":"https://graph.qq.com/oauth2.0/authorize","tokenUrl":"https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1","userInfoUrl":"https://graph.qq.com/user/get_user_info","clientAuthMethod":"client_secret_post"}}]' 200 token-only
      fi
    elif [[ "$*" == *assetlinks.json* ]]; then
      respond '{"package_name":"com.wotbtools.app"}' 200 token-only
    elif [[ "$*" == *"/api/admin/users"* ]]; then
      if [ "$authenticated" = 1 ]; then
        respond '{"errorCode":"AUTH_FORBIDDEN"}' "${FAKE_ADMIN_TOKEN_STATUS:-403}"
      else
        respond '{"errorCode":"AUTH_UNAUTHORIZED"}' "${FAKE_ADMIN_ANON_STATUS:-401}"
      fi
    elif [[ "$*" == *"/api/users/profile"* ]]; then
      respond '{"nickname":"e2e"}' "${FAKE_PROFILE_STATUS:-200}"
    elif [[ "$*" == *"/api/boost/options"* ]]; then
      respond '[]' "${FAKE_BOOST_STATUS:-200}"
    elif [[ "$*" == *"/api/hof?"* ]]; then
      if [ "${FAKE_HOF_LIST_EMPTY:-0}" = 1 ]; then
        respond '{"records":[]}' "${FAKE_HOF_STATUS:-200}"
      else
        respond '{"records":[{"id":348,"nickname":"e2e"}]}' "${FAKE_HOF_STATUS:-200}"
      fi
    elif [[ "$*" == *"/download"* && "$write_out" == *size_download* ]]; then
      printf '%s %s\n' "${FAKE_EXPORT_DOWNLOAD_STATUS:-200}" "${FAKE_EXPORT_BYTES:-4096}"
    elif [[ "$*" == *"/replay"* && "$write_out" == *size_download* ]]; then
      printf '%s %s\n' "${FAKE_HOF_REPLAY_STATUS:-200}" "${FAKE_HOF_REPLAY_BYTES:-2048}"
    elif [[ "$*" == *"X-Amz-Signature"* && "$*" == *"artifacts/0/ai-facts.json"* ]]; then
      respond '{"facts":true}' "${FAKE_MINIO_ARTIFACT_STATUS:-200}"
    elif [[ "$*" == *"X-Amz-Signature"* ]]; then
      respond '{"schemaVersion":"1"}' "${FAKE_MINIO_STATUS:-200}"
    elif [[ "$*" == *"/api/replay/processing-jobs/"*"/result"* ]]; then
      respond '{"battles":[{"battleId":"b1"}],"battleSourceNames":["a.wotbreplay"]}' "${FAKE_DATASET_STATUS:-200}"
    elif [[ "$*" == *"/api/replay/processing-jobs/00000000-0000-4000-8000-000000000000"* ]]; then
      if [ "$authenticated" = 1 ]; then
        respond '{"errorCode":"JOB_NOT_FOUND"}' "${FAKE_CONTROL_PLANE_STATUS:-404}"
      else
        respond '{"errorCode":"JOB_NOT_FOUND"}' "${FAKE_CONTROL_PLANE_ANON_STATUS:-401}"
      fi
    elif [[ "$*" == *"/api/replay/processing-jobs/"* ]]; then
      respond '{"jobId":"e2e-job-1","status":"'${FAKE_E2E_JOB_STATUS:-READY}'"}' "${FAKE_CONTROL_PLANE_JOB_STATUS:-200}"
    elif [[ "$*" == *"/api/replay/processing-jobs"* && "$*" == *--form* ]]; then
      respond '{"jobId":"e2e-job-1","status":"QUEUED","total":1}' "${FAKE_E2E_CREATE_STATUS:-202}"
    elif [[ "$*" == *"/api/replay/export-jobs/"* ]]; then
      respond '{"jobId":"e2e-export-1","status":"'${FAKE_EXPORT_JOB_STATUS:-READY}'"}' "${FAKE_EXPORT_STATUS_STATUS:-200}"
    elif [[ "$*" == *"/api/replay/export-jobs"* ]]; then
      respond '{"jobId":"e2e-export-1","status":"QUEUED"}' "${FAKE_EXPORT_CREATE_STATUS:-202}"
    elif [[ "$*" == *"/api/replay/map-overview"* ]]; then
      if [ "${FAKE_MAP_STATUS:-200}" = 204 ]; then
        printf '%s\n' "${FAKE_MAP_STATUS}"
      else
        respond '{"mapName":"rockfield","cells":[]}' "${FAKE_MAP_STATUS:-200}"
      fi
    elif [[ "$*" == *"/api/replay/battle-playback-v2"* ]]; then
      if [ "${FAKE_PLAYBACK_STATUS:-200}" = 204 ]; then
        printf '%s\n' "${FAKE_PLAYBACK_STATUS}"
      else
        respond '{"battle":{"frames":[]}}' "${FAKE_PLAYBACK_STATUS:-200}"
      fi
    elif [[ "$*" == *"https://wotbtools.com"* ]]; then
      respond '{"status":"UP"}' "${FAKE_PUBLIC_WEB_STATUS:-200}"
    elif [[ "$*" == *"https://auth.wotbtools.com"* ]]; then
      respond '{"issuer":"https://auth.wotbtools.com/realms/wotbtools"}' "${FAKE_PUBLIC_AUTH_STATUS:-200}"
    else
      printf '%s\n' "${FAKE_HEALTH_STATUS:-200}"
    fi
    ;;
  *) exit 0 ;;
esac
FAKE_DOCKER
chmod 700 "$WORK/bin/docker"

run_check() {
  local tx_dir="$1" check_script="$2"
  shift 2
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_TX_DIR="$tx_dir" KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real \
    KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real \
    WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test \
    TX_BUSINESS_POSTGRES_ADMIN_USER=tx-business-admin \
    TX_BUSINESS_POSTGRES_ADMIN_PASSWORD=not-real \
    TX_BUSINESS_DB_NAME=wotb TX_BUSINESS_DB_USERNAME=control_api TX_BUSINESS_DB_PASSWORD=not-real \
    TX_RABBITMQ_CONTROL_API_PASSWORD=not-real \
    YECAO_MINIO_CONTROL_API_ACCESS_KEY=not-real YECAO_MINIO_CONTROL_API_SECRET_KEY=not-real \
    KEYCLOAK_ADMIN_CLIENT_SECRET=not-real AI_API_KEY=not-real \
    KEYCLOAK_E2E_CLIENT_SECRET=not-real-e2e \
    WOTB_E2E_DATA_SNAPSHOT="$WORK/rowcounts.json" \
    WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
    "$@" bash "$check_script" 2>&1
}

# Read-only Yecao row-count snapshot the operator supplies before cutting DNS.
printf '{"tables":{"hall_of_fame_record":348}}\n' > "$WORK/rowcounts.json"

printf 'tx-local-opentofu-business-postgres\n' > "$WORK/business-postgres.tofu-provisioned"
ready_output="$(run_check "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT")"
grep -Fq 'PRE_CUTOVER_READY' <<< "$ready_output"
grep -Fq 'tx-internal-api-route: PASS' <<< "$ready_output"
grep -Fq 'distributed-execution-plane: PASS' <<< "$ready_output"
grep -Fq 'tx-business-api: PASS' <<< "$ready_output"
grep -Fq 'auth-token: PASS' <<< "$ready_output"
grep -Fq 'tx-control-plane: PASS' <<< "$ready_output"
grep -Fq 'anonymous-rejected: PASS' <<< "$ready_output"
grep -Fq 'admin-authz: PASS' <<< "$ready_output"
grep -Fq 'business-profile: PASS' <<< "$ready_output"
grep -Fq 'business-hof: PASS' <<< "$ready_output"
grep -Fq 'business-boost: PASS' <<< "$ready_output"
grep -Fq 'hof-replay-storage: PASS' <<< "$ready_output"
grep -Fq 'parser-worker: PASS' <<< "$ready_output"
grep -Fq 'processing-e2e: PASS' <<< "$ready_output"
grep -Fq 'dataset-result: PASS' <<< "$ready_output"
grep -Fq 'map-overview: PASS' <<< "$ready_output"
grep -Fq 'battle-playback-v2: PASS' <<< "$ready_output"
grep -Fq 'minio: PASS' <<< "$ready_output"
grep -Fq 'ai-facts: PASS' <<< "$ready_output"
grep -Fq 'export: PASS' <<< "$ready_output"
grep -Fq 'business-data-integrity: PASS' <<< "$ready_output"
grep -Fq 'public-edge-web: PASS' <<< "$ready_output"
grep -Fq 'public-edge-auth: PASS' <<< "$ready_output"
grep -Fq 'DNS_CUTOVER_NOT_PERFORMED' <<< "$ready_output"
grep -Fq 'WAITING_FOR_OPERATOR_APPROVAL' <<< "$ready_output"
grep -Fq 'qq-idp-admin-api: PASS' <<< "$ready_output"
grep -Fq 'QQ_IDP_STATUS=idp-qq=READY' <<< "$ready_output"
grep -Fq 'rabbitmq-provisioning: PASS' <<< "$ready_output"
grep -Fq 'business-postgres: PASS' <<< "$ready_output"
grep -Fq 'business-postgres-loopback: PASS' <<< "$ready_output"
grep -Fq 'business-postgres-provisioning: PASS' <<< "$ready_output"

# Exercise the actual promoted TX layout: the wrapper and deploy helper are
# siblings under runtime/deploy, with no repository checkout or source root.
RELOCATED_ROOT="$WORK/relocated-root"
mkdir -p "$RELOCATED_ROOT/deploy" "$RELOCATED_ROOT/config/sponsor" "$RELOCATED_ROOT/android-release"
cp "$ROOT/deploy/tx/pre-cutover-check.sh" "$RELOCATED_ROOT/deploy/pre-cutover-check.sh"
cp "$ROOT/deploy/tx/deploy.sh" "$RELOCATED_ROOT/deploy/deploy.sh"
cp "$ROOT/deploy/tx/docker-compose.yml" "$RELOCATED_ROOT/deploy/docker-compose.yml"
cp "$ROOT/deploy/tx/yecao-backend-contract.json" "$RELOCATED_ROOT/deploy/yecao-backend-contract.json"
printf '{}\n' > "$RELOCATED_ROOT/config/sponsor-config.json"
printf 'tx-local-opentofu-rabbitmq\n' > "$RELOCATED_ROOT/rabbitmq.tofu-provisioned"
printf 'tx-local-opentofu-business-postgres\n' > "$RELOCATED_ROOT/business-postgres.tofu-provisioned"

relocated_ready_output="$(run_check "" "$RELOCATED_ROOT/deploy/pre-cutover-check.sh")"
grep -Fq 'PRE_CUTOVER_READY' <<< "$relocated_ready_output"
grep -Fq 'QQ_IDP_STATUS=idp-qq=READY' <<< "$relocated_ready_output"
grep -Fq 'yecao-backend-wireguard-bind: PASS (deployed contract)' <<< "$relocated_ready_output"
grep -Fq 'business-postgres: PASS' <<< "$relocated_ready_output"

# --- Routing, execution-plane and business-E2E tokens must all block readiness ---
run_gate_failure() {
  local label="$1" expected="$2" tx_dir="$3" check_script="$4"
  shift 4
  local output rc
  set +e
  output="$(run_check "$tx_dir" "$check_script" "$@")"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || { echo "FAIL: $label must block PRE_CUTOVER_READY" >&2; exit 1; }
  ! grep -Fq 'PRE_CUTOVER_READY' <<< "$output" \
    || { echo "FAIL: $label emitted PRE_CUTOVER_READY" >&2; exit 1; }
  grep -Fq 'PRE_CUTOVER_NOT_READY' <<< "$output" \
    || { echo "FAIL: $label must report PRE_CUTOVER_NOT_READY (output: $output)" >&2; exit 1; }
  grep -Fq "$expected" <<< "$output" \
    || { echo "FAIL: $label must report '$expected' (output: $output)" >&2; exit 1; }
}

run_gate_failure "frontend-upstream-yecao" 'tx-internal-api-route: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_FRONTEND_UPSTREAM=http://10.20.0.2:8087
run_gate_failure "frontend-upstream-public" 'tx-internal-api-route: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_FRONTEND_UPSTREAM=https://example.test
run_gate_failure "business-api-published-port" 'tx-internal-api-route: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" \
  FAKE_BUSINESS_API_PUBLISHED_PORT='[{"host_ip":"0.0.0.0","published":8087,"target":8087}]'
run_gate_failure "relocated-frontend-upstream-yecao" 'tx-internal-api-route: FAIL' \
  "" "$RELOCATED_ROOT/deploy/pre-cutover-check.sh" env FAKE_FRONTEND_UPSTREAM=http://10.20.0.2:8087
run_gate_failure "local-execution-plane" 'distributed-execution-plane: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_EXECUTION_MODE=local
run_gate_failure "memory-job-authority" 'distributed-execution-plane: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_JOB_REPOSITORY=memory

# Every business token must independently block readiness, so a green gate cannot
# be produced by a partially working chain.
source_root_env=(env WOTB_SOURCE_ROOT="$ROOT")
run_gate_failure "e2e-identity-missing" 'business-e2e: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" KEYCLOAK_E2E_CLIENT_SECRET=
run_gate_failure "control-plane-contract" 'tx-control-plane: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_CONTROL_PLANE_STATUS=500
run_gate_failure "anonymous-not-rejected" 'anonymous-rejected: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_CONTROL_PLANE_ANON_STATUS=200
run_gate_failure "admin-boundary-open" 'admin-authz: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_ADMIN_TOKEN_STATUS=200
run_gate_failure "profile-api-error" 'business-profile: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_PROFILE_STATUS=503
run_gate_failure "hof-list-error" 'business-hof: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_HOF_STATUS=500
run_gate_failure "boost-options-error" 'business-boost: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_BOOST_STATUS=500
run_gate_failure "hof-replay-not-migrated" 'hof-replay-storage: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_HOF_LIST_EMPTY=1
run_gate_failure "parser-worker-idle" 'parser-worker: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_PARSER_CONSUMERS=0
run_gate_failure "processing-e2e-create" 'processing-e2e: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_E2E_CREATE_STATUS=503
run_gate_failure "processing-e2e-failed" 'processing-e2e: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_E2E_JOB_STATUS=FAILED
run_gate_failure "dataset-result-error" 'dataset-result: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_DATASET_STATUS=503
run_gate_failure "map-overview-missing-artifact" 'map-overview: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_MAP_STATUS=204
run_gate_failure "battle-playback-missing-artifact" 'battle-playback-v2: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_PLAYBACK_STATUS=204
run_gate_failure "minio-unreadable" 'minio: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_MINIO_STATUS=403
run_gate_failure "ai-facts-unreadable" 'ai-facts: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_MINIO_ARTIFACT_STATUS=403
run_gate_failure "export-job-failed" 'export: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_EXPORT_JOB_STATUS=FAILED
run_gate_failure "export-download-error" 'export: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_EXPORT_DOWNLOAD_STATUS=500
run_gate_failure "data-integrity-mismatch" 'business-data-integrity: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_INTEGRITY_COUNT=1
run_gate_failure "data-snapshot-missing" 'business-data-integrity: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" WOTB_E2E_DATA_SNAPSHOT="$WORK/missing-snapshot.json"
run_gate_failure "public-edge-web-refused" 'public-edge-web: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_PUBLIC_WEB_STATUS=503
run_gate_failure "public-edge-auth-refused" 'public-edge-auth: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_PUBLIC_AUTH_STATUS=503

# --- Business PostgreSQL must independently block readiness -------------------
run_business_failure() {
  local label="$1" expected="$2" tx_dir="$3" check_script="$4"
  shift 4
  local output rc
  set +e
  output="$(run_check "$tx_dir" "$check_script" "$@")"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || { echo "FAIL: $label must block PRE_CUTOVER_READY" >&2; exit 1; }
  ! grep -Fq 'PRE_CUTOVER_READY' <<< "$output" \
    || { echo "FAIL: $label emitted PRE_CUTOVER_READY" >&2; exit 1; }
  grep -Fq 'PRE_CUTOVER_NOT_READY' <<< "$output" \
    || { echo "FAIL: $label must report PRE_CUTOVER_NOT_READY (output: $output)" >&2; exit 1; }
  grep -Fq "$expected" <<< "$output" \
    || { echo "FAIL: $label must report '$expected' (output: $output)" >&2; exit 1; }
}

run_business_failure "business-postgres-unhealthy" 'business-postgres: FAIL (container is missing or not healthy)' \
  "$WORK" "$CHECK" env FAKE_BUSINESS_UNHEALTHY=1
run_business_failure "business-postgres-missing" 'business-postgres: FAIL (container is missing or not healthy)' \
  "$WORK" "$CHECK" env FAKE_BUSINESS_MISSING=1
run_business_failure "business-postgres-not-ready" 'business-postgres: FAIL (container is missing or not healthy)' \
  "$WORK" "$CHECK" env FAKE_BUSINESS_PG_NOT_READY=1
run_business_failure "business-postgres-port-exposed" 'business-postgres-loopback: FAIL (management port must be 127.0.0.1:25432:5432 only)' \
  "$WORK" "$CHECK" env FAKE_BUSINESS_PORT_EXPOSED=1

# A missing or invalid OpenTofu marker must block readiness even when the
# runtime itself is healthy.
MARKER="$WORK/business-postgres.tofu-provisioned"
mv -- "$MARKER" "$WORK/business-postgres.tofu-provisioned.saved"
run_business_failure "business-postgres-marker-missing" 'business-postgres-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)' \
  "$WORK" "$CHECK"
printf 'tx-local-opentofu-keycloak\n' > "$MARKER"
run_business_failure "business-postgres-marker-invalid" 'business-postgres-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)' \
  "$WORK" "$CHECK"
printf 'tx-local-opentofu-business-postgres\n' > "$MARKER"

# The relocated production layout must apply the same Business PostgreSQL gate.
mv -- "$RELOCATED_ROOT/business-postgres.tofu-provisioned" \
  "$RELOCATED_ROOT/business-postgres.tofu-provisioned.saved"
run_business_failure "relocated-business-postgres-marker-missing" \
  'business-postgres-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)' \
  "" "$RELOCATED_ROOT/deploy/pre-cutover-check.sh"
mv -- "$RELOCATED_ROOT/business-postgres.tofu-provisioned.saved" \
  "$RELOCATED_ROOT/business-postgres.tofu-provisioned"
run_business_failure "relocated-business-postgres-unhealthy" \
  'business-postgres: FAIL (container is missing or not healthy)' \
  "" "$RELOCATED_ROOT/deploy/pre-cutover-check.sh" env FAKE_BUSINESS_UNHEALTHY=1

set +e
qq_idp_blocked_output="$(run_check "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_QQ_IDP_INVALID=1)"
qq_idp_blocked_rc=$?
set -e
[ "$qq_idp_blocked_rc" -ne 0 ]
! grep -Fq 'PRE_CUTOVER_READY' <<< "$qq_idp_blocked_output"
grep -Fq 'qq-idp-admin-api: FAIL (idp-qq representation is not production-ready)' <<< "$qq_idp_blocked_output"

# A healthy runtime with a valid marker must still be able to reach readiness,
# proving the new checks gate rather than permanently block the cutover.
final_output="$(run_check "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT")"
grep -Fq 'PRE_CUTOVER_READY' <<< "$final_output"

echo "PRE_CUTOVER_READY gate contract OK"
