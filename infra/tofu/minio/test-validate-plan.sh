#!/usr/bin/env bash
# Deterministic plan-safety policy contract for the MinIO root.
# It needs no MinIO server: tofu is stubbed to replay fixture plan JSON.
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat > "$WORK/bin/tofu" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "$#" -eq 3 ] && [ "$1" = show ] && [ "$2" = -json ] || exit 2
cat "$3"
EOF
chmod 700 "$WORK/bin/tofu"

write_plan() {
  local name="$1" json="$2"
  printf '%s\n' "$json" > "$WORK/$name.tfplan"
}

assert_passes() {
  local name="$1"
  shift
  PATH="$WORK/bin:$PATH" bash "$ROOT/validate-plan.sh" "$WORK/$name.tfplan" "$@" >/dev/null
}

assert_rejects() {
  local name="$1" expected="$2"
  shift 2
  local reason
  if reason="$(PATH="$WORK/bin:$PATH" bash "$ROOT/validate-plan.sh" "$WORK/$name.tfplan" "$@" 2>&1)"; then
    echo "ERROR: $name should have been rejected." >&2
    exit 1
  fi
  # A fixture that merely crashes the validator must never count as a rejection,
  # and each fixture must be refused by the policy rule it is written to cover.
  if ! grep -Fq -- "$expected" <<< "$reason"; then
    echo "ERROR: $name was not rejected by the expected policy rule." >&2
    echo "       expected to find: $expected" >&2
    printf '       actual: %s\n' "$reason" >&2
    exit 1
  fi
}

readonly DESTRUCTIVE_RULE="destructive or in-place MinIO plan action"
readonly UNKNOWN_RULE="unexpected MinIO OpenTofu resource"
readonly SECOND_PLAN_RULE="second MinIO OpenTofu plan is not clean"

readonly BUCKET_ARN='arn:aws:s3:::wotbtools-temp'

write_plan initial-create "{\"resource_changes\":[
  {\"address\":\"minio_s3_bucket.temporary_workspace\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_s3_bucket_lifecycle.temporary_jobs\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user.worker\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_worker\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.worker\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user.control_api\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api_reclaim\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api_reclaim\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api_location\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api_location\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_worker_location\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.worker_location\",\"change\":{\"actions\":[\"create\"]}}
]}"

# Adding only the second identity on an already-provisioned bucket is a
# first-class supported plan.
write_plan control-api-added "{\"resource_changes\":[
  {\"address\":\"minio_s3_bucket.temporary_workspace\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_s3_bucket_lifecycle.temporary_jobs\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user.worker\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_worker\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.worker\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user.control_api\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api\",\"change\":{\"actions\":[\"create\"]}}
]}"

# The real production sequence for create rollback: the control plane identity
# already exists, and only the delete grant is added.
write_plan control-api-reclaim-added "{\"resource_changes\":[
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api_reclaim\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api_reclaim\",\"change\":{\"actions\":[\"create\"]}}
]}"

# The GetBucketLocation grant follows the same create-only sequence on the already
# provisioned identities: both application identities reach the bucket through the same
# SDK, so both location documents are created — never an edit of an applied read/write
# or reclaim document.
write_plan control-api-location-added "{\"resource_changes\":[
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api_location\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api_location\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_worker_location\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.worker_location\",\"change\":{\"actions\":[\"create\"]}}
]}"

write_plan second-plan-noop "{\"resource_changes\":[
  {\"address\":\"minio_s3_bucket.temporary_workspace\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_s3_bucket_lifecycle.temporary_jobs\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user.worker\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_worker\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.worker\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user.control_api\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api_reclaim\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api_reclaim\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_control_api_location\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.control_api_location\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_policy.temporary_workspace_worker_location\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"minio_iam_user_policy_attachment.worker_location\",\"change\":{\"actions\":[\"no-op\"]}}
]}"

write_plan control-api-user-delete '{"resource_changes":[{"address":"minio_iam_user.control_api","change":{"actions":["delete"]}}]}'
write_plan control-api-policy-delete '{"resource_changes":[{"address":"minio_iam_policy.temporary_workspace_control_api","change":{"actions":["delete"]}}]}'
write_plan control-api-attachment-delete '{"resource_changes":[{"address":"minio_iam_user_policy_attachment.control_api","change":{"actions":["delete"]}}]}'
write_plan worker-user-replacement '{"resource_changes":[{"address":"minio_iam_user.worker","change":{"actions":["delete","create"]}}]}'
write_plan control-api-user-replacement '{"resource_changes":[{"address":"minio_iam_user.control_api","change":{"actions":["delete","create"]}}]}'
write_plan bucket-lifecycle-update '{"resource_changes":[{"address":"minio_s3_bucket_lifecycle.temporary_jobs","change":{"actions":["update"]}}]}'
write_plan unknown-resource '{"resource_changes":[{"address":"minio_iam_user.application_owned","change":{"actions":["create"]}}]}'
write_plan application-owned-bucket '{"resource_changes":[{"address":"minio_s3_bucket.hof_replays","change":{"actions":["create"]}}]}'

# Permission growth reaches the plan as an in-place update of the policy or the
# attachment (a permission change can never be a create), and the guard refuses
# every in-place action before it reads any document. The first two fixtures keep
# the widened document in `after` to make the intent explicit.
write_plan control-api-policy-actions-widened "{\"resource_changes\":[{\"address\":\"minio_iam_policy.temporary_workspace_control_api\",\"change\":{\"actions\":[\"update\"],\"after\":{\"policy\":\"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Action\\\":[\\\"s3:GetObject\\\",\\\"s3:PutObject\\\",\\\"s3:DeleteObject\\\"],\\\"Resource\\\":[\\\"$BUCKET_ARN/temp/jobs/*\\\"]}]}\"}}}]}"
write_plan control-api-policy-prefix-widened "{\"resource_changes\":[{\"address\":\"minio_iam_policy.temporary_workspace_control_api\",\"change\":{\"actions\":[\"update\"],\"after\":{\"policy\":\"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Action\\\":[\\\"s3:GetObject\\\",\\\"s3:PutObject\\\"],\\\"Resource\\\":[\\\"$BUCKET_ARN/*\\\"]}]}\"}}}]}"
write_plan worker-policy-scope-widened '{"resource_changes":[{"address":"minio_iam_policy.temporary_workspace_worker","change":{"actions":["update"]}}]}'
write_plan control-api-policy-condition-dropped '{"resource_changes":[{"address":"minio_iam_policy.temporary_workspace_control_api","change":{"actions":["update"]}}]}'
write_plan control-api-attachment-repointed '{"resource_changes":[{"address":"minio_iam_user_policy_attachment.control_api","change":{"actions":["update"]}}]}'
write_plan control-api-reclaim-delete '{"resource_changes":[{"address":"minio_iam_policy.temporary_workspace_control_api_reclaim","change":{"actions":["delete"]}}]}'
write_plan control-api-reclaim-scope-widened '{"resource_changes":[{"address":"minio_iam_policy.temporary_workspace_control_api_reclaim","change":{"actions":["update"]}}]}'
write_plan control-api-location-delete '{"resource_changes":[{"address":"minio_iam_policy.temporary_workspace_control_api_location","change":{"actions":["delete"]}}]}'
write_plan control-api-location-attachment-repointed '{"resource_changes":[{"address":"minio_iam_user_policy_attachment.control_api_location","change":{"actions":["update"]}}]}'
write_plan worker-location-delete '{"resource_changes":[{"address":"minio_iam_policy.temporary_workspace_worker_location","change":{"actions":["delete"]}}]}'
write_plan worker-location-attachment-repointed '{"resource_changes":[{"address":"minio_iam_user_policy_attachment.worker_location","change":{"actions":["update"]}}]}'

assert_passes initial-create
assert_passes control-api-added
assert_passes control-api-reclaim-added
assert_passes control-api-location-added
assert_passes second-plan-noop --require-no-changes
assert_rejects control-api-user-delete "$DESTRUCTIVE_RULE"
assert_rejects control-api-policy-delete "$DESTRUCTIVE_RULE"
assert_rejects control-api-attachment-delete "$DESTRUCTIVE_RULE"
assert_rejects worker-user-replacement "$DESTRUCTIVE_RULE"
assert_rejects control-api-user-replacement "$DESTRUCTIVE_RULE"
assert_rejects bucket-lifecycle-update "$DESTRUCTIVE_RULE"
assert_rejects unknown-resource "$UNKNOWN_RULE"
assert_rejects application-owned-bucket "$UNKNOWN_RULE"
assert_rejects control-api-policy-actions-widened "$DESTRUCTIVE_RULE"
assert_rejects control-api-policy-prefix-widened "$DESTRUCTIVE_RULE"
assert_rejects worker-policy-scope-widened "$DESTRUCTIVE_RULE"
assert_rejects control-api-policy-condition-dropped "$DESTRUCTIVE_RULE"
assert_rejects control-api-attachment-repointed "$DESTRUCTIVE_RULE"
assert_rejects control-api-reclaim-delete "$DESTRUCTIVE_RULE"
assert_rejects control-api-reclaim-scope-widened "$DESTRUCTIVE_RULE"
assert_rejects control-api-location-delete "$DESTRUCTIVE_RULE"
assert_rejects control-api-location-attachment-repointed "$DESTRUCTIVE_RULE"
assert_rejects worker-location-delete "$DESTRUCTIVE_RULE"
assert_rejects worker-location-attachment-repointed "$DESTRUCTIVE_RULE"
assert_rejects control-api-added "$SECOND_PLAN_RULE" --require-no-changes
assert_rejects control-api-reclaim-added "$SECOND_PLAN_RULE" --require-no-changes
assert_rejects control-api-location-added "$SECOND_PLAN_RULE" --require-no-changes
assert_rejects initial-create "$SECOND_PLAN_RULE" --require-no-changes

echo "MinIO OpenTofu plan safety policy contract OK"
