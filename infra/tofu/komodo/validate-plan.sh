#!/usr/bin/env bash
# Komodo DNS plan guard.
#
# This root owns exactly one resource: the public DNSPod A record for the
# controller hostname pointing at the TX ingress address. Anything else - an
# extra resource, a delete, a replacement, or a record that resolves somewhere
# else - is rejected before `tofu apply` is allowed to run.
#
# The expected record values intentionally repeat `dns.tf`, so the guard is an
# independent statement of intent rather than a restatement of whatever the
# configuration happens to plan.
set -Eeuo pipefail

PLAN="${1:?usage: validate-plan.sh <plan.tfplan> [--require-no-changes]}"
MODE="${2:-}"
[[ -f "$PLAN" ]] || { echo "Plan file is missing: $PLAN" >&2; exit 2; }
[[ -z "$MODE" || "$MODE" == --require-no-changes ]] || { echo "Unknown mode: $MODE" >&2; exit 2; }
command -v tofu >/dev/null || { echo 'tofu is required.' >&2; exit 2; }
command -v jq >/dev/null || { echo 'jq is required.' >&2; exit 2; }

plan_json="$(tofu show -json "$PLAN")"

if [[ "$MODE" == --require-no-changes ]]; then
  jq -e '
    [ .resource_changes[]? ]
    | all(.[]; ((.change.actions // []) == ["no-op"]))
  ' <<<"$plan_json" >/dev/null || {
    echo 'Komodo second plan is not clean.' >&2
    exit 1
  }
  echo 'Komodo OpenTofu second plan: CLEAN'
  exit 0
fi

jq -e '
  def controller_record:
    .address == "tencentcloud_dnspod_record.komodo"
    and .type == "tencentcloud_dnspod_record"
    and ((.change.actions // []) == ["no-op"]
         or (.change.actions // []) == ["create"]
         or (.change.actions // []) == ["update"])
    and (.change.after.domain == "wotbtools.com")
    and (.change.after.sub_domain == "komodo")
    and (.change.after.record_type == "A")
    and (.change.after.value == "118.25.18.105")
    and (.change.after.status == "ENABLE");

  [ .resource_changes[]? ] as $changes
  | (($changes | length) <= 1) and (all($changes[]; controller_record))
' <<<"$plan_json" >/dev/null || {
  echo 'Komodo plan contains an unexpected resource, a destructive/replacement action, or an unexpected DNS record.' >&2
  exit 1
}
echo 'Komodo OpenTofu plan guard: PASS'
