terraform {
  backend "pg" {
    schema_name          = "tofu_keycloak"
    skip_schema_creation = true
  }
}
