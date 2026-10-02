#!/usr/bin/env bash
set -Eeuo pipefail

PLAN="${1:?usage: validate-plan.sh <plan.tfplan> [--require-no-changes]}"
MODE="${2:-}"
[[ -f "$PLAN" ]] || { echo "Plan file is missing: $PLAN" >&2; exit 2; }
[[ -z "$MODE" || "$MODE" == --require-no-changes ]] || { echo "Unknown mode: $MODE" >&2; exit 2; }
command -v tofu >/dev/null
command -v jq >/dev/null

json="$(tofu show -json "$PLAN")"
jq -e 'type == "object" and (.resource_changes | type == "array")' <<<"$json" >/dev/null || {
  echo 'Malformed Komodo OpenTofu plan.' >&2
  exit 1
}

if [[ "$MODE" == --require-no-changes ]]; then
  jq -e 'all(.resource_changes[]; ((.change.actions // []) == ["no-op"]))' <<<"$json" >/dev/null || {
    echo 'Komodo second plan is not clean.' >&2
    exit 1
  }
  echo 'Komodo OpenTofu second plan: CLEAN'
  exit 0
fi

jq -e '
  all(.resource_changes[];
    .address == "tencentcloud_dnspod_record.komodo"
    and .type == "tencentcloud_dnspod_record"
    and (
      (.change.actions == ["no-op"])
      or (.change.actions == ["create"])
      or (.change.actions == ["update"])
    )
  )
' <<<"$json" >/dev/null || {
  echo 'Komodo plan contains an unexpected resource or destructive/replacement action.' >&2
  exit 1
}
echo 'Komodo OpenTofu plan guard: PASS'
