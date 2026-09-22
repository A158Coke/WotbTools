#!/usr/bin/env bash
set -Eeuo pipefail

readonly PLAN_FILE="${1:-}"
readonly REQUIRE_NO_CHANGES="${2:-}"

[ -f "$PLAN_FILE" ] || {
  echo "ERROR: plan file is required." >&2
  exit 2
}

if [ -n "$REQUIRE_NO_CHANGES" ] && [ "$REQUIRE_NO_CHANGES" != "--require-no-changes" ]; then
  echo "ERROR: unsupported validation option: $REQUIRE_NO_CHANGES" >&2
  exit 2
fi

PLAN_JSON="$(mktemp)"
trap 'rm -f -- "$PLAN_JSON"' EXIT
tofu show -json "$PLAN_FILE" > "$PLAN_JSON"

python3 - "$REQUIRE_NO_CHANGES" "$PLAN_JSON" <<'PY'
import json
import sys

require_no_changes = sys.argv[1] == "--require-no-changes"
with open(sys.argv[2], encoding="utf-8") as plan_file:
    plan = json.load(plan_file)
allowed = {
    "minio_s3_bucket.temporary_workspace",
    "minio_s3_bucket_lifecycle.temporary_jobs",
    "minio_iam_user.worker",
    "minio_iam_policy.temporary_workspace_worker",
    "minio_iam_user_policy_attachment.worker",
    "minio_iam_user.control_api",
    "minio_iam_policy.temporary_workspace_control_api",
    "minio_iam_user_policy_attachment.control_api",
    # create-rollback grant: delete of the control plane's own temp/jobs/* objects
    "minio_iam_policy.temporary_workspace_control_api_reclaim",
    "minio_iam_user_policy_attachment.control_api_reclaim",
    # SDK bucket-location lookup grant: one read-only bucket-level action, no object access
    "minio_iam_policy.temporary_workspace_control_api_location",
    "minio_iam_user_policy_attachment.control_api_location",
}

changed = []
for item in plan.get("resource_changes", []):
    address = item.get("address")
    actions = item.get("change", {}).get("actions", [])
    if address not in allowed:
        raise SystemExit(f"unexpected MinIO OpenTofu resource: {address}")
    if any(action not in {"no-op", "create"} for action in actions):
        raise SystemExit(f"destructive or in-place MinIO plan action for {address}: {actions}")
    if actions != ["no-op"]:
        changed.append(address)

if require_no_changes and changed:
    raise SystemExit("second MinIO OpenTofu plan is not clean: " + ", ".join(changed))

print("MinIO OpenTofu plan safety validation passed.")
PY
