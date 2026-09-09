resource "tencentcloud_cos_bucket" "production_artifacts" {
  bucket               = var.bucket_name
  acl                  = "private"
  encryption_algorithm = "AES256"
  # The provider does not import this optional ForceNew field into state;
  # omitting its false default avoids a replacement-only normalization diff.
  versioning_enable = false

  tags = {
    wotbtools = "wotbtools-bucket"
  }

  lifecycle_rules {
    expiration {
      days = 1
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
