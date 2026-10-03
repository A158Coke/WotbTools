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

# --- Android client contract, evaluated from the plan JSON only ---------------
# `keycloak_openid_client.android` is a NEW resource: the first production plan
# has no prior state for it, so its change is create-only and must pass. The gate
# fails on delete or replace (["delete"], ["delete","create"], ["create","delete"]):
# recreating the client would rotate its internal Keycloak id and orphan every
# Android session and its mappers.
# Create-vs-no-op asymmetry, stated explicitly because it is the whole point:
# `resource_changes` is NOT a diff-only list - it carries `["no-op"]` entries too
# (see `deploy/tx/keycloak-tofu.sh`, whose green second plan is `all(... | all(. == "no-op"))`,
# and the `boost-role-retirement` fixture in scripts/ci/test-keycloak-tofu-contract.sh).
# So a settled Android client legitimately appears here as a no-op with its full
# `change.after`, and this gate MUST stay green for that plan: the frozen field
# checks below therefore apply to the resource's desired state whatever the action
# is (create / update / no-op all carry `change.after`), and only delete and
# replace are rejected. Never require a create or a non-no-op action here: doing so
# would fail the post-apply second plan and block every future Keycloak deploy.
# An absent android client is equally fine - a plan that does not touch the client
# (an unrelated change, a first plan before the resource exists) stays green.
android_client_changes="$(jq -r '
  [.resource_changes[]? | select(.address == "keycloak_openid_client.android")] | length
' <<< "$plan_json")" || {
  echo "Unable to evaluate the Android Keycloak client contract." >&2
  exit 1
}

android_mapper_changes="$(jq -r '
  [.resource_changes[]? | select(.address | startswith("keycloak_openid_user_attribute_protocol_mapper.wotbtools_android"))] | length
' <<< "$plan_json")" || {
  echo "Unable to evaluate the Android protocol-mapper contract." >&2
  exit 1
}

if [ "$android_client_changes" -eq 0 ]; then
  echo "Keycloak plan does not touch keycloak_openid_client.android (create/update contract not applicable)."
elif [ "$android_client_changes" -gt 1 ]; then
  echo "The Keycloak plan addresses keycloak_openid_client.android $android_client_changes times; the Android client must appear exactly once." >&2
  exit 1
else
  android_violations="$(jq -r '
    [.resource_changes[]? | select(.address == "keycloak_openid_client.android")][0] as $c
    | ($c.change.actions // []) as $actions
    | ($c.change.after // {}) as $after
    | [
        (if (($actions | index("delete")) != null)
           then "actions=\($actions) (a delete/replace would rotate the client id and orphan Android sessions; only the plan that creates or settles this client is approved)"
           else empty end),
        (if $after.client_id == "wotbtools-android" then empty else "client_id=\($after.client_id // "<absent>") (expected wotbtools-android)" end),
        (if $after.access_type == "PUBLIC" then empty else "access_type=\($after.access_type // "<absent>") (expected PUBLIC: a native app cannot hold a client secret)" end),
        (if $after.standard_flow_enabled == true then empty else "standard_flow_enabled=\($after.standard_flow_enabled // "<absent>") (expected true: Authorization Code + PKCE)" end),
        (if $after.implicit_flow_enabled == false then empty else "implicit_flow_enabled=\($after.implicit_flow_enabled // "<absent>") (expected false)" end),
        (if $after.direct_access_grants_enabled == false then empty else "direct_access_grants_enabled=\($after.direct_access_grants_enabled // "<absent>") (expected false: no password grant)" end),
        (if $after.service_accounts_enabled == false then empty else "service_accounts_enabled=\($after.service_accounts_enabled // "<absent>") (expected false: public client, no service account)" end),
        (if $after.pkce_code_challenge_method == "S256" then empty else "pkce_code_challenge_method=\($after.pkce_code_challenge_method // "<absent>") (expected S256: the actual secret of a public native client)" end),
        (if (($after.valid_redirect_uris // []) | sort) == ["com.wotbtools.app:/oauth2redirect", "https://auth.wotbtools.com/android/oauth/callback"]
           then empty
           else "valid_redirect_uris=\(($after.valid_redirect_uris // []) | sort) (expected exactly the two frozen values, with no wildcard)"
           end),
        (if (($after.valid_post_logout_redirect_uris // []) | sort) == ["com.wotbtools.app:/oauth2redirect", "https://auth.wotbtools.com/android/oauth/callback"]
           then empty
           else "valid_post_logout_redirect_uris=\(($after.valid_post_logout_redirect_uris // []) | sort) (expected exactly the two frozen values: the app receives the RP-initiated logout)"
           end),
        (if $after.frontchannel_logout_enabled == false then empty else "frontchannel_logout_enabled=\($after.frontchannel_logout_enabled // "<absent>") (expected false: logout is RP-initiated end-session only)" end),
        (if $after.consent_required == false then empty else "consent_required=\($after.consent_required // "<absent>") (expected false)" end),
        (if $after.login_theme == "wotbtools" then empty else "login_theme=\($after.login_theme // "<absent>") (expected wotbtools)" end),
        (if $after.always_display_in_console == true then empty else "always_display_in_console=\($after.always_display_in_console // "<absent>") (expected true)" end)
      ]
    | .[]
  ' <<< "$plan_json")" || {
    echo "Unable to evaluate the Android Keycloak client contract." >&2
    exit 1
  }
  if [ -n "$android_violations" ]; then
    echo "The planned keycloak_openid_client.android does not satisfy the frozen Android client contract." >&2
    while IFS= read -r violation; do
      echo "BLOCKER: keycloak_openid_client.android $violation" >&2
    done <<< "$android_violations"
    exit 1
  fi
fi

# Reuse the same `local.protocol_mappers` map as the web client, so the five
# claim names are the android client's protocol mappers floor: losing one drops a
# claim the Android app reads. Same create-vs-no-op asymmetry as the client rule
# above: an all-no-op plan still lists every mapper with its full `change.after`,
# so the presence loop passes there, while a delete or replace of any mapper fails
# - hence the loop only requires that the mapper is planned at all (`no-op`
# included) and that its entry is not a deletion. The rule is plan-shaped for the
# same reason as the client contract: it is evaluated only when the plan actually
# touches the Android surface, so a no-op plan, the QQ rotation plan, or any plan
# that does not carry the Android client stays green. Only presence is pinned per
# name (`startswith` and the mapper's own `name`), never the full address, so no
# for_each key syntax is baked into this gate.
if [ "$android_client_changes" -gt 0 ] || [ "$android_mapper_changes" -gt 0 ]; then
  android_mapper_violations="$(jq -r '
    [.resource_changes[]? | select((.address | startswith("keycloak_openid_user_attribute_protocol_mapper.wotbtools_android")))]
    | .[] | (.change.actions // []) as $actions
    | select(($actions | map(. != "no-op")) | any)
    | select(($actions | index("delete")) != null)
    | "BLOCKER: \(.address) actions=\($actions)"
  ' <<< "$plan_json")" || {
    echo "Unable to evaluate the Android protocol-mapper deletion policy." >&2
    exit 1
  }
  if [ -n "$android_mapper_violations" ]; then
    echo "The Keycloak plan deletes or replaces an Android protocol mapper; the app would lose that token claim." >&2
    while IFS= read -r violation; do
      echo "$violation" >&2
    done <<< "$android_mapper_violations"
    exit 1
  fi

  for mapper in display-name-mapper wotb-region-mapper wotb-account-id-mapper wotb-nickname-mapper wotb-verified-mapper; do
    jq -e --arg resource "keycloak_openid_user_attribute_protocol_mapper.wotbtools_android" --arg mapper "$mapper" '
      any(.resource_changes[]?;
        (.address | startswith($resource)) and
        ((.change.actions // []) | index("delete") == null) and
        ((.change.after.name // "") == $mapper)
      )
    ' <<< "$plan_json" >/dev/null || {
      echo "The Keycloak plan is missing the planned Android protocol mapper $mapper; the Android token would lose that claim." >&2
      exit 1
    }
  done
fi

replacement_count="$(jq '[.resource_changes[]? | select((.change.actions // []) | index("delete") != null and index("create") != null)] | length' <<< "$plan_json")" || {
  echo "Unable to count Keycloak resource replacements in the OpenTofu plan." >&2
  exit 1
}
if [ "$replacement_count" -gt 3 ]; then
  echo "The Keycloak plan contains unexpected mass resource replacement ($replacement_count resources)." >&2
  exit 1
fi

echo "Keycloak OpenTofu plan safety guard passed."
