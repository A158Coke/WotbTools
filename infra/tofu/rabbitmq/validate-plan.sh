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

# Static topology is OpenTofu-owned. Any address outside the reviewed set is an
# unknown owner for a broker object and fails closed.
static_topology = {
    "rabbitmq_vhost.wotbtools",
    "rabbitmq_exchange.jobs",
    "rabbitmq_queue.parser",
    "rabbitmq_queue.parser_retry",
    "rabbitmq_queue.parser_dlq",
    "rabbitmq_binding.parser_request",
    "rabbitmq_binding.parser_retry",
    "rabbitmq_binding.parser_dead",
}
# Application identities may only be created or rotated in place. Their ACLs may
# additionally be updated in place, which is an explicitly reviewed and
# non-destructive change.
application_identities = {
    "rabbitmq_user.control_api",
    "rabbitmq_user.parser_worker",
}
application_acls = {
    "rabbitmq_permissions.control_api_publisher",
    "rabbitmq_permissions.parser_worker_consumer",
}

changed = []
for item in plan.get("resource_changes", []):
    address = item.get("address")
    actions = item.get("change", {}).get("actions", [])
    if address not in static_topology | application_identities | application_acls:
        raise SystemExit(f"unexpected RabbitMQ OpenTofu resource: {address}")
    if "delete" in actions:
        raise SystemExit(f"destructive RabbitMQ plan action for {address}: {actions}")
    if actions == ["no-op"]:
        continue
    if actions == ["create"]:
        changed.append(address)
        continue
    if address in application_identities and actions == ["update"]:
        changed.append(address)
        continue
    if address in application_acls and actions == ["update"]:
        changed.append(address)
        continue
    # Queues and exchanges cannot be mutated in place by RabbitMQ; an update
    # here means the plan is attempting an unexpected topology mutation.
    raise SystemExit(f"unsafe RabbitMQ plan action for {address}: {actions}")

# Whatever an approved diff contains, an application identity can never declare
# topology and can never hold a vhost-wide ACL.
for item in plan.get("resource_changes", []):
    address = item.get("address")
    if address not in application_acls:
        continue
    after = item.get("change", {}).get("after") or {}
    permissions = (after.get("permissions") or [{}])[0]
    if permissions.get("configure") != "^$":
        raise SystemExit(
            f"unsafe RabbitMQ plan action for {address}: an application identity may not configure topology"
        )
    for scope in ("write", "read"):
        if permissions.get(scope) == ".*":
            raise SystemExit(
                f"unsafe RabbitMQ plan action for {address}: an application identity may not hold a vhost-wide {scope} ACL"
            )

if require_no_changes and changed:
    raise SystemExit("second RabbitMQ OpenTofu plan is not clean: " + ", ".join(changed))

print("RabbitMQ OpenTofu plan safety validation passed.")
PY
