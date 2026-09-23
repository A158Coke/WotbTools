#!/usr/bin/env bash
# TX release identity, one-service reconciliation and readiness gates.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
SHA_C=cccccccccccccccccccccccccccccccccccccccc
PREFIX=ccr.ccs.tencentyun.com/wotbtools
TAG_A="$PREFIX/wotbtools-business-api:sha-aaaaaaaaaaaa"
TAG_B="$PREFIX/wotbtools-business-api:sha-bbbbbbbbbbbb"
mkdir -p "$WORK/host" "$WORK/incoming/deploy/tx" "$WORK/bin"
cp -a "$ROOT/deploy/tx/." "$WORK/incoming/deploy/tx/"
cp "$ROOT/deploy/release-metadata.py" "$WORK/incoming/deploy/"
find "$WORK/incoming/deploy/tx" -name '*.sh' -exec sed -i 's/\r$//' {} +
cat > "$WORK/host/production-release.json" <<JSON
{"schemaVersion":2,"services":{"business-api":{"configSha":"$SHA_A","image":{"tag":"$TAG_A","commitSha":"$SHA_A"},"deployedAt":"2026-01-01T00:00:00Z"},"frontend":{"configSha":"$SHA_A","image":{"tag":"$PREFIX/wotbtools-frontend:sha-aaaaaaaaaaaa","commitSha":"$SHA_A"},"deployedAt":"2026-01-01T00:00:00Z"},"keycloak":{"configSha":"$SHA_A","image":{"tag":"$PREFIX/wotbtools-keycloak:sha-aaaaaaaaaaaa","commitSha":"$SHA_A"},"deployedAt":"2026-01-01T00:00:00Z"}}}
JSON
chmod 600 "$WORK/host/production-release.json"
printf 'tx-local-opentofu-keycloak\n' > "$WORK/host/keycloak.tofu-provisioned"
cat > "$WORK/bin/ip" <<'IP'
#!/usr/bin/env bash
[ "${1:-}" != -4 ] || { echo 'inet 10.20.0.1/24'; exit 0; }
exit 0
IP
cat > "$WORK/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = compose ] || exit 0
shift
if [ "${1:-}" = version ]; then exit 0; fi
while [ "${1:-}" = -f ]; do shift 2; done
verb="${1:-}"; shift || true
printf '%s %s\n' "$verb" "$*" >> "${FAKE_DOCKER_LOG:?}"
case "$verb" in
  up) [ "${FAKE_UP_FAILURE:-0}" != 1 ] ;;
  run) if [ "${FAKE_PROBE_FAILURE:-0}" = 1 ]; then printf '503'; else printf '200'; fi ;;
  *) : ;;
esac
DOCKER
chmod 700 "$WORK/bin/ip" "$WORK/bin/docker"
run() {
  local service="$1" config="$2" tag="$3" image_sha="$4" log="$5"
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" WOTB_TX_DIR="$WORK/host" \
    WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" TX_RUNTIME_ROOT="$WORK/host" \
    WOTB_DEPLOY_SERVICE="$service" WOTB_DEPLOY_CONFIG_SHA="$config" \
    WOTB_DEPLOY_IMAGE_TAG="$tag" WOTB_DEPLOY_IMAGE_COMMIT_SHA="$image_sha" \
    TX_IMAGE_REGISTRY_PREFIX="$PREFIX" WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
    KC_POSTGRES_ADMIN_USER=test KC_POSTGRES_ADMIN_PASSWORD=test KC_BOOTSTRAP_ADMIN_PASSWORD=test \
    KC_DB_USERNAME=test KC_DB_PASSWORD=test WG_APPLICATION_ID=test CADDY_ACME_EMAIL=test@example.com \
    TX_BUSINESS_POSTGRES_ADMIN_USER=test TX_BUSINESS_POSTGRES_ADMIN_PASSWORD=test \
    TX_BUSINESS_DB_NAME=test TX_BUSINESS_DB_USERNAME=test TX_BUSINESS_DB_PASSWORD=test \
    TX_BUSINESS_DB_PASSWORD_VERSION=1 TX_RABBITMQ_ADMIN_USER=test TX_RABBITMQ_ADMIN_PASSWORD=test \
    TX_RABBITMQ_CONTROL_API_PASSWORD=test TX_RABBITMQ_PARSER_WORKER_PASSWORD=test \
    YECAO_MINIO_CONTROL_API_ACCESS_KEY=test YECAO_MINIO_CONTROL_API_SECRET_KEY=test \
    KEYCLOAK_ADMIN_CLIENT_SECRET=test AI_API_KEY=test FAKE_DOCKER_LOG="$log" \
    FAKE_UP_FAILURE="${FAKE_UP_FAILURE:-0}" FAKE_PROBE_FAILURE="${FAKE_PROBE_FAILURE:-0}" \
    bash "$WORK/incoming/deploy/tx/deploy.sh"
}
metadata() { python3 "$ROOT/deploy/release-metadata.py" get --host tx --tx-prefix "$PREFIX" \
  --file "$WORK/host/production-release.json" --service "$1" --field "$2"; }

# The staged frontend route may only point to the TX-internal business API.
cp "$WORK/incoming/deploy/tx/docker-compose.yml" "$WORK/tx-compose.saved"
sed -i 's#http://business-api:8087#http://10.20.0.2:8087#g' "$WORK/incoming/deploy/tx/docker-compose.yml"
if run business-api "$SHA_B" '' '' "$WORK/route-reject.log" >/dev/null 2>&1; then exit 1; fi
[ ! -s "$WORK/route-reject.log" ]
cp "$WORK/tx-compose.saved" "$WORK/incoming/deploy/tx/docker-compose.yml"

# Config-only business-api keeps its recorded image, updates config SHA, starts one service.
run business-api "$SHA_B" '' '' "$WORK/config.log" >/dev/null
[ "$(metadata business-api tag)" = "$TAG_A" ]
[ "$(metadata business-api configSha)" = "$SHA_B" ]
grep -q '^pull business-api$' "$WORK/config.log"
grep -q '^up -d --no-deps --force-recreate business-api$' "$WORK/config.log"
! grep -Eq '^up .*keycloak|^up .*wotb-frontend|^up .*caddy' "$WORK/config.log"
grep -Fq "$TAG_A" "$WORK/host/deploy/docker-compose.yml"

# A fresh Build image advances image identity after the blocking health probe.
run business-api "$SHA_C" "$TAG_B" "$SHA_B" "$WORK/image.log" >/dev/null
[ "$(metadata business-api tag)" = "$TAG_B" ]
[ "$(metadata business-api commitSha)" = "$SHA_B" ]
[ "$(metadata business-api configSha)" = "$SHA_C" ]
[ "$(stat -c %a "$WORK/host/production-release.json")" = 600 ]

# Fixed Caddy reconcile keeps metadata unchanged and reloads nginx in place.
before="$(sha256sum "$WORK/host/production-release.json")"
run caddy "$SHA_C" '' '' "$WORK/caddy.log" >/dev/null
[ "$before" = "$(sha256sum "$WORK/host/production-release.json")" ]
grep -q '^up -d --no-deps --force-recreate caddy$' "$WORK/caddy.log"
grep -q '^exec -T wotb-frontend nginx -s reload$' "$WORK/caddy.log"
! grep -q '^up .*wotb-frontend' "$WORK/caddy.log"

# Missing/invalid metadata, wrong registry and multi-service selectors fail before Docker.
for service in all keycloak,business-api wotb-backend; do
  if run "$service" "$SHA_C" '' '' "$WORK/reject.log" >/dev/null 2>&1; then exit 1; fi
done
if run business-api "$SHA_C" 'ghcr.io/a158coke/wotbtools-business-api:sha-bbbbbbbbbbbb' "$SHA_B" "$WORK/reject.log" >/dev/null 2>&1; then exit 1; fi
cp "$WORK/host/production-release.json" "$WORK/metadata.saved"
printf '{broken' > "$WORK/host/production-release.json"; chmod 600 "$WORK/host/production-release.json"
if run business-api "$SHA_C" '' '' "$WORK/reject.log" >/dev/null 2>&1; then exit 1; fi
cp "$WORK/metadata.saved" "$WORK/host/production-release.json"; chmod 600 "$WORK/host/production-release.json"

# Health failure cannot advance metadata, even after runtime files were promoted.
before="$(sha256sum "$WORK/host/production-release.json")"
if FAKE_PROBE_FAILURE=1 run business-api "$SHA_A" "$TAG_A" "$SHA_A" "$WORK/health-fail.log" >/dev/null 2>&1; then exit 1; fi
[ "$before" = "$(sha256sum "$WORK/host/production-release.json")" ]
grep -q '^stop business-api$' "$WORK/health-fail.log"

echo 'TX metadata v2, single-service deploy, and readiness gates: PASS'
