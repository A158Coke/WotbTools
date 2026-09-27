terraform {
  backend "local" {
    path = "/opt/wotb-tx/keycloak-tofu-state/terraform.tfstate"
  }
}
