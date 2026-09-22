#!/usr/bin/env bash
set -euo pipefail

plan_file="${1:-plan.tfplan}"
TOFU="${TOFU_BIN:-tofu}"
[ -f "$plan_file" ] || {
  echo "OpenTofu Keycloak plan file is missing: $plan_file" >&2
  exit 1
}

plan_json="$("$TOFU" show -json "$plan_file")"
if jq -e '
  any(.resource_changes[]?;
    (.address == "keycloak_realm.wotbtools" or
     .address == "keycloak_openid_client.web" or
     .address == "keycloak_openid_client.admin_api" or
     .address == "keycloak_openid_client.e2e") and
    ((.change.actions // []) | index("delete") != null)
  )
' <<< "$plan_json" >/dev/null; then
  echo "The Keycloak plan deletes or replaces a protected realm/client resource." >&2
  jq -r '.resource_changes[] | select((.change.actions // []) | index("delete") != null) | "BLOCKER: \(.address) actions=\(.change.actions)"' <<< "$plan_json" >&2
  exit 1
fi

if jq -e '
  any(.resource_changes[]?;
    (.address | startswith("keycloak_oidc_identity_provider.")) and
    ((.change.actions // []) | index("delete") != null)
  )
' <<< "$plan_json" >/dev/null; then
  echo "The Keycloak plan deletes an identity provider; refusing unexpected IdP deletion." >&2
  jq -r '.resource_changes[] | select((.address | startswith("keycloak_oidc_identity_provider.")) and ((.change.actions // []) | index("delete") != null)) | "BLOCKER: \(.address) actions=\(.change.actions)"' <<< "$plan_json" >&2
  exit 1
fi

# No realm-role deletion rule lives here on purpose. Role membership is desired
# state, so removing a role from `roles.tf` is a reviewed change that the plan
# itself must expose (and is never exempted per role name). The rules above and
# below own identity destruction (realm, clients, identity providers) and
# unexpected mass replacement instead.

replacement_count="$(jq '[.resource_changes[]? | select((.change.actions // []) | index("delete") != null and index("create") != null)] | length' <<< "$plan_json")"
if [ "$replacement_count" -gt 3 ]; then
  echo "The Keycloak plan contains unexpected mass resource replacement ($replacement_count resources)." >&2
  exit 1
fi

echo "Keycloak OpenTofu plan safety guard passed."
