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
  consent_required            = false
  login_theme                 = "wotbtools"
  always_display_in_console   = true
  frontchannel_logout_enabled = true
  pkce_code_challenge_method  = ""
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

resource "keycloak_openid_client" "android" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "wotbtools-android"
  name      = "WoTBTools Android"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  consent_required             = false
  login_theme                  = "wotbtools"
  always_display_in_console    = true
  frontchannel_logout_enabled  = false
  pkce_code_challenge_method   = "S256"

  valid_redirect_uris = [
    "https://auth.wotbtools.com/android/oauth/callback",
    "com.wotbtools.app:/oauth2redirect",
  ]
  valid_post_logout_redirect_uris = [
    "https://auth.wotbtools.com/android/oauth/callback",
    "com.wotbtools.app:/oauth2redirect",
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

resource "keycloak_openid_client" "e2e" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "wotbtools-e2e"
  name      = "WoTBTools Cutover E2E Gate"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  client_secret_wo             = var.e2e_client_secret
  client_secret_wo_version     = var.e2e_client_secret_version

  lifecycle {
    prevent_destroy = true
  }
}
