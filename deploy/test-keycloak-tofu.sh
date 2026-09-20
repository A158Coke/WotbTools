#!/usr/bin/env bash
# Fresh-realm Keycloak OpenTofu and least-privilege Admin API smoke.
# This deliberately starts with an empty PostgreSQL database and never imports
# a realm JSON file. Test credentials are local-only fixtures.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOFU_ROOT="$ROOT/infra/tofu/keycloak"
IMAGE="${WOTB_KEYCLOAK_TEST_IMAGE:-wotbtools-keycloak:runtime-contract}"
TOFU="${TOFU_BIN:-tofu}"
NETWORK="wotb-keycloak-tofu-$RANDOM-$$"
DB_NAME="wotb-keycloak-tofu-db-$$"
KC_NAME="wotb-keycloak-tofu-kc-$$"
WORK="$(mktemp -d)"
RETRIES="${WOTB_KEYCLOAK_TOFU_RETRIES:-90}"
INTERVAL_SEC="${WOTB_KEYCLOAK_TOFU_INTERVAL_SEC:-2}"
BOOTSTRAP_PASSWORD="tofu-bootstrap-test-password"
ADMIN_API_SECRET="tofu-admin-api-test-secret"
QQ_CLIENT_ID="tofu-qq-client-id"
QQ_CLIENT_SECRET="tofu-qq-client-secret"
QQ_CLIENT_SECRET_VERSION=1
TEST_USERNAME="tofu-admin-api-test-user"

fail() {
  echo "KEYCLOAK OPENTOFU FAIL: $*" >&2
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$KC_NAME"; then
    docker logs --tail 160 "$KC_NAME" >&2 || true
  fi
  exit 1
}

cleanup() {
  rm -rf -- "$WORK"
  docker rm -f "$KC_NAME" "$DB_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for command_name in docker curl jq; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done
command -v "$TOFU" >/dev/null 2>&1 || fail "$TOFU is required"
[ -d "$TOFU_ROOT" ] || fail "Keycloak OpenTofu root is missing"
[[ "$RETRIES" =~ ^[1-9][0-9]*$ ]] || fail "retry count must be a positive integer"
[[ "$INTERVAL_SEC" =~ ^[1-9][0-9]*$ ]] || fail "retry interval must be a positive integer"

if [ "${WOTB_KEYCLOAK_SKIP_BUILD:-0}" != "1" ]; then
  echo "== Building Keycloak image for fresh OpenTofu smoke =="
  docker build --build-arg BUILD_COMMIT=keycloak-tofu-contract \
    -f "$ROOT/docker/Dockerfile.keycloak" -t "$IMAGE" "$ROOT" >/dev/null
fi

docker run --rm --entrypoint /bin/sh "$IMAGE" -ec '
  test -f /opt/keycloak/providers/keycloak-qq-provider.jar
  test -f /opt/keycloak/providers/keycloak-juhe-qq-provider.jar
  test -f /opt/keycloak/providers/keycloak-wargaming-provider.jar
  test ! -e /opt/keycloak/data/import/wotbtools-realm.json
' || fail "Keycloak image still contains a realm import"

docker network create "$NETWORK" >/dev/null
docker run -d --name "$DB_NAME" --network "$NETWORK" \
  -e POSTGRES_DB=keycloak \
  -e POSTGRES_USER=wotb \
  -e POSTGRES_PASSWORD=tofu-postgres-test-password \
  postgres:18-alpine >/dev/null

for attempt in $(seq 1 "$RETRIES"); do
  if docker exec "$DB_NAME" pg_isready -U wotb -d keycloak >/dev/null 2>&1; then
    echo "PASS: fresh PostgreSQL ready"
    break
  fi
  [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  [ "$attempt" -eq "$RETRIES" ] && fail "fresh PostgreSQL did not become ready"
done

docker run -d --name "$KC_NAME" --network "$NETWORK" \
  -p 127.0.0.1:18080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_PASSWORD" \
  -e KC_DB=postgres \
  -e KC_DB_URL="jdbc:postgresql://$DB_NAME:5432/keycloak" \
  -e KC_DB_USERNAME=wotb \
  -e KC_DB_PASSWORD=tofu-postgres-test-password \
  -e KC_HTTP_ENABLED=true \
  -e KC_HTTP_PORT=8080 \
  -e KC_HOSTNAME_STRICT=false \
  -e WG_APPLICATION_ID=keycloak-tofu-test \
  "$IMAGE" start --optimized >/dev/null

KEYCLOAK_URL="http://127.0.0.1:18080"
for attempt in $(seq 1 "$RETRIES"); do
  if curl -fsS "$KEYCLOAK_URL/realms/master/.well-known/openid-configuration" \
      -o "$WORK/master-discovery.json"; then
    echo "PASS: fresh Keycloak bootstrap realm ready"
    break
  fi
  [ "$attempt" -lt "$RETRIES" ] && sleep "$INTERVAL_SEC"
  [ "$attempt" -eq "$RETRIES" ] && fail "fresh Keycloak did not expose master discovery"
done

export TF_VAR_keycloak_url="$KEYCLOAK_URL"
export TF_VAR_keycloak_admin_realm=master
export TF_VAR_keycloak_admin_client_id=admin-cli
export TF_VAR_keycloak_admin_username=admin
export TF_VAR_keycloak_admin_password="$BOOTSTRAP_PASSWORD"
export TF_VAR_keycloak_admin_client_secret="$ADMIN_API_SECRET"
export TF_VAR_keycloak_admin_client_secret_version=1
export TF_VAR_qq_client_id="$QQ_CLIENT_ID"
export TF_VAR_qq_client_secret="$QQ_CLIENT_SECRET"
export TF_VAR_qq_client_secret_version="$QQ_CLIENT_SECRET_VERSION"

cd "$TOFU_ROOT"
TOFU_WORK_ROOT="$WORK/tofu-root"
mkdir -p "$TOFU_WORK_ROOT"
cp -a "$TOFU_ROOT/." "$TOFU_WORK_ROOT/"
cd "$TOFU_WORK_ROOT"
# The production root declares COS as its backend. A fresh CI realm must use
# disposable local state, so remove only the backend declaration in this
# temporary copy; the committed backend contract is checked separately.
rm -f -- backend.tf
"$TOFU" init -backend=false -input=false >/dev/null
"$TOFU" validate
"$TOFU" plan -input=false -no-color -out="$WORK/plan.tfplan"
bash ./validate-plan.sh "$WORK/plan.tfplan"
"$TOFU" apply -input=false -auto-approve "$WORK/plan.tfplan"
"$TOFU" plan -input=false -no-color -out="$WORK/second-plan.tfplan"
bash ./validate-plan.sh "$WORK/second-plan.tfplan"
if jq -e 'any(.resource_changes[]?; ((.change.actions // []) | any(. != "no-op")))' \
    < <("$TOFU" show -json "$WORK/second-plan.tfplan") >/dev/null; then
  fail "fresh realm second plan is not a no-op"
fi
echo "PASS: fresh realm apply and second plan no-op"

token() {
  local realm="$1" client_id="$2" output="$3" grant_type="$4"
  shift 4
  curl -fsS -X POST "$KEYCLOAK_URL/realms/$realm/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "grant_type=$grant_type" \
    --data-urlencode "client_id=$client_id" "$@" > "$output"
  jq -er '.access_token' "$output"
}

BOOTSTRAP_TOKEN="$(token master admin-cli "$WORK/bootstrap-token.json" password \
  --data-urlencode 'username=admin' --data-urlencode "password=$BOOTSTRAP_PASSWORD")"
SERVICE_TOKEN="$(token wotbtools wotbtools-admin-api "$WORK/service-token.json" client_credentials \
  --data-urlencode "client_secret=$ADMIN_API_SECRET")"
echo "PASS: client_credentials token obtained"

curl -fsS "$KEYCLOAK_URL/realms/wotbtools/.well-known/openid-configuration" \
  > "$WORK/wotbtools-discovery.json"
jq -e '
  (.issuer | endswith("/realms/wotbtools")) and
  (.authorization_endpoint | contains("/protocol/openid-connect/auth")) and
  (.token_endpoint | contains("/protocol/openid-connect/token"))
' "$WORK/wotbtools-discovery.json" >/dev/null \
  || fail "wotbtools OIDC discovery does not expose the expected issuer and endpoints"
echo "PASS: wotbtools OIDC discovery and token/auth endpoints"

api() {
  local expected="$1" method="$2" url="$3" bearer="$4" output="$5"
  shift 5
  local status
  status="$(curl -sS -o "$output" -w '%{http_code}' -X "$method" \
    -H "Authorization: Bearer $bearer" -H 'Content-Type: application/json' "$@" "$url")"
  [ "$status" = "$expected" ] || fail "$method $url returned HTTP $status, expected $expected: $(jq -c . "$output" 2>/dev/null || tr '\n' ' ' < "$output")"
}

api 201 POST "$KEYCLOAK_URL/admin/realms/wotbtools/users" "$BOOTSTRAP_TOKEN" "$WORK/create-user.json" \
  --data-raw "{\"username\":\"$TEST_USERNAME\",\"enabled\":true,\"emailVerified\":true}"
TEST_USER_ID="$(api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/users?username=$TEST_USERNAME" "$SERVICE_TOKEN" "$WORK/users.json" >/dev/null; jq -er '.[0].id' "$WORK/users.json")"
echo "PASS: search users"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/users/count?search=$TEST_USERNAME" "$SERVICE_TOKEN" "$WORK/count.json"
jq -e 'tonumber >= 1' "$WORK/count.json" >/dev/null || fail "user count did not include the test user"
echo "PASS: count users"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/users/$TEST_USER_ID" "$SERVICE_TOKEN" "$WORK/user.json"
jq -e --arg username "$TEST_USERNAME" '.username == $username' "$WORK/user.json" >/dev/null \
  || fail "get user returned the wrong user"
echo "PASS: get user"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/users/$TEST_USER_ID/federated-identity" "$SERVICE_TOKEN" "$WORK/federated.json"
echo "PASS: federated identities query"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/roles/booster" "$SERVICE_TOKEN" "$WORK/role.json"
ROLE_ID="$(jq -er '.id' "$WORK/role.json")"
api 204 POST "$KEYCLOAK_URL/admin/realms/wotbtools/users/$TEST_USER_ID/role-mappings/realm" "$SERVICE_TOKEN" "$WORK/add-role.json" \
  --data-raw "[{\"id\":\"$ROLE_ID\",\"name\":\"booster\",\"composite\":false,\"clientRole\":false,\"containerId\":\"wotbtools\"}]"
api 204 DELETE "$KEYCLOAK_URL/admin/realms/wotbtools/users/$TEST_USER_ID/role-mappings/realm" "$SERVICE_TOKEN" "$WORK/remove-role.json" \
  --data-raw "[{\"id\":\"$ROLE_ID\",\"name\":\"booster\",\"composite\":false,\"clientRole\":false,\"containerId\":\"wotbtools\"}]"
echo "PASS: ordinary realm role add/remove"

api 204 DELETE "$KEYCLOAK_URL/admin/realms/wotbtools/users/$TEST_USER_ID" "$SERVICE_TOKEN" "$WORK/delete-user.json"
echo "PASS: delete user"

client_id() {
  local client_id_value="$1" output="$2"
  api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/clients?clientId=$client_id_value" \
    "$BOOTSTRAP_TOKEN" "$output"
  jq -er '.[0].id' "$output"
}

WEB_CLIENT_ID="$(client_id wotbtools-web "$WORK/web-client.json")"
ADMIN_API_CLIENT_ID="$(client_id wotbtools-admin-api "$WORK/admin-api-client.json")"
REALM_MANAGEMENT_CLIENT_ID="$(client_id realm-management "$WORK/realm-management-client.json")"
SERVICE_ACCOUNT_ID="$(api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/users?username=service-account-wotbtools-admin-api" \
  "$BOOTSTRAP_TOKEN" "$WORK/service-account.json" >/dev/null; jq -er '.[0].id' "$WORK/service-account.json")"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/clients/$WEB_CLIENT_ID" \
  "$BOOTSTRAP_TOKEN" "$WORK/web-client.json"
jq -e '
  .clientId == "wotbtools-web" and
  .enabled == true and
  .publicClient == true and
  .serviceAccountsEnabled == false and
  .standardFlowEnabled == true and
  .implicitFlowEnabled == false and
  .directAccessGrantsEnabled == false and
  .consentRequired == false and
  .alwaysDisplayInConsole == true and
  .frontchannelLogout == true and
  .attributes.login_theme == "wotbtools" and
  .attributes["frontchannel.logout.session.required"] == "true" and
  ((.attributes["pkce.code.challenge.method"] // "") == "") and
  ((.redirectUris // []) | sort) == [
    "http://localhost:5173/*",
    "http://localhost:8088/*",
    "https://*.wotbtools.com/*",
    "https://wotbtools.com/*"
  ] and
  ((.webOrigins // []) | sort) == [
    "http://localhost:5173",
    "http://localhost:8088",
    "https://*.wotbtools.com",
    "https://wotbtools.com"
  ]
' "$WORK/web-client.json" >/dev/null \
  || fail "wotbtools-web runtime representation changed its browser client contract"
echo "PASS: wotbtools-web redirect, browser-flow, theme, always-display, front-channel logout, PKCE and consent contract"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/clients/$ADMIN_API_CLIENT_ID" \
  "$BOOTSTRAP_TOKEN" "$WORK/admin-api-client.json"
jq -e '
  .clientId == "wotbtools-admin-api" and
  .enabled == true and
  .publicClient == false and
  .serviceAccountsEnabled == true and
  .standardFlowEnabled == false and
  .implicitFlowEnabled == false and
  .directAccessGrantsEnabled == false and
  ((.redirectUris // []) | length) == 0 and
  ((.webOrigins // []) | length) == 0
' "$WORK/admin-api-client.json" >/dev/null \
  || fail "admin API client runtime representation has an unsafe browser or flow setting"
echo "PASS: admin API client is confidential service-account-only without redirect flow"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/roles/default-roles-wotbtools/composites" \
  "$BOOTSTRAP_TOKEN" "$WORK/default-roles.json"
jq -e 'any(.[]; .name == "wotbtools-user")' "$WORK/default-roles.json" >/dev/null \
  || fail "default-roles-wotbtools does not include wotbtools-user"
echo "PASS: default wotbtools-user role"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/users/$SERVICE_ACCOUNT_ID/role-mappings/clients/$REALM_MANAGEMENT_CLIENT_ID" \
  "$BOOTSTRAP_TOKEN" "$WORK/admin-api-roles.json"
jq -e '([.[].name] | sort) == ["manage-users", "query-users", "view-realm"]' \
  "$WORK/admin-api-roles.json" >/dev/null \
  || fail "service account roles are not exactly the approved minimal set"
if jq -e 'any(.[].name; . == "realm-admin")' "$WORK/admin-api-roles.json" >/dev/null; then
  fail "service account must not have realm-admin"
fi
echo "PASS: service account has only manage-users/query-users/view-realm"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/clients/$WEB_CLIENT_ID/protocol-mappers/models" \
  "$BOOTSTRAP_TOKEN" "$WORK/mappers.json"
jq -e '([.[].name] | sort) == ["display-name-mapper", "wotb-account-id-mapper", "wotb-nickname-mapper", "wotb-region-mapper", "wotb-verified-mapper"]' \
  "$WORK/mappers.json" >/dev/null || fail "wotbtools-web mapper set is incomplete"

api 200 GET "$KEYCLOAK_URL/admin/realms/wotbtools/identity-provider/instances" "$BOOTSTRAP_TOKEN" "$WORK/idps.json"
jq -e '([.[].alias] | sort) == ["idp-qq", "wargaming-asia", "wargaming-eu", "wargaming-na"]' "$WORK/idps.json" >/dev/null \
  || fail "fresh realm IdP aliases are not the approved TX set"
jq -e 'all(.[]; .alias != "qq" and .alias != "juhe-qq")' "$WORK/idps.json" >/dev/null \
  || fail "fresh TX realm must not create legacy QQ aliases"
jq -e --arg qq_client_id "$QQ_CLIENT_ID" '
  any(.[];
    .alias == "idp-qq" and
    .providerId == "qq" and
    .enabled == true and
    .config.clientId == $qq_client_id and
    .config.clientId != "bootstrap-not-configured" and
    .config.authorizationUrl == "https://graph.qq.com/oauth2.0/authorize" and
    .config.tokenUrl == "https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1" and
    .config.userInfoUrl == "https://graph.qq.com/user/get_user_info" and
    .config.clientAuthMethod == "client_secret_post"
  ) and
  all(.[] | select(.providerId == "wargaming"); .config.region != null)
' \
  "$WORK/idps.json" >/dev/null || fail "QQ/Wargaming provider representation is incomplete"
echo "PASS: realm, client, mapper, default-role, QQ IdP Admin API representation, and structural config"

while IFS= read -r alias; do
  [ -n "$alias" ] || continue
  broker_status="$(curl -sS -o "$WORK/broker-$alias.json" -w '%{http_code}' \
    "$KEYCLOAK_URL/realms/wotbtools/broker/$alias/endpoint")"
  [ "$broker_status" != 404 ] || fail "enabled IdP broker endpoint is missing for $alias"
done < <(jq -r '.[] | select(.enabled == true) | .alias' "$WORK/idps.json")
echo "PASS: enabled IdP broker endpoints are exposed"

expect_forbidden() {
  local method="$1" url="$2" output="$3"
  shift 3
  api 403 "$method" "$url" "$SERVICE_TOKEN" "$output" "$@"
}

expect_forbidden PUT "$KEYCLOAK_URL/admin/realms/wotbtools" "$WORK/negative-realm.json" \
  --data-raw '{"enabled":true}'
expect_forbidden POST "$KEYCLOAK_URL/admin/realms/wotbtools/clients" "$WORK/negative-client-create.json" \
  --data-raw '{"clientId":"must-not-be-created","enabled":true}'
expect_forbidden DELETE "$KEYCLOAK_URL/admin/realms/wotbtools/clients/$WEB_CLIENT_ID" "$WORK/negative-client-delete.json"
expect_forbidden POST "$KEYCLOAK_URL/admin/realms/wotbtools/identity-provider/instances" "$WORK/negative-idp-create.json" \
  --data-raw '{"alias":"must-not-be-created","providerId":"oidc"}'
expect_forbidden DELETE "$KEYCLOAK_URL/admin/realms/wotbtools/identity-provider/instances/idp-qq" "$WORK/negative-idp-delete.json"
echo "PASS: realm/client/IdP mutation attempts return 403"

echo "KEYCLOAK_OPENTOFU_SMOKE_PASS"
