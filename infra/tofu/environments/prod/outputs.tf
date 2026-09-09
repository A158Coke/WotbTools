output "bucket_name" {
  description = "Managed production COS bucket name."
  value       = tencentcloud_cos_bucket.production_artifacts.bucket
}

output "region" {
  description = "Tencent Cloud region containing the managed COS bucket."
  value       = var.region
}
