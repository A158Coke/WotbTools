#!/usr/bin/env bash
# Exercise Yecao parser deployment and its stateless boundary without metadata.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/incoming/deploy" "$WORK/minio/deploy" "$WORK/bin"
cp "$ROOT/deploy/deploy.sh" "$ROOT/deploy/docker-compose.prod.yml" \
  "$ROOT/deploy/dependency-readiness.sh" "$ROOT/deploy/dependency-readiness.py" \
  "$WORK/incoming/deploy/"
sed -i 's/\r$//' "$WORK/incoming/deploy/"*.sh "$WORK/incoming/deploy/"*.yml
cp "$ROOT/deploy/minio-deploy.sh" "$ROOT/deploy/docker-compose.minio.yml" "$WORK/minio/deploy/"
sed -i 's/\r$//' "$WORK/minio/deploy/"*.sh "$WORK/minio/deploy/"*.yml
cat > "$WORK/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" != volume ] || {
  [ "${FAKE_MINIO_VOLUME:-0}" = 1 ] || exit 1
  case "$*" in
    *'com.docker.compose.project'*) echo wotb-yecao-minio ;;
    *'com.docker.compose.volume'*) echo minio_data ;;
  esac
  exit 0
}
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
verb="${1:-}"; shift || true
printf '%s %s\n' "$verb" "$*" >> "$FAKE_DOCKER_LOG"
case "$verb" in
  config) if [ "${FAKE_MINIO_COMPOSE:-0}" = 1 ]; then
    printf '%s\n' '{"name":"wotb-yecao-minio","services":{"minio":{"volumes":[{"type":"volume","source":"minio_data","target":"/data"}]}},"volumes":{"minio_data":{"name":"wotb_yecao_minio_data"}},"networks":{"default":{"name":"wotb_internal","external":true}}}'
  fi ;;
  ps) [ "${FAKE_MINIO_VOLUME:-0}" = 1 ] || echo 'parser-worker Up' ;;
esac
DOCKER
chmod 700 "$WORK/bin/docker"
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
run() {
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
    WOTB_DEPLOY_SERVICE=parser-worker WOTB_DEPLOY_CONFIG_SHA="$SHA" \
    WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 WOTB_PULL_ATTEMPTS=1 \
    TX_RABBITMQ_PARSER_WORKER_PASSWORD=test YECAO_MINIO_WORKER_ACCESS_KEY=test \
    YECAO_MINIO_WORKER_SECRET_KEY=test FAKE_DOCKER_LOG="$WORK/docker.log" \
    bash "$WORK/incoming/deploy/deploy.sh"
}
cp "$WORK/incoming/deploy/docker-compose.prod.yml" "$WORK/original.yml"
sed -i '/^  parser-worker:$/a\    POSTGRES_HOST: postgres' "$WORK/incoming/deploy/docker-compose.prod.yml"
if run >/dev/null 2>&1; then echo 'stateful worker was accepted' >&2; exit 1; fi
cp "$WORK/original.yml" "$WORK/incoming/deploy/docker-compose.prod.yml"
run >/dev/null
grep -q '^pull parser-worker$' "$WORK/docker.log"
grep -q '^up -d --no-deps --force-recreate parser-worker$' "$WORK/docker.log"
grep -Fq 'wotbtools-parser-worker:latest' "$WORK/docker-compose.yml"
[ ! -e "$WORK/production-release.json" ]
# MinIO refuses to create an empty data volume; an existing owner volume works without metadata.
minio() {
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" WOTB_DIR="$WORK" \
    WOTB_DEPLOY_SERVICE=minio YECAO_MINIO_ROOT_USER=test YECAO_MINIO_ROOT_PASSWORD=test \
    FAKE_MINIO_VOLUME="${FAKE_MINIO_VOLUME:-0}" FAKE_MINIO_COMPOSE=1 FAKE_DOCKER_LOG="$WORK/minio.log" \
    bash "$WORK/minio/deploy/minio-deploy.sh" "$WORK/minio"
}
if minio >/dev/null 2>&1; then echo 'MinIO accepted a missing data volume' >&2; exit 1; fi
FAKE_MINIO_VOLUME=1 minio >/dev/null
grep -q '^up -d --wait --no-deps minio$' "$WORK/minio.log"
echo 'Yecao worker deploy uses latest without release metadata: PASS'
