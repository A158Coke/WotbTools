resource "keycloak_oidc_identity_provider" "qq" {
  realm         = keycloak_realm.wotbtools.id
  alias         = "idp-qq"
  display_name  = "QQ"
  provider_id   = "qq"
  client_id     = var.qq_client_id
  client_secret = var.qq_client_secret
  enabled       = var.qq_enabled

  authorization_url = "https://graph.qq.com/oauth2.0/authorize"
  token_url         = "https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1"
  user_info_url     = "https://graph.qq.com/user/get_user_info"
  default_scopes    = "get_user_info"

  post_broker_login_flow_alias = keycloak_authentication_flow.post_broker_session.alias

  extra_config = {
    clientAuthMethod = "client_secret_post"
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    keycloak_authentication_execution.post_broker_persistent_browser_session,
  ]
}

locals {
  wargaming_identity_providers = {
    asia = {
      alias        = "wargaming-asia"
      display_name = "Wargaming.net Asia"
      region       = "ASIA"
    }
    eu = {
      alias        = "wargaming-eu"
      display_name = "Wargaming.net Europe"
      region       = "EU"
    }
    na = {
      alias        = "wargaming-na"
      display_name = "Wargaming.net North America"
      region       = "NA"
    }
  }
}

resource "keycloak_oidc_identity_provider" "wargaming" {
  for_each = local.wargaming_identity_providers

  realm        = keycloak_realm.wotbtools.id
  alias        = each.value.alias
  display_name = each.value.display_name
  provider_id  = "wargaming"
  client_id    = var.wargaming_application_id
  client_secret_wo         = "not-used"
  client_secret_wo_version = "1"
  authorization_url        = "https://unused.invalid"
  token_url                = "https://unused.invalid"

  post_broker_login_flow_alias = keycloak_authentication_flow.post_broker_session.alias

  extra_config = {
    region = each.value.region
  }

  lifecycle {
    ignore_changes = [
      enabled,
    ]
  }

  depends_on = [
    keycloak_authentication_execution.post_broker_persistent_browser_session,
  ]
}
