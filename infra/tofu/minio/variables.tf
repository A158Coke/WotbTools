variable "minio_server" {
  description = "WireGuard-only MinIO API endpoint reachable from Yecao."
  type        = string
  default     = "10.20.0.2:9000"
}

variable "minio_root_user" {
  description = "MinIO root user for bootstrap and OpenTofu administration."
  type        = string
  sensitive   = true
}

variable "minio_root_password" {
  description = "MinIO root password for bootstrap and OpenTofu administration."
  type        = string
  sensitive   = true
}

variable "worker_access_key" {
  description = "Pre-provisioned worker access key; this is the MinIO IAM user name."
  type        = string
  sensitive   = true
}

variable "worker_secret_key" {
  description = "Pre-provisioned worker secret key. Sensitive provider state is protected on Yecao."
  type        = string
  sensitive   = true
}
