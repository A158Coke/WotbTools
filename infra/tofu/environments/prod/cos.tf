resource "tencentcloud_cos_bucket" "production_artifacts" {
  bucket               = var.bucket_name
  acl                  = "private"
  encryption_algorithm = "AES256"
  multi_az             = false
  versioning_enable    = false

  lifecycle_rules {
    expiration {
      days = 1
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
