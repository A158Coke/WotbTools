resource "keycloak_realm" "wotbtools" {
  realm                         = "wotbtools"
  display_name                  = "WoTBTools"
  enabled                       = true
  registration_allowed          = false
  login_theme                   = "wotbtools"
  reset_password_allowed        = false
  edit_username_allowed         = true
  access_token_lifespan         = "30m"
  sso_session_idle_timeout      = "24h"
  sso_session_max_lifespan      = "168h"
  terraform_deletion_protection = true

  internationalization {
    default_locale    = "zh"
    supported_locales = ["zh", "en", "ru"]
  }

  lifecycle {
    prevent_destroy = true
  }
}
