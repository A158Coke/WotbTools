
assert_frontend_backend_capabilities() {
  python3 -c '
import json, sys
try:
    health = json.load(sys.stdin)
    capabilities = health.get("capabilities") if isinstance(health, dict) else None
    ready = health.get("status") == "ok" and isinstance(capabilities, list) and "broadcast-season-contents-v1" in capabilities
except (ValueError, AttributeError):
    ready = False
if not ready:
    raise SystemExit("Business API lacks broadcast-season-contents-v1; keep the existing frontend and rerun after the backend is ready.")
print("frontend-backend-capabilities: PASS")
'
}

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

source "$(dirname "${BASH_SOURCE[0]}")/runtime-business-probes.sh"

edge_tls_probe() {
  local host="$1" url="$2" raw exit_code=0
  local -a args=(--silent --show-error --connect-timeout "$PROBE_CONNECT_TIMEOUT_SEC" \
    --max-time "$PROBE_MAX_TIME_SEC" --output /dev/null --write-out '%{http_code} %{remote_ip}' \
    --resolve "$host:443:$E2E_PUBLIC_IP" "$url")
  EDGE_EXIT=0
  EDGE_STATUS="000"
  EDGE_REMOTE_IP=""
  EDGE_ERROR=""
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

  business_e2e_check || failures=1
  public_tls_check || failures=1

  [ "$failures" -eq 0 ] && echo "QQ_IDP_STATUS=idp-qq=READY"
  if [ "$failures" -ne 0 ]; then
    echo "TX_RUNTIME_NOT_READY" >&2
    return 1
  fi
  echo "TX_RUNTIME_READY"
}
