terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "1.27.0"
    }
  }

  backend "local" {
    # TX-only sensitive state, deliberately separate from the Keycloak
    # PostgreSQL state. The deployment helper creates the parent with mode 0700.
    # The application role password uses the provider write-only field and is
    # therefore not stored in this state.
    path = "/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate"
  }
}
