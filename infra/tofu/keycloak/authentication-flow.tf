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
