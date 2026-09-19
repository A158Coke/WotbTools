# Compose owns the PostgreSQL process, image, volume, and loopback admin port.
# This root owns only the Business PostgreSQL logical resources: the authoritative
# business state lives in tables created by Flyway, never by OpenTofu.
provider "postgresql" {
  host            = var.postgresql_host
  port            = var.postgresql_port
  database        = "postgres"
  username        = var.postgresql_admin_username
  password        = var.postgresql_admin_password
  sslmode         = "disable"
  connect_timeout = 10
}
