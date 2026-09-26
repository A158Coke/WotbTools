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
  KEYCLOAK_E2E_CLIENT_SECRET KEYCLOAK_E2E_CLIENT_SECRET_VERSION \
  WG_APPLICATION_ID \
  TX_QQ_CLIENT_ID TX_QQ_CLIENT_SECRET; do
  require_env "$name"
done

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

is_placeholder_value() {
  case "${1,,}" in
    bootstrap-not-configured|dummy|empty|not-configured|not-used) return 0 ;;
    *) return 1 ;;
  esac
}

require_configured_value() {
  local name="$1" value="${!1}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  [[ -n "$value" ]] && ! is_placeholder_value "$value" \
    || { echo "ERROR: $name must be configured and must not be a placeholder." >&2; exit 2; }
}

for name in WG_APPLICATION_ID TX_QQ_CLIENT_ID TX_QQ_CLIENT_SECRET KEYCLOAK_E2E_CLIENT_SECRET; do
  require_configured_value "$name"
done
is_positive_integer "$KEYCLOAK_E2E_CLIENT_SECRET_VERSION" \
  || { echo "ERROR: KEYCLOAK_E2E_CLIENT_SECRET_VERSION must be a positive integer." >&2; exit 2; }

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
export TF_VAR_e2e_client_secret="$KEYCLOAK_E2E_CLIENT_SECRET"
export TF_VAR_e2e_client_secret_version="$KEYCLOAK_E2E_CLIENT_SECRET_VERSION"
# The Wargaming application ID is the same secret the Keycloak runtime already
# receives; OpenTofu only owns the ASIA/EU/NA IdP representation's client_id.
# It is passed as a sensitive TF_VAR and never echoed.
export TF_VAR_wargaming_application_id="$WG_APPLICATION_ID"
export TF_VAR_qq_client_id="$TX_QQ_CLIENT_ID"
# Plain sensitive desired state (no rotation version): the injected value is what
# idp-qq must converge to on every apply.
export TF_VAR_qq_client_secret="$TX_QQ_CLIENT_SECRET"

TOFU_CLI_CONFIG="${TF_CLI_CONFIG_FILE:-/opt/wotb-tx/tofurc}"
TOFU_STATE_DIR="/opt/wotb-tx/keycloak-tofu-state"
TOFU_STATE_FILE="$TOFU_STATE_DIR/terraform.tfstate"
TOFU_STATE_MARKER="$TOFU_STATE_DIR/bootstrap-complete"
if [ ! -d "$TOFU_STATE_DIR" ] || [ -L "$TOFU_STATE_DIR" ] || \
  [ ! -f "$TOFU_STATE_FILE" ] || [ ! -s "$TOFU_STATE_FILE" ] || [ -L "$TOFU_STATE_FILE" ] || \
  [ ! -f "$TOFU_STATE_MARKER" ] || [ ! -s "$TOFU_STATE_MARKER" ] || [ -L "$TOFU_STATE_MARKER" ] || \
  ! grep -qx 'local-tofu-state-bootstrap-v1' "$TOFU_STATE_MARKER"; then
  echo "ERROR: local OpenTofu state is not bootstrapped or is unsafe: $TOFU_STATE_FILE" >&2
  echo "Adopt the existing production Keycloak resources into this local state before deployment." >&2
  exit 1
fi
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

second_json="$(tofu show -json second-plan.tfplan)"
if ! jq -e 'all(.resource_changes[]?; ((.change.actions // []) | all(. == "no-op")))' \
  <<< "$second_json" >/dev/null; then
  echo "ERROR: Keycloak OpenTofu second plan is invalid or not No changes." >&2
  exit 1
fi

install -d -m 700 /opt/wotb-tx
printf '%s\n' tx-local-opentofu-keycloak > /opt/wotb-tx/keycloak.tofu-provisioned
chmod 600 /opt/wotb-tx/keycloak.tofu-provisioned
echo "Keycloak OpenTofu apply and second-plan drift check passed."
