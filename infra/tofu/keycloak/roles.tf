locals {
  realm_roles = {
    "wotbtools-user"   = "WoTBTools user"
    "HoF-admin"        = "Hall of Fame administrator"
    "tournament-admin" = "Tournament administrator"
    "content-admin"    = "Content administrator"
  }
}

resource "keycloak_role" "realm" {
  for_each = local.realm_roles

  realm_id    = keycloak_realm.wotbtools.id
  name        = each.key
  description = each.value
}

resource "keycloak_role" "wotbtools_admin" {
  realm_id    = keycloak_realm.wotbtools.id
  name        = "wotbtools-admin"
  description = "WoTBTools admin"
  composite_roles = [
    keycloak_role.realm["wotbtools-user"].id,
    keycloak_role.realm["HoF-admin"].id,
    keycloak_role.realm["tournament-admin"].id,
    keycloak_role.realm["content-admin"].id,
  ]
}

moved {
  from = keycloak_role.realm["wotbtools-admin"]
  to   = keycloak_role.wotbtools_admin
}

resource "keycloak_default_roles" "wotbtools" {
  realm_id      = keycloak_realm.wotbtools.id
  default_roles = [keycloak_role.realm["wotbtools-user"].name]

  lifecycle {
    prevent_destroy = true
  }
}

data "keycloak_openid_client" "realm_management" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "realm-management"
}

locals {
  admin_api_realm_management_roles = toset([
    "manage-users",
    "query-users",
    "view-realm",
  ])
}

resource "keycloak_openid_client_service_account_role" "admin_api" {
  for_each = local.admin_api_realm_management_roles

  realm_id                = keycloak_realm.wotbtools.id
  service_account_user_id = keycloak_openid_client.admin_api.service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = each.value

  depends_on = [keycloak_openid_client.admin_api]
}

resource "keycloak_openid_client_service_account_realm_role" "e2e" {
  realm_id                = keycloak_realm.wotbtools.id
  service_account_user_id = keycloak_openid_client.e2e.service_account_user_id
  role                    = keycloak_role.realm["wotbtools-user"].name

  depends_on = [keycloak_openid_client.e2e]
}
