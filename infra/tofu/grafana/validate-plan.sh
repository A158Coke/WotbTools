#!/usr/bin/env bash
set -euo pipefail

plan_file="${1:-plan.tfplan}"
[[ -f "$plan_file" ]] || { echo "Grafana plan file is missing: $plan_file" >&2; exit 1; }

# These three dashboard deletes were the reviewed migration from API-managed
# legacy dashboards. No data-source deletion or dashboard replacement is safe.
plan_json="$(tofu show -json "$plan_file")"

# Report every class before enforcing, so an operator sees what the plan moves.
jq -r '
  [ .resource_changes[]? ] as $changes |
  [ $changes[] | select(.type == "grafana_dashboard" and (.change.actions // []) == ["delete"] and
    (.address == "grafana_dashboard.managed[\"wotbtools_http_errors\"]" or
     .address == "grafana_dashboard.managed[\"wotbtools_replay_parser\"]" or
     .address == "grafana_dashboard.managed[\"wotbtools_android_downloads\"]")) ] as $expected |
  [ $changes[] | select(.type == "grafana_dashboard" and ((.change.actions // []) | index("delete") != null) and
    ((.change.actions // []) != ["delete"] or
     (.address != "grafana_dashboard.managed[\"wotbtools_http_errors\"]" and
      .address != "grafana_dashboard.managed[\"wotbtools_replay_parser\"]" and
      .address != "grafana_dashboard.managed[\"wotbtools_android_downloads\"]"))) ] as $unexpected |
  [ $changes[] | select(.type == "grafana_dashboard" and (((.change.actions // []) | index("delete")) != null) and (((.change.actions // []) | index("create")) != null)) ] as $replacements |
  [ $changes[] | select(.type == "grafana_data_source" and ((.change.actions // []) | index("delete") != null)) ] as $datasources |
  "expected dashboard deletes: \($expected | length)",
  "unexpected dashboard deletes: \($unexpected | length)",
  "replacements: \($replacements | length)",
  "datasource deletes: \($datasources | length)"
' <<< "$plan_json"

if jq -e '
  def is_delete: ((.change.actions // []) | index("delete") != null);
  def is_approved:
    .address == "grafana_dashboard.managed[\"wotbtools_http_errors\"]" or
    .address == "grafana_dashboard.managed[\"wotbtools_replay_parser\"]" or
    .address == "grafana_dashboard.managed[\"wotbtools_android_downloads\"]";
  any(.resource_changes[]?;
    (.type == "grafana_data_source" and is_delete) or
    (.type == "grafana_dashboard" and is_delete and
      ((is_approved | not) or (.change.actions // []) != ["delete"]))
  )
' <<< "$plan_json" >/dev/null; then
  echo "Grafana plan contains an unexpected delete or dashboard replacement." >&2
  exit 1
fi

echo "Grafana OpenTofu plan safety guard passed."
