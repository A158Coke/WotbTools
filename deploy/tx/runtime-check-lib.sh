# Read-only production runtime and end-to-end checks. Sourced by runtime-check.sh.

# Validate rendered Compose ports for all core services, or one selected owner.
# Exact TCP tuples reject extra/public bindings and preserve local administration.
assert_tx_service_ports() {
  python3 -c '
import json, sys
services = json.load(sys.stdin)["services"]
expected = {
    "wotb-frontend": [("10.20.0.1", "8081", "80", "tcp")],
    "business-api": [("10.20.0.1", "8087", "8087", "tcp"), ("10.20.0.1", "8088", "8088", "tcp")],
    "keycloak": [("127.0.0.1", "18080", "8080", "tcp"), ("10.20.0.1", "8080", "8080", "tcp")],
    "keycloak-postgres": [("127.0.0.1", "15432", "5432", "tcp"), ("10.20.0.1", "15432", "5432", "tcp")],
    "business-postgres": [("127.0.0.1", "25432", "5432", "tcp"), ("10.20.0.1", "25432", "5432", "tcp")],
}
for name in sys.argv[1:] or expected:
    actual = [
        (str(p.get("host_ip", "")), str(p.get("published", "")), str(p.get("target", "")), p.get("protocol", "tcp"))
        for p in (services[name].get("ports") or [])
    ]
    if sorted(actual) != sorted(expected[name]):
        raise SystemExit(f"{name}: expected reviewed loopback/WireGuard TCP bindings, got {actual}")
' "$@"
}

probe_body_contains() {
  local service="$1" url="$2" needle="$3" host_header="${4:-}" body
  local -a args=(--silent --show-error --fail --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC")
  [ -n "$host_header" ] && args+=(--header "$host_header")
  args+=("$url")
  if ! body="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}")"; then
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
      http://keycloak:8080/realms/master/protocol/openid-connect/token)"; then
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
      http://keycloak:8080/admin/realms/wotbtools/identity-provider/instances)"; then
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
# Keep Compose/container lifecycle diagnostics on stderr: stdout is a machine
# protocol (JSON/body + curl write-out) and must stay parseable.
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
  if ! raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}")"; then
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
  if ! raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}")"; then
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

# First HoF record that explicitly advertises a replay. Public HoF records can
# legitimately exist without an archived replay, so arbitrary ids are not valid
# storage probes.
e2e_first_replay_id() {
  local body="$1"
  python3 -c '
import json
import sys

try:
    document = json.load(sys.stdin)
except ValueError:
    raise SystemExit(0)

items = document.get("items") if isinstance(document, dict) else None
if not isinstance(items, list):
    raise SystemExit(0)

for item in items:
    if not isinstance(item, dict) or item.get("replayAvailable") is not True:
        continue
    value = item.get("id")
    if isinstance(value, int):
        print(value)
        break
    if isinstance(value, str) and value.isdigit():
        print(value)
        break
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
  e2e_http GET "http://business-api:8087/api/hof?page=1&size=200"
  local hof_body="$E2E_HTTP_BODY" hof_status="$E2E_HTTP_STATUS"
  if [ "$hof_status" = 200 ]; then
    e2e_emit business-hof 1
  else
    e2e_emit business-hof 0 "public HoF list must answer 200, got HTTP $hof_status"
    failures=1
  fi
  # --- HoF replay originals are readable for a record that advertises one ----
  local hof_id="" hof_page=1 hof_total_pages=0 hof_scan_failed=0
  if [ "$hof_status" = 200 ]; then
    hof_id="$(e2e_first_replay_id "$hof_body")"
    hof_total_pages="$(e2e_field "$hof_body" totalPages)"
    [[ "$hof_total_pages" =~ ^[0-9]+$ ]] || hof_total_pages=1
    while [ -z "$hof_id" ] && [ "$hof_page" -lt "$hof_total_pages" ]; do
      hof_page=$((hof_page + 1))
      e2e_http GET "http://business-api:8087/api/hof?page=$hof_page&size=200"
      if [ "$E2E_HTTP_STATUS" != 200 ]; then
        hof_scan_failed=1
        break
      fi
      hof_id="$(e2e_first_replay_id "$E2E_HTTP_BODY")"
    done
  fi

  if [ "$hof_scan_failed" = 1 ]; then
    e2e_emit hof-replay-storage 0 "HoF replay candidate scan failed at page $hof_page (HTTP $E2E_HTTP_STATUS)"
    failures=1
  elif [ -z "$hof_id" ]; then
    e2e_emit hof-replay-storage 0 "no HoF record advertises replayAvailable=true"
    failures=1
  elif e2e_download "http://business-api:8087/api/hof/$hof_id/replay" \
    && [ "$E2E_HTTP_STATUS" = 200 ] && [ "$E2E_DOWNLOAD_SIZE" -gt 0 ]; then
    e2e_emit hof-replay-storage 1
  else
    e2e_emit hof-replay-storage 0 "HoF record id=$hof_id advertises replayAvailable=true but its replay is unreadable (HTTP $E2E_HTTP_STATUS, ${E2E_DOWNLOAD_SIZE}B); check replay_data"
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
  if raw="$(docker compose -f "$LIVE_COMPOSE" run --rm --no-deps health-probe "${args[@]}")"; then
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

# --- K6B logical endpoints ---------------------------------------------------
# One contract, two sources. `declared` reads what the staged Compose project
# renders from the current environment; `active` reads the Config.Env of the
# container that is running. Only the second one is runtime truth, and both must
# agree with the placement the TX deploy helper would choose right now: the same
# canonical fail-closed validators guard the deployment, the read-only readiness
# probe, and this gate, so there is exactly one reviewed allowlist.
#
# Only values are extracted here; every allowlist decision is delegated to
# deploy.sh (sourced by runtime-check.sh, which is the only caller).
tx_endpoint_violation() {
  local message
  if message="$("$@" 2>&1)"; then
    return 0
  fi
  printf '%s' "$message"
}

tx_logical_endpoint_violations() {
  local mode="$1" document="$2" key first second third message
  local violations=""
  while IFS= read -r line; do
    message=""
    IFS=$'\t' read -r key first second third <<< "$line"
    case "$key" in
      error) message="$first" ;;
      frontend.backend-upstream)
        message="$(tx_endpoint_violation validate_http_endpoint TX_BACKEND_UPSTREAM \
          "$first" http://business-api:8087 8087)"
        if [ -z "$message" ] && [ "$first" != "$BACKEND_UPSTREAM_VALUE" ]; then
          message="BACKEND_UPSTREAM=$first is not the expected placement $BACKEND_UPSTREAM_VALUE"
        fi
        ;;
      # /api/ai/ is the only route that leaves TX: exactly one reviewed endpoint.
      frontend.ai-upstream)
        if [ "$first" != "$AI_UPSTREAM_VALUE" ]; then
          message="AI_UPSTREAM=$first is not the expected Yecao ai-service endpoint $AI_UPSTREAM_VALUE"
        fi
        ;;
      business-api.postgres)
        message="$(tx_endpoint_violation validate_database_endpoint TX_BUSINESS_DB \
          "$first" "$second" business-postgres 5432 25432)"
        if [ -z "$message" ] \
          && { [ "$first" != "$BUSINESS_DB_HOST_VALUE" ] || [ "$second" != "$BUSINESS_DB_PORT_VALUE" ]; }; then
          message="POSTGRES_HOST/POSTGRES_PORT=$first:$second is not the expected placement $BUSINESS_DB_HOST_VALUE:$BUSINESS_DB_PORT_VALUE"
        fi
        ;;
      business-api.keycloak-admin)
        message="$(tx_endpoint_violation validate_http_endpoint TX_KEYCLOAK_ADMIN_SERVER_URL \
          "$first" http://keycloak:8080 8080)"
        if [ -z "$message" ] && [ "$first" != "$KEYCLOAK_ADMIN_SERVER_URL_VALUE" ]; then
          message="KEYCLOAK_ADMIN_SERVER_URL=$first is not the expected placement $KEYCLOAK_ADMIN_SERVER_URL_VALUE"
        fi
        ;;
      # The issuer is not a placement endpoint: Keycloak mints `iss` from its
      # public hostname, so this value never moves with the service plane.
      business-api.keycloak-issuer)
        if [ "$first" != "https://auth.wotbtools.com/realms/wotbtools" ]; then
          message="KEYCLOAK_ISSUER_URI=$first is not the public canonical issuer"
        fi
        ;;
      keycloak.db-url)
        message="$(tx_endpoint_violation validate_database_endpoint TX_KEYCLOAK_DB \
          "$first" "$second" keycloak-postgres 5432 15432)"
        if [ -z "$message" ] && [ -z "$third" ]; then
          message="KC_DB_URL=$first:$second names no database"
        elif [ -z "$message" ] \
          && { [ "$first" != "$KEYCLOAK_DB_HOST_VALUE" ] || [ "$second" != "$KEYCLOAK_DB_PORT_VALUE" ]; }; then
          message="KC_DB_URL points at $first:$second instead of the expected placement $KEYCLOAK_DB_HOST_VALUE:$KEYCLOAK_DB_PORT_VALUE"
        fi
        ;;
      keycloak.db-url.invalid)
        message="KC_DB_URL=$first is not a jdbc:postgresql://host:port/database URL"
        ;;
      caddy.frontend-upstream)
        message="$(tx_endpoint_violation validate_caddy_upstream CADDY_FRONTEND_UPSTREAM \
          "$first" wotb-frontend:80 8081)"
        if [ -z "$message" ] && [ "$first" != "$CADDY_FRONTEND_UPSTREAM_VALUE" ]; then
          message="CADDY_FRONTEND_UPSTREAM=$first is not the expected placement $CADDY_FRONTEND_UPSTREAM_VALUE"
        fi
        ;;
      caddy.keycloak-upstream)
        message="$(tx_endpoint_violation validate_caddy_upstream CADDY_KEYCLOAK_UPSTREAM \
          "$first" keycloak:8080 8080)"
        if [ -z "$message" ] && [ "$first" != "$CADDY_KEYCLOAK_UPSTREAM_VALUE" ]; then
          message="CADDY_KEYCLOAK_UPSTREAM=$first is not the expected placement $CADDY_KEYCLOAK_UPSTREAM_VALUE"
        fi
        ;;
      *) message="unhandled logical endpoint record: $key" ;;
    esac
    [ -z "$message" ] || violations+="$message"$'\n'
  done < <(python3 -c '
import json, sys

mode = sys.argv[1]
document = json.load(sys.stdin)
records = []
missing = set()


def emit(*fields):
    records.append("\t".join(str(field) for field in fields))


def environment(service):
    if mode == "declared":
        rendered = (document.get("services") or {}).get(service)
        if rendered is None:
            return None
        return {str(key): str(value) for key, value in (rendered.get("environment") or {}).items()}
    entries = document.get(service)
    if entries is None:
        return None
    return dict(entry.split("=", 1) for entry in entries if "=" in entry)


def extract(record, service, *keys):
    env = environment(service)
    if env is None:
        if service not in missing:
            missing.add(service)
            emit("error", "%s has no %s environment to inspect" % (service, mode))
        return
    emit(record, *(env.get(key, "") for key in keys))


extract("frontend.backend-upstream", "wotb-frontend", "BACKEND_UPSTREAM")
extract("frontend.ai-upstream", "wotb-frontend", "AI_UPSTREAM")
extract("business-api.postgres", "business-api", "POSTGRES_HOST", "POSTGRES_PORT")
extract("business-api.keycloak-admin", "business-api", "KEYCLOAK_ADMIN_SERVER_URL")
extract("business-api.keycloak-issuer", "business-api", "KEYCLOAK_ISSUER_URI")
extract("caddy.frontend-upstream", "caddy", "CADDY_FRONTEND_UPSTREAM")
extract("caddy.keycloak-upstream", "caddy", "CADDY_KEYCLOAK_UPSTREAM")

keycloak_env = environment("keycloak")
if keycloak_env is None:
    emit("error", "keycloak has no %s environment to inspect" % mode)
else:
    prefix = "jdbc:postgresql://"
    url = keycloak_env.get("KC_DB_URL", "")
    authority, _, database = url[len(prefix):].partition("/") if url.startswith(prefix) else ("", "", "")
    host, _, port = authority.rpartition(":")
    if host and port and database:
        emit("keycloak.db-url", host, port, database)
    else:
        emit("keycloak.db-url.invalid", url)

print("\n".join(records))
' "$mode" <<< "$document")
  printf '%s' "${violations%$'\n'}"
}

tx_logical_endpoint_report() {
  local token="$1" mode="$2" document="$3" violations status=0
  # A broken evaluator (unreadable document, missing TX deploy helper state) must
  # fail closed instead of reporting the empty violation list as success.
  violations="$(tx_logical_endpoint_violations "$mode" "$document")" || status=$?
  if [ "$status" -ne 0 ]; then
    echo "$token: FAIL (the $mode endpoint contract could not be evaluated: ${violations:-no output})" >&2
    return 1
  fi
  if [ -z "$violations" ]; then
    echo "$token: PASS"
    return 0
  fi
  echo "$token: FAIL (${violations//$'\n'/; })" >&2
  return 1
}

# The active contract, read from the running containers themselves. `docker
# compose config` would only re-render a hypothetical file from the caller's own
# environment, so it cannot prove what the live containers were started with.
tx_active_endpoint_document() {
  local service container entries document="{"
  for service in wotb-frontend business-api keycloak caddy; do
    container="$(docker compose -f "$LIVE_COMPOSE" ps -q "$service" 2>/dev/null | head -n1 || true)"
    [ -n "$container" ] || { echo "$service has no running container"; return 1; }
    entries="$(docker inspect --format '{{json .Config.Env}}' "$container" 2>/dev/null || true)"
    [ -n "$entries" ] || { echo "the running $service container exposes no environment"; return 1; }
    document+="\"$service\":$entries,"
  done
  printf '%s}' "${document%,}"
}

tx_runtime_check() {
  local source_root="${WOTB_SOURCE_ROOT:-}" compose_json active_endpoints health business_container
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

  # K6B logical endpoints are asserted twice, from two independent sources:
  #   declared - the Compose project the current environment renders right now
  #   active   - the environment of the containers that are actually running
  # A rendered file alone is not runtime truth: the gate workflow can carry the
  # reviewed placement while production still dials the previous one, and both
  # sides would stay healthy. Each value must therefore be inside the reviewed
  # allowlist *and* equal to the placement this invocation expects.
  tx_logical_endpoint_report tx-logical-endpoints-declared declared "$compose_json" || failures=1
  if active_endpoints="$(tx_active_endpoint_document)"; then
    tx_logical_endpoint_report tx-logical-endpoints-active active "$active_endpoints" || failures=1
  else
    echo "tx-logical-endpoints-active: FAIL ($active_endpoints)" >&2
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

  if assert_tx_service_ports <<< "$compose_json"; then
    echo "wireguard-service-plane: PASS"
  else
    echo "wireguard-service-plane: FAIL (core services must preserve exactly the reviewed WireGuard and loopback bindings)" >&2
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
  # must not be emitted until its runtime, reviewed service bindings, and
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
