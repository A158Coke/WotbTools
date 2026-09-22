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

# The control plane must be able to roll back a create that failed before dispatch: the inputs it
# already wrote to temp/jobs/<jobId>/input/ have no job referencing them and must not wait for the
# one-day lifecycle rule. This is a *third* document rather than one more action inside the read/write
# policy above, for the same reason the two documents are duplicated: permission growth on an applied
# policy arrives as an in-place update, which the plan guard refuses by design, and re-deriving the
# whole topology to keep the change "clean" would be a far larger blast radius than one extra grant.
# The scope is the same temp/jobs/* prefix and the only action is delete of an object the control
# plane itself named — `worker` is deliberately left without it, so the parsing host still cannot
# remove anything.
resource "minio_iam_policy" "temporary_workspace_control_api_reclaim" {
  name = "wotbtools-temp-control-api-reclaim"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DeleteOwnTemporaryJobObjects"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = ["${minio_s3_bucket.temporary_workspace.arn}/temp/jobs/*"]
      },
    ]
  })
}

resource "minio_iam_user_policy_attachment" "control_api_reclaim" {
  user_name   = minio_iam_user.control_api.name
  policy_name = minio_iam_policy.temporary_workspace_control_api_reclaim.name
}

# The MinIO Java SDK resolves a bucket's location before every object operation: an
# `s3:GetObject`/`s3:PutObject` caller without `s3:GetBucketLocation` gets
# `403 AccessDenied` on `GET /wotbtools-temp?location=` and the object request is never sent.
# That is a bucket-level action, so it cannot live in the read/write document (whose bucket-level
# statement is prefix-conditioned) and it is a *fourth* document for the same reason the third one
# is separate: growing an applied policy arrives as an in-place update, which the plan guard
# refuses by design. It grants exactly one read-only action on the bucket resource and no object
# access at all — the `temp/jobs/*` object scope is still owned solely by the read/write document
# above, so this document cannot widen what the control plane can read or write.
resource "minio_iam_policy" "temporary_workspace_control_api_location" {
  name = "wotbtools-temp-control-api-location"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadTemporaryWorkspaceBucketLocation"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = [minio_s3_bucket.temporary_workspace.arn]
      },
    ]
  })
}

resource "minio_iam_user_policy_attachment" "control_api_location" {
  user_name   = minio_iam_user.control_api.name
  policy_name = minio_iam_policy.temporary_workspace_control_api_location.name
}
