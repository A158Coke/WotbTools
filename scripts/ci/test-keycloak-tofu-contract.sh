#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/keycloak"
required_files = {
    "backend.tf",
    "client.tf",
    "identity-providers.tf",
    "outputs.tf",
    "protocol-mappers.tf",
    "realm.tf",
    "roles.tf",
    "variables.tf",
    "versions.tf",
    "providers.tf",
    "validate-plan.sh",
}
assert {path.name for path in tofu_root.iterdir()} >= required_files
root_text = "\n".join(path.read_text(encoding="utf-8") for path in tofu_root.glob("*.tf"))
deploy_text = (root / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
tx_compose = (root / "deploy/tx/docker-compose.yml").read_text(encoding="utf-8")
keycloak_dockerfile = (root / "docker/Dockerfile.keycloak").read_text(encoding="utf-8")
online_compose = (root / "docker/online/docker-compose.yml").read_text(encoding="utf-8")
tx_deploy = (root / "deploy/tx/deploy.sh").read_text(encoding="utf-8")
tofu_script = (root / "deploy/tx/keycloak-tofu.sh").read_text(encoding="utf-8")
workflow = yaml.safe_load(deploy_text)

assert 'key    = "wotbtools/prod/keycloak.tfstate"' in root_text
assert 'keycloak/keycloak' in (tofu_root / "versions.tf").read_text(encoding="utf-8")
assert 'version = "5.9.0"' in (tofu_root / "versions.tf").read_text(encoding="utf-8")
assert 'keycloak_version         = "26.6.4"' in (tofu_root / "providers.tf").read_text(encoding="utf-8")
assert 'tls_insecure_skip_verify = false' in (tofu_root / "providers.tf").read_text(encoding="utf-8")
assert 'client_id = "wotbtools-admin-api"' in root_text
assert 'access_type                  = "CONFIDENTIAL"' in root_text
assert 'service_accounts_enabled     = true' in root_text
assert 'standard_flow_enabled        = false' in root_text
assert 'implicit_flow_enabled        = false' in root_text
assert 'direct_access_grants_enabled = false' in root_text
assert 'client_secret_wo             = var.keycloak_admin_client_secret' in root_text
assert 'client_secret = var.keycloak_admin_client_secret' not in root_text
assert 'client_secret_wo_version' in root_text
assert 'manage-users' in root_text and 'query-users' in root_text and 'view-realm' in root_text
for forbidden in (
    "realm-admin",
    "manage-realm",
    "manage-clients",
    "manage-identity-providers",
    "manage-events",
    "impersonation",
):
    assert forbidden not in root_text, f"forbidden Admin API role leaked into OpenTofu root: {forbidden}"
for forbidden_construct in ("remote-exec", "local-exec", "null_resource"):
    assert forbidden_construct not in root_text
assert 'default_roles = [keycloak_role.realm["wotbtools-user"].name]' in root_text
assert root_text.count('keycloak_openid_user_attribute_protocol_mapper') == 1
assert 'for_each = local.wargaming_identity_providers' in root_text
assert 'alias                    = "idp-qq"' in root_text
assert 'alias        = "wargaming-asia"' in root_text
assert 'alias        = "wargaming-eu"' in root_text
assert 'alias        = "wargaming-na"' in root_text
assert 'alias                    = "qq"' not in root_text
assert 'alias                    = "juhe-qq"' not in root_text

for path_text in (keycloak_dockerfile, tx_compose, online_compose):
    assert "--import-realm" not in path_text
    assert "wotbtools-realm.json" not in path_text
assert '"127.0.0.1:18080:8080"' in tx_compose
assert '"0.0.0.0:18080:8080"' not in tx_compose
assert 'keycloak.tofu-provisioned' in tx_deploy
assert 'tx-local-opentofu-keycloak' in tx_deploy
assert 'validate-plan.sh' in tofu_script
assert 'tofu apply -input=false -auto-approve plan.tfplan' in tofu_script
assert 'second-plan.tfplan' in tofu_script
assert 'TF_VAR_keycloak_admin_client_secret' in tofu_script
assert 'TF_VAR_qq_client_secret' in tofu_script
assert 'TF_VAR_wargaming_placeholder_secret' in tofu_script
assert 'echo "$KEYCLOAK_ADMIN_CLIENT_SECRET"' not in tofu_script
assert 'printf' in tofu_script

steps = workflow["jobs"]["deploy_tx"]["steps"]
names = [step.get("name", "") for step in steps]
for name in (
    "Install Keycloak OpenTofu root on TX",
    "Start empty TX Keycloak for OpenTofu bootstrap",
    "Apply Keycloak OpenTofu on TX localhost",
):
    assert name in names
assert names.index("Bootstrap TX Keycloak PostgreSQL before OpenTofu") < names.index("Start empty TX Keycloak for OpenTofu bootstrap")
assert names.index("Start empty TX Keycloak for OpenTofu bootstrap") < names.index("Apply Keycloak OpenTofu on TX localhost")
apply_step = next(step for step in steps if step.get("name") == "Apply Keycloak OpenTofu on TX localhost")
apply_envs = apply_step["with"]["envs"]
for runtime_name in (
    "KEYCLOAK_ADMIN_USERNAME",
    "KEYCLOAK_ADMIN_PASSWORD",
    "KEYCLOAK_ADMIN_CLIENT_SECRET",
    "KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION",
    "QQ_CLIENT_ID",
    "QQ_CLIENT_SECRET",
    "QQ_CLIENT_SECRET_VERSION",
    "WARGAMING_PLACEHOLDER_SECRET",
    "WARGAMING_PLACEHOLDER_SECRET_VERSION",
):
    assert runtime_name in apply_envs
assert apply_step["env"]["KEYCLOAK_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_BOOTSTRAP_ADMIN_PASSWORD }}"
assert apply_step["env"]["KEYCLOAK_ADMIN_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_ADMIN_CLIENT_SECRET }}"
assert apply_step["env"]["QQ_CLIENT_SECRET"] == "${{ secrets.TX_QQ_CLIENT_SECRET }}"
assert apply_step["env"]["WARGAMING_PLACEHOLDER_SECRET"] == "${{ secrets.TX_WARGAMING_PLACEHOLDER_SECRET }}"
assert "tfvars" not in deploy_text.lower()
assert "KEYCLOAK_ADMIN_CLIENT_SECRET" not in apply_step["with"]["script"]

print("TX-local Keycloak OpenTofu adoption contract OK")
PY
