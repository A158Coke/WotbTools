#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${1:-}"
[ -n "$ROOT" ] && [ -d "$ROOT" ] || {
  echo "ERROR: Keycloak OpenTofu root is required." >&2
  exit 2
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || {
    echo "ERROR: $name is required." >&2
    exit 2
  }
}

for name in KEYCLOAK_ADMIN_USERNAME KEYCLOAK_ADMIN_PASSWORD \
  KEYCLOAK_ADMIN_CLIENT_SECRET KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION \
  QQ_CLIENT_ID QQ_CLIENT_SECRET QQ_CLIENT_SECRET_VERSION \
  WARGAMING_PLACEHOLDER_SECRET WARGAMING_PLACEHOLDER_SECRET_VERSION; do
  require_env "$name"
done

command -v tofu >/dev/null 2>&1 || {
  echo "ERROR: tofu is required on TX." >&2
  exit 2
}
command -v jq >/dev/null 2>&1 || {
  echo "ERROR: jq is required on TX for plan safety validation." >&2
  exit 2
}

cd "$ROOT"
export TF_VAR_keycloak_admin_username="$KEYCLOAK_ADMIN_USERNAME"
export TF_VAR_keycloak_admin_password="$KEYCLOAK_ADMIN_PASSWORD"
export TF_VAR_keycloak_admin_client_secret="$KEYCLOAK_ADMIN_CLIENT_SECRET"
export TF_VAR_keycloak_admin_client_secret_version="$KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION"
export TF_VAR_qq_client_id="$QQ_CLIENT_ID"
export TF_VAR_qq_client_secret="$QQ_CLIENT_SECRET"
export TF_VAR_qq_client_secret_version="$QQ_CLIENT_SECRET_VERSION"
export TF_VAR_wargaming_placeholder_secret="$WARGAMING_PLACEHOLDER_SECRET"
export TF_VAR_wargaming_placeholder_secret_version="$WARGAMING_PLACEHOLDER_SECRET_VERSION"

trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT
tofu init -reconfigure -input=false
tofu validate
tofu plan -input=false -no-color -out=plan.tfplan
bash ./validate-plan.sh plan.tfplan
tofu apply -input=false -auto-approve plan.tfplan
tofu plan -input=false -no-color -out=second-plan.tfplan
bash ./validate-plan.sh second-plan.tfplan

if jq -e 'any(.resource_changes[]?; ((.change.actions // []) | any(. != "no-op")))' \
  <(tofu show -json second-plan.tfplan) >/dev/null; then
  echo "ERROR: Keycloak OpenTofu second plan is not No changes." >&2
  exit 1
fi

install -d -m 700 /opt/wotb-tx
printf '%s\n' tx-local-opentofu-keycloak > /opt/wotb-tx/keycloak.tofu-provisioned
chmod 600 /opt/wotb-tx/keycloak.tofu-provisioned
echo "Keycloak OpenTofu apply and second-plan drift check passed."
