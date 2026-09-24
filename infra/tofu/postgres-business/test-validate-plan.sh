#!/usr/bin/env bash
# Deterministic plan-safety policy contract for the Business PostgreSQL root.
# It needs no database: tofu is stubbed to replay fixture plan JSON.
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat > "$WORK/bin/tofu" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "$#" -eq 3 ] && [ "$1" = show ] && [ "$2" = -json ] || exit 2
cat "$3"
EOF
chmod 700 "$WORK/bin/tofu"

write_plan() {
  local name="$1" json="$2"
  printf '%s\n' "$json" > "$WORK/$name.tfplan"
}

assert_passes() {
  local name="$1"
  shift
  PATH="$WORK/bin:$PATH" bash "$ROOT/validate-plan.sh" "$WORK/$name.tfplan" "$@" >/dev/null
}

assert_rejects() {
  local name="$1"
  shift
  if PATH="$WORK/bin:$PATH" bash "$ROOT/validate-plan.sh" "$WORK/$name.tfplan" "$@" >/dev/null 2>&1; then
    echo "ERROR: $name should have been rejected." >&2
    exit 1
  fi
}

write_plan initial-create '{"resource_changes":[{"address":"postgresql_role.control_api","change":{"actions":["create"]}},{"address":"postgresql_database.wotb","change":{"actions":["create"]}},{"address":"postgresql_grant.control_api_database_access","change":{"actions":["create"]}},{"address":"postgresql_role.tofu_state","change":{"actions":["create"]}},{"address":"postgresql_database.tofu_state","change":{"actions":["create"]}},{"address":"postgresql_grant.tofu_state_database_access","change":{"actions":["create"]}},{"address":"postgresql_schema.tofu_state[\"tofu_keycloak\"]","change":{"actions":["create"]}},{"address":"postgresql_schema.tofu_state[\"tofu_keycloak_postgres\"]","change":{"actions":["create"]}},{"address":"postgresql_schema.tofu_state[\"tofu_grafana\"]","change":{"actions":["create"]}}]}'
write_plan application-password-rotation '{"resource_changes":[{"address":"postgresql_database.wotb","change":{"actions":["no-op"]}},{"address":"postgresql_grant.control_api_database_access","change":{"actions":["no-op"]}},{"address":"postgresql_role.control_api","change":{"actions":["update"]}},{"address":"postgresql_database.tofu_state","change":{"actions":["no-op"]}},{"address":"postgresql_grant.tofu_state_database_access","change":{"actions":["no-op"]}},{"address":"postgresql_role.tofu_state","change":{"actions":["no-op"]}}]}'
write_plan tofu-state-delete '{"resource_changes":[{"address":"postgresql_database.tofu_state","change":{"actions":["delete"]}}]}'
write_plan database-delete '{"resource_changes":[{"address":"postgresql_database.wotb","change":{"actions":["delete"]}}]}'
write_plan role-replacement '{"resource_changes":[{"address":"postgresql_role.control_api","change":{"actions":["delete","create"]}}]}'
write_plan grant-delete '{"resource_changes":[{"address":"postgresql_grant.control_api_database_access","change":{"actions":["delete"]}}]}'
write_plan database-update '{"resource_changes":[{"address":"postgresql_database.wotb","change":{"actions":["update"]}}]}'
write_plan unknown-resource '{"resource_changes":[{"address":"postgresql_table.hall_of_fame_record","change":{"actions":["create"]}}]}'

assert_passes initial-create
assert_passes application-password-rotation
assert_rejects database-delete
assert_rejects role-replacement
assert_rejects grant-delete
assert_rejects database-update
assert_rejects tofu-state-delete
assert_rejects unknown-resource
assert_rejects application-password-rotation --require-no-changes
assert_rejects initial-create --require-no-changes

# A completely clean follow-up plan must be accepted when no changes occurred.
write_plan clean '{"resource_changes":[{"address":"postgresql_role.control_api","change":{"actions":["no-op"]}},{"address":"postgresql_database.wotb","change":{"actions":["no-op"]}},{"address":"postgresql_grant.control_api_database_access","change":{"actions":["no-op"]}},{"address":"postgresql_role.tofu_state","change":{"actions":["no-op"]}},{"address":"postgresql_database.tofu_state","change":{"actions":["no-op"]}},{"address":"postgresql_grant.tofu_state_database_access","change":{"actions":["no-op"]}},{"address":"postgresql_schema.tofu_state[\"tofu_keycloak\"]","change":{"actions":["no-op"]}},{"address":"postgresql_schema.tofu_state[\"tofu_keycloak_postgres\"]","change":{"actions":["no-op"]}},{"address":"postgresql_schema.tofu_state[\"tofu_grafana\"]","change":{"actions":["no-op"]}}]}'
assert_passes clean --require-no-changes

echo "Business PostgreSQL OpenTofu plan safety policy contract OK"
