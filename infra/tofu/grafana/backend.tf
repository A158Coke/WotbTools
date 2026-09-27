terraform {
  backend "local" {
    path = "/opt/wotb/grafana-tofu-state/terraform.tfstate"
  }
}
