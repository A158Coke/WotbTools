#!/usr/bin/env bash
# Real Keycloak production runtime smoke.
# Builds the repository image, runs it against PostgreSQL, and verifies that
# the image exposes only the application/OIDC interface.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${WOTB_KEYCLOAK_TEST_IMAGE:-wotbtools-keycloak:runtime-contract}"
NETWORK="wotb-keycloak-runtime-$RANDOM-$$"
DB_NAME="wotb-keycloak-runtime-db-$$"
KC_NAME="wotb-keycloak-runtime-kc-$$"
RETRIES="${WOTB_KEYCLOAK_RUNTIME_RETRIES:-60}"
INTERVAL_SEC="${WOTB_KEYCLOAK_RUNTIME_INTERVAL_SEC:-2}"

if [[ ! "$RETRIES" =~ ^[1-9][0-9]*$ || ! "$INTERVAL_SEC" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: Keycloak runtime retry settings must be positive integers." >&2
  exit 2
fi

cleanup() {
  docker rm -f "$KC_NAME" "$DB_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "KEYCLOAK RUNTIME FAIL: $*" >&2
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$KC_NAME"; then
    docker logs --tail 120 "$KC_NAME" >&2 || true
  fi
  exit 1
}

if grep -Eq -- '--(health-enabled|metrics-enabled)|KC_HTTP_(MANAGEMENT|METRICS)' \
    "$ROOT/docker/Dockerfile.keycloak" "$ROOT/deploy/docker-compose.prod.yml"; then
  fail "Keycloak management health/metrics configuration must be removed"
fi

grep -Fq 'keycloak-juhe-qq-provider/pom.xml' "$ROOT/docker/Dockerfile.keycloak" \
  || fail "Keycloak image must build the production Juhe QQ provider during the transition"
grep -Fq 'keycloak-juhe-qq-provider.jar' "$ROOT/docker/Dockerfile.keycloak" \
  || fail "Keycloak image must copy the production Juhe QQ provider"

python3 - "$ROOT/docker/keycloak/wotbtools-realm.json" <<'PY'
import json
import re
import sys

realm_path = sys.argv[1]
with open(realm_path, encoding="utf-8") as source:
    realm = json.load(source)

if realm.get("identityProviders") != []:
    raise SystemExit("realm import must not contain IdP configuration or credentials")

secret_key = re.compile(r"^(?:secret|client[_-]?secret|password|token)$", re.IGNORECASE)

def verify(value, path="$"):
    if isinstance(value, dict):
        for key, nested in value.items():
            if secret_key.search(key):
                raise SystemExit(f"realm import contains a credential-like key at {path}.{key}")
            verify(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            verify(nested, f"{path}[{index}]")

verify(realm)
clients = [client for client in realm.get("clients", []) if client.get("clientId") == "wotbtools-web"]
if len(clients) != 1 or clients[0].get("publicClient") is not True:
    raise SystemExit("realm import must contain exactly one public wotbtools-web client")
PY

if [ "${WOTB_KEYCLOAK_SKIP_BUILD:-0}" != "1" ]; then
  echo "== Building real Keycloak production image =="
  docker build --build-arg BUILD_COMMIT=runtime-contract -f "$ROOT/docker/Dockerfile.keycloak" -t "$IMAGE" "$ROOT" >/dev/null
fi

docker run --rm --entrypoint /bin/sh "$IMAGE" -ec '
  test -f /opt/keycloak/providers/keycloak-qq-provider.jar
  test -f /opt/keycloak/providers/keycloak-juhe-qq-provider.jar
  test -f /opt/keycloak/providers/keycloak-wargaming-provider.jar
  test -f /opt/keycloak/data/import/wotbtools-realm.json
' || fail "Keycloak provider image contents do not match the approved provider set"

docker network create "$NETWORK" >/dev/null
docker run -d --name "$DB_NAME" --network "$NETWORK" \
  -e POSTGRES_DB=keycloak \
  -e POSTGRES_USER=wotb \
  -e POSTGRES_PASSWORD=runtime-test-password \
  postgres:18-alpine >/dev/null

for attempt in $(seq 1 "$RETRIES"); do
  if docker exec "$DB_NAME" pg_isready -U wotb -d keycloak >/dev/null 2>&1; then
    echo "PASS: PostgreSQL runtime dependency ready"
    break
  fi
  [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  [ "$attempt" -eq "$RETRIES" ] && fail "PostgreSQL did not become ready"
done

docker run -d --name "$KC_NAME" --network "$NETWORK" \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=runtime-test-password \
  -e KC_DB=postgres \
  -e KC_DB_URL=jdbc:postgresql://$DB_NAME:5432/keycloak \
  -e KC_DB_USERNAME=wotb \
  -e KC_DB_PASSWORD=runtime-test-password \
  -e KC_HTTP_ENABLED=true \
  -e KC_HTTP_PORT=8080 \
  -e KC_HOSTNAME_STRICT=false \
  "$IMAGE" start --optimized >/dev/null

command_json="$(docker inspect -f '{{json .Config.Cmd}}' "$KC_NAME")"
grep -Fq '"start","--optimized"' <<<"$command_json" \
  || fail "runtime command is not start --optimized: $command_json"
bindings="$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$KC_NAME")"
case "$bindings" in
  null|'{}') ;;
  *) fail "Keycloak runtime must not publish host ports: $bindings" ;;
esac

run_internal_wget() {
  local url="$1"
  docker run --rm --network "$NETWORK" alpine:3.22 wget -qO- "$url"
}

wait_for_body() {
  local label="$1" url="$2" body attempt pattern all_patterns_match
  shift 2
  for attempt in $(seq 1 "$RETRIES"); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$KC_NAME" 2>/dev/null || printf 'false')" != true ]; then
      fail "$label cannot be checked because the Keycloak container is not running"
    fi
    if body="$(run_internal_wget "$url" 2>/dev/null)" && [ -n "$body" ]; then
      all_patterns_match=true
      for pattern in "$@"; do
        if ! grep -Eq "$pattern" <<<"$body"; then
          all_patterns_match=false
          break
        fi
      done
      if [ "$all_patterns_match" = true ]; then
        echo "PASS: $label"
        return 0
      fi
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  done
  fail "$label did not return the expected response"
}

wait_for_body "Keycloak application interface" \
  "http://$KC_NAME:8080/realms/master/.well-known/openid-configuration" '"issuer"'

if docker logs "$KC_NAME" 2>&1 | grep -Fq 'Changes detected in configuration. Updating the server image.'; then
  fail "runtime startup attempted a Keycloak image rebuild"
fi
if docker logs "$KC_NAME" 2>&1 | grep -Eiq 'Quarkus augmentation'; then
  fail "runtime startup performed Quarkus augmentation"
fi
build_identity_seen=false
for attempt in $(seq 1 "$RETRIES"); do
  if docker logs "$KC_NAME" 2>&1 | grep -Fq 'WotBTools Keycloak build=runtime-contract'; then
    build_identity_seen=true
    break
  fi
  [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
done
if [ "$build_identity_seen" != true ]; then
  fail "runtime startup did not report the injected build commit"
fi
echo "PASS: Keycloak optimized runtime did not rebuild or augment"
