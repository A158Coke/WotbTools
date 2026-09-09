variable "region" {
  description = "Tencent Cloud region containing the production COS bucket."
  type        = string
  default     = "ap-shanghai"
}

variable "bucket_name" {
  description = "Existing production COS bucket managed by this configuration."
  type        = string
  default     = "wotbtools-prod-artifacts-1478073677"
}
