#!/usr/bin/env bash
# Exercise the Yecao deployment (ai-service + observability) without release metadata.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/incoming/deploy" "$WORK/bin"
cp "$ROOT/deploy/deploy.sh" "$ROOT/deploy/docker-compose.prod.yml" "$WORK/incoming/deploy/"
sed -i 's/\r$//' "$WORK/incoming/deploy/"*.sh "$WORK/incoming/deploy/"*.yml
cat > "$WORK/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
verb="${1:-}"; shift || true
printf '%s %s\n' "$verb" "$*" >> "$FAKE_DOCKER_LOG"
DOCKER
chmod 700 "$WORK/bin/docker"
cat > "$WORK/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_CURL_LOG"
[[ "$*" == *'http://10.20.0.2:8089/actuator/health/readiness'* ]]
CURL
chmod 700 "$WORK/bin/curl"
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
deploy_run() {
  local service="$1"
  shift
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
    WOTB_DEPLOY_SERVICE="$service" WOTB_DEPLOY_CONFIG_SHA="$SHA" \
    WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 WOTB_PULL_ATTEMPTS=1 \
    FAKE_DOCKER_LOG="$WORK/docker.log" FAKE_CURL_LOG="$WORK/curl.log" "$@" \
    bash "$WORK/incoming/deploy/deploy.sh"
}

# Replay parsing runs in the browser: the retired parser execution plane must not be
# declared or selectable on Yecao any more.
! grep -Eq '^  parser-worker:' "$ROOT/deploy/docker-compose.prod.yml"
! grep -Eiq 'rabbitmq|minio|parser-worker' "$ROOT/deploy/docker-compose.prod.yml" "$ROOT/deploy/deploy.sh"
if deploy_run parser-worker >/dev/null 2>&1; then echo 'retired parser-worker was accepted' >&2; exit 1; fi

if deploy_run ai-service AI_API_KEY= >/dev/null 2>&1; then echo 'AI service accepted a missing API key' >&2; exit 1; fi
deploy_run ai-service AI_API_KEY=test >/dev/null
grep -q '^pull ai-service$' "$WORK/docker.log"
grep -q '^up -d --no-deps --force-recreate ai-service$' "$WORK/docker.log"
grep -Fq 'ghcr.io/a158coke/ai-service:latest' "$WORK/docker-compose.yml"
grep -Fq '10.20.0.2:8089:8080' "$WORK/docker-compose.yml"
grep -Fq 'http://10.20.0.2:8089/actuator/health/readiness' "$WORK/curl.log"
[ ! -e "$WORK/production-release.json" ]
echo 'Yecao ai-service deploy uses latest without release metadata: PASS'
