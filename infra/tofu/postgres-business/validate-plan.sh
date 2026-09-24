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

# Business PostgreSQL owns exactly these logical resources. Every application
# table, index, and sequence stays Flyway-owned and must never appear here.
allowed = {
    "postgresql_database.wotb",
    "postgresql_role.control_api",
    "postgresql_grant.control_api_database_access",
    "postgresql_role.tofu_state",
    "postgresql_database.tofu_state",
    "postgresql_grant.tofu_state_database_access",
    "postgresql_grant.tofu_state_revoke_public_database_access",
    "postgresql_grant.tofu_state_revoke_public_schema_access",
    "postgresql_grant.tofu_state_public_schema_access",
    "postgresql_schema.tofu_state[\"tofu_keycloak\"]",
    "postgresql_schema.tofu_state[\"tofu_keycloak_postgres\"]",
    "postgresql_schema.tofu_state[\"tofu_grafana\"]",
}
rotatable = {"postgresql_role.control_api", "postgresql_role.tofu_state"}

changed = []
for item in plan.get("resource_changes", []):
    address = item.get("address")
    actions = item.get("change", {}).get("actions", [])
    if address not in allowed:
        raise SystemExit(f"unexpected Business PostgreSQL OpenTofu resource: {address}")
    if "delete" in actions:
        raise SystemExit(f"destructive Business PostgreSQL plan action for {address}: {actions}")
    if actions == ["no-op"]:
        continue
    if actions == ["create"]:
        changed.append(address)
        continue
    # The application role password is writable in place. A rotation must remain
    # a non-destructive update; accepting a replacement would orphan the
    # authoritative business database owner.
    if address in rotatable and actions == ["update"]:
        changed.append(address)
        continue
    raise SystemExit(f"unsafe Business PostgreSQL plan action for {address}: {actions}")

if require_no_changes and changed:
    raise SystemExit("second Business PostgreSQL OpenTofu plan is not clean: " + ", ".join(changed))

print("Business PostgreSQL OpenTofu plan safety validation passed.")
PY
