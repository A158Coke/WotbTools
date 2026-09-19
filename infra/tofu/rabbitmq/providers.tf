provider "rabbitmq" {
  endpoint = var.rabbitmq_management_endpoint
  username = var.rabbitmq_admin_user
  password = var.rabbitmq_admin_password
}
