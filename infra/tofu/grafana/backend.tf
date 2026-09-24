terraform {
  backend "pg" {
    schema_name          = "tofu_grafana"
    skip_schema_creation = true
  }
}
