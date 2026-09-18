variable "keycloak_url" {
  description = "TX-local Keycloak Admin API base URL."
  type        = string
  default     = "http://127.0.0.1:18080"

  validation {
    condition     = var.keycloak_url == "http://127.0.0.1:18080"
    error_message = "keycloak_url must remain the TX-local loopback endpoint."
  }
}

variable "keycloak_admin_realm" {
  description = "Realm used by the bootstrap admin to obtain an Admin API token."
  type        = string
  default     = "master"
}

variable "keycloak_admin_client_id" {
  description = "Bootstrap admin client used only to authenticate OpenTofu."
  type        = string
  default     = "admin-cli"
}

variable "keycloak_admin_username" {
  description = "Runtime-only Keycloak bootstrap admin username."
  type        = string
  default     = "admin"
}

variable "keycloak_admin_password" {
  description = "Runtime-only Keycloak bootstrap admin password."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "keycloak_admin_client_secret" {
  description = "Runtime-only write-only secret used by the backend client_credentials client."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "keycloak_admin_client_secret_version" {
  description = "Explicit runtime client secret rotation version."
  type        = string
  nullable    = false

  validation {
    condition     = trimspace(var.keycloak_admin_client_secret_version) != ""
    error_message = "keycloak_admin_client_secret_version must be non-empty."
  }
}
