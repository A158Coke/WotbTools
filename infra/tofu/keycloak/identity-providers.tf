# `idp-qq` owns the QQ App Key as plain desired state. The write-only pair is
# deliberately not used: the provider only sends a write-only secret when its
# companion rotation version changes, so that shape makes a version (or an
# equivalent counter/hash) the owner of "did the secret change?". The QQ App Key
# has exactly one source of truth - the value the TX deployment injects - so the
# secret is ordinary desired state here: every plan diffs the injected value
# against state and every apply converges idp-qq to it.
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

  extra_config = {
    clientAuthMethod = "client_secret_post"
  }

  lifecycle {
    prevent_destroy = true
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
  # the real broker flow and keeps reading WG_APPLICATION_ID from the Keycloak
  # runtime environment. The representation's client_id still carries the real
  # Blitz application ID so the IdP representation is not a placeholder.
  realm        = keycloak_realm.wotbtools.id
  alias        = each.value.alias
  display_name = each.value.display_name
  provider_id  = "wargaming"
  client_id    = var.wargaming_application_id
  # Wargaming is a custom SPI provider. These fixed values only satisfy the
  # official OIDC resource schema and are not production credentials.
  client_secret_wo         = "not-used"
  client_secret_wo_version = "1"
  authorization_url        = "https://unused.invalid"
  token_url                = "https://unused.invalid"

  extra_config = {
    region = each.value.region
  }

  # Wargaming activation is also operator-owned; OpenTofu must not enforce a
  # repository-selected enabled/disabled state after bootstrap.
  lifecycle {
    ignore_changes = [
      enabled,
    ]
  }
}
