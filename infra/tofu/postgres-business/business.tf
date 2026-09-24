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

# Flyway runs as the database owner, which already holds schema-level DDL
# privileges. This grant is the explicit runtime contract for the future
# Control API connection; it deliberately grants no schema or table objects,
# because Flyway remains the single owner of the application schema.
resource "postgresql_grant" "control_api_database_access" {
  database    = postgresql_database.wotb.name
  role        = postgresql_role.control_api.name
  object_type = "database"
  privileges  = ["CONNECT", "CREATE", "TEMPORARY"]

  lifecycle {
    prevent_destroy = true
  }
}

# The remote-state role is deliberately separate from the application role.
# It owns only the dedicated state database and its backend schemas.
resource "postgresql_role" "tofu_state" {
  name                      = var.tofu_state_role_name
  login                     = true
  superuser                 = false
  create_database           = false
  create_role               = false
  replication               = false
  bypass_row_level_security = false
  password_wo               = var.tofu_state_role_password
  password_wo_version       = var.tofu_state_role_password_version

  lifecycle {
    prevent_destroy = true
  }
}

resource "postgresql_database" "tofu_state" {
  name     = var.tofu_state_database_name
  owner    = postgresql_role.tofu_state.name
  encoding = "UTF8"
  template = "template0"

  lifecycle {
    prevent_destroy = true
  }
}

resource "postgresql_grant" "tofu_state_database_access" {
  database    = postgresql_database.tofu_state.name
  role        = postgresql_role.tofu_state.name
  object_type = "database"
  privileges  = ["CONNECT", "CREATE", "TEMPORARY"]

  lifecycle {
    prevent_destroy = true
  }
}

# PostgreSQL grants CONNECT to PUBLIC by default. Revoke that default on the
# dedicated state database, then grant access only to the backend role.
resource "postgresql_grant" "tofu_state_revoke_public_database_access" {
  database    = postgresql_database.tofu_state.name
  role        = "public"
  object_type = "database"
  privileges  = []

  lifecycle {
    prevent_destroy = true
  }
}

# OpenTofu's pg backend stores its shared lock-ID sequence in public. Keep that
# namespace private to the state role while allowing backend sequence creation.
resource "postgresql_grant" "tofu_state_revoke_public_schema_access" {
  database    = postgresql_database.tofu_state.name
  schema      = "public"
  role        = "public"
  object_type = "schema"
  privileges  = []

  lifecycle {
    prevent_destroy = true
  }
}

resource "postgresql_grant" "tofu_state_public_schema_access" {
  database    = postgresql_database.tofu_state.name
  schema      = "public"
  role        = postgresql_role.tofu_state.name
  object_type = "schema"
  privileges  = ["USAGE", "CREATE"]

  lifecycle {
    prevent_destroy = true
  }
}

resource "postgresql_schema" "tofu_state" {
  for_each = toset(var.tofu_state_schema_names)

  database = postgresql_database.tofu_state.name
  name     = each.value
  owner    = postgresql_role.tofu_state.name

  lifecycle {
    prevent_destroy = true
  }
}
