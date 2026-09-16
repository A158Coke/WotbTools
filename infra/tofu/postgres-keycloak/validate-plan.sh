#!/usr/bin/env bash
set -euo pipefail

plan_file="${1:-plan.tfplan}"
[ -f "$plan_file" ] || {
  echo "OpenTofu plan file is missing: $plan_file" >&2
  exit 1
}

if tofu show -json "$plan_file" | jq -e '
  def protected:
    .address == "postgresql_role.keycloak" or
    .address == "postgresql_database.keycloak" or
    .address == "postgresql_grant.keycloak_database_access";
  any(.resource_changes[]?;
    protected and ((.change.actions // []) | index("delete") != null)
  )
' >/dev/null; then
  echo "The postgres-keycloak plan deletes or replaces a protected Keycloak database resource." >&2
  exit 1
fi
