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
chmod 700 "$WORK/incoming/deploy/deploy.sh"

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
    if [ -n "${FAKE_HEALTH_FAILURE_SERVICE:-}" ] && [[ "$*" == *"$FAKE_HEALTH_FAILURE_SERVICE"* ]]; then
      printf '503\n'
    elif [ -n "${FAKE_HEALTH_REDIRECT_SERVICE:-}" ] && [[ "$*" == *"$FAKE_HEALTH_REDIRECT_SERVICE"* ]]; then
      printf '302\n'
    else
      printf '200\n'
    fi
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
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
    TAG="$tag" RELEASE_SHA="$sha" RELEASE_RUN_NUMBER=7 \
    WOTB_HEALTH_ATTEMPTS=2 WOTB_HEALTH_INTERVAL_SEC=1 \
    WOTB_BACKEND_MIGRATION_MAX_VERSION=22 \
    WOTB_DEPLOY_SERVICES="$service" WOTB_DEPLOY_IMAGE_SERVICES="$image_service" \
    DB_PASSWORD=not-real KC_ADMIN_PASSWORD=not-real WG_APPLICATION_ID=not-real \
    KEYCLOAK_ADMIN_CLIENT_SECRET=not-real AI_API_KEY=not-real \
    GRAFANA_ADMIN_USER=not-real GRAFANA_ADMIN_PASSWORD=not-real \
    FAKE_DOCKER_LOG="$log" FAKE_HEALTH_FAILURE_SERVICE="${FAKE_HEALTH_FAILURE_SERVICE:-}" \
    FAKE_HEALTH_REDIRECT_SERVICE="${FAKE_HEALTH_REDIRECT_SERVICE:-}" \
    FAKE_POSTGRES_FAILURE="${FAKE_POSTGRES_FAILURE:-0}" \
    FAKE_UP_FAILURE="${FAKE_UP_FAILURE:-0}" \
    bash "$WORK/incoming/deploy/deploy.sh"
}

first_log="$WORK/first.log"
run_deploy bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sha-bbbbbbbbbbbb wotb-backend wotb-backend "$first_log"
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
echo "compose up failure stops only the failed service"
echo "selective deploy, global health, and no-auto-recovery contract OK"
