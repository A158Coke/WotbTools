provider "postgresql" {
  host            = var.postgresql_host
  port            = var.postgresql_port
  database        = "postgres"
  username        = var.postgresql_admin_username
  password        = var.postgresql_admin_password
  sslmode         = "disable"
  connect_timeout = 10
}
