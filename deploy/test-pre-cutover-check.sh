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
grep -Fq 'wireguard-backend' "$DEPLOY"
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
case "${1:-}" in
  config)
    printf '{"services":{"keycloak-postgres":{"ports":[{"host_ip":"127.0.0.1","published":15432,"target":5432}]},"business-postgres":{"ports":%s},"rabbitmq":{"ports":[{"host_ip":"10.20.0.1","published":5672,"target":5672},{"host_ip":"127.0.0.1","published":15672,"target":15672}]},"keycloak":{"ports":[{"host_ip":"127.0.0.1","published":18080,"target":8080}]}}}\n' "$business_ports"
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
    if [[ "$*" == *10.20.0.2:8087/api/health* ]] && [ "${FAKE_WG_FAIL:-0}" = 1 ]; then
      printf '503\n'
    elif [[ "$*" == *protocol/openid-connect/token* ]]; then
      printf '{"access_token":"fake-admin-token"}\n'
    elif [[ "$*" == *identity-provider/instances* ]]; then
      if [ "${FAKE_QQ_IDP_INVALID:-0}" = 1 ]; then
        printf '[]\n'
      else
        printf '[{"alias":"idp-qq","providerId":"qq","enabled":true,"config":{"clientId":"fake-qq-client-id","authorizationUrl":"https://graph.qq.com/oauth2.0/authorize","tokenUrl":"https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1","userInfoUrl":"https://graph.qq.com/user/get_user_info","clientAuthMethod":"client_secret_post"}}]\n'
      fi
    elif [[ "$*" == *assetlinks.json* ]]; then
      printf '{"package_name":"com.wotbtools.app"}\n'
    else
      printf '200\n'
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
    WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
    "$@" bash "$check_script" 2>&1
}

printf 'tx-local-opentofu-business-postgres\n' > "$WORK/business-postgres.tofu-provisioned"
ready_output="$(run_check "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT")"
grep -Fq 'PRE_CUTOVER_READY' <<< "$ready_output"
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

set +e
blocked_output="$(run_check "$WORK" "$CHECK" env WOTB_SOURCE_ROOT="$ROOT" FAKE_WG_FAIL=1)"
blocked_rc=$?
set -e
[ "$blocked_rc" -ne 0 ]
! grep -Fq 'PRE_CUTOVER_READY' <<< "$blocked_output"
grep -Fq 'wireguard-backend: FAIL' <<< "$blocked_output"

set +e
relocated_blocked_output="$(run_check "" "$RELOCATED_ROOT/deploy/pre-cutover-check.sh" env FAKE_WG_FAIL=1)"
relocated_blocked_rc=$?
set -e
[ "$relocated_blocked_rc" -ne 0 ]
! grep -Fq 'PRE_CUTOVER_READY' <<< "$relocated_blocked_output"
grep -Fq 'wireguard-backend: FAIL' <<< "$relocated_blocked_output"

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
