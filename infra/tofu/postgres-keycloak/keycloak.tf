resource "postgresql_role" "keycloak" {
  name                      = var.keycloak_role_name
  login                     = true
  superuser                 = false
  create_database           = false
  create_role               = false
  replication               = false
  bypass_row_level_security = false
  password_wo               = var.keycloak_role_password
  password_wo_version       = var.keycloak_role_password_version

  lifecycle {
    prevent_destroy = true
  }
}

resource "postgresql_database" "keycloak" {
  name     = var.keycloak_database_name
  owner    = postgresql_role.keycloak.name
  encoding = "UTF8"
  template = "template0"

  lifecycle {
    prevent_destroy = true
  }
}

resource "postgresql_grant" "keycloak_database_access" {
  database    = postgresql_database.keycloak.name
  role        = postgresql_role.keycloak.name
  object_type = "database"
  privileges  = ["CONNECT", "CREATE", "TEMPORARY"]

  lifecycle {
    prevent_destroy = true
  }
}
