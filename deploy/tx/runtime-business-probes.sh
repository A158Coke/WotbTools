#!/usr/bin/env bash
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
