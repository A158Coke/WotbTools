output "realm_id" {
  value = keycloak_realm.wotbtools.id
}

output "web_client_id" {
  value = keycloak_openid_client.web.client_id
}

output "admin_api_client_id" {
  value = keycloak_openid_client.admin_api.client_id
}

output "identity_provider_aliases" {
  value = concat(
    [keycloak_oidc_identity_provider.qq.alias],
    [for provider in values(keycloak_oidc_identity_provider.wargaming) : provider.alias],
  )
}
