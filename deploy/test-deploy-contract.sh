#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/incoming/deploy" "$WORK/bin" "$WORK/config" "$WORK/android-release"
cp "$ROOT/deploy/deploy.sh" "$WORK/incoming/deploy/deploy.sh"
cp "$ROOT/deploy/docker-compose.prod.yml" "$WORK/incoming/deploy/docker-compose.prod.yml"
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
    if [ "${FAKE_HEALTH_FAILURE:-0}" = 1 ] && [[ "$*" == *wotb-frontend* ]]; then printf '503\n'; else printf '200\n'; fi
    ;;
  exec)
    if [[ "$*" == *pg_isready* ]]; then exit 0; fi
    if [[ "$*" == *psql* ]]; then printf '22\n'; fi
    ;;
  ps) printf 'service Up\n' ;;
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
    FAKE_DOCKER_LOG="$log" FAKE_HEALTH_FAILURE="${FAKE_HEALTH_FAILURE:-0}" \
    FAKE_UP_FAILURE="${FAKE_UP_FAILURE:-0}" \
    bash "$WORK/incoming/deploy/deploy.sh"
}

first_log="$WORK/first.log"
run_deploy bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sha-bbbbbbbbbbbb wotb-backend wotb-backend "$first_log"
grep -q '^up .*wotb-backend' "$first_log"
! grep -Eq '^up .*wotb-frontend|^up .*keycloak|^up .*postgres' "$first_log"
grep -q '"imageTag": "sha-bbbbbbbbbbbb"' "$WORK/production-release.json"
grep -q '"imageTag": "sha-aaaaaaaaaaaa"' "$WORK/production-release.json"
if command -v stat >/dev/null 2>&1 && stat -c %a "$WORK/production-release.json" >/dev/null 2>&1; then
  [ "$(stat -c %a "$WORK/production-release.json")" = 600 ]
fi
! grep -Eq 'pg_dump|LKG|candidate|rollback|RESTORE' "$WORK/incoming/deploy/deploy.sh"

before_metadata="$(sha256sum "$WORK/production-release.json")"
failure_log="$WORK/failure.log"
set +e
FAKE_HEALTH_FAILURE=1 run_deploy cccccccccccccccccccccccccccccccccccccccc sha-cccccccccccc wotb-frontend wotb-frontend "$failure_log"
failure_rc=$?
set -e
[ "$failure_rc" -ne 0 ]
grep -q '^stop .*wotb-frontend' "$failure_log"
! grep -Eq '^up .*wotb-backend|^up .*keycloak|^up .*postgres' "$failure_log"
[ "$before_metadata" = "$(sha256sum "$WORK/production-release.json")" ]

up_failure_log="$WORK/up-failure.log"
set +e
FAKE_HEALTH_FAILURE=0 FAKE_UP_FAILURE=1 run_deploy dddddddddddddddddddddddddddddddddddddddd sha-dddddddddddd wotb-frontend wotb-frontend "$up_failure_log"
up_failure_rc=$?
set -e
[ "$up_failure_rc" -ne 0 ]
grep -q '^stop .*wotb-frontend' "$up_failure_log"
echo "compose up failure stops only the failed service"
echo "selective deploy and no-auto-recovery contract OK"
