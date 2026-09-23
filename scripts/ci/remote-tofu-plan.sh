#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${1:-}"
ROOT_NAME="${2:-}"
[ -n "$ROOT_DIR" ] && [ -d "$ROOT_DIR" ] || { echo 'staged root is required' >&2; exit 2; }

case "$ROOT_NAME" in
  keycloak)
    export TF_CLI_CONFIG_FILE=/opt/wotb-tx/tofurc
    export TF_VAR_keycloak_admin_username="${KEYCLOAK_ADMIN_USERNAME:?}"
    export TF_VAR_keycloak_admin_password="${KEYCLOAK_ADMIN_PASSWORD:?}"
    export TF_VAR_keycloak_admin_client_secret="${KEYCLOAK_ADMIN_CLIENT_SECRET:?}"
    export TF_VAR_keycloak_admin_client_secret_version="${KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION:?}"
    export TF_VAR_e2e_client_secret="${KEYCLOAK_E2E_CLIENT_SECRET:?}"
    export TF_VAR_e2e_client_secret_version="${KEYCLOAK_E2E_CLIENT_SECRET_VERSION:?}"
    export TF_VAR_wargaming_application_id="${WG_APPLICATION_ID:?}"
    export TF_VAR_qq_client_id="${TX_QQ_CLIENT_ID:?}"
    export TF_VAR_qq_client_secret="${TX_QQ_CLIENT_SECRET:?}"
    export AWS_ACCESS_KEY_ID="${TENCENTCLOUD_SECRET_ID:?}"
    export AWS_SECRET_ACCESS_KEY="${TENCENTCLOUD_SECRET_KEY:?}"
    ;;
  rabbitmq)
    export TF_CLI_CONFIG_FILE=/opt/wotb-tx/deploy/rabbitmq.tofurc
    export TF_VAR_rabbitmq_management_endpoint=http://127.0.0.1:15672
    export TF_VAR_rabbitmq_admin_user="${TX_RABBITMQ_ADMIN_USER:?}"
    export TF_VAR_rabbitmq_admin_password="${TX_RABBITMQ_ADMIN_PASSWORD:?}"
    export TF_VAR_control_api_password="${TX_RABBITMQ_CONTROL_API_PASSWORD:?}"
    export TF_VAR_parser_worker_password="${TX_RABBITMQ_PARSER_WORKER_PASSWORD:?}"
    ;;
  business-postgres)
    export TF_CLI_CONFIG_FILE=/opt/wotb-tx/deploy/business-postgres.tofurc
    export TF_VAR_postgresql_admin_username="${TX_BUSINESS_POSTGRES_ADMIN_USER:?}"
    export TF_VAR_postgresql_admin_password="${TX_BUSINESS_POSTGRES_ADMIN_PASSWORD:?}"
    export TF_VAR_business_database_name="${TX_BUSINESS_DB_NAME:?}"
    export TF_VAR_business_role_name="${TX_BUSINESS_DB_USERNAME:?}"
    export TF_VAR_business_role_password="${TX_BUSINESS_DB_PASSWORD:?}"
    export TF_VAR_business_role_password_version="${TX_BUSINESS_DB_PASSWORD_VERSION:?}"
    ;;
  keycloak-postgres)
    export TF_CLI_CONFIG_FILE=/opt/wotb-tx/tofurc
    export TF_VAR_postgresql_admin_username=kc_admin
    export TF_VAR_postgresql_admin_password="${KC_POSTGRES_ADMIN_PASSWORD:?}"
    export TF_VAR_keycloak_role_password="${KC_DB_PASSWORD:?}"
    export TF_VAR_keycloak_role_password_version="${KC_DB_PASSWORD_VERSION:?}"
    export AWS_ACCESS_KEY_ID="${TENCENTCLOUD_SECRET_ID:?}"
    export AWS_SECRET_ACCESS_KEY="${TENCENTCLOUD_SECRET_KEY:?}"
    ;;
  minio)
    export TF_CLI_CONFIG_FILE=/opt/wotb/deploy/minio/tofurc
    export TF_VAR_minio_server=10.20.0.2:9000
    export TF_VAR_minio_root_user="${YECAO_MINIO_ROOT_USER:?}"
    export TF_VAR_minio_root_password="${YECAO_MINIO_ROOT_PASSWORD:?}"
    export TF_VAR_worker_access_key="${YECAO_MINIO_WORKER_ACCESS_KEY:?}"
    export TF_VAR_worker_secret_key="${YECAO_MINIO_WORKER_SECRET_KEY:?}"
    export TF_VAR_control_api_access_key="${YECAO_MINIO_CONTROL_API_ACCESS_KEY:?}"
    export TF_VAR_control_api_secret_key="${YECAO_MINIO_CONTROL_API_SECRET_KEY:?}"
    ;;
  *) echo "unsupported host-local plan root: $ROOT_NAME" >&2; exit 2 ;;
esac

[ -f "$TF_CLI_CONFIG_FILE" ] || { echo 'trusted host OpenTofu CLI configuration is missing' >&2; exit 2; }
command -v tofu >/dev/null && command -v jq >/dev/null
export TF_IN_AUTOMATION=true CHECKPOINT_DISABLE=1 TF_DATA_DIR="$ROOT_DIR/.tofu-data"
umask 077
cd "$ROOT_DIR"
trap 'rm -f -- plan.tfplan; rm -rf -- "$TF_DATA_DIR"' EXIT
tofu fmt -check -recursive
tofu init -reconfigure -input=false -lockfile=readonly
tofu validate
tofu plan -input=false -no-color -out=plan.tfplan
bash ./validate-plan.sh plan.tfplan
echo "Trusted production-state read-only plan passed for $ROOT_NAME."
