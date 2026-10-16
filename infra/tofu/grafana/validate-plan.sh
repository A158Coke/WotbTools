#!/usr/bin/env bash
set -euo pipefail
plan_file="${1:-plan.tfplan}"
[[ -f "$plan_file" ]] || { echo "Grafana plan file is missing: $plan_file" >&2; exit 1; }
plan_json="$(tofu show -json "$plan_file")"
# Dashboards are disposable, declarative resources: any delete or replacement is allowed.
# Datasources remain protected and file-provisioned.
jq -e 'type == "object" and (.resource_changes == null or (.resource_changes | type == "array"))' <<< "$plan_json" >/dev/null
jq -r '
  [ .resource_changes[]? | select(.type == "grafana_dashboard") ] as $dashboards |
  "dashboard creates: \([$dashboards[] | select(.change.actions | index("create"))] | length)",
  "dashboard updates: \([$dashboards[] | select(.change.actions | index("update"))] | length)",
  "dashboard deletes: \([$dashboards[] | select(.change.actions | index("delete"))] | length)"
' <<< "$plan_json"
if jq -e 'any(.resource_changes[]?; .type == "grafana_data_source" and ((.change.actions // []) | index("delete") != null))' <<< "$plan_json" >/dev/null; then
  echo "Grafana datasource deletion is prohibited." >&2
  exit 1
fi
echo "Grafana OpenTofu plan safety guard passed."
