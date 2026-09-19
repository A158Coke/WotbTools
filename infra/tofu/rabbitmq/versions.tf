terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    rabbitmq = {
      source  = "cyrilgdn/rabbitmq"
      version = "1.10.1"
    }
  }

  backend "local" {
    # TX-only sensitive state. The deployment helper creates the parent with
    # mode 0700 because the provider stores application passwords in state.
    path = "/opt/wotb-tx/rabbitmq-tofu-state/terraform.tfstate"
  }
}
