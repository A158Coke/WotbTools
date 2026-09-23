locals {
  realm_roles = {
    "wotbtools-admin" = "WoTBTools admin"
    "wotbtools-user"  = "WoTBTools user"
    "HoF-admin"       = "Hall of Fame administrator"
  }
}

# Realm roles follow desired state: adding or retiring a role is an ordinary
# transition that `tofu plan` must be able to show as a delete. `tofu plan` is
# the destructive-change audit gate, so this resource deliberately carries no
# `prevent_destroy` and no role name is special-cased anywhere.
resource "keycloak_role" "realm" {
  for_each = local.realm_roles

  realm_id    = keycloak_realm.wotbtools.id
  name        = each.key
  description = each.value
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

# The runtime E2E identity holds exactly one realm role. It is assigned
# explicitly instead of relying on `keycloak_default_roles`, because a service
# account user is created with the client and would otherwise depend on apply
# ordering to inherit the realm default role.
resource "keycloak_openid_client_service_account_realm_role" "e2e" {
  realm_id                = keycloak_realm.wotbtools.id
  service_account_user_id = keycloak_openid_client.e2e.service_account_user_id
  role                    = keycloak_role.realm["wotbtools-user"].name

  depends_on = [keycloak_openid_client.e2e]
}
