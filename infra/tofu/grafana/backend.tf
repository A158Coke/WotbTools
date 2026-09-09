terraform {
  backend "s3" {
    bucket = "wotbtools-prod-tofu-state-1478073677"
    key    = "wotbtools/prod/grafana.tfstate"
    region = "ap-shanghai"

    endpoints = {
      s3 = "https://cos.ap-shanghai.myqcloud.com"
    }

    use_path_style              = false
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_lockfile                = false
  }
}
