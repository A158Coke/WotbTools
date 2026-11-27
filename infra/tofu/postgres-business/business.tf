resource "postgresql_role" "control_api" {
  name                      = var.business_role_name
  login                     = true
  superuser                 = false
  create_database           = false
  create_role               = false
  replication               = false
  bypass_row_level_security = false
  password_wo               = var.business_role_password
  password_wo_version       = var.business_role_password_version

  lifecycle {
    prevent_destroy = true
  }
}

resource "postgresql_database" "wotb" {
  name     = var.business_database_name
  owner    = postgresql_role.control_api.name
  encoding = "UTF8"
  template = "template0"

  lifecycle {
    prevent_destroy = true
  }
}

resource "postgresql_grant" "control_api_database_access" {
  database    = postgresql_database.wotb.name
  role        = postgresql_role.control_api.name
  object_type = "database"
  privileges  = ["CONNECT", "CREATE", "TEMPORARY"]

  lifecycle {
    prevent_destroy = true
  }
}
