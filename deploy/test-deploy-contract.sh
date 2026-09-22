#!/usr/bin/env bash
# Contract for the Yecao production deploy: service whitelist, immutable image identity pinning, the
# parser-worker fail-closed guards, the container-liveness gate, and the no-auto-recovery promise.
# The retired Yecao application runtime (backend, frontend, Keycloak, PostgreSQL) must stay
# unselectable, and the deploy must not demand the credentials that only those services consumed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BACKEND_CONFIG="$ROOT/java/wotb-web/src/main/resources/application.yml"
grep -q '^    port: 8088$' "$BACKEND_CONFIG"
grep -q '^        include: health,info,metrics,prometheus$' "$BACKEND_CONFIG"
! grep -q 'base-path:' "$BACKEND_CONFIG"
! grep -q 'wotb-backend:8087/api/health' "$ROOT/deploy/deploy.sh"

# Yecao keeps exactly one application image on GHCR — the parser execution plane. TX's TCR routing
# must never leak into it, and the retired Yecao application images must not come back.
grep -Fq 'image: ghcr.io/a158coke/wotbtools-parser-worker:${TAG:?TAG is required}' \
  "$ROOT/deploy/docker-compose.prod.yml" \
  || { echo "Yecao must keep the parser-worker image on GHCR" >&2; exit 1; }
grep -Fq 'image: ghcr.io/a158coke/wotbtools-minio:${TAG:?TAG is required}' "$ROOT/deploy/docker-compose.minio.yml" \
  || { echo "Yecao MinIO must remain on GHCR" >&2; exit 1; }
! grep -Fq 'ccr.ccs.tencentyun.com' "$ROOT/deploy/docker-compose.prod.yml" \
  || { echo "Yecao production Compose must not use Tencent TCR" >&2; exit 1; }
for retired_image in wotbtools-backend wotbtools-frontend wotbtools-keycloak; do
  ! grep -Fq "ghcr.io/a158coke/$retired_image:" "$ROOT/deploy/docker-compose.prod.yml" \
    || { echo "retired Yecao application image must be gone: $retired_image" >&2; exit 1; }
done
# The retired application services and the deployment-owned probe container are gone from the Yecao
# Compose: nothing on that host publishes a port any more.
for retired_service in postgres keycloak wotb-backend wotb-frontend health-probe; do
  ! grep -Eq "^  $retired_service:\s*$" "$ROOT/deploy/docker-compose.prod.yml" \
    || { echo "retired Yecao service must be gone: $retired_service" >&2; exit 1; }
done
! grep -Eq '^    ports:' "$ROOT/deploy/docker-compose.prod.yml" \
  || { echo "the Yecao runtime Compose must not publish a port" >&2; exit 1; }

mkdir -p "$WORK/incoming/deploy/observability/alloy" "$WORK/bin"
cp "$ROOT/deploy/deploy.sh" "$WORK/incoming/deploy/deploy.sh"
cp "$ROOT/deploy/docker-compose.prod.yml" "$WORK/incoming/deploy/docker-compose.prod.yml"
cp "$ROOT/deploy/validate-alloy-config.sh" "$WORK/incoming/deploy/validate-alloy-config.sh"
cp "$ROOT/deploy/observability/alloy/config.alloy" "$WORK/incoming/deploy/observability/alloy/config.alloy"
cat > "$WORK/incoming/deploy/verify-observability.sh" <<'FAKE_OBSERVABILITY'
#!/usr/bin/env bash
set -euo pipefail
: "${WOTB_DIR:?}"
: "${WOTB_DEPLOY_ROOT:?}"
: "${WOTB_ALLOY_CONFIG:?}"
: "${WOTB_ALLOY_VALIDATOR:?}"
: "${WOTB_DASHBOARD_DIR:?}"
: "${WOTB_GRAFANA_API_HELPER:?}"
printf 'WOTB_DIR=%s\nWOTB_DEPLOY_ROOT=%s\nWOTB_ALLOY_CONFIG=%s\nWOTB_ALLOY_VALIDATOR=%s\nWOTB_DASHBOARD_DIR=%s\nWOTB_GRAFANA_API_HELPER=%s\n' \
  "$WOTB_DIR" "$WOTB_DEPLOY_ROOT" "$WOTB_ALLOY_CONFIG" "$WOTB_ALLOY_VALIDATOR" \
  "$WOTB_DASHBOARD_DIR" "$WOTB_GRAFANA_API_HELPER" > "$WOTB_DIR/verify-observability-env"
FAKE_OBSERVABILITY
chmod 700 "$WORK/incoming/deploy/deploy.sh"
chmod 700 "$WORK/incoming/deploy/verify-observability.sh"

# Production metadata written before the cutover still names the retired Yecao application services.
# The deploy must keep validating that history and must never refresh it.
cat > "$WORK/production-release.json" <<'JSON'
{
  "schemaVersion": 1,
  "services": {
    "keycloak": {"commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "imageTag": "sha-aaaaaaaaaaaa", "deployedAt": "2026-01-01T00:00:00Z"},
    "wotb-backend": {"commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "imageTag": "sha-aaaaaaaaaaaa", "deployedAt": "2026-01-01T00:00:00Z", "schemaVersion": 22, "migrationMaxVersion": 22},
    "wotb-frontend": {"commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "imageTag": "sha-aaaaaaaaaaaa", "deployedAt": "2026-01-01T00:00:00Z"}
  }
}
JSON

cat > "$WORK/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
log="${FAKE_DOCKER_LOG:?}"
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
command="${1:-}"
shift || true
case "$command" in
  config) exit 0 ;;
  pull) printf 'pull %s\n' "$*" >> "$log" ;;
  up)
    printf 'up %s\n' "$*" >> "$log"
    if [ "${FAKE_UP_FAILURE:-0}" = 1 ] && [[ "$*" == *parser-worker* ]]; then exit 1; fi
    ;;
  stop) printf 'stop %s\n' "$*" >> "$log" ;;
  ps)
    if [ "${1:-}" = -a ] && [ "${2:-}" = all ]; then
      printf 'invalid-ps-all\n' >> "$log"
      exit 1
    fi
    printf 'service Up\n'
    ;;
  logs) : ;;
  *) : ;;
esac
FAKE_DOCKER
chmod 700 "$WORK/bin/docker"

run_deploy() {
  local sha="$1" tag="$2" service="$3" image_service="$4" log="$5"
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
    TAG="$tag" RELEASE_SHA="$sha" RELEASE_RUN_NUMBER=7 \
    WOTB_HEALTH_ATTEMPTS=2 WOTB_HEALTH_INTERVAL_SEC=1 \
    WOTB_DEPLOY_SERVICES="$service" WOTB_DEPLOY_IMAGE_SERVICES="$image_service" \
    GRAFANA_ADMIN_USER=not-real GRAFANA_ADMIN_PASSWORD=not-real \
    TX_RABBITMQ_PARSER_WORKER_PASSWORD="${TX_RABBITMQ_PARSER_WORKER_PASSWORD:-}" \
    YECAO_MINIO_WORKER_ACCESS_KEY="${YECAO_MINIO_WORKER_ACCESS_KEY:-}" \
    YECAO_MINIO_WORKER_SECRET_KEY="${YECAO_MINIO_WORKER_SECRET_KEY:-}" \
    FAKE_DOCKER_LOG="$log" FAKE_UP_FAILURE="${FAKE_UP_FAILURE:-0}" \
    bash "$WORK/incoming/deploy/deploy.sh"
}

# ---------------------------------------------------------------- retired services stay unselectable
# The deploy must reject the retired Yecao application services and the removed whole-stack selector
# before it touches a single container, and it must not require the credentials that only those
# services consumed (database, Keycloak admin, AI Review, Boost or Replay tuning).
assert_service_rejected() {
  local rejected="$1" log="$WORK/rejected-$1.log"
  : > "$log"
  local output rc
  set +e
  output="$(run_deploy bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sha-bbbbbbbbbbbb "$rejected" '' "$log" 2>&1)"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || { echo "FAIL: $rejected must not be deployable" >&2; exit 1; }
  grep -q 'unsupported deployment service' <<< "$output" \
    || { echo "FAIL: $rejected was rejected with an unexpected error" >&2; exit 1; }
  [ ! -s "$log" ] || { echo "FAIL: $rejected was rejected only after touching containers" >&2; exit 1; }
}
before_metadata="$(sha256sum "$WORK/production-release.json")"
assert_service_rejected all
assert_service_rejected wotb-backend
assert_service_rejected wotb-frontend
assert_service_rejected keycloak
assert_service_rejected postgres
[ "$before_metadata" = "$(sha256sum "$WORK/production-release.json")" ]

# ---------------------------------------------------------------- parser-worker contract
# The Yecao execution plane is the host's only application service: no public port, no database
# credentials, and its own least-privilege MinIO identity plus the TX broker credential.
compose_worker="$(awk '/^  parser-worker:$/{flag=1} /^  node-exporter:$/{flag=0} flag' \
  "$ROOT/deploy/docker-compose.prod.yml")"
grep -q 'image: ghcr.io/a158coke/wotbtools-parser-worker:${TAG:?TAG is required}' <<< "$compose_worker"
! grep -Eq '^    ports:' <<< "$compose_worker"
! grep -Eq 'POSTGRES|DB_PASSWORD|JDBC|SPRING_DATASOURCE' <<< "$compose_worker"
grep -q 'RABBITMQ_HOST: "${PARSER_WORKER_RABBITMQ_HOST:-10.20.0.1}"' <<< "$compose_worker"
grep -q 'RABBITMQ_VHOST: "${PARSER_WORKER_RABBITMQ_VHOST:-/wotbtools}"' <<< "$compose_worker"
grep -q 'TX_RABBITMQ_PARSER_WORKER_PASSWORD' <<< "$compose_worker"
grep -q 'YECAO_MINIO_WORKER_ACCESS_KEY' <<< "$compose_worker"
grep -q 'YECAO_MINIO_WORKER_SECRET_KEY' <<< "$compose_worker"

# MinIO endpoint ownership is per consumer, not one shared topology value. The worker and the MinIO
# runtime share the `wotb_internal` network, so the worker resolves the service through Docker DNS;
# TX is not on that network and keeps the WireGuard address. A container → host → published-port
# hairpin is not reachable, which is exactly how the worker failed with
# PARSER_WORKER_STORAGE_UNAVAILABLE / `Connect timed out`. Both endpoints are pinned here, each to
# its own variable, so they cannot silently collapse back into one value.
worker_minio_endpoint='minio:9000'
control_plane_minio_endpoint='10.20.0.2:9000'
grep -Fq "MINIO_ENDPOINT: \"\${PARSER_WORKER_MINIO_ENDPOINT:-$worker_minio_endpoint}\"" \
  <<< "$compose_worker" \
  || { echo "parser-worker must resolve MinIO through Docker service discovery" >&2; exit 1; }
! grep -Eq '^[[:space:]]+[A-Z0-9_]+: .*10\.20\.0\.2' <<< "$compose_worker" \
  || { echo "parser-worker must not be handed the TX WireGuard MinIO endpoint" >&2; exit 1; }
! grep -q 'YECAO_MINIO_ENDPOINT' <<< "$compose_worker" \
  || { echo "parser-worker endpoint ownership must not reuse the control-plane variable" >&2; exit 1; }
grep -Fq "endpoint: \${MINIO_ENDPOINT:$worker_minio_endpoint}" \
  "$ROOT/java/wotb-parser-worker/src/main/resources/application.yml" \
  || { echo "parser-worker application default must be the Docker DNS endpoint" >&2; exit 1; }
# The control plane never follows the worker: TX reaches Yecao MinIO over WireGuard and cannot
# resolve the Yecao-local Docker service name.
grep -Fq "endpoint: \${YECAO_MINIO_ENDPOINT:$control_plane_minio_endpoint}" \
  "$ROOT/java/wotb-web/src/main/resources/application.yml" \
  || { echo "TX control plane must keep reaching Yecao MinIO over WireGuard" >&2; exit 1; }
grep -Fq "YECAO_MINIO_ENDPOINT: \${YECAO_MINIO_ENDPOINT:-$control_plane_minio_endpoint}" \
  "$ROOT/deploy/tx/docker-compose.yml" \
  || { echo "TX business-api endpoint must stay the WireGuard address" >&2; exit 1; }
! grep -Eq "^[[:space:]]+[A-Z0-9_]+: .*$worker_minio_endpoint" "$ROOT/deploy/tx/docker-compose.yml" \
  || { echo "TX runtime must not resolve the Yecao-local Docker service name" >&2; exit 1; }
! grep -q 'PARSER_WORKER_MINIO_ENDPOINT' "$ROOT/deploy/tx/docker-compose.yml" \
  || { echo "TX must not be wired to the parser-worker endpoint variable" >&2; exit 1; }

worker_log="$WORK/parser-worker.log"
worker_output="$(TX_RABBITMQ_PARSER_WORKER_PASSWORD=not-real \
  YECAO_MINIO_WORKER_ACCESS_KEY=not-real YECAO_MINIO_WORKER_SECRET_KEY=not-real \
  run_deploy 7777777777777777777777777777777777777777 sha-777777777777 parser-worker parser-worker \
  "$worker_log" 2>&1)"
grep -q 'parser-worker: PASS' <<< "$worker_output"
grep -q '^pull parser-worker' "$worker_log"
grep -q '^up -d --no-deps --force-recreate parser-worker' "$worker_log"
! grep -Eq '^up .*node-exporter|^up .*prometheus|^up .*grafana' "$worker_log"
grep -q '"parser-worker"' "$WORK/production-release.json"
grep -q '"imageTag": "sha-777777777777"' "$WORK/production-release.json"
# The retired Yecao application service identities must survive untouched.
grep -q '"wotb-backend": {' "$WORK/production-release.json"
grep -q '"imageTag": "sha-aaaaaaaaaaaa"' "$WORK/production-release.json"
if command -v stat >/dev/null 2>&1 && stat -c %a "$WORK/production-release.json" >/dev/null 2>&1; then
  [ "$(stat -c %a "$WORK/production-release.json")" = 600 ]
fi
! grep -Eq 'pg_dump|LKG|candidate|rollback|RESTORE' "$WORK/incoming/deploy/deploy.sh"

# Selecting the service without its credentials must fail closed before any container is touched.
set +e
missing_credential_output="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
  TAG=sha-777777777777 RELEASE_SHA=7777777777777777777777777777777777777777 RELEASE_RUN_NUMBER=7 \
  WOTB_DEPLOY_SERVICES=parser-worker WOTB_DEPLOY_IMAGE_SERVICES=parser-worker \
  GRAFANA_ADMIN_USER=not-real GRAFANA_ADMIN_PASSWORD=not-real \
  FAKE_DOCKER_LOG="$WORK/missing-credential.log" \
  bash "$WORK/incoming/deploy/deploy.sh" 2>&1)"
missing_credential_rc=$?
set -e
[ "$missing_credential_rc" -ne 0 ]
grep -q 'TX_RABBITMQ_PARSER_WORKER_PASSWORD secret is not configured' <<< "$missing_credential_output"
[ ! -s "$WORK/missing-credential.log" ]

# The worker must stay stateless: PostgreSQL is the job authority on TX and MinIO owns the datasets,
# so a staged compose that handed the worker database credentials, a local replay job directory, or
# an execution mode would silently create a second, non-authoritative replay runtime. The deploy has
# to refuse it before any container is touched.
grep -q 'assert_parser_worker_execution_plane "$EFFECTIVE_COMPOSE"' "$ROOT/deploy/deploy.sh"
python3 - "$ROOT/deploy/docker-compose.prod.yml" "$WORK/incoming/deploy/docker-compose.prod.yml" <<'PY'
import re
import sys

source, target = sys.argv[1:3]
text = open(source, encoding="utf-8").read()
match = re.search(r"(?ms)^  parser-worker:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", text)
assert match, "parser-worker service block is missing"
block = match.group(0)
mutated = block.replace("    environment:\n", "    environment:\n      POSTGRES_HOST: postgres\n", 1)
assert mutated != block
open(target, "w", encoding="utf-8").write(text.replace(block, mutated))
PY
set +e
stateless_guard_output="$(TX_RABBITMQ_PARSER_WORKER_PASSWORD=not-real \
  YECAO_MINIO_WORKER_ACCESS_KEY=not-real YECAO_MINIO_WORKER_SECRET_KEY=not-real \
  run_deploy 9999999999999999999999999999999999999999 sha-999999999999 parser-worker parser-worker \
  "$WORK/stateless-guard.log" 2>&1)"
stateless_guard_rc=$?
set -e
[ "$stateless_guard_rc" -ne 0 ]
grep -q 'parser-worker must stay stateless' <<< "$stateless_guard_output"
[ ! -s "$WORK/stateless-guard.log" ]
cp "$ROOT/deploy/docker-compose.prod.yml" "$WORK/incoming/deploy/docker-compose.prod.yml"

# ---------------------------------------------------------------- observability-only deploy
observability_log="$WORK/observability.log"
run_deploy 8888888888888888888888888888888888888888 sha-888888888888 \
  node-exporter,prometheus,loki,alloy,grafana '' "$observability_log"
! grep -q 'invalid-ps-all' "$observability_log"
for service in node-exporter prometheus loki alloy grafana; do
  grep -q "^up -d --no-deps --force-recreate $service" "$observability_log"
done
! grep -Eq '^up .*parser-worker' "$observability_log"
! grep -Eq '^pull ' "$observability_log"
grep -Fxq "WOTB_DIR=$WORK" "$WORK/verify-observability-env"
grep -Fxq "WOTB_DEPLOY_ROOT=$WORK" "$WORK/verify-observability-env"
grep -Fxq "WOTB_ALLOY_CONFIG=$WORK/deploy/observability/alloy/config.alloy" "$WORK/verify-observability-env"
grep -Fxq "WOTB_ALLOY_VALIDATOR=$WORK/deploy/validate-alloy-config.sh" "$WORK/verify-observability-env"
grep -Fxq "WOTB_DASHBOARD_DIR=$WORK/deploy/observability/grafana/dashboards" "$WORK/verify-observability-env"
grep -Fxq "WOTB_GRAFANA_API_HELPER=$WORK/deploy/grafana-api-request.sh" "$WORK/verify-observability-env"

# An observability deploy that cannot start its container must degrade, never fail the release: the
# verifier is file-provisioned and its data path is owned by the observability PR.
degraded_log="$WORK/degraded.log"
cat > "$WORK/incoming/deploy/verify-observability.sh" <<'FAKE_OBSERVABILITY_FAIL'
#!/usr/bin/env bash
echo "OBSERVABILITY FAIL [test]: injected" >&2
exit 1
FAKE_OBSERVABILITY_FAIL
chmod 700 "$WORK/incoming/deploy/verify-observability.sh"
degraded_output="$(run_deploy 8888888888888888888888888888888888888888 sha-888888888888 \
  node-exporter,prometheus,loki,alloy,grafana '' "$degraded_log" 2>&1)"
grep -q 'OBSERVABILITY DEGRADED: data-path verification failed.' <<< "$degraded_output"
grep -q 'Deployment completed' <<< "$degraded_output"

# ---------------------------------------------------------------- worker liveness gate
# The worker exposes no HTTP endpoint, so a container that does not stay up must fail the deploy.
cat > "$WORK/bin/docker" <<'FAKE_DOCKER_WORKER_DOWN'
#!/usr/bin/env bash
set -euo pipefail
log="${FAKE_DOCKER_LOG:?}"
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
command="${1:-}"
shift || true
case "$command" in
  config) exit 0 ;;
  pull) printf 'pull %s\n' "$*" >> "$log" ;;
  up) printf 'up %s\n' "$*" >> "$log" ;;
  stop) printf 'stop %s\n' "$*" >> "$log" ;;
  ps)
    if [ "${1:-}" = -a ] && [ "${2:-}" = parser-worker ]; then
      printf 'parser-worker Exited (1) 2 seconds ago\n'
      exit 0
    fi
    printf 'service Up\n'
    ;;
  *) : ;;
esac
FAKE_DOCKER_WORKER_DOWN
chmod 700 "$WORK/bin/docker"
worker_down_log="$WORK/parser-worker-down.log"
set +e
worker_down_output="$(TX_RABBITMQ_PARSER_WORKER_PASSWORD=not-real \
  YECAO_MINIO_WORKER_ACCESS_KEY=not-real YECAO_MINIO_WORKER_SECRET_KEY=not-real \
  WOTB_HEALTH_ATTEMPTS=2 WOTB_HEALTH_INTERVAL_SEC=1 \
  run_deploy 6666666666666666666666666666666666666666 sha-666666666666 parser-worker parser-worker \
  "$worker_down_log" 2>&1)"
worker_down_rc=$?
set -e
[ "$worker_down_rc" -ne 0 ]
grep -q 'parser-worker: FAIL' <<< "$worker_down_output"
grep -q '^stop .*parser-worker' "$worker_down_log"

# A failing service must stop the release before metadata is updated, so the recorded identity never
# claims a release that did not converge.
up_failure_log="$WORK/up-failure.log"
before_up_failure="$(sha256sum "$WORK/production-release.json")"
set +e
FAKE_UP_FAILURE=1 TX_RABBITMQ_PARSER_WORKER_PASSWORD=not-real \
  YECAO_MINIO_WORKER_ACCESS_KEY=not-real YECAO_MINIO_WORKER_SECRET_KEY=not-real \
  run_deploy 5555555555555555555555555555555555555555 sha-555555555555 \
  parser-worker parser-worker "$up_failure_log"
up_failure_rc=$?
set -e
[ "$up_failure_rc" -ne 0 ]
grep -q '^stop .*parser-worker' "$up_failure_log"
[ "$before_up_failure" = "$(sha256sum "$WORK/production-release.json")" ]

echo "selective deploy, retired-service rejection, parser-worker statelessness/liveness, and no-auto-recovery contract OK"
