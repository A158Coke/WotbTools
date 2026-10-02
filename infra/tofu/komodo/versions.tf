terraform {
  required_version = ">= 1.12.6, < 1.14.0"

  required_providers {
    tencentcloud = {
      source  = "tencentcloudstack/tencentcloud"
      version = "1.83.11"
    }
  }

  backend "local" {
    path = "/opt/komodo/tofu-state/terraform.tfstate"
  }
}
