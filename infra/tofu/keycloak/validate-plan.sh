#!/usr/bin/env bash
set -euo pipefail

plan_file="${1:-plan.tfplan}"
TOFU="${TOFU_BIN:-tofu}"
[ -f "$plan_file" ] || {
  echo "OpenTofu Keycloak plan file is missing: $plan_file" >&2
  exit 1
}

plan_json="$("$TOFU" show -json "$plan_file")" || {
  echo "Unable to read the Keycloak OpenTofu plan as JSON." >&2
  exit 1
}

if ! jq -e '
  type == "object" and
  (.resource_changes | type == "array") and
  all(.resource_changes[];
    type == "object" and
    (.address | type == "string") and
    (.change | type == "object") and
    (.change.actions | type == "array") and
    all(.change.actions[]; type == "string")
  )
' <<< "$plan_json" >/dev/null; then
  echo "The Keycloak OpenTofu plan JSON is malformed or missing resource changes." >&2
  exit 1
fi

protected_realm_client_deletion="$(jq -r '
  any(.resource_changes[]?;
    (.address == "keycloak_realm.wotbtools" or
     .address == "keycloak_openid_client.web" or
     .address == "keycloak_openid_client.admin_api" or
     .address == "keycloak_openid_client.e2e") and
    ((.change.actions // []) | index("delete") != null)
  )
' <<< "$plan_json")" || {
  echo "Unable to evaluate the Keycloak realm/client deletion policy." >&2
  exit 1
}
if [[ "$protected_realm_client_deletion" == true ]]; then
  echo "The Keycloak plan deletes or replaces a protected realm/client resource." >&2
  jq -r '.resource_changes[] | select((.change.actions // []) | index("delete") != null) | "BLOCKER: \(.address) actions=\(.change.actions)"' <<< "$plan_json" >&2
  exit 1
fi

identity_provider_deletion="$(jq -r '
  any(.resource_changes[]?;
    (.address | startswith("keycloak_oidc_identity_provider.")) and
    ((.change.actions // []) | index("delete") != null)
  )
' <<< "$plan_json")" || {
  echo "Unable to evaluate the Keycloak identity-provider deletion policy." >&2
  exit 1
}
if [[ "$identity_provider_deletion" == true ]]; then
  echo "The Keycloak plan deletes an identity provider; refusing unexpected IdP deletion." >&2
  jq -r '.resource_changes[] | select((.address | startswith("keycloak_oidc_identity_provider.")) and ((.change.actions // []) | index("delete") != null)) | "BLOCKER: \(.address) actions=\(.change.actions)"' <<< "$plan_json" >&2
  exit 1
fi

# No realm-role deletion rule lives here on purpose. Role membership is desired
# state, so removing a role from `roles.tf` is a reviewed change that the plan
# itself must expose (and is never exempted per role name). The rules above and
# below own identity destruction (realm, clients, identity providers) and
# unexpected mass replacement instead.

replacement_count="$(jq '[.resource_changes[]? | select((.change.actions // []) | index("delete") != null and index("create") != null)] | length' <<< "$plan_json")" || {
  echo "Unable to count Keycloak resource replacements in the OpenTofu plan." >&2
  exit 1
}
if [ "$replacement_count" -gt 3 ]; then
  echo "The Keycloak plan contains unexpected mass resource replacement ($replacement_count resources)." >&2
  exit 1
fi

echo "Keycloak OpenTofu plan safety guard passed."
