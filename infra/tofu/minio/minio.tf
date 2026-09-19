resource "minio_s3_bucket" "temporary_workspace" {
  bucket = "wotbtools-temp"
  acl    = "private"

  lifecycle {
    prevent_destroy = true
  }
}

resource "minio_s3_bucket_lifecycle" "temporary_jobs" {
  bucket = minio_s3_bucket.temporary_workspace.bucket

  rule {
    id     = "expire-temp-jobs-after-one-day"
    status = "Enabled"

    filter {
      prefix = "temp/jobs/"
    }

    expiration {
      days = 1
    }
  }
}

resource "minio_iam_user" "worker" {
  name   = var.worker_access_key
  secret = var.worker_secret_key
}

resource "minio_iam_policy" "temporary_workspace_worker" {
  name = "wotbtools-temp-worker"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListTemporaryJobObjects"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [minio_s3_bucket.temporary_workspace.arn]
        Condition = {
          StringLike = {
            "s3:prefix" = ["temp/jobs/*"]
          }
        }
      },
      {
        Sid      = "ReadWriteTemporaryJobObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${minio_s3_bucket.temporary_workspace.arn}/temp/jobs/*"]
      },
    ]
  })
}

resource "minio_iam_user_policy_attachment" "worker" {
  user_name   = minio_iam_user.worker.name
  policy_name = minio_iam_policy.temporary_workspace_worker.name
}
