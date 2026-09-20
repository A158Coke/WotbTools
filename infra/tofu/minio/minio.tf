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

# Two application identities share the temp/jobs/* workspace. `worker` is the
# Yecao parser-worker (parsing execution plane); `control_api` is the TX replay
# control plane. They hold the same prefix scope on purpose: the prefix layout
# separates object kinds, while the identity separates deployments so one leaked
# credential stays scoped to one host and either side can be rotated alone.
# `worker` is deliberately left with its original resource address and its
# original policy document; extracting a shared policy would rewrite an applied
# resource, which the plan guard rejects as an in-place update.
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

resource "minio_iam_user" "control_api" {
  name   = var.control_api_access_key
  secret = var.control_api_secret_key
}

# Same temp/jobs/* scope as the worker policy. The two documents are duplicated
# instead of shared so each identity's policy can be rotated or dropped alone;
# `test-validate-plan.sh` and the CI MinIO smoke keep both scopes identical.
resource "minio_iam_policy" "temporary_workspace_control_api" {
  name = "wotbtools-temp-control-api"
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

resource "minio_iam_user_policy_attachment" "control_api" {
  user_name   = minio_iam_user.control_api.name
  policy_name = minio_iam_policy.temporary_workspace_control_api.name
}
