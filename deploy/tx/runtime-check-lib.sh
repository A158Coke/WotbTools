# Read-only production runtime and end-to-end checks. Sourced by runtime-check.sh.

probe_body_contains() {
  local service="$1" url="$2" needle="$3" host_header="${4:-}" body
  local -a args=(--silent --show-error --fail --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC")
  [ -n "$host_header" ] && args+=(--header "$host_header")
  args+=("$url")
  if ! body="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    echo "$service: FAIL (probe command failed)" >&2
    return 1
  fi
  if ! grep -Fq "$needle" <<< "$body"; then
    echo "$service: FAIL (response missing expected contract)" >&2
    return 1
  fi
  echo "$service: PASS"
}

qq_identity_provider_ready() {
  local token_response admin_token idp_response
  if ! token_response="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe \
      --silent --show-error --fail --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
      --max-time "$PROBE_MAX_TIME_SEC" --request POST \
      --data-urlencode 'grant_type=password' \
      --data-urlencode 'client_id=admin-cli' \
      --data-urlencode 'username=admin' \
      --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD" \
      http://keycloak:8080/realms/master/protocol/openid-connect/token 2>&1)"; then
    echo "qq-idp-admin-token: FAIL (token request failed)" >&2
    return 1
  fi
  if ! admin_token="$(python3 -c 'import json, sys; print(json.load(sys.stdin)["access_token"])' <<< "$token_response" 2>/dev/null)"; then
    echo "qq-idp-admin-token: FAIL (token response is invalid)" >&2
    return 1
  fi
  if ! idp_response="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe \
      --silent --show-error --fail --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
      --max-time "$PROBE_MAX_TIME_SEC" \
      --header "Authorization: Bearer $admin_token" \
      http://keycloak:8080/admin/realms/wotbtools/identity-provider/instances 2>&1)"; then
    echo "qq-idp-admin-api: FAIL (identity provider query failed)" >&2
    return 1
  fi
  if ! python3 -c '
import json
import sys

providers = json.load(sys.stdin)
expected = {
    "authorizationUrl": "https://graph.qq.com/oauth2.0/authorize",
    "tokenUrl": "https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1",
    "userInfoUrl": "https://graph.qq.com/user/get_user_info",
    "clientAuthMethod": "client_secret_post",
}
qq = [provider for provider in providers if provider.get("alias") == "idp-qq"]
if len(qq) != 1:
    raise SystemExit(1)
provider = qq[0]
config = provider.get("config") or {}
if provider.get("providerId") != "qq" or provider.get("enabled") is not True:
    raise SystemExit(1)
if config.get("clientId") in (None, "", "bootstrap-not-configured", "dummy", "empty"):
    raise SystemExit(1)
if any(config.get(key) != value for key, value in expected.items()):
    raise SystemExit(1)
' <<< "$idp_response"; then
    echo "qq-idp-admin-api: FAIL (idp-qq representation is not production-ready)" >&2
    return 1
  fi
  echo "qq-idp-admin-api: PASS"
}

# ---------------------------------------------------------------- business E2E
# The read-only runtime check proves the *real* business chain from inside
# wotb_tx_internal: Keycloak token -> business runtime -> PostgreSQL -> HoF
# replay storage. Replay parsing runs in the browser, so there is no server-side
# processing chain to exercise. The check performs no writes and makes no paid
# AI provider call.

E2E_CLIENT_ID="${KEYCLOAK_E2E_CLIENT_ID:-wotbtools-e2e}"
E2E_CLIENT_SECRET="${KEYCLOAK_E2E_CLIENT_SECRET:-}"
E2E_PUBLIC_IP="${WOTB_E2E_PUBLIC_IP:-118.25.18.105}"
# The public hosts and the URLs the edge check must prove.
E2E_WEB_URL="${WOTB_E2E_WEB_URL:-https://wotbtools.com/api/health}"
E2E_AUTH_URL="${WOTB_E2E_AUTH_URL:-https://auth.wotbtools.com/realms/wotbtools/.well-known/openid-configuration}"
E2E_BEARER=""
E2E_HTTP_STATUS="000"
E2E_HTTP_BODY=""
E2E_DOWNLOAD_SIZE="0"
declare -a E2E_EXTRA_ARGS=()

# Run one HTTP call in the deployment-owned health-probe container: the gate
# needs no curl on the TX host and never contacts a published application port.
e2e_http() {
  local method="$1" url="$2" body="${3:-}" content_type="${4:-}" raw
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --request "$method" --write-out $'\n%{http_code}')
  [ -n "$E2E_BEARER" ] && args+=(--header "Authorization: Bearer $E2E_BEARER")
  [ -n "$content_type" ] && args+=(--header "Content-Type: $content_type")
  [ -n "$body" ] && args+=(--data "$body")
  if [ "${#E2E_EXTRA_ARGS[@]}" -gt 0 ]; then
    args+=("${E2E_EXTRA_ARGS[@]}")
    E2E_EXTRA_ARGS=()
  fi
  args+=("$url")
  E2E_HTTP_STATUS="000"
  E2E_HTTP_BODY=""
  if ! raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    E2E_HTTP_BODY="$raw"
    return 1
  fi
  E2E_HTTP_STATUS="${raw##*$'\n'}"
  E2E_HTTP_BODY="${raw%$'\n'*}"
  [ "$E2E_HTTP_BODY" != "$raw" ] || E2E_HTTP_BODY=""
  return 0
}

# Status-only probe for binary payloads (HoF replay originals).
e2e_download() {
  local url="$1" raw
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --output /dev/null --write-out '%{http_code} %{size_download}')
  [ -n "$E2E_BEARER" ] && args+=(--header "Authorization: Bearer $E2E_BEARER")
  args+=("$url")
  E2E_HTTP_STATUS="000"
  E2E_DOWNLOAD_SIZE="0"
  if ! raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    return 1
  fi
  E2E_HTTP_STATUS="${raw%% *}"
  E2E_DOWNLOAD_SIZE="${raw##* }"
  return 0
}

# Decode one field from the JSON body by dotted path; empty output means absent.
e2e_field() {
  local body="$1" path="$2"
  python3 -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except ValueError:
    raise SystemExit(0)
for part in sys.argv[1].split("."):
    if isinstance(payload, list):
        try:
            payload = payload[int(part)]
            continue
        except (ValueError, IndexError):
            raise SystemExit(0)
    if not isinstance(payload, dict) or part not in payload:
        raise SystemExit(0)
    payload = payload[part]
if payload is None or isinstance(payload, (dict, list)):
    raise SystemExit(0)
print(payload)
' "$path" <<< "$body"
}

# First integer `id` anywhere in a JSON document; robust against the paged HoF
# envelope without hard-coding its wrapper field names.
e2e_first_id() {
  local body="$1"
  python3 -c '
import json
import sys


def first_id(node):
    if isinstance(node, dict):
        value = node.get("id")
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
        for child in node.values():
            found = first_id(child)
            if found is not None:
                return found
    elif isinstance(node, list):
        for child in node:
            found = first_id(child)
            if found is not None:
                return found
    return None


try:
    document = json.load(sys.stdin)
except ValueError:
    raise SystemExit(0)
found = first_id(document)
if found is not None:
    print(found)
' <<< "$body"
}

e2e_emit() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = 1 ]; then
    echo "$name: PASS"
  else
    echo "$name: FAIL ($detail)" >&2
  fi
}

business_e2e_check() {
  local failures=0 status
  E2E_BEARER=""

  if [ -z "$E2E_CLIENT_SECRET" ]; then
    e2e_emit business-e2e 0 "KEYCLOAK_E2E_CLIENT_SECRET is required; the gate drives the real business chain with the wotbtools-e2e identity"
    return 1
  fi

  # --- auth: mint the machine token used by every authenticated call ---------
  E2E_EXTRA_ARGS=(--data-urlencode 'grant_type=client_credentials' \
    --data-urlencode "client_id=$E2E_CLIENT_ID" \
    --data-urlencode "client_secret=$E2E_CLIENT_SECRET")
  if e2e_http POST "http://keycloak:8080/realms/wotbtools/protocol/openid-connect/token" \
    && [ "$E2E_HTTP_STATUS" = 200 ]; then
    E2E_BEARER="$(e2e_field "$E2E_HTTP_BODY" access_token)"
  fi
  if [ -z "$E2E_BEARER" ]; then
    e2e_emit business-e2e 0 "client_credentials token request failed (HTTP $E2E_HTTP_STATUS)"
    return 1
  fi
  e2e_emit auth-token 1

  # --- anonymous rejection ---------------------------------------------------
  local saved_bearer="$E2E_BEARER"
  E2E_BEARER=""
  e2e_http GET "http://business-api:8087/api/users/profile"
  if [ "$E2E_HTTP_STATUS" = 401 ]; then
    e2e_emit anonymous-rejected 1
  else
    e2e_emit anonymous-rejected 0 "anonymous profile access must be 401, got HTTP $E2E_HTTP_STATUS"
    failures=1
  fi
  E2E_BEARER="$saved_bearer"

  # --- admin authorization boundary -----------------------------------------
  E2E_BEARER=""
  e2e_http GET "http://business-api:8087/api/admin/users"
  local admin_anonymous="$E2E_HTTP_STATUS"
  E2E_BEARER="$saved_bearer"
  e2e_http GET "http://business-api:8087/api/admin/users"
  if [ "$admin_anonymous" = 401 ] && [ "$E2E_HTTP_STATUS" = 403 ]; then
    e2e_emit admin-authz 1
  else
    e2e_emit admin-authz 0 "expected anonymous 401 and authenticated non-admin 403, got $admin_anonymous/$E2E_HTTP_STATUS"
    failures=1
  fi

  # --- read-only business APIs ----------------------------------------------
  e2e_http GET "http://business-api:8087/api/users/profile"
  if [ "$E2E_HTTP_STATUS" = 200 ] || [ "$E2E_HTTP_STATUS" = 404 ]; then
    e2e_emit business-profile 1
  else
    e2e_emit business-profile 0 "profile read must answer 200 or a canonical 404, got HTTP $E2E_HTTP_STATUS"
    failures=1
  fi
  e2e_http GET "http://business-api:8087/api/hof?page=0&size=1"
  local hof_body="$E2E_HTTP_BODY" hof_status="$E2E_HTTP_STATUS"
  if [ "$hof_status" = 200 ]; then
    e2e_emit business-hof 1
  else
    e2e_emit business-hof 0 "public HoF list must answer 200, got HTTP $hof_status"
    failures=1
  fi
  # --- HoF replay originals are readable for a real migrated record ----------
  local hof_id=""
  [ "$hof_status" = 200 ] && hof_id="$(e2e_first_id "$hof_body")"
  if [ -n "$hof_id" ] && e2e_download "http://business-api:8087/api/hof/$hof_id/replay" \
    && [ "$E2E_HTTP_STATUS" = 200 ] && [ "$E2E_DOWNLOAD_SIZE" -gt 0 ]; then
    e2e_emit hof-replay-storage 1
  else
    e2e_emit hof-replay-storage 0 "no readable HoF replay original for id=${hof_id:-none} (HTTP $E2E_HTTP_STATUS, ${E2E_DOWNLOAD_SIZE}B); check the replay_data volume"
    failures=1
  fi

  [ "$failures" -eq 0 ] || return 1
  return 0
}

# Public edge check: each public name must be served by the TX address over a
# locally trusted certificate with 2xx. TLS verification is never disabled and
# `curl -k` is never used, so an untrusted chain is a hard failure.
edge_tls_probe() {
  local host="$1" url="$2" raw exit_code=0
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --output /dev/null --write-out '%{http_code} %{remote_ip}' \
    --resolve "$host:443:$E2E_PUBLIC_IP" "$url")
  EDGE_EXIT=0
  EDGE_STATUS="000"
  EDGE_REMOTE_IP=""
  EDGE_ERROR=""
  # `if ! cmd` would make `$?` the status of the negation (always 0), so the real
  # exit code is captured in the else branch, where `$?` is the command's status.
  # The command inside an `if` condition stays exempt from errexit.
  if raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}" 2>&1)"; then
    exit_code=0
  else
    exit_code=$?
  fi
  EDGE_EXIT="$exit_code"
  if [ "$exit_code" -ne 0 ]; then
    EDGE_ERROR="$(tr '\r\n' ' ' <<< "$raw" | sed -E 's/[[:space:]]+/ /g')"
    return 1
  fi
  EDGE_STATUS="${raw%% *}"
  EDGE_REMOTE_IP="${raw##* }"
  return 0
}

# Edge token: the public name must be served by the TX address over a locally
# trusted certificate with 2xx. Verification is never disabled.
edge_tls_token() {
  local token="$1" host="$2" url="$3"
  if ! edge_tls_probe "$host" "$url"; then
    if [ "${EDGE_EXIT:-0}" = 60 ]; then
      e2e_emit "$token" 0 "the certificate for $host is not trusted (curl exit 60): Caddy has no valid public certificate"
    else
      e2e_emit "$token" 0 "curl failed for $host (exit $EDGE_EXIT: $EDGE_ERROR)"
    fi
    return 1
  fi
  if [ "$EDGE_REMOTE_IP" != "$E2E_PUBLIC_IP" ]; then
    e2e_emit "$token" 0 "$host was served by $EDGE_REMOTE_IP instead of the TX address $E2E_PUBLIC_IP"
    return 1
  fi
  if [[ "$EDGE_STATUS" =~ ^2[0-9]{2}$ ]]; then
    e2e_emit "$token" 1
    return 0
  fi
  e2e_emit "$token" 0 "$host served HTTP $EDGE_STATUS over trusted HTTPS (expected 2xx)"
  return 1
}

public_tls_check() {
  local failures=0
  edge_tls_token public-tls-web wotbtools.com "$E2E_WEB_URL" || failures=1
  edge_tls_token public-tls-auth auth.wotbtools.com "$E2E_AUTH_URL" || failures=1
  [ "$failures" -eq 0 ]
}

tx_runtime_check() {
  local source_root="${WOTB_SOURCE_ROOT:-}" compose_json health business_container
  local failures=0 provider
  DEPLOY_SERVICES=(keycloak-postgres business-postgres keycloak wotb-frontend business-api caddy alloy-tx)

  command -v docker >/dev/null 2>&1 || { echo "docker: FAIL (docker is required)" >&2; return 1; }
  command -v python3 >/dev/null 2>&1 || { echo "python3: FAIL (python3 is required)" >&2; return 1; }
  for required in KC_POSTGRES_ADMIN_USER KC_POSTGRES_ADMIN_PASSWORD \
    KC_BOOTSTRAP_ADMIN_PASSWORD KC_DB_USERNAME KC_DB_PASSWORD \
    WG_APPLICATION_ID CADDY_ACME_EMAIL \
    TX_BUSINESS_POSTGRES_ADMIN_USER TX_BUSINESS_POSTGRES_ADMIN_PASSWORD \
    TX_BUSINESS_DB_NAME TX_BUSINESS_DB_USERNAME TX_BUSINESS_DB_PASSWORD \
    KEYCLOAK_ADMIN_CLIENT_SECRET; do
    require_env "$required"
  done
  [ -f "$LIVE_COMPOSE" ] || { echo "tx-compose: FAIL (missing $LIVE_COMPOSE)" >&2; return 1; }

  if compose_json="$(docker compose -f "$LIVE_COMPOSE" config --format json 2>&1)"; then
    echo "tx-compose: PASS"
  else
    echo "tx-compose: FAIL ($compose_json)" >&2
    return 1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
services = data["services"]
frontend = services["wotb-frontend"].get("environment") or {}
assert frontend.get("BACKEND_UPSTREAM") == "http://business-api:8087", frontend.get("BACKEND_UPSTREAM")
assert frontend.get("AI_UPSTREAM") == "http://10.20.0.2:8089", frontend.get("AI_UPSTREAM")
business_api = services["business-api"]
business_ports = [
    (str(port.get("host_ip", "")), str(port.get("published")), str(port.get("target")))
    for port in (business_api.get("ports") or [])
]
assert business_ports == [("10.20.0.1", "8088", "8088")], business_ports
published = [
    str(port)
    for name, service in services.items()
    for port in (service.get("ports") or [])
]
assert not any("8087" in port or "8089" in port for port in published), published
' <<< "$compose_json"; then
    echo "tx-internal-api-route: PASS"
  else
    echo "tx-internal-api-route: FAIL (frontend must use TX-internal business-api plus the Yecao ai-service WireGuard endpoint, and only the management port may bind to WireGuard)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
services = json.load(sys.stdin)["services"]
alloy = services["alloy-tx"]
assert not (alloy.get("ports") or []), alloy.get("ports")
volumes = alloy.get("volumes") or []
assert any(v.get("source") == "/var/run/docker.sock" and v.get("target") == "/var/run/docker.sock" for v in volumes), volumes
assert any(v.get("target") == "/etc/alloy/config.alloy" and v.get("read_only") for v in volumes), volumes
' <<< "$compose_json"; then
    echo "tx-alloy-config: PASS"
  else
    echo "tx-alloy-config: FAIL (alloy-tx must publish no port and mount its config and Docker socket)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
environment = data["services"]["business-api"].get("environment") or {}
assert "WOTB_REPLAY_EXECUTION_MODE" not in environment, "the retired replay execution-mode switch must not be set"
assert "WOTB_REPLAY_PROCESSING_JOB_REPOSITORY" not in environment, "the retired replay job-repository switch must not be set"
' <<< "$compose_json"; then
    echo "retired-replay-switches: PASS"
  else
    echo "retired-replay-switches: FAIL (business-api must not carry the retired replay execution-mode / job-repository switches)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
ports = data["services"]["keycloak-postgres"].get("ports", [])
values = [str(p) for p in ports]
assert any("127.0.0.1" in p and "15432" in p and "5432" in p for p in values), values
assert not any("0.0.0.0" in p or p.startswith("5432:") or "::" in p for p in values), values
' <<< "$compose_json"; then
    echo "postgres-loopback: PASS"
  else
    echo "postgres-loopback: FAIL (management port must be 127.0.0.1:15432:5432 only)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
ports = [str(p) for p in data["services"]["business-postgres"].get("ports", [])]
assert any("127.0.0.1" in p and "25432" in p and "5432" in p for p in ports), ports
assert not any(
    "0.0.0.0" in p or "::" in p or "10.20.0.1" in p or p.startswith("25432:") for p in ports
), ports
' <<< "$compose_json"; then
    echo "business-postgres-loopback: PASS"
  else
    echo "business-postgres-loopback: FAIL (management port must be 127.0.0.1:25432:5432 only)" >&2
    failures=1
  fi

  if python3 -c '
import json, sys
data = json.load(sys.stdin)
ports = [str(p) for p in data["services"]["keycloak"].get("ports", [])]
assert any("127.0.0.1" in p and "18080" in p and "8080" in p for p in ports), ports
assert not any("0.0.0.0" in p or p.startswith("8080:") or "::" in p for p in ports)
' <<< "$compose_json"; then
    echo "keycloak-admin-loopback: PASS"
  else
    echo "keycloak-admin-loopback: FAIL (Admin API must bind to 127.0.0.1:18080:8080 only)" >&2
    failures=1
  fi

  health="$(docker compose -f "$LIVE_COMPOSE" ps --format '{{.Health}}' keycloak-postgres 2>/dev/null || true)"
  if [ "$health" = healthy ] && docker compose -f "$LIVE_COMPOSE" exec -T keycloak-postgres \
      pg_isready -U "$KC_POSTGRES_ADMIN_USER" -d postgres >/dev/null 2>&1; then
    echo "keycloak-postgres: PASS"
  else
    echo "keycloak-postgres: FAIL (container is not healthy)" >&2
    failures=1
  fi

  # Business PostgreSQL is authoritative business state, so TX_RUNTIME_READY
  # must not be emitted until its runtime, loopback administration port, and
  # TX-local OpenTofu provisioning marker are all proven. These checks are
  # read-only: they never create, modify, or delete any database or row.
  business_container="$(docker compose -f "$LIVE_COMPOSE" ps -q business-postgres 2>/dev/null || true)"
  health="$(docker compose -f "$LIVE_COMPOSE" ps --format '{{.Health}}' business-postgres 2>/dev/null || true)"
  if [ -n "$business_container" ] && [ "$health" = healthy ] \
    && docker compose -f "$LIVE_COMPOSE" exec -T business-postgres \
      pg_isready -U "$TX_BUSINESS_POSTGRES_ADMIN_USER" -d postgres >/dev/null 2>&1; then
    echo "business-postgres: PASS"
  else
    echo "business-postgres: FAIL (container is missing or not healthy)" >&2
    failures=1
  fi

  if [ -f "$BUSINESS_POSTGRES_TOFU_PROVISION_MARKER" ] \
      && grep -Fxq 'tx-local-opentofu-business-postgres' "$BUSINESS_POSTGRES_TOFU_PROVISION_MARKER"; then
    echo "business-postgres-provisioning: PASS"
  else
    echo "business-postgres-provisioning: FAIL (TX-local OpenTofu marker is missing or invalid)" >&2
    failures=1
  fi

  wait_for_probe keycloak http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration || failures=1
  wait_for_probe tx-business-api http://business-api:8088/actuator/health || failures=1
  wait_for_probe frontend http://wotb-frontend/api/health 'Host: wotbtools.com' || failures=1
  wait_for_probe caddy-ready http://caddy/_wotb/ready || failures=1
  wait_for_probe caddy-frontend http://caddy/_wotb/frontend/api/health || failures=1
  wait_for_probe caddy-keycloak http://caddy/_wotb/keycloak/realms/wotbtools/.well-known/openid-configuration || failures=1
  wait_for_probe caddy-monitor http://caddy/_wotb/monitor/api/health || failures=1
  probe_body_contains assetlinks http://caddy/.well-known/assetlinks.json 'com.wotbtools.app' || failures=1

  for provider in keycloak-qq-provider.jar keycloak-wargaming-provider.jar; do
    if docker compose -f "$LIVE_COMPOSE" exec -T keycloak test -f "/opt/keycloak/providers/$provider"; then
      echo "keycloak-provider-$provider: PASS"
    else
      echo "keycloak-provider-$provider: FAIL" >&2
      failures=1
    fi
  done

  qq_identity_provider_ready || failures=1

  if docker compose -f "$LIVE_COMPOSE" exec -T keycloak test ! -e /opt/keycloak/data/import/wotbtools-realm.json; then
    echo "keycloak-realm-import: PASS (OpenTofu owns realm configuration)"
  else
    echo "keycloak-realm-import: FAIL (legacy realm import must be absent)" >&2
    failures=1
  fi

  if [ -n "$source_root" ] && [ -f "$source_root/infra/tofu/keycloak/realm.tf" ]; then
    echo "realm-client-source-of-truth: PASS (Keycloak OpenTofu root present)"
  fi
  # The TX deploy helper owns no DNS or Yecao retirement command; that boundary
  # is enforced statically by the TX runtime contract tests.

  # Real business chain: token -> business runtime -> PostgreSQL -> HoF storage.
  # These tokens are the reason TX_RUNTIME_READY means "business works", not
  # "containers are up".
  business_e2e_check || failures=1
  # Public edge: both public hosts must be served by TX over trusted TLS with 2xx.
  public_tls_check || failures=1

  [ "$failures" -eq 0 ] && echo "QQ_IDP_STATUS=idp-qq=READY"
  if [ "$failures" -ne 0 ]; then
    echo "TX_RUNTIME_NOT_READY" >&2
    return 1
  fi
  echo "TX_RUNTIME_READY"
}
