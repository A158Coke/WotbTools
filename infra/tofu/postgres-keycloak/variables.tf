variable "postgresql_host" {
  description = "TX-local PostgreSQL management endpoint. This root never connects over a public or WireGuard address."
  type        = string
  default     = "127.0.0.1"

  validation {
    condition     = var.postgresql_host == "127.0.0.1"
    error_message = "postgresql_host must remain the TX-local loopback address 127.0.0.1."
  }
}

variable "postgresql_port" {
  description = "Loopback-only host port published by the keycloak-postgres Compose service."
  type        = number
  default     = 15432

  validation {
    condition     = var.postgresql_port == 15432
    error_message = "postgresql_port must remain the loopback-only management port 15432."
  }
}

variable "postgresql_admin_username" {
  description = "PostgreSQL administrator role used only by the provider at TX runtime."
  type        = string
  default     = "postgres"
}

variable "postgresql_admin_password" {
  description = "TX runtime-only PostgreSQL administrator password; set through TF_VAR_postgresql_admin_password, never tfvars."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "keycloak_database_name" {
  description = "Dedicated database owned by the Keycloak application role."
  type        = string
  default     = "keycloak"
}

variable "keycloak_role_name" {
  description = "Least-privilege PostgreSQL login role used by Keycloak."
  type        = string
  default     = "keycloak"
}

variable "keycloak_role_password" {
  description = "TX runtime-only Keycloak role password; supplied to the provider write-only field and never stored in state."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "keycloak_role_password_version" {
  description = "Non-secret password rotation version. Increment only when keycloak_role_password changes."
  type        = string
  default     = "1"

  validation {
    condition     = trimspace(var.keycloak_role_password_version) != ""
    error_message = "keycloak_role_password_version must be a non-empty rotation version."
  }
}
