variable "rabbitmq_management_endpoint" {
  description = "TX-local RabbitMQ Management API endpoint. This root must never connect through a public or WireGuard address."
  type        = string
  default     = "http://127.0.0.1:15672"

  validation {
    condition     = var.rabbitmq_management_endpoint == "http://127.0.0.1:15672"
    error_message = "rabbitmq_management_endpoint must remain http://127.0.0.1:15672."
  }
}

variable "rabbitmq_admin_user" {
  description = "RabbitMQ bootstrap administrator used only by Compose and this TX-local provider."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "rabbitmq_admin_password" {
  description = "RabbitMQ bootstrap administrator password; supplied through TF_VAR_rabbitmq_admin_password, never tfvars."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "control_api_password" {
  description = "Password for the control-api publisher identity. Sensitive TX-local provider state is root-only."
  type        = string
  sensitive   = true
  nullable    = false
}

variable "parser_worker_password" {
  description = "Password for the parser-worker consumer identity. Sensitive TX-local provider state is root-only."
  type        = string
  sensitive   = true
  nullable    = false
}
