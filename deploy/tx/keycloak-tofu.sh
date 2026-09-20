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
  TX_QQ_CLIENT_ID TX_QQ_CLIENT_SECRET TX_QQ_CLIENT_SECRET_VERSION; do
  require_env "$name"
done

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

is_qq_placeholder() {
  case "${1,,}" in
    bootstrap-not-configured|dummy|empty|juhe|juhe-qq|not-configured) return 0 ;;
    *) return 1 ;;
  esac
}

for name in TX_QQ_CLIENT_ID TX_QQ_CLIENT_SECRET; do
  value="${!name}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  [[ -n "$value" ]] && ! is_qq_placeholder "$value" \
    || { echo "ERROR: $name must be configured and must not be a placeholder." >&2; exit 2; }
done
is_positive_integer "$TX_QQ_CLIENT_SECRET_VERSION" \
  || { echo "ERROR: TX_QQ_CLIENT_SECRET_VERSION must be a positive integer." >&2; exit 2; }

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
export TF_VAR_qq_client_id="$TX_QQ_CLIENT_ID"
export TF_VAR_qq_client_secret="$TX_QQ_CLIENT_SECRET"
export TF_VAR_qq_client_secret_version="$TX_QQ_CLIENT_SECRET_VERSION"

TOFU_CLI_CONFIG="${TF_CLI_CONFIG_FILE:-/opt/wotb-tx/tofurc}"
[ -f "$TOFU_CLI_CONFIG" ] || {
  echo "ERROR: OpenTofu CLI config not found: $TOFU_CLI_CONFIG" >&2
  exit 2
}
export TF_CLI_CONFIG_FILE="$TOFU_CLI_CONFIG"

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
