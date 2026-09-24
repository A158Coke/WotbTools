terraform {
  backend "pg" {
    schema_name          = "tofu_keycloak_postgres"
    skip_schema_creation = true
  }
}
