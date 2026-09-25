terraform {
  backend "local" {
    path = "/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate"
  }
}
