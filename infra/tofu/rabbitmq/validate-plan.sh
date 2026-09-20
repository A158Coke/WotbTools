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
# Application identities are AMQP-only. Any in-place update here is supposed to
# be a credential rotation, so the post-plan representation is checked rather
# than trusted: a RabbitMQ tag is exactly what grants Management API and UI
# access, and gaining one would silently widen the identity beyond the reviewed
# contract.
application_identities = {
    "rabbitmq_user.control_api": "control-api",
    "rabbitmq_user.parser_worker": "parser-worker",
}
# `rabbitmq_user` exposes exactly these attributes. Anything else in the plan is
# metadata this guard cannot prove safe, so it fails closed. `password` is
# sensitive and is never inspected: a real plan carries its plaintext, and a
# rotation must stay allowed.
user_attributes = {"id", "name", "password", "tags"}
# The exact, reviewed ACL contract per resource address. A blacklist cannot do
# this job: `^wotb\\..*$`, `^wotb.*$`, `^.+$` or a wrong-but-narrow regex all
# widen or move a privilege while looking harmless, so every scope is compared
# for equality and any different post-plan value fails closed.
application_acls = {
    "rabbitmq_permissions.control_api_publisher": {
        "configure": "^$",
        "write": "^wotb\\.jobs$",
        "read": "^$",
    },
    "rabbitmq_permissions.parser_worker_consumer": {
        "configure": "^$",
        "write": "^wotb\\.jobs$",
        "read": "^wotb\\.parser$",
    },
}


def application_identity_violation(address, change):
    expected_name = application_identities[address]
    after = change.get("after") or {}
    if after.get("name") != expected_name:
        return f"application identity must stay named {expected_name}"
    # `None` (unknown at plan time) is rejected as well: empty tags must be
    # proven, not assumed.
    if after.get("tags") != []:
        return "application identity may not carry RabbitMQ tags"
    unexpected = sorted(
        {key for key, value in after.items() if key not in user_attributes and value is not None}
        | {key for key in change.get("after_unknown") or {} if key not in user_attributes}
    )
    if unexpected:
        return "unexpected application identity attribute(s): " + ", ".join(unexpected)
    return None


changed = []
for item in plan.get("resource_changes", []):
    address = item.get("address")
    actions = item.get("change", {}).get("actions", [])
    if address not in set(application_identities) | static_topology | set(application_acls):
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

# Whatever an approved diff contains, an application identity can never carry a
# tag, be renamed, gain unknown metadata, or hold an ACL other than the one
# reviewed for its address.
for item in plan.get("resource_changes", []):
    address = item.get("address")
    change = item.get("change", {})
    if address in application_identities:
        violation = application_identity_violation(address, change)
        if violation:
            raise SystemExit(f"unsafe RabbitMQ plan action for {address}: {violation}")
        continue
    if address not in application_acls:
        continue
    after = change.get("after") or {}
    permissions = (after.get("permissions") or [{}])[0]
    for scope, expected in application_acls[address].items():
        actual = permissions.get(scope)
        if actual != expected:
            raise SystemExit(
                f"unsafe RabbitMQ plan action for {address}: ACL {scope} must stay exactly {expected!r}, got {actual!r}"
            )

if require_no_changes and changed:
    raise SystemExit("second RabbitMQ OpenTofu plan is not clean: " + ", ".join(changed))

print("RabbitMQ OpenTofu plan safety validation passed.")
PY
