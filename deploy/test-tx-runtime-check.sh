#!/usr/bin/env bash
# Contract for the read-only TX_RUNTIME_READY entrypoint. Business PostgreSQL is
# authoritative business state, so the check must refuse readiness when its
# runtime, reviewed loopback/WireGuard bindings, or OpenTofu marker is wrong.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/deploy/tx/runtime-check.sh"
DEPLOY="$ROOT/deploy/tx/deploy.sh"

grep -Fq 'TX_DEPLOY_LIBRARY_ONLY=1' "$CHECK"
grep -Fq 'DEPLOY_SH="$SCRIPT_DIR/deploy.sh"' "$CHECK"
grep -Fq 'source "$DEPLOY_SH"' "$CHECK"
grep -Fq 'tx_runtime_check' "$CHECK"
RUNTIME_CHECK_LIB="$ROOT/deploy/tx/runtime-check-lib.sh"
grep -Fq 'TX_RUNTIME_READY' "$RUNTIME_CHECK_LIB"
grep -Fq 'TX_RUNTIME_NOT_READY' "$RUNTIME_CHECK_LIB"
grep -Fq 'QQ_IDP_STATUS=idp-qq=READY' "$RUNTIME_CHECK_LIB"
grep -Fq 'qq_identity_provider_ready' "$RUNTIME_CHECK_LIB"
grep -Fq 'identity-provider/instances' "$RUNTIME_CHECK_LIB"
grep -Fq 'clientAuthMethod' "$RUNTIME_CHECK_LIB"
grep -Fq 'https://graph.qq.com/oauth2.0/authorize' "$RUNTIME_CHECK_LIB"
grep -Fq 'https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1' "$RUNTIME_CHECK_LIB"
grep -Fq 'https://graph.qq.com/user/get_user_info' "$RUNTIME_CHECK_LIB"
grep -Fq 'tx-internal-api-route: PASS' "$RUNTIME_CHECK_LIB"
grep -Fq 'tx-alloy-config: PASS' "$RUNTIME_CHECK_LIB"
grep -Fq 'retired-replay-switches: PASS' "$RUNTIME_CHECK_LIB"
! grep -Fq 'wireguard-backend' "$RUNTIME_CHECK_LIB"
# Replay parsing runs in the browser: the server-side replay chain (broker,
# object store, parser worker, processing/export jobs) must not come back.
! grep -Eiq 'rabbitmq|minio|parser-worker|processing-jobs|export-jobs|map-overview|battle-playback-v2' "$RUNTIME_CHECK_LIB"
grep -Fq 'keycloak-qq-provider.jar' "$RUNTIME_CHECK_LIB"
grep -Fq 'keycloak-wargaming-provider.jar' "$RUNTIME_CHECK_LIB"
grep -Fq 'com.wotbtools.app' "$RUNTIME_CHECK_LIB"
! grep -Eiq '(nsupdate|route53|cloudflare|gcloud dns|az network dns)' "$CHECK"
! grep -Eiq 'docker compose .* (stop|rm|down).*yecao' "$CHECK"

# The retired cutover machinery must be gone: no phase selector, no SNI-only
# edge phase, no cutover verdicts or boundary token, no migration-only snapshot,
# and no business-data-integrity token (its Yecao row-count snapshot input cannot
# be regenerated, so the token was retired with the machinery).
! grep -Fq 'WOTB_CUTOVER_PHASE' "$RUNTIME_CHECK_LIB"
! grep -Fq 'CUTOVER_PHASE' "$RUNTIME_CHECK_LIB"
! grep -Fq 'public-edge-sni' "$RUNTIME_CHECK_LIB"
! grep -Fq 'POST_CUTOVER' "$RUNTIME_CHECK_LIB"
! grep -Fq 'PRE_CUTOVER' "$RUNTIME_CHECK_LIB"
! grep -Fq 'cutover-safety-boundary' "$RUNTIME_CHECK_LIB"
! grep -Fq 'pre-cutover' "$RUNTIME_CHECK_LIB"
! grep -Fq 'WOTB_E2E_DATA_SNAPSHOT' "$RUNTIME_CHECK_LIB"
! grep -Fq 'business-data-integrity' "$RUNTIME_CHECK_LIB"
! grep -Fq -- '--post-cutover' "$CHECK"
! grep -Fq 'pre-cutover' "$CHECK"

# Business PostgreSQL is authoritative state: the check must own its health,
# reviewed loopback/WireGuard bindings, and provisioning marker before readiness.
grep -Fq 'TX_BUSINESS_POSTGRES_ADMIN_USER' "$RUNTIME_CHECK_LIB"
grep -Fq 'TX_BUSINESS_POSTGRES_ADMIN_PASSWORD' "$RUNTIME_CHECK_LIB"
grep -Fq 'wireguard-service-plane: PASS' "$RUNTIME_CHECK_LIB"
grep -Fq 'wireguard-service-plane: FAIL (core services must preserve exactly the reviewed WireGuard and loopback bindings)' "$RUNTIME_CHECK_LIB"
grep -Fq 'business-postgres: PASS' "$RUNTIME_CHECK_LIB"
grep -Fq 'business-postgres: FAIL (container is missing or not healthy)' "$RUNTIME_CHECK_LIB"
grep -Fq 'business-postgres-provisioning: PASS' "$RUNTIME_CHECK_LIB"
grep -Fq 'business-postgres-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)' "$RUNTIME_CHECK_LIB"
grep -Fq 'tx-local-opentofu-business-postgres' "$RUNTIME_CHECK_LIB"
grep -Fq 'BUSINESS_POSTGRES_TOFU_PROVISION_MARKER' "$RUNTIME_CHECK_LIB"
# The new checks must be read-only: no DDL/DML against the business database.
! grep -Eiq '(drop|truncate|delete[[:space:]]+from|create[[:space:]]+database|alter[[:space:]]+database)' "$RUNTIME_CHECK_LIB"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/deploy" "$WORK/bin" "$WORK/runtime/config/sponsor" "$WORK/runtime/android-release"
cp "$ROOT/deploy/tx/docker-compose.yml" "$WORK/deploy/docker-compose.yml"
printf '{}\n' > "$WORK/runtime/config/sponsor-config.json"
cat > "$WORK/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
business_ports='[{"host_ip":"127.0.0.1","published":25432,"target":5432},{"host_ip":"10.20.0.1","published":25432,"target":5432}]'
if [ "${FAKE_BUSINESS_PORT_EXPOSED:-0}" = 1 ]; then
  business_ports='[{"host_ip":"0.0.0.0","published":25432,"target":5432}]'
fi
frontend_upstream="${FAKE_FRONTEND_UPSTREAM:-http://business-api:8087}"
# The AI route's upstream is the Yecao ai-service WireGuard endpoint; the fake can
# point it elsewhere to prove the readiness check still fails closed.
frontend_ai_upstream="${FAKE_FRONTEND_AI_UPSTREAM:-http://10.20.0.2:8089}"
# The retired replay execution-mode switch must be absent from a healthy compose; setting
# FAKE_EXECUTION_MODE injects it back to prove the deploy guard still fails closed.
execution_mode_field=""
if [ -n "${FAKE_EXECUTION_MODE:-}" ]; then
  execution_mode_field=",\"WOTB_REPLAY_EXECUTION_MODE\":\"${FAKE_EXECUTION_MODE}\""
fi
# 同上：已退役的后端选择器也不得出现；FAKE_JOB_REPOSITORY 可把它注回以证明门禁仍 fail closed。
job_repository_field=""
if [ -n "${FAKE_JOB_REPOSITORY:-}" ]; then
  job_repository_field=",\"WOTB_REPLAY_PROCESSING_JOB_REPOSITORY\":\"${FAKE_JOB_REPOSITORY}\""
fi
# 组合成保留 Docker-local dependency 的 business-api environment 主体。
extra_env="${job_repository_field}${execution_mode_field}"
extra_env="\"POSTGRES_HOST\":\"business-postgres\",\"KEYCLOAK_ADMIN_SERVER_URL\":\"http://keycloak:8080\"${extra_env}"
business_api_ports='[{"host_ip":"10.20.0.1","published":8087,"target":8087},{"host_ip":"10.20.0.1","published":8088,"target":8088}]'
[ -z "${FAKE_BUSINESS_API_PUBLISHED_PORT:-}" ] || business_api_ports="$FAKE_BUSINESS_API_PUBLISHED_PORT"
case "${1:-}" in
  config)
    printf '{"services":{"keycloak-postgres":{"ports":[{"host_ip":"127.0.0.1","published":15432,"target":5432},{"host_ip":"10.20.0.1","published":15432,"target":5432}]},"business-postgres":{"ports":%s},"keycloak":{"environment":{"KC_DB_URL":"jdbc:postgresql://keycloak-postgres:5432/keycloak"},"ports":[{"host_ip":"127.0.0.1","published":18080,"target":8080},{"host_ip":"10.20.0.1","published":8080,"target":8080}]},"wotb-frontend":{"ports":[{"host_ip":"10.20.0.1","published":8081,"target":80}],"environment":{"BACKEND_UPSTREAM":"%s","AI_UPSTREAM":"%s"}},"business-api":{"ports":%s,"environment":{%s}},"alloy-tx":{"ports":[],"volumes":[{"source":"/var/run/docker.sock","target":"/var/run/docker.sock"},{"source":"./alloy/config.alloy","target":"/etc/alloy/config.alloy","read_only":true}]}}}\n' \
      "$business_ports" "$frontend_upstream" "$frontend_ai_upstream" "$business_api_ports" "$extra_env" | python3 -c '
import json, os, sys
data = json.load(sys.stdin)
removed = os.environ.get("FAKE_BINDING_REMOVED")
if removed:
    name, index = removed.split(":")
    data["services"][name]["ports"].pop(int(index))
dependency = os.environ.get("FAKE_DOCKER_LOCAL_DEPENDENCY")
if dependency:
    name, key, value = dependency.split("|", 2)
    data["services"][name]["environment"][key] = value
json.dump(data, sys.stdout)
'
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
    if [[ "$*" == *business-postgres* ]] && [ "${FAKE_BUSINESS_PG_NOT_READY:-0}" = 1 ]; then
      exit 1
    fi
    exit 0
    ;;
  run)
    # The check asks curl for a body + status; the older probes ask for the status
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
      if [ "$authenticated" = 1 ]; then
        respond '{"nickname":"e2e"}' "${FAKE_PROFILE_STATUS:-200}"
      else
        respond '{"errorCode":"AUTH_UNAUTHORIZED"}' "${FAKE_PROFILE_ANON_STATUS:-401}"
      fi
    elif [[ "$*" == *"/api/hof?"* ]]; then
      if [ "${FAKE_HOF_LIST_EMPTY:-0}" = 1 ]; then
        respond '{"records":[]}' "${FAKE_HOF_STATUS:-200}"
      else
        respond '{"records":[{"id":348,"nickname":"e2e"}]}' "${FAKE_HOF_STATUS:-200}"
      fi
    elif [[ "$*" == *"/replay"* && "$write_out" == *size_download* ]]; then
      printf '%s %s\n' "${FAKE_HOF_REPLAY_STATUS:-200}" "${FAKE_HOF_REPLAY_BYTES:-2048}"
    elif [[ "$*" == *"https://wotbtools.com"* ]]; then
      if [[ "$write_out" == *remote_ip* ]]; then
        # Real curl prints the write-out even when the TLS handshake is rejected,
        # so a non-zero exit carries status 000.
        printf '%s %s\n' "${FAKE_TLS_STATUS:-200}" "${FAKE_TLS_REMOTE_IP:-118.25.18.105}"
        exit "${FAKE_TLS_EXIT:-0}"
      fi
      respond '{"status":"UP"}' "${FAKE_PUBLIC_WEB_STATUS:-200}"
    elif [[ "$*" == *"https://auth.wotbtools.com"* ]]; then
      if [[ "$write_out" == *remote_ip* ]]; then
        printf '%s %s\n' "${FAKE_TLS_STATUS:-200}" "${FAKE_TLS_REMOTE_IP:-118.25.18.105}"
        exit "${FAKE_TLS_EXIT:-0}"
      fi
      respond '{"issuer":"https://auth.wotbtools.com/realms/wotbtools"}' "${FAKE_PUBLIC_AUTH_STATUS:-200}"
    else
      printf '%s\n' "${FAKE_HEALTH_STATUS:-200}"
    fi
    ;;
  *) exit 0 ;;
esac
FAKE_DOCKER
chmod 700 "$WORK/bin/docker"

# Shared check environment. WOTB_TX_DIR is set per invocation because the
# relocated-layout fixtures point at a promoted runtime directory.
CHECK_ENV=(
  PATH="$WORK/bin:$PATH" HOME="$WORK"
  KC_POSTGRES_ADMIN_USER=kc_admin KC_POSTGRES_ADMIN_PASSWORD=not-real
  KC_BOOTSTRAP_ADMIN_PASSWORD=not-real KC_DB_USERNAME=keycloak KC_DB_PASSWORD=not-real
  WG_APPLICATION_ID=not-real CADDY_ACME_EMAIL=ops@example.test
  TX_BUSINESS_POSTGRES_ADMIN_USER=tx-business-admin
  TX_BUSINESS_POSTGRES_ADMIN_PASSWORD=not-real
  TX_BUSINESS_DB_NAME=wotb TX_BUSINESS_DB_USERNAME=control_api TX_BUSINESS_DB_PASSWORD=not-real
  KEYCLOAK_ADMIN_CLIENT_SECRET=not-real
  KEYCLOAK_E2E_CLIENT_SECRET=not-real-e2e
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1
)

run_check() {
  local tx_dir="$1" check_script="$2"
  shift 2
  env -i "${CHECK_ENV[@]}" WOTB_TX_DIR="$tx_dir" \
    "$@" bash "$check_script" 2>&1
}

printf 'tx-local-opentofu-business-postgres\n' > "$WORK/business-postgres.tofu-provisioned"
ready_output="$(run_check "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT")"
grep -Fq 'TX_RUNTIME_READY' <<< "$ready_output"
grep -Fq 'tx-internal-api-route: PASS' <<< "$ready_output"
grep -Fq 'tx-alloy-config: PASS' <<< "$ready_output"
grep -Fq 'caddy-monitor: PASS' <<< "$ready_output"
grep -Fq 'retired-replay-switches: PASS' <<< "$ready_output"
grep -Fq 'tx-business-api: PASS' <<< "$ready_output"
grep -Fq 'auth-token: PASS' <<< "$ready_output"
grep -Fq 'anonymous-rejected: PASS' <<< "$ready_output"
grep -Fq 'admin-authz: PASS' <<< "$ready_output"
grep -Fq 'business-profile: PASS' <<< "$ready_output"
grep -Fq 'business-hof: PASS' <<< "$ready_output"
grep -Fq 'hof-replay-storage: PASS' <<< "$ready_output"
# The public edge is a single trusted-TLS assertion, never an SNI-only phase.
grep -Fq 'public-tls-web: PASS' <<< "$ready_output"
grep -Fq 'public-tls-auth: PASS' <<< "$ready_output"
! grep -Fq 'public-edge-sni' <<< "$ready_output"
! grep -Fq 'DNS_CUTOVER' <<< "$ready_output"
! grep -Fq 'WAITING_FOR_OPERATOR' <<< "$ready_output"
! grep -Fq 'cutover-safety-boundary' <<< "$ready_output"
grep -Fq 'qq-idp-admin-api: PASS' <<< "$ready_output"
grep -Fq 'QQ_IDP_STATUS=idp-qq=READY' <<< "$ready_output"
grep -Fq 'business-postgres: PASS' <<< "$ready_output"
grep -Fq 'wireguard-service-plane: PASS' <<< "$ready_output"
grep -Fq 'business-postgres-provisioning: PASS' <<< "$ready_output"

# Exercise the actual promoted TX layout: the wrapper and deploy helper are
# siblings under runtime/deploy, with no repository checkout or source root.
RELOCATED_ROOT="$WORK/relocated-root"
mkdir -p "$RELOCATED_ROOT/deploy" "$RELOCATED_ROOT/config/sponsor" "$RELOCATED_ROOT/android-release"
cp "$ROOT/deploy/tx/runtime-check.sh" "$RELOCATED_ROOT/deploy/runtime-check.sh"
cp "$ROOT/deploy/tx/deploy.sh" "$RELOCATED_ROOT/deploy/deploy.sh"
cp "$ROOT/deploy/tx/runtime-check-lib.sh" "$RELOCATED_ROOT/deploy/runtime-check-lib.sh"
cp "$ROOT/deploy/tx/docker-compose.yml" "$RELOCATED_ROOT/deploy/docker-compose.yml"
printf '{}\n' > "$RELOCATED_ROOT/config/sponsor-config.json"
printf 'tx-local-opentofu-business-postgres\n' > "$RELOCATED_ROOT/business-postgres.tofu-provisioned"

relocated_ready_output="$(run_check "" "$RELOCATED_ROOT/deploy/runtime-check.sh")"
grep -Fq 'TX_RUNTIME_READY' <<< "$relocated_ready_output"
grep -Fq 'QQ_IDP_STATUS=idp-qq=READY' <<< "$relocated_ready_output"
grep -Fq 'business-postgres: PASS' <<< "$relocated_ready_output"

# --- Routing, execution-plane, business-E2E and edge tokens must all block readiness ---
run_gate_failure() {
  local label="$1" expected="$2" tx_dir="$3" check_script="$4"
  shift 4
  local output rc
  set +e
  output="$(run_check "$tx_dir" "$check_script" "$@")"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || { echo "FAIL: $label must block TX_RUNTIME_READY" >&2; exit 1; }
  ! grep -Fq 'TX_RUNTIME_READY' <<< "$output" \
    || { echo "FAIL: $label emitted TX_RUNTIME_READY" >&2; exit 1; }
  grep -Fq 'TX_RUNTIME_NOT_READY' <<< "$output" \
    || { echo "FAIL: $label must report TX_RUNTIME_NOT_READY (output: $output)" >&2; exit 1; }
  grep -Fq "$expected" <<< "$output" \
    || { echo "FAIL: $label must report '$expected' (output: $output)" >&2; exit 1; }
}

run_gate_failure "frontend-upstream-yecao" 'tx-internal-api-route: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_FRONTEND_UPSTREAM=http://10.20.0.2:8087
run_gate_failure "frontend-upstream-public" 'tx-internal-api-route: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_FRONTEND_UPSTREAM=https://example.test
# The AI route must reach the Yecao ai-service over WireGuard: pointing it at the TX
# business runtime or a public host reintroduces exactly the boundary this check owns.
run_gate_failure "frontend-ai-upstream-business-api" 'tx-internal-api-route: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_FRONTEND_AI_UPSTREAM=http://business-api:8087
run_gate_failure "frontend-ai-upstream-public" 'tx-internal-api-route: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_FRONTEND_AI_UPSTREAM=https://ai.example.test
run_gate_failure "business-api-published-port" 'wireguard-service-plane: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" \
  FAKE_BUSINESS_API_PUBLISHED_PORT='[{"host_ip":"0.0.0.0","published":8087,"target":8087}]'
run_gate_failure "business-api-extra-management-bind" 'wireguard-service-plane: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" \
  FAKE_BUSINESS_API_PUBLISHED_PORT='[{"host_ip":"10.20.0.1","published":8088,"target":8088},{"host_ip":"127.0.0.1","published":8088,"target":8088}]'
for binding in wotb-frontend:0 business-api:0 business-api:1 keycloak:0 keycloak:1 \
  keycloak-postgres:0 keycloak-postgres:1 business-postgres:0 business-postgres:1; do
  run_gate_failure "missing-$binding" 'wireguard-service-plane: FAIL' \
    "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_BINDING_REMOVED="$binding"
done
for dependency in \
  'business-api|POSTGRES_HOST|10.20.0.1' \
  'business-api|KEYCLOAK_ADMIN_SERVER_URL|http://10.20.0.1:8080' \
  'keycloak|KC_DB_URL|jdbc:postgresql://10.20.0.1:15432/keycloak'; do
  run_gate_failure "changed-$dependency" 'tx-internal-api-route: FAIL' \
    "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_DOCKER_LOCAL_DEPENDENCY="$dependency"
done
run_gate_failure "relocated-frontend-upstream-yecao" 'tx-internal-api-route: FAIL' \
  "" "$RELOCATED_ROOT/deploy/runtime-check.sh" env FAKE_FRONTEND_UPSTREAM=http://10.20.0.2:8087
run_gate_failure "retired-execution-mode-switch" 'retired-replay-switches: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_EXECUTION_MODE=distributed
run_gate_failure "retired-job-repository-switch" 'retired-replay-switches: FAIL' \
  "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_JOB_REPOSITORY=memory

# Every business token must independently block readiness, so a green check cannot
# be produced by a partially working chain.
source_root_env=(env WOTB_SOURCE_ROOT="$ROOT")
run_gate_failure "e2e-identity-missing" 'business-e2e: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" KEYCLOAK_E2E_CLIENT_SECRET=
run_gate_failure "anonymous-not-rejected" 'anonymous-rejected: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_PROFILE_ANON_STATUS=200
run_gate_failure "admin-boundary-open" 'admin-authz: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_ADMIN_TOKEN_STATUS=200
run_gate_failure "profile-api-error" 'business-profile: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_PROFILE_STATUS=503
run_gate_failure "hof-list-error" 'business-hof: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_HOF_STATUS=500
run_gate_failure "hof-replay-missing" 'hof-replay-storage: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_HOF_LIST_EMPTY=1
# An untrusted certificate is a hard failure: TLS verification is never disabled.
run_gate_failure "public-tls-untrusted-certificate" 'public-tls-web: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_TLS_EXIT=60
run_gate_failure "public-tls-wrong-address" 'public-tls-web: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_TLS_REMOTE_IP=203.0.113.9
run_gate_failure "public-tls-web-unreachable" 'public-tls-web: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_TLS_EXIT=7
run_gate_failure "public-tls-auth-unreachable" 'public-tls-auth: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_TLS_EXIT=28
run_gate_failure "public-tls-handshake-failed" 'public-tls-web: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_TLS_EXIT=35
run_gate_failure "public-tls-non-2xx" 'public-tls-web: FAIL' \
  "$WORK" "$CHECK" "${source_root_env[@]}" FAKE_TLS_STATUS=503

# An unknown flag must be a usage error: the entrypoint accepts no phase.
set +e
usage_output="$(env -i "${CHECK_ENV[@]}" WOTB_TX_DIR="$WORK" bash "$CHECK" --bogus 2>&1)"
usage_rc=$?
set -e
[ "$usage_rc" -eq 2 ] || { echo "FAIL: an unknown check argument must be a usage error" >&2; exit 1; }
grep -Fq 'usage: runtime-check.sh' <<< "$usage_output" \
  || { echo "FAIL: usage error must explain the accepted flags (output: $usage_output)" >&2; exit 1; }

# --- Business PostgreSQL must independently block readiness -------------------
run_business_failure() {
  local label="$1" expected="$2" tx_dir="$3" check_script="$4"
  shift 4
  local output rc
  set +e
  output="$(run_check "$tx_dir" "$check_script" "$@")"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || { echo "FAIL: $label must block TX_RUNTIME_READY" >&2; exit 1; }
  ! grep -Fq 'TX_RUNTIME_READY' <<< "$output" \
    || { echo "FAIL: $label emitted TX_RUNTIME_READY" >&2; exit 1; }
  grep -Fq 'TX_RUNTIME_NOT_READY' <<< "$output" \
    || { echo "FAIL: $label must report TX_RUNTIME_NOT_READY (output: $output)" >&2; exit 1; }
  grep -Fq "$expected" <<< "$output" \
    || { echo "FAIL: $label must report '$expected' (output: $output)" >&2; exit 1; }
}

run_business_failure "business-postgres-unhealthy" 'business-postgres: FAIL (container is missing or not healthy)' \
  "$WORK" "$CHECK" env FAKE_BUSINESS_UNHEALTHY=1
run_business_failure "business-postgres-missing" 'business-postgres: FAIL (container is missing or not healthy)' \
  "$WORK" "$CHECK" env FAKE_BUSINESS_MISSING=1
run_business_failure "business-postgres-not-ready" 'business-postgres: FAIL (container is missing or not healthy)' \
  "$WORK" "$CHECK" env FAKE_BUSINESS_PG_NOT_READY=1
run_business_failure "business-postgres-port-exposed" 'wireguard-service-plane: FAIL (core services must preserve exactly the reviewed WireGuard and loopback bindings)' \
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

# The relocated production layout must apply the same Business PostgreSQL check.
mv -- "$RELOCATED_ROOT/business-postgres.tofu-provisioned" \
  "$RELOCATED_ROOT/business-postgres.tofu-provisioned.saved"
run_business_failure "relocated-business-postgres-marker-missing" \
  'business-postgres-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)' \
  "" "$RELOCATED_ROOT/deploy/runtime-check.sh"
mv -- "$RELOCATED_ROOT/business-postgres.tofu-provisioned.saved" \
  "$RELOCATED_ROOT/business-postgres.tofu-provisioned"
run_business_failure "relocated-business-postgres-unhealthy" \
  'business-postgres: FAIL (container is missing or not healthy)' \
  "" "$RELOCATED_ROOT/deploy/runtime-check.sh" env FAKE_BUSINESS_UNHEALTHY=1

set +e
qq_idp_blocked_output="$(run_check "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_QQ_IDP_INVALID=1)"
qq_idp_blocked_rc=$?
set -e
[ "$qq_idp_blocked_rc" -ne 0 ]
! grep -Fq 'TX_RUNTIME_READY' <<< "$qq_idp_blocked_output"
grep -Fq 'qq-idp-admin-api: FAIL (idp-qq representation is not production-ready)' <<< "$qq_idp_blocked_output"

# A healthy runtime with a valid marker must still be able to reach readiness,
# proving the checks gate rather than permanently block the deployment.
final_output="$(run_check "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT")"
grep -Fq 'TX_RUNTIME_READY' <<< "$final_output"

echo "TX_RUNTIME_READY check contract OK"
