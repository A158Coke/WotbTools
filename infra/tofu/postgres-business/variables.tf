variable "postgresql_host" {
  description = "TX-local Business PostgreSQL management endpoint. This root never connects over a public or WireGuard address."
  type        = string
  default     = "127.0.0.1"

  validation {
    condition     = var.postgresql_host == "127.0.0.1"
    error_message = "postgresql_host must remain the TX-local loopback address 127.0.0.1."
  }
}

variable "postgresql_port" {
  description = "Loopback-only host port published by the business-postgres Compose service."
  type        = number
  default     = 25432

  validation {
    condition     = var.postgresql_port == 25432
    error_message = "postgresql_port must remain the loopback-only management port 25432."
  }
}

variable "postgresql_admin_username" {
  description = "Dedicated Business PostgreSQL bootstrap administrator used only by Compose and the TX-local provider."
  type        = string
  default     = "wotb"
}

variable "postgresql_admin_password" {
  description = "TX runtime-only Business PostgreSQL administrator password; set through TF_VAR_postgresql_admin_password, never tfvars."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "business_database_name" {
  description = "Canonical authoritative business database owned by the application role."
  type        = string
  default     = "wotb"
}

variable "business_role_name" {
  description = "Least-privilege PostgreSQL login role used by the future Control API and Flyway runtime."
  type        = string
  default     = "control_api"
}

variable "business_role_password" {
  description = "TX runtime-only application role password; supplied to the provider write-only field and never stored in state."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "business_role_password_version" {
  description = "Non-secret password rotation version. Increment only when business_role_password changes."
  type        = string
  default     = "1"

  validation {
    condition     = trimspace(var.business_role_password_version) != ""
    error_message = "business_role_password_version must be a non-empty rotation version."
  }
}

variable "tofu_state_database_name" {
  description = "Dedicated database for the postgres-keycloak, keycloak, and Grafana OpenTofu remote states."
  type        = string
  default     = "tofu_state"

  validation {
    condition     = var.tofu_state_database_name == "tofu_state"
    error_message = "The OpenTofu state database name is fixed to tofu_state."
  }
}

variable "tofu_state_role_name" {
  description = "Dedicated least-privilege login role for OpenTofu state backends."
  type        = string
  default     = "tofu_state"

  validation {
    condition     = var.tofu_state_role_name == "tofu_state"
    error_message = "The OpenTofu state role name is fixed to tofu_state."
  }
}

variable "tofu_state_role_password" {
  description = "Runtime-only state role password supplied through TF_VAR_tofu_state_role_password, never tfvars."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "tofu_state_role_password_version" {
  description = "Non-secret rotation version for the OpenTofu state role password."
  type        = string
  default     = "1"

  validation {
    condition     = trimspace(var.tofu_state_role_password_version) != ""
    error_message = "tofu_state_role_password_version must be a non-empty rotation version."
  }
}

variable "tofu_state_schema_names" {
  description = "The isolated pg backend schemas used by the managed OpenTofu roots."
  type        = list(string)
  default     = ["tofu_keycloak", "tofu_keycloak_postgres", "tofu_grafana"]

  validation {
    condition = toset(var.tofu_state_schema_names) == toset([
      "tofu_keycloak",
      "tofu_keycloak_postgres",
      "tofu_grafana",
    ])
    error_message = "The OpenTofu state schemas must remain the three approved schema names."
  }
}
