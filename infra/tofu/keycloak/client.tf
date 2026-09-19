resource "keycloak_openid_client" "web" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "wotbtools-web"
  name      = "WoTBTools Frontend"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  # Browser client parity with the current production client: the realm login
  # theme applies, the client is always listed in the Account/Admin UI,
  # front-channel logout is on, consent is off, and PKCE is not required
  # ("" is the provider's "no code challenge method" value).
  consent_required            = false
  login_theme                 = "wotbtools"
  always_display_in_console   = true
  frontchannel_logout_enabled = true
  pkce_code_challenge_method  = ""
  # keycloak/keycloak 5.9.0 has no typed field for the Keycloak client attribute
  # "Front-channel logout session required" (frontchannel.logout.session.required,
  # OIDCConfigAttributes in Keycloak 26.6.4). It is declared through the provider's
  # documented extra_config map; Keycloak's own default for it is also true.
  extra_config = {
    "frontchannel.logout.session.required" = "true"
  }

  valid_redirect_uris = [
    "https://wotbtools.com/*",
    "https://*.wotbtools.com/*",
    "http://localhost:5173/*",
    "http://localhost:8088/*",
  ]
  web_origins = [
    "https://wotbtools.com",
    "https://*.wotbtools.com",
    "http://localhost:5173",
    "http://localhost:8088",
  ]

  lifecycle {
    prevent_destroy = true
  }
}

resource "keycloak_openid_client" "admin_api" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "wotbtools-admin-api"
  name      = "WoTBTools Backend Admin API"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  client_secret_wo             = var.keycloak_admin_client_secret
  client_secret_wo_version     = var.keycloak_admin_client_secret_version

  lifecycle {
    prevent_destroy = true
  }
}
