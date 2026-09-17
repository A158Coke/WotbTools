provider "keycloak" {
  url                      = var.keycloak_url
  realm                    = var.keycloak_admin_realm
  client_id                = var.keycloak_admin_client_id
  username                 = var.keycloak_admin_username
  password                 = var.keycloak_admin_password
  tls_insecure_skip_verify = false
  keycloak_version         = "26.6.4"
}
