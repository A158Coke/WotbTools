# Brokered Web logins do not submit Keycloak's username/password Remember Me form.
# Run this after every external IdP login and let the custom authenticator mark only
# wotbtools-web authentication sessions as remember-me before Keycloak attaches the
# final user session. Android enters the same IdP-level flow but is deliberately a no-op.
resource "keycloak_authentication_flow" "post_broker_session" {
  realm_id    = keycloak_realm.wotbtools.id
  alias       = "wotbtools-post-broker-session"
  description = "Persist brokered browser sessions for wotbtools-web"
}

resource "keycloak_authentication_execution" "post_broker_persistent_browser_session" {
  realm_id          = keycloak_realm.wotbtools.id
  parent_flow_alias = keycloak_authentication_flow.post_broker_session.alias
  authenticator     = "wotbtools-persistent-browser-session"
  requirement       = "REQUIRED"
  priority          = 10
}
