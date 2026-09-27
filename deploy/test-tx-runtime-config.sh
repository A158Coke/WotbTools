#!/usr/bin/env bash
# Exercise one TX owner deploy without a release registry or unrelated images.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/host" "$WORK/incoming/deploy" "$WORK/bin"
cp -a "$ROOT/deploy/tx" "$WORK/incoming/deploy/"
cp "$ROOT/deploy/validate-alloy-config.sh" "$WORK/incoming/deploy/"
find "$WORK/incoming/deploy/tx" -type f \( -name '*.sh' -o -name '*.yml' \) -exec sed -i 's/\r$//' {} +
cat > "$WORK/bin/ip" <<'IP'
#!/usr/bin/env bash
if [ "${1:-}" = -4 ]; then echo 'inet 10.20.0.1/24'; fi
IP
cat > "$WORK/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = compose ] || exit 0
shift
while :; do
  case "${1:-}" in -p|-f) shift 2 ;; *) break ;; esac
done
verb="${1:-}"; shift || true
printf '%s %s\n' "$verb" "$*" >> "$FAKE_DOCKER_LOG"
case "$verb" in
  run)
    if [[ "$*" == *":3100/ready"* ]]; then
      printf 'ready'
    elif [[ "$*" == *loki/api/v1/query_range* ]]; then
      marker="$(printf '%s' "$*" | grep -oE 'observability-canary-[^" ]+\.apk' | head -n1 || true)"
      printf '{"status":"success","values":[["%s"]],"event":"event=android_apk_download","statusCode":"status=404","request":"apk=%s"}' "$*" "$marker"
    else
      printf '200'
    fi
    ;;
  ps)
    if [[ "$*" == *alloy-tx* ]]; then printf 'Up\n'; else printf 'container-id\n'; fi
    ;;
esac
DOCKER
chmod 700 "$WORK/bin/ip" "$WORK/bin/docker"
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
  TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=frontend WOTB_DEPLOY_CONFIG_SHA="$SHA" \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 FAKE_DOCKER_LOG="$WORK/docker.log" \
  bash "$WORK/incoming/deploy/tx/deploy.sh" >/dev/null
grep -q '^pull wotb-frontend$' "$WORK/docker.log"
grep -q '^up -d --no-deps --force-recreate wotb-frontend$' "$WORK/docker.log"
! grep -Eq '^up .*business-api|^up .*keycloak' "$WORK/docker.log"
grep -Fq 'wotbtools-frontend:latest' "$WORK/host/deploy/frontend.compose.yml"
[ ! -e "$WORK/host/production-release.json" ]
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
  TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=caddy WOTB_DEPLOY_CONFIG_SHA="$SHA" \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 CADDY_ACME_EMAIL=ci@example.invalid \
  FAKE_DOCKER_LOG="$WORK/caddy.log" bash "$WORK/incoming/deploy/tx/deploy.sh" >/dev/null
grep -q '^up -d --no-deps --force-recreate caddy$' "$WORK/caddy.log"
! grep -Eq '^up .*business-api|^up .*keycloak' "$WORK/caddy.log"
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
  TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=keycloak WOTB_DEPLOY_CONFIG_SHA="$SHA" \
  WOTB_TX_BOOTSTRAP_KEYCLOAK=1 WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  KC_POSTGRES_ADMIN_USER=ci KC_POSTGRES_ADMIN_PASSWORD=ci KC_BOOTSTRAP_ADMIN_PASSWORD=ci \
  KC_DB_USERNAME=ci KC_DB_PASSWORD=ci WG_APPLICATION_ID=ci \
  FAKE_DOCKER_LOG="$WORK/keycloak.log" bash "$WORK/incoming/deploy/tx/deploy.sh" >/dev/null
grep -q '^up -d --no-deps --force-recreate keycloak$' "$WORK/keycloak.log"
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_TX_DIR="$WORK/host" WOTB_TX_INCOMING_DIR="$WORK/incoming/deploy/tx" \
  TX_RUNTIME_ROOT="$WORK/host" WOTB_DEPLOY_SERVICE=alloy-tx WOTB_DEPLOY_CONFIG_SHA="$SHA" \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$WORK/alloy.log" bash "$WORK/incoming/deploy/tx/deploy.sh" >"$WORK/alloy.out"
grep -q '^up -d --no-deps --force-recreate alloy-tx$' "$WORK/alloy.log"
grep -Fq 'alloy-tx: PASS' "$WORK/alloy.out"
cmp -s "$ROOT/deploy/tx/alloy/config.alloy" "$WORK/host/deploy/alloy/config.alloy"
echo 'TX owner deployment uses latest without release metadata: PASS'
