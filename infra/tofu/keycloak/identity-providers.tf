resource "keycloak_oidc_identity_provider" "qq" {
  realm        = keycloak_realm.wotbtools.id
  alias        = "idp-qq"
  display_name = "QQ"
  # QQ is bootstrapped before the Open Platform review is complete. The
  # initial disabled value is deliberately ignored after creation so an
  # operator can configure and activate the provider in Keycloak later.
  enabled                  = false
  provider_id              = "qq"
  client_id                = "bootstrap-not-configured"
  client_secret_wo         = "bootstrap-not-configured"
  client_secret_wo_version = "1"
  authorization_url        = "https://graph.qq.com/oauth2.0/authorize"
  token_url                = "https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1"
  user_info_url            = "https://graph.qq.com/user/get_user_info"
  default_scopes           = "get_user_info"

  extra_config = {
    clientAuthMethod = "client_secret_post"
  }

  # These fields belong to the operator after the skeleton is created. The
  # write-only secret and its version are ignored together so a later apply
  # cannot rotate or replace manually configured QQ credentials.
  lifecycle {
    ignore_changes = [
      client_id,
      client_secret_wo,
      client_secret_wo_version,
      enabled,
    ]
  }
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

  # This resource is an adapter for the official Keycloak provider's OIDC
  # schema. Wargaming is not OIDC: the custom provider_id=wargaming SPI owns
  # the real broker flow, and WG_APPLICATION_ID stays in Keycloak runtime env.
  realm        = keycloak_realm.wotbtools.id
  alias        = each.value.alias
  display_name = each.value.display_name
  enabled      = false
  provider_id  = "wargaming"
  client_id    = "not-used"
  # Wargaming is a custom SPI provider. These fixed values only satisfy the
  # official OIDC resource schema and are not production credentials.
  client_secret_wo         = "not-used"
  client_secret_wo_version = "1"
  authorization_url        = "https://unused.invalid"
  token_url                = "https://unused.invalid"

  extra_config = {
    region = each.value.region
  }
}
