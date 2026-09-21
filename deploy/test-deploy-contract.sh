#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BACKEND_CONFIG="$ROOT/java/wotb-web/src/main/resources/application.yml"
grep -q '^    port: 8088$' "$BACKEND_CONFIG"
grep -q '^        include: health,info,metrics,prometheus$' "$BACKEND_CONFIG"
! grep -q 'base-path:' "$BACKEND_CONFIG"
grep -q 'wait_for_probe backend http://wotb-backend:8088/actuator/health' "$ROOT/deploy/deploy.sh"
! grep -q 'wotb-backend:8087/api/health' "$ROOT/deploy/deploy.sh"

mkdir -p "$WORK/incoming/deploy/observability/alloy" "$WORK/bin" "$WORK/config" "$WORK/android-release"
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
    if [ "${FAKE_UP_FAILURE:-0}" = 1 ] && [[ "$*" == *wotb-frontend* ]]; then exit 1; fi
    ;;
  stop) printf 'stop %s\n' "$*" >> "$log" ;;
  run)
    printf 'run %s\n' "$*" >> "$log"
    status="${FAKE_HEALTH_STATUS:-}"
    if [ -z "$status" ]; then
      if [ -n "${FAKE_HEALTH_FAILURE_SERVICE:-}" ] && [[ "$*" == *"$FAKE_HEALTH_FAILURE_SERVICE"* ]]; then
        status=503
      elif [ -n "${FAKE_HEALTH_REDIRECT_SERVICE:-}" ] && [[ "$*" == *"$FAKE_HEALTH_REDIRECT_SERVICE"* ]]; then
        status=302
      else
        status=200
      fi
    fi
    [ -z "${FAKE_HEALTH_STDERR:-}" ] || printf '%s\n' "$FAKE_HEALTH_STDERR" >&2
    printf '%s\n' "$status"
    exit "${FAKE_HEALTH_EXIT_CODE:-0}"
    ;;
  exec)
    if [[ "$*" == *pg_isready* ]]; then [ "${FAKE_POSTGRES_FAILURE:-0}" = 1 ] && exit 1; exit 0; fi
    if [[ "$*" == *psql* ]]; then printf '22\n'; fi
    ;;
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
  local migration_version="${6:-22}"
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
    TAG="$tag" RELEASE_SHA="$sha" RELEASE_RUN_NUMBER=7 \
    WOTB_HEALTH_ATTEMPTS=2 WOTB_HEALTH_INTERVAL_SEC=1 \
    WOTB_BACKEND_MIGRATION_MAX_VERSION="$migration_version" \
    WOTB_DEPLOY_SERVICES="$service" WOTB_DEPLOY_IMAGE_SERVICES="$image_service" \
    DB_PASSWORD=not-real KC_ADMIN_PASSWORD=not-real WG_APPLICATION_ID=not-real \
    KEYCLOAK_ADMIN_CLIENT_SECRET=not-real AI_API_KEY=not-real \
    GRAFANA_ADMIN_USER=not-real GRAFANA_ADMIN_PASSWORD=not-real \
    TX_RABBITMQ_PARSER_WORKER_PASSWORD="${TX_RABBITMQ_PARSER_WORKER_PASSWORD:-}" \
    YECAO_MINIO_WORKER_ACCESS_KEY="${YECAO_MINIO_WORKER_ACCESS_KEY:-}" \
    YECAO_MINIO_WORKER_SECRET_KEY="${YECAO_MINIO_WORKER_SECRET_KEY:-}" \
    FAKE_DOCKER_LOG="$log" FAKE_HEALTH_FAILURE_SERVICE="${FAKE_HEALTH_FAILURE_SERVICE:-}" \
    FAKE_HEALTH_REDIRECT_SERVICE="${FAKE_HEALTH_REDIRECT_SERVICE:-}" \
    FAKE_HEALTH_STATUS="${FAKE_HEALTH_STATUS:-}" \
    FAKE_HEALTH_STDERR="${FAKE_HEALTH_STDERR:-}" \
    FAKE_HEALTH_EXIT_CODE="${FAKE_HEALTH_EXIT_CODE:-0}" \
    FAKE_POSTGRES_FAILURE="${FAKE_POSTGRES_FAILURE:-0}" \
    FAKE_UP_FAILURE="${FAKE_UP_FAILURE:-0}" \
    bash "$WORK/incoming/deploy/deploy.sh"
}

first_log="$WORK/first.log"
first_output="$(FAKE_HEALTH_STATUS=200 FAKE_HEALTH_STDERR=$'Container health-probe Creating\nContainer health-probe Created' \
  run_deploy bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sha-bbbbbbbbbbbb wotb-backend wotb-backend "$first_log" 2>&1)"
grep -q 'backend: PASS' <<< "$first_output"
grep -q '^up .*wotb-backend' "$first_log"
! grep -Eq '^up .*wotb-frontend|^up .*keycloak|^up .*postgres' "$first_log"
grep -q '^run .*http://wotb-backend:8088/actuator/health' "$first_log"
! grep -q 'wotb-backend:8087/api/health' "$first_log"
grep -q '^run .*--header Host: wotbtools.com .*http://wotb-frontend/api/health' "$first_log"
grep -q '^run .*http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration' "$first_log"
grep -q '"imageTag": "sha-bbbbbbbbbbbb"' "$WORK/production-release.json"
grep -q '"imageTag": "sha-aaaaaaaaaaaa"' "$WORK/production-release.json"
if command -v stat >/dev/null 2>&1 && stat -c %a "$WORK/production-release.json" >/dev/null 2>&1; then
  [ "$(stat -c %a "$WORK/production-release.json")" = 600 ]
fi
! grep -Eq 'pg_dump|LKG|candidate|rollback|RESTORE' "$WORK/incoming/deploy/deploy.sh"

status_204_log="$WORK/status-204.log"
status_204_output="$(FAKE_HEALTH_STATUS=204 run_deploy 1212121212121212121212121212121212121212 sha-121212121212 wotb-backend wotb-backend "$status_204_log" 2>&1)"
grep -q 'backend: PASS' <<< "$status_204_output"

assert_probe_failure() {
  local status="$1" log output rc
  log="$WORK/status-$status.log"
  set +e
  output="$(FAKE_HEALTH_STATUS="$status" run_deploy 1313131313131313131313131313131313131313 sha-131313131313 wotb-backend wotb-backend "$log" 2>&1)"
  rc=$?
  set -e
  [ "$rc" -ne 0 ]
  grep -q 'backend: FAIL' <<< "$output"
  grep -q 'probeService=backend' <<< "$output"
  grep -q 'probeTargetUrl=http://wotb-backend:8088/actuator/health' <<< "$output"
  grep -q "probeHttpStatus=$status" <<< "$output"
  grep -q "probeError=HTTP status $status is not 2xx" <<< "$output"
  grep -q '^stop .*wotb-backend' "$log"
}

assert_probe_failure 301
assert_probe_failure 401
assert_probe_failure 503

invalid_stdout_log="$WORK/invalid-stdout.log"
set +e
invalid_stdout_output="$(FAKE_HEALTH_STATUS=$'200\nunexpected-output' \
  run_deploy 1515151515151515151515151515151515151515 sha-151515151515 wotb-backend wotb-backend "$invalid_stdout_log" 2>&1)"
invalid_stdout_rc=$?
set -e
[ "$invalid_stdout_rc" -ne 0 ]
grep -q 'probeHttpStatus=unavailable' <<< "$invalid_stdout_output"
grep -q 'probeError=curl stdout did not contain exactly one three-digit HTTP status' <<< "$invalid_stdout_output"
grep -q '^stop .*wotb-backend' "$invalid_stdout_log"

curl_exit_log="$WORK/curl-exit.log"
set +e
curl_exit_output="$(FAKE_HEALTH_STATUS=000 FAKE_HEALTH_EXIT_CODE=7 \
  FAKE_HEALTH_STDERR=$'Container health-probe Creating\ncurl: (7) Authorization: Bearer should-not-leak' \
  run_deploy 1414141414141414141414141414141414141414 sha-141414141414 wotb-backend wotb-backend "$curl_exit_log" 2>&1)"
curl_exit_rc=$?
set -e
[ "$curl_exit_rc" -ne 0 ]
grep -q 'probeHttpStatus=000' <<< "$curl_exit_output"
grep -q 'probeError=compose/curl exited with status 7:' <<< "$curl_exit_output"
grep -q 'Authorization: REDACTED' <<< "$curl_exit_output"
! grep -q 'should-not-leak' <<< "$curl_exit_output"
grep -q '^stop .*wotb-backend' "$curl_exit_log"

before_metadata="$(sha256sum "$WORK/production-release.json")"
backend_unhealthy_log="$WORK/backend-unhealthy.log"
set +e
backend_unhealthy_output="$(FAKE_HEALTH_FAILURE_SERVICE=wotb-backend run_deploy cccccccccccccccccccccccccccccccccccccccc sha-cccccccccccc wotb-frontend wotb-frontend "$backend_unhealthy_log" 2>&1)"
backend_unhealthy_rc=$?
set -e
[ "$backend_unhealthy_rc" -ne 0 ]
grep -q 'backend: FAIL' <<< "$backend_unhealthy_output"
grep -q '== wotb-backend inspect ==' <<< "$backend_unhealthy_output"
! grep -q '^stop .*wotb-backend' "$backend_unhealthy_log"
[ "$before_metadata" = "$(sha256sum "$WORK/production-release.json")" ]

postgres_unhealthy_log="$WORK/postgres-unhealthy.log"
set +e
postgres_unhealthy_output="$(FAKE_POSTGRES_FAILURE=1 run_deploy dddddddddddddddddddddddddddddddddddddddd sha-dddddddddddd wotb-frontend wotb-frontend "$postgres_unhealthy_log" 2>&1)"
postgres_unhealthy_rc=$?
set -e
[ "$postgres_unhealthy_rc" -ne 0 ]
grep -q 'postgres: FAIL' <<< "$postgres_unhealthy_output"
grep -q '== postgres inspect ==' <<< "$postgres_unhealthy_output"
! grep -q '^stop .*postgres' "$postgres_unhealthy_log"
[ "$before_metadata" = "$(sha256sum "$WORK/production-release.json")" ]

backend_candidate_log="$WORK/backend-candidate.log"
set +e
FAKE_HEALTH_FAILURE_SERVICE=wotb-backend run_deploy eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee sha-eeeeeeeeeeee wotb-backend wotb-backend "$backend_candidate_log"
backend_candidate_rc=$?
set -e
[ "$backend_candidate_rc" -ne 0 ]
grep -q '^stop .*wotb-backend' "$backend_candidate_log"
[ "$before_metadata" = "$(sha256sum "$WORK/production-release.json")" ]

redirect_log="$WORK/redirect.log"
set +e
FAKE_HEALTH_REDIRECT_SERVICE=wotb-frontend run_deploy ffffffffffffffffffffffffffffffffffffffff sha-ffffffffffff wotb-frontend wotb-frontend "$redirect_log"
redirect_rc=$?
set -e
[ "$redirect_rc" -ne 0 ]
grep -q '^stop .*wotb-frontend' "$redirect_log"
[ "$before_metadata" = "$(sha256sum "$WORK/production-release.json")" ]

up_failure_log="$WORK/up-failure.log"
set +e
FAKE_UP_FAILURE=1 run_deploy 9999999999999999999999999999999999999999 sha-999999999999 wotb-frontend wotb-frontend "$up_failure_log"
up_failure_rc=$?
set -e
[ "$up_failure_rc" -ne 0 ]
grep -q '^stop .*wotb-frontend' "$up_failure_log"
all_observability_log="$WORK/all-observability.log"
run_deploy 8888888888888888888888888888888888888888 sha-888888888888 all wotb-backend,wotb-frontend,keycloak "$all_observability_log"
! grep -q 'invalid-ps-all' "$all_observability_log"
# parser-worker is selected explicitly: a whole-stack deploy must not start the new execution-plane
# service until the legacy stack is retired, so `all` keeps its existing service set.
! grep -q '^up .*parser-worker' "$all_observability_log"
grep -Fxq "WOTB_DIR=$WORK" "$WORK/verify-observability-env"
grep -Fxq "WOTB_DEPLOY_ROOT=$WORK" "$WORK/verify-observability-env"
grep -Fxq "WOTB_ALLOY_CONFIG=$WORK/deploy/observability/alloy/config.alloy" "$WORK/verify-observability-env"
grep -Fxq "WOTB_ALLOY_VALIDATOR=$WORK/deploy/validate-alloy-config.sh" "$WORK/verify-observability-env"
grep -Fxq "WOTB_DASHBOARD_DIR=$WORK/deploy/observability/grafana/dashboards" "$WORK/verify-observability-env"
grep -Fxq "WOTB_GRAFANA_API_HELPER=$WORK/deploy/grafana-api-request.sh" "$WORK/verify-observability-env"

# ---------------------------------------------------------------- parser-worker contract
# The Yecao execution plane is a deployable service with no public port and no database credentials:
# it consumes the TX broker and reads/writes Yecao MinIO with its own least-privilege identity.
compose_worker="$(awk '/^  parser-worker:$/{flag=1} /^  wotb-frontend:$/{flag=0} flag' \
  "$ROOT/deploy/docker-compose.prod.yml")"
grep -q 'image: ghcr.io/a158coke/wotbtools-parser-worker:${TAG:?TAG is required}' <<< "$compose_worker"
! grep -Eq '^    ports:' <<< "$compose_worker"
! grep -Eq 'POSTGRES|DB_PASSWORD|JDBC|SPRING_DATASOURCE' <<< "$compose_worker"
grep -q 'RABBITMQ_HOST: "${PARSER_WORKER_RABBITMQ_HOST:-10.20.0.1}"' <<< "$compose_worker"
grep -q 'RABBITMQ_VHOST: "${PARSER_WORKER_RABBITMQ_VHOST:-/wotbtools}"' <<< "$compose_worker"
grep -q 'TX_RABBITMQ_PARSER_WORKER_PASSWORD' <<< "$compose_worker"
grep -q 'YECAO_MINIO_WORKER_ACCESS_KEY' <<< "$compose_worker"
grep -q 'YECAO_MINIO_WORKER_SECRET_KEY' <<< "$compose_worker"

worker_log="$WORK/parser-worker.log"
# A worker-only deploy must accept an empty WOTB_BACKEND_MIGRATION_MAX_VERSION: the worker has no
# database access, so the backend Flyway ceiling is not one of its inputs. The deploy workflow sends
# an empty value for the parser-worker target.
worker_output="$(TX_RABBITMQ_PARSER_WORKER_PASSWORD=not-real \
  YECAO_MINIO_WORKER_ACCESS_KEY=not-real YECAO_MINIO_WORKER_SECRET_KEY=not-real \
  run_deploy 7777777777777777777777777777777777777777 sha-777777777777 parser-worker parser-worker \
  "$worker_log" "" 2>&1)"
grep -q 'parser-worker: PASS' <<< "$worker_output"
! grep -q 'WOTB_BACKEND_MIGRATION_MAX_VERSION' <<< "$worker_output"
grep -q '^pull parser-worker' "$worker_log"
grep -q '^up -d --no-deps --force-recreate parser-worker' "$worker_log"
! grep -Eq '^up .*wotb-backend|^up .*wotb-frontend|^up .*keycloak' "$worker_log"
grep -q '"parser-worker"' "$WORK/production-release.json"

# The backend migration ceiling stays mandatory for every deploy that actually ships the backend
# image, so the relaxed parser-worker path cannot leak into the application deploy.
while IFS=$'\t' read -r migration_service migration_image migration_version; do
  [ -n "$migration_service" ] && [ -n "$migration_image" ] || continue
  migration_log="$WORK/migration-$migration_service-${migration_version:-empty}.log"
  : > "$migration_log"
  set +e
  migration_output="$(run_deploy bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sha-bbbbbbbbbbbb \
    "$migration_service" "$migration_image" "$migration_log" "$migration_version" 2>&1)"
  migration_rc=$?
  set -e
  [ "$migration_rc" -ne 0 ] \
    || { echo "FAIL: $migration_service must reject WOTB_BACKEND_MIGRATION_MAX_VERSION='$migration_version'" >&2; exit 1; }
  grep -q 'WOTB_BACKEND_MIGRATION_MAX_VERSION must be a non-negative integer' <<< "$migration_output" \
    || { echo "FAIL: $migration_service rejected the migration ceiling with an unexpected error" >&2; exit 1; }
  [ ! -s "$migration_log" ] \
    || { echo "FAIL: $migration_service rejected the migration ceiling only after touching containers" >&2; exit 1; }
done <<'CASES'
wotb-backend	wotb-backend	
all	all	
wotb-backend	wotb-backend	not-a-number
CASES

# Selecting the service without its credentials must fail closed before any container is touched.
set +e
missing_credential_output="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
  TAG=sha-777777777777 RELEASE_SHA=7777777777777777777777777777777777777777 RELEASE_RUN_NUMBER=7 \
  WOTB_BACKEND_MIGRATION_MAX_VERSION=22 \
  WOTB_DEPLOY_SERVICES=parser-worker WOTB_DEPLOY_IMAGE_SERVICES=parser-worker \
  DB_PASSWORD=not-real KC_ADMIN_PASSWORD=not-real WG_APPLICATION_ID=not-real \
  KEYCLOAK_ADMIN_CLIENT_SECRET=not-real AI_API_KEY=not-real \
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
  run) printf '200\n' ;;
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

echo "compose up failure stops only the failed service"
echo "selective deploy, global health, parser-worker liveness, and no-auto-recovery contract OK"
