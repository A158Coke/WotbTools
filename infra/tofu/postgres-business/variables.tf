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
