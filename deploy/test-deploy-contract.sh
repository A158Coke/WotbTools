#!/usr/bin/env bash
# Yecao production identity, single-service, and failure-gate smoke.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
SHA_C=cccccccccccccccccccccccccccccccccccccccc
DIGEST_A=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DIGEST_B=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
TAG_A=ghcr.io/a158coke/wotbtools-parser-worker:sha-aaaaaaaaaaaa
TAG_B=ghcr.io/a158coke/wotbtools-parser-worker:sha-bbbbbbbbbbbb
MINIO_TAG=ghcr.io/a158coke/wotbtools-minio:sha-aaaaaaaaaaaa

mkdir -p "$WORK/incoming/deploy/observability/alloy" "$WORK/bin" "$WORK/minio/deploy"
cp "$ROOT/deploy/deploy.sh" "$ROOT/deploy/release-metadata.py" "$ROOT/deploy/docker-compose.prod.yml" \
  "$ROOT/deploy/validate-alloy-config.sh" "$ROOT/deploy/verify-observability.sh" \
  "$ROOT/deploy/grafana-api-request.sh" "$ROOT/deploy/dependency-readiness.sh" \
  "$ROOT/deploy/dependency-readiness.py" "$WORK/incoming/deploy/"
cp "$ROOT/deploy/observability/alloy/config.alloy" "$WORK/incoming/deploy/observability/alloy/"
cp "$ROOT/deploy/minio-deploy.sh" "$ROOT/deploy/release-metadata.py" \
  "$ROOT/deploy/docker-compose.minio.yml" "$WORK/minio/deploy/"
sed -i 's/\r$//' "$WORK/incoming/deploy/"*.sh "$WORK/minio/deploy/"*.sh
sed -i 's/\r$//' "$WORK/incoming/deploy/docker-compose.prod.yml"
cat > "$WORK/production-release.json" <<JSON
{"schemaVersion":2,"services":{"parser-worker":{"configSha":"$SHA_A","image":{"tag":"$TAG_A","commitSha":"$SHA_A"},"deployedAt":"2026-01-01T00:00:00Z"},"minio":{"configSha":"$SHA_A","image":{"tag":"$MINIO_TAG","commitSha":"$SHA_A"},"deployedAt":"2026-01-01T00:00:00Z"}}}
JSON
chmod 600 "$WORK/production-release.json"
cat > "$WORK/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
verb="${1:-}"; shift || true
printf '%s %s\n' "$verb" "$*" >> "${FAKE_DOCKER_LOG:?}"
if [ "${FAKE_CAPTURE_TAG:-0}" = 1 ]; then printf 'compose-tag=%s\n' "${TAG:-}" >> "$FAKE_DOCKER_LOG"; fi
case "$verb" in
  up) [ "${FAKE_UP_FAILURE:-0}" != 1 ] ;;
  ps) if [ "${FAKE_WORKER_DOWN:-0}" = 1 ]; then echo 'parser-worker Exited'; else echo 'parser-worker Up'; fi ;;
  *) : ;;
esac
DOCKER
chmod 700 "$WORK/bin/docker"
run() {
  local service="$1" config="$2" tag="$3" image_sha="$4" log="$5" digest="${6:-}"
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
    WOTB_DEPLOY_SERVICE="$service" WOTB_DEPLOY_CONFIG_SHA="$config" \
    WOTB_DEPLOY_IMAGE_TAG="$tag" WOTB_DEPLOY_IMAGE_COMMIT_SHA="$image_sha" \
    WOTB_DEPLOY_IMAGE_DIGEST="$digest" \
    WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 WOTB_PULL_ATTEMPTS=1 \
    GRAFANA_ADMIN_USER=test GRAFANA_ADMIN_PASSWORD=test \
    TX_RABBITMQ_PARSER_WORKER_PASSWORD=test YECAO_MINIO_WORKER_ACCESS_KEY=test \
    YECAO_MINIO_WORKER_SECRET_KEY=test FAKE_DOCKER_LOG="$log" \
    FAKE_UP_FAILURE="${FAKE_UP_FAILURE:-0}" FAKE_WORKER_DOWN="${FAKE_WORKER_DOWN:-0}" \
    bash "$WORK/incoming/deploy/deploy.sh"
}
metadata() { python3 "$ROOT/deploy/release-metadata.py" get --host yecao \
  --file "$WORK/production-release.json" --service "$1" --field "$2"; }

# The execution plane may not acquire a local PostgreSQL job authority.
cp "$WORK/incoming/deploy/docker-compose.prod.yml" "$WORK/worker-compose.saved"
sed -i '/^  parser-worker:$/a\    POSTGRES_HOST: postgres' "$WORK/incoming/deploy/docker-compose.prod.yml"
if run parser-worker "$SHA_B" '' '' "$WORK/stateless.log" >/dev/null 2>&1; then exit 1; fi
[ ! -s "$WORK/stateless.log" ]
cp "$WORK/worker-compose.saved" "$WORK/incoming/deploy/docker-compose.prod.yml"

# Config-only pins the deployed image, updates only config SHA, and starts one service.
run parser-worker "$SHA_B" '' '' "$WORK/config.log" >/dev/null
[ "$(metadata parser-worker tag)" = "$TAG_A" ]
[ "$(metadata parser-worker configSha)" = "$SHA_B" ]
grep -q '^pull parser-worker$' "$WORK/config.log"
grep -q '^up -d --no-deps --force-recreate parser-worker$' "$WORK/config.log"
! grep -Eq '^up .*grafana|^up .*minio' "$WORK/config.log"
grep -Fq "$TAG_A" "$WORK/docker-compose.yml"
[ -f "$WORK/deploy/dependency-readiness.sh" ]
[ -f "$WORK/deploy/dependency-readiness.py" ]
[ ! -f "$WORK/deploy/validate-alloy-config.sh" ]

# Build image advances image identity only after liveness succeeds.
run parser-worker "$SHA_C" "$TAG_B" "$SHA_B" "$WORK/image.log" "$DIGEST_B" >/dev/null
[ "$(metadata parser-worker tag)" = "$TAG_B" ]
[ "$(metadata parser-worker commitSha)" = "$SHA_B" ]
[ "$(metadata parser-worker configSha)" = "$SHA_C" ]
grep -Fq "$TAG_B@$DIGEST_B" "$WORK/docker-compose.yml"
[ "$(stat -c %a "$WORK/production-release.json")" = 600 ]

# Fixed upstream service never alters either self-built image entry.
before="$(sha256sum "$WORK/production-release.json")"
run node-exporter "$SHA_C" '' '' "$WORK/fixed.log" >/dev/null
[ "$before" = "$(sha256sum "$WORK/production-release.json")" ]
grep -q '^up -d --no-deps --force-recreate node-exporter$' "$WORK/fixed.log"
! grep -Eq '^up .*parser-worker|^up .*grafana' "$WORK/fixed.log"
[ -f "$WORK/deploy/verify-observability.sh" ]
[ -f "$WORK/deploy/dependency-readiness.sh" ]

# Invalid ownership, missing metadata, wrong registry and retired selectors fail before Docker.
for service in all wotb-backend keycloak; do
  if run "$service" "$SHA_C" '' '' "$WORK/reject.log" >/dev/null 2>&1; then exit 1; fi
done
if run parser-worker "$SHA_C" 'ccr.ccs.tencentyun.com/x/wotbtools-parser-worker:sha-bbbbbbbbbbbb' "$SHA_B" "$WORK/reject.log" "$DIGEST_B" >/dev/null 2>&1; then exit 1; fi
if run parser-worker "$SHA_C" "$TAG_B" "$SHA_B" "$WORK/digest-required.log" >/dev/null 2>&1; then exit 1; fi
cp "$WORK/production-release.json" "$WORK/metadata.saved"
printf '{broken' > "$WORK/production-release.json"; chmod 600 "$WORK/production-release.json"
if run parser-worker "$SHA_C" '' '' "$WORK/reject.log" >/dev/null 2>&1; then exit 1; fi
cp "$WORK/metadata.saved" "$WORK/production-release.json"; chmod 600 "$WORK/production-release.json"

# Failed runtime does not advance metadata and stops the affected worker.
before="$(sha256sum "$WORK/production-release.json")"
if FAKE_UP_FAILURE=1 run parser-worker "$SHA_A" "$TAG_A" "$SHA_A" "$WORK/fail.log" "$DIGEST_A" >/dev/null 2>&1; then exit 1; fi
[ "$before" = "$(sha256sum "$WORK/production-release.json")" ]
grep -q '^stop parser-worker$' "$WORK/fail.log"

# MinIO runtime is separate from Tofu and shares the same metadata file and host lock.
before="$(sha256sum "$WORK/production-release.json")"
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" WOTB_DIR="$WORK" \
  WOTB_DEPLOY_SERVICE=minio WOTB_DEPLOY_CONFIG_SHA="$SHA_B" \
  WOTB_DEPLOY_IMAGE_TAG="$MINIO_TAG" WOTB_DEPLOY_IMAGE_COMMIT_SHA="$SHA_A" \
  WOTB_DEPLOY_IMAGE_DIGEST="$DIGEST_A" \
  WOTB_DEPLOY_DEFER_METADATA=1 \
  YECAO_MINIO_ROOT_USER=test YECAO_MINIO_ROOT_PASSWORD=test FAKE_DOCKER_LOG="$WORK/minio.log" FAKE_CAPTURE_TAG=1 \
  bash "$WORK/minio/deploy/minio-deploy.sh" "$WORK/minio" >"$WORK/minio-deferred.log"
[ "$(metadata minio tag)" = "$MINIO_TAG" ]
[ "$(sha256sum "$WORK/production-release.json")" = "$before" ]
grep -q '^up -d --wait --no-deps minio$' "$WORK/minio.log"
grep -Fq "compose-tag=${MINIO_TAG##*:}@$DIGEST_A" "$WORK/minio.log"
grep -q 'metadata update deferred' "$WORK/minio-deferred.log"

# A second invocation without deferral commits the successful runtime identity.
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" WOTB_DIR="$WORK" \
  WOTB_DEPLOY_SERVICE=minio WOTB_DEPLOY_CONFIG_SHA="$SHA_B" \
  YECAO_MINIO_ROOT_USER=test YECAO_MINIO_ROOT_PASSWORD=test FAKE_DOCKER_LOG="$WORK/minio-normal.log" \
  bash "$WORK/minio/deploy/minio-deploy.sh" "$WORK/minio" >/dev/null
[ "$(metadata minio configSha)" = "$SHA_B" ]

echo 'Yecao metadata v2, single-service deploy, and failure gates: PASS'
