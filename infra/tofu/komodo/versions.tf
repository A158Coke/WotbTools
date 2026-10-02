terraform {
  required_version = ">= 1.12.6, < 2.0.0"

  required_providers {
    tencentcloud = {
      source  = "tencentcloudstack/tencentcloud"
      version = "1.83.11"
    }
  }

  # Owner-host local state. The bootstrap marker and the corruption rules that
  # guard it live in `deploy/komodo/reconcile.sh`; no remote or SHA-scoped
  # backend is permitted for the controller plane.
  backend "local" {
    path = "/opt/komodo/tofu-state/terraform.tfstate"
  }
}
