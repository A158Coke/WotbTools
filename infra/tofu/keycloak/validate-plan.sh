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

realm_events_changes="$(jq -r '
  [.resource_changes[]? | select(.address == "keycloak_realm_events.wotbtools")] | length
' <<< "$plan_json")" || {
  echo "Unable to evaluate the Keycloak security event logging contract." >&2
  exit 1
}
if [ "$realm_events_changes" -eq 0 ]; then
  echo "Keycloak plan does not touch keycloak_realm_events.wotbtools (security event logging contract not applicable)."
elif [ "$realm_events_changes" -gt 1 ]; then
  echo "The Keycloak plan addresses keycloak_realm_events.wotbtools $realm_events_changes times; it must appear exactly once." >&2
  exit 1
else
  realm_events_violations="$(jq -r '
    [.resource_changes[]? | select(.address == "keycloak_realm_events.wotbtools")][0] as $c
    | ($c.change.actions // []) as $actions
    | ($c.change.after // {}) as $after
    # 布尔与数组一律用 tojson 渲染：jq 的 `//` 把 `false` 当成空值，所以
    # `false // "<absent>"` 会得到 "<absent>"，把「被显式关掉」说成「字段缺失」。
    | [
        (if (($actions | index("delete")) != null)
           then "actions=\($actions) (deleting or replacing this resource silently turns the 190-day security log off)"
           else empty end),
        (if $after.events_enabled == true then empty else "events_enabled=\($after.events_enabled | tojson) (expected true)" end),
        (if $after.admin_events_enabled == true then empty else "admin_events_enabled=\($after.admin_events_enabled | tojson) (expected true)" end),
        (if $after.admin_events_details_enabled == false
           then empty
           else "admin_events_details_enabled=\($after.admin_events_details_enabled | tojson) (expected false: the full resource representation must never be retained)"
           end),
        (if (($after.events_listeners // []) | index("jboss-logging")) != null
           then empty
           else "events_listeners=\($after.events_listeners | tojson) (expected to contain jboss-logging: it is what puts events on stdout)"
           end),
        (if (($after.enabled_event_types // []) | index("LOGIN")) != null
           then empty
           else "enabled_event_types=\($after.enabled_event_types // []) (expected to contain LOGIN)"
           end),
        (if (($after.enabled_event_types // []) | index("LOGIN_ERROR")) != null
           then empty
           else "enabled_event_types=\($after.enabled_event_types // []) (expected to contain LOGIN_ERROR)"
           end)
      ]
    | .[]
  ' <<< "$plan_json")" || {
    echo "Unable to evaluate the Keycloak security event logging contract." >&2
    exit 1
  }
  if [ -n "$realm_events_violations" ]; then
    echo "The planned keycloak_realm_events.wotbtools does not satisfy the security log retention contract." >&2
    while IFS= read -r violation; do
      echo "BLOCKER: keycloak_realm_events.wotbtools $violation" >&2
    done <<< "$realm_events_violations"
    exit 1
  fi
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
