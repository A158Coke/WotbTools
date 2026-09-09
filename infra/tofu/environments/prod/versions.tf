terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    tencentcloud = {
      source  = "tencentcloudstack/tencentcloud"
      version = "1.83.26"
    }
  }
}
