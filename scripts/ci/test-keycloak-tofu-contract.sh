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
identity_text = (tofu_root / "identity-providers.tf").read_text(encoding="utf-8")
deploy_text = (root / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
tx_compose = (root / "deploy/tx/docker-compose.yml").read_text(encoding="utf-8")
keycloak_dockerfile = (root / "docker/Dockerfile.keycloak").read_text(encoding="utf-8")
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

# wotbtools-web is the browser client: it must declare the production parity
# settings explicitly (theme, front-channel logout, consent, PKCE), while the
# confidential service-account client must stay free of browser-flow settings.
client_text = (tofu_root / "client.tf").read_text(encoding="utf-8")
web_block = " ".join(
    client_text.split('resource "keycloak_openid_client" "web"', 1)[1]
    .split('resource "keycloak_openid_client" "admin_api"', 1)[0]
    .split()
)
for expected in (
    'access_type = "PUBLIC"',
    "standard_flow_enabled = true",
    "implicit_flow_enabled = false",
    "direct_access_grants_enabled = false",
    "service_accounts_enabled = false",
    "consent_required = false",
    'login_theme = "wotbtools"',
    "frontchannel_logout_enabled = true",
    'pkce_code_challenge_method = ""',
    '"frontchannel.logout.session.required" = "true"',
    "prevent_destroy = true",
):
    assert expected in web_block, f"wotbtools-web production parity declaration missing: {expected}"
admin_api_block = " ".join(
    client_text.split('resource "keycloak_openid_client" "admin_api"', 1)[1].split()
)
for forbidden in (
    "login_theme",
    "frontchannel_logout_enabled",
    "consent_required",
    "pkce_code_challenge_method",
    "extra_config",
    "valid_redirect_uris",
    "web_origins",
):
    assert forbidden not in admin_api_block, (
        f"browser-only client setting leaked into wotbtools-admin-api: {forbidden}"
    )
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
assert 'alias        = "idp-qq"' in identity_text
assert 'alias        = "wargaming-asia"' in root_text
assert 'alias        = "wargaming-eu"' in root_text
assert 'alias        = "wargaming-na"' in root_text
assert 'alias                    = "qq"' not in root_text
assert 'alias                    = "juhe-qq"' not in root_text
assert 'client_id                = "bootstrap-not-configured"' in identity_text
assert 'client_secret_wo         = "bootstrap-not-configured"' in identity_text
assert 'client_secret_wo_version = "1"' in identity_text
assert '''lifecycle {
    ignore_changes = [
      client_id,
      client_secret_wo,
      client_secret_wo_version,
      enabled,
    ]
  }''' in identity_text
qq_block = identity_text.split('resource "keycloak_oidc_identity_provider" "qq"', 1)[1].split("\n}\n\nlocals", 1)[0]
wargaming_block = identity_text.split('resource "keycloak_oidc_identity_provider" "wargaming"', 1)[1]
assert 'enabled                  =' not in qq_block
assert 'enabled      =' not in wargaming_block
assert wargaming_block.count('ignore_changes') == 1
assert 'ignore_changes = [\n      enabled,\n    ]' in wargaming_block
assert 'client_id    = "not-used"' in identity_text
assert 'client_secret_wo         = "not-used"' in identity_text
assert 'client_secret_wo_version = "1"' in identity_text
assert not any(
    forbidden in root_text
    for forbidden in (
        "qq_client_id",
        "qq_client_secret",
        "wargaming_placeholder_secret",
    )
)

for path_text in (keycloak_dockerfile, tx_compose):
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
for forbidden in (
    "QQ_CLIENT_ID",
    "QQ_CLIENT_SECRET",
    "QQ_CLIENT_SECRET_VERSION",
    "WARGAMING_PLACEHOLDER_SECRET",
    "WARGAMING_PLACEHOLDER_SECRET_VERSION",
    "TF_VAR_qq_client",
    "TF_VAR_wargaming_placeholder",
):
    assert forbidden not in tofu_script
assert 'echo "$KEYCLOAK_ADMIN_CLIENT_SECRET"' not in tofu_script
assert 'printf' in tofu_script
assert 'TOFU_CLI_CONFIG="${TF_CLI_CONFIG_FILE:-/opt/wotb-tx/tofurc}"' in tofu_script
assert '[ -f "$TOFU_CLI_CONFIG" ] || {' in tofu_script
assert 'echo "ERROR: OpenTofu CLI config not found: $TOFU_CLI_CONFIG" >&2' in tofu_script
assert 'export TF_CLI_CONFIG_FILE="$TOFU_CLI_CONFIG"' in tofu_script
assert tofu_script.index('TOFU_CLI_CONFIG="${TF_CLI_CONFIG_FILE:-/opt/wotb-tx/tofurc}"') < tofu_script.index('tofu init -reconfigure -input=false')
assert tofu_script.index('export TF_CLI_CONFIG_FILE="$TOFU_CLI_CONFIG"') < tofu_script.index('tofu init -reconfigure -input=false')
assert 'bash ./validate-plan.sh plan.tfplan' in tofu_script
assert 'bash ./validate-plan.sh second-plan.tfplan' in tofu_script
assert 'tofu apply -input=false -auto-approve plan.tfplan' in tofu_script
assert 'second-plan.tfplan' in tofu_script
assert "if jq -e 'any(.resource_changes[]?; ((.change.actions // []) | any(. != \"no-op\")))'" in tofu_script
assert 'echo "ERROR: Keycloak OpenTofu second plan is not No changes." >&2' in tofu_script
assert 'install -d -m 700 /opt/wotb-tx' in tofu_script
assert 'tx-local-opentofu-keycloak' in tofu_script

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
apply_envs = set(apply_step["with"]["envs"].split(","))
assert apply_envs == {
    "KEYCLOAK_ADMIN_USERNAME",
    "KEYCLOAK_ADMIN_PASSWORD",
    "KEYCLOAK_ADMIN_CLIENT_SECRET",
    "KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
}
assert apply_step["env"]["KEYCLOAK_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_BOOTSTRAP_ADMIN_PASSWORD }}"
assert apply_step["env"]["KEYCLOAK_ADMIN_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_ADMIN_CLIENT_SECRET }}"
for forbidden in (
    "TX_QQ_CLIENT_ID",
    "TX_QQ_CLIENT_SECRET",
    "TX_QQ_CLIENT_SECRET_VERSION",
    "TX_WARGAMING_PLACEHOLDER_SECRET",
    "TX_WARGAMING_PLACEHOLDER_SECRET_VERSION",
):
    assert forbidden not in deploy_text
assert "tfvars" not in deploy_text.lower()
assert "KEYCLOAK_ADMIN_CLIENT_SECRET" not in apply_step["with"]["script"]

print("TX-local Keycloak OpenTofu adoption contract OK")
PY
