terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "1.27.0"
    }
  }
}
