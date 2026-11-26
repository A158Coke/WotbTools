resource "keycloak_realm_events" "wotbtools" {
  realm_id = keycloak_realm.wotbtools.id

  events_enabled = true
  events_expiration = 604800

  enabled_event_types = [
    "LOGIN",
    "LOGIN_ERROR",
    "LOGOUT",
    "LOGOUT_ERROR",
    "IDENTITY_PROVIDER_LOGIN",
    "IDENTITY_PROVIDER_LOGIN_ERROR",
    "IDENTITY_PROVIDER_FIRST_LOGIN",
  ]

  admin_events_enabled         = true
  admin_events_details_enabled = false

  events_listeners = ["jboss-logging"]
}
