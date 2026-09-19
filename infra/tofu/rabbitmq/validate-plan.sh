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
    "rabbitmq_vhost.wotbtools",
    "rabbitmq_user.control_api",
    "rabbitmq_user.parser_worker",
    "rabbitmq_permissions.control_api_publisher",
    "rabbitmq_permissions.parser_worker_consumer",
}
application_users = {
    "rabbitmq_user.control_api",
    "rabbitmq_user.parser_worker",
}
changed = []
for item in plan.get("resource_changes", []):
    address = item.get("address")
    actions = item.get("change", {}).get("actions", [])
    if address not in allowed:
        raise SystemExit(f"unexpected RabbitMQ OpenTofu resource: {address}")
    if "delete" in actions:
        raise SystemExit(f"destructive RabbitMQ plan action for {address}: {actions}")
    if actions == ["no-op"]:
        continue
    if actions == ["create"]:
        changed.append(address)
        continue
    if address in application_users and actions == ["update"]:
        changed.append(address)
        continue
    raise SystemExit(f"unsafe RabbitMQ plan action for {address}: {actions}")

if require_no_changes and changed:
    raise SystemExit("second RabbitMQ OpenTofu plan is not clean: " + ", ".join(changed))

print("RabbitMQ OpenTofu plan safety validation passed.")
PY
