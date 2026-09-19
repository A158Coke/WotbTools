terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    minio = {
      source  = "aminueza/minio"
      version = "3.40.1"
    }
  }

  backend "local" {
    # Yecao-only state. The deployment helper creates its parent directory with
    # mode 0700 because the provider records the worker secret as sensitive state.
    path = "/opt/wotb/minio-tofu-state/terraform.tfstate"
  }
}
