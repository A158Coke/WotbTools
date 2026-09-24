#!/usr/bin/env bash
set -euo pipefail

plan_file="${1:-plan.tfplan}"
[ -f "$plan_file" ] || {
  echo "OpenTofu plan file is missing: $plan_file" >&2
  exit 1
}

plan_json="$(tofu show -json "$plan_file")" || {
  echo "Unable to read the postgres-keycloak OpenTofu plan as JSON." >&2
  exit 1
}

if ! jq -e '
  type == "object" and
  (.resource_changes | type == "array") and
  all(.resource_changes[];
    type == "object" and
    (.address | type == "string") and
    (.change | type == "object") and
    (.change.actions | type == "array") and
    all(.change.actions[]; type == "string")
  )
' <<< "$plan_json" >/dev/null; then
  echo "The postgres-keycloak OpenTofu plan JSON is malformed or missing resource changes." >&2
  exit 1
fi

protected_deletion="$(jq -r '
  def protected:
    .address == "postgresql_role.keycloak" or
    .address == "postgresql_database.keycloak" or
    .address == "postgresql_grant.keycloak_database_access";
  any(.resource_changes[]?;
    protected and ((.change.actions // []) | index("delete") != null)
  )
' <<< "$plan_json")" || {
  echo "Unable to evaluate the postgres-keycloak OpenTofu plan safety policy." >&2
  exit 1
}

if [[ "$protected_deletion" == true ]]; then
  echo "The postgres-keycloak plan deletes or replaces a protected Keycloak database resource." >&2
  exit 1
fi
