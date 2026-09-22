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

variable "e2e_client_secret" {
  description = "Runtime-only write-only secret used by the read-only cutover E2E gate client."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "e2e_client_secret_version" {
  description = "Explicit cutover E2E gate client secret rotation version."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[1-9][0-9]*$", trimspace(var.e2e_client_secret_version)))
    error_message = "e2e_client_secret_version must be a positive integer and must change with e2e_client_secret rotation."
  }
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

variable "wargaming_application_id" {
  description = "Wargaming.net application ID; ASIA/EU/NA share this single Blitz-registered application."
  type        = string
  sensitive   = true
  nullable    = false

  validation {
    condition = !contains(
      ["", "bootstrap-not-configured", "dummy", "empty", "juhe", "juhe-qq", "not-configured", "not-used"],
      lower(trimspace(var.wargaming_application_id)),
    )
    error_message = "wargaming_application_id must be a configured Wargaming.net application ID, not a placeholder."
  }
}

variable "qq_client_id" {
  description = "QQ Connect application ID supplied only by the TX deployment environment."
  type        = string
  nullable    = false

  validation {
    condition = !contains(
      ["", "bootstrap-not-configured", "dummy", "empty", "juhe", "juhe-qq", "not-configured"],
      lower(trimspace(var.qq_client_id)),
    )
    error_message = "qq_client_id must be a configured QQ Connect application ID, not a placeholder."
  }
}

variable "qq_client_secret" {
  description = "QQ Connect application secret supplied only through the write-only OpenTofu field."
  type        = string
  sensitive   = true
  nullable    = false

  validation {
    condition = !contains(
      ["", "bootstrap-not-configured", "dummy", "empty", "juhe", "juhe-qq", "not-configured"],
      lower(trimspace(var.qq_client_secret)),
    )
    error_message = "qq_client_secret must be a configured QQ Connect secret, not a placeholder."
  }
}

variable "qq_client_secret_version" {
  description = "Positive QQ Connect secret rotation version; increment it whenever the secret changes."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[1-9][0-9]*$", trimspace(var.qq_client_secret_version)))
    error_message = "qq_client_secret_version must be a positive integer and must change with qq_client_secret rotation."
  }
}

variable "qq_enabled" {
  description = "Whether the production QQ identity provider is enabled."
  type        = bool
  default     = true
  nullable    = false
}
