#!/usr/bin/env bash
# Contract for the read-only PRE_CUTOVER_READY entrypoint.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/deploy/tx/pre-cutover-check.sh"
DEPLOY="$ROOT/deploy/tx/deploy.sh"

grep -Fq 'TX_DEPLOY_LIBRARY_ONLY=1' "$CHECK"
grep -Fq 'source "$ROOT/deploy/tx/deploy.sh"' "$CHECK"
grep -Fq 'pre_cutover_check' "$CHECK"
grep -Fq 'PRE_CUTOVER_READY' "$DEPLOY"
grep -Fq 'DNS_CUTOVER_NOT_PERFORMED' "$DEPLOY"
grep -Fq 'WAITING_FOR_OPERATOR_APPROVAL' "$DEPLOY"
grep -Fq 'PRE_CUTOVER_NOT_READY' "$DEPLOY"
grep -Fq 'QQ_IDP_STATUS=idp-qq=WAITING_EXTERNAL' "$DEPLOY"
grep -Fq 'QQ_FALLBACK_STATUS=juhe-qq=PRODUCTION_REQUIRED' "$DEPLOY"
grep -Fq 'wireguard-backend' "$DEPLOY"
grep -Fq 'keycloak-juhe-qq-provider.jar' "$DEPLOY"
grep -Fq 'keycloak-qq-provider.jar' "$DEPLOY"
grep -Fq 'keycloak-wargaming-provider.jar' "$DEPLOY"
grep -Fq 'com.wotbtools.app' "$DEPLOY"
! grep -Eiq '(nsupdate|route53|cloudflare|gcloud dns|az network dns)' "$CHECK"
! grep -Eiq 'docker compose .* (stop|rm|down).*yecao' "$CHECK"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/deploy" "$WORK/bin" "$WORK/runtime/config/sponsor" "$WORK/runtime/android-release"
cp "$ROOT/deploy/tx/docker-compose.yml" "$WORK/deploy/docker-compose.yml"
cp "$ROOT/deploy/tx/yecao-backend-contract.json" "$WORK/deploy/yecao-backend-contract.json"
printf '{}\n' > "$WORK/runtime/config/sponsor-config.json"
cat > "$WORK/runtime.env" <<'ENV'
KC_POSTGRES_ADMIN_USER=kc_admin
KC_POSTGRES_ADMIN_PASSWORD=not-real
KC_BOOTSTRAP_ADMIN_PASSWORD=not-real
KC_DB_USERNAME=keycloak
KC_DB_PASSWORD=not-real
WG_APPLICATION_ID=not-real
CADDY_ACME_EMAIL=ops@example.test
ENV
cat > "$WORK/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
case "${1:-}" in
  config)
    printf '%s\n' '{"services":{"keycloak-postgres":{"ports":[{"host_ip":"127.0.0.1","published":15432,"target":5432}]}}}'
    ;;
  ps) printf 'healthy\n' ;;
  exec) exit 0 ;;
  run)
    if [[ "$*" == *10.20.0.2:8087/api/health* ]] && [ "${FAKE_WG_FAIL:-0}" = 1 ]; then
      printf '503\n'
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

ready_output="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK" TX_RUNTIME_ENV_FILE="$WORK/runtime.env" \
  WOTB_SOURCE_ROOT="$ROOT" WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  bash "$CHECK" 2>&1)"
grep -Fq 'PRE_CUTOVER_READY' <<< "$ready_output"
grep -Fq 'DNS_CUTOVER_NOT_PERFORMED' <<< "$ready_output"
grep -Fq 'WAITING_FOR_OPERATOR_APPROVAL' <<< "$ready_output"
grep -Fq 'QQ_IDP_STATUS=idp-qq=WAITING_EXTERNAL' <<< "$ready_output"

set +e
blocked_output="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK" TX_RUNTIME_ENV_FILE="$WORK/runtime.env" \
  WOTB_SOURCE_ROOT="$ROOT" WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_WG_FAIL=1 bash "$CHECK" 2>&1)"
blocked_rc=$?
set -e
[ "$blocked_rc" -ne 0 ]
! grep -Fq 'PRE_CUTOVER_READY' <<< "$blocked_output"
grep -Fq 'wireguard-backend: FAIL' <<< "$blocked_output"

echo "PRE_CUTOVER_READY gate contract OK"
