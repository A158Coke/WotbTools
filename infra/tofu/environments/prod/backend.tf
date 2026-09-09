terraform {
  backend "s3" {
    bucket = "wotbtools-prod-tofu-state-1478073677"
    key    = "wotbtools/prod/terraform.tfstate"
    region = "ap-shanghai"

    # Tencent COS exposes an S3-compatible endpoint, not the AWS STS/IAM APIs.
    endpoints = {
      s3 = "https://cos.ap-shanghai.myqcloud.com"
    }

    # COS recommends virtual-hosted-style access. Path-style access can be
    # rejected for newer buckets, so keep it explicitly disabled.
    use_path_style = false

    # These checks are AWS-specific and are not provided by COS.
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true

    # COS is a non-AWS S3-compatible implementation; avoid AWS checksum
    # requirements that are not needed for this backend.
    skip_s3_checksum = true

    # COS conditional-object locking compatibility is not established here.
    # GitHub Actions serializes production plan workflows instead; this is not
    # a replacement for a distributed backend lock.
    use_lockfile = false
  }
}
