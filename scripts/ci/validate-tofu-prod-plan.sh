#!/usr/bin/env bash
set -euo pipefail

plan_file="${1:-plan.tfplan}"
[ -f "$plan_file" ] || {
  echo "OpenTofu plan file is missing: $plan_file" >&2
  exit 1
}

if tofu show -json "$plan_file" | jq -e '
  any(.resource_changes[]?;
    ((.address == "tencentcloud_cos_bucket.production_artifacts" or
      .address == "tencentcloud_lighthouse_instance.production" or
      .address == "tencentcloud_lighthouse_firewall_rule.production") and
      ((.change.actions // []) | index("delete") != null)))
' >/dev/null; then
  echo "The COS production plan contains a delete or replacement action for a protected resource." >&2
  exit 1
fi
