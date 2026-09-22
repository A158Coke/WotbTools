#!/usr/bin/env bash
# TX-local Keycloak OpenTofu ownership and production-safety contract. Reads
# repository files only, so it runs in the fast CI contract stage.
#
# Responsibility split (do not duplicate the other layers here):
#   tofu fmt / tofu validate / plan  -> syntax, schema and provider-legal fields
#   deploy/test-keycloak-tofu.sh     -> real fresh-realm apply + Admin API smoke
#   deploy/test-keycloak-runtime.sh  -> real Keycloak container contract
# This file only pins what native tooling considers valid but would still break
# the project's privilege boundary or production safety.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/keycloak"


def read(path):
    return (root / path).read_text(encoding="utf-8")


def flat(text):
    return re.sub(r"\s+", " ", text)


root_text = "\n".join(path.read_text(encoding="utf-8") for path in tofu_root.glob("*.tf"))
flat_root = flat(root_text)
versions = read("infra/tofu/keycloak/versions.tf")
providers = read("infra/tofu/keycloak/providers.tf")
identity_text = read("infra/tofu/keycloak/identity-providers.tf")
variables_text = read("infra/tofu/keycloak/variables.tf")
tx_compose = read("deploy/tx/docker-compose.yml")
tofu_script = read("deploy/tx/keycloak-tofu.sh")
deploy_text = read(".github/workflows/deploy.yml")
outputs_text = read("infra/tofu/keycloak/outputs.tf")

# --- reproducibility: provider pin, TLS verification, production state path --
assert 'keycloak/keycloak' in versions and 'version = "5.9.0"' in versions
assert "~>" not in versions
assert "tls_insecure_skip_verify = false" in providers
assert 'key    = "wotbtools/prod/keycloak.tfstate"' in root_text

# --- no out-of-band execution path around the provider -----------------------
for forbidden in ("remote-exec", "local-exec", "null_resource"):
    assert forbidden not in root_text, forbidden

# --- the Admin API service account never gains realm administration ----------
for forbidden in (
    "realm-admin",
    "manage-realm",
    "manage-clients",
    "manage-identity-providers",
    "manage-events",
    "impersonation",
):
    assert forbidden not in flat_root, f"over-privileged Admin API role: {forbidden}"
for required in ("manage-users", "query-users", "view-realm"):
    assert required in flat_root, required

# --- the Admin API client secret is write-only -------------------------------
assert "client_secret_wo = var.keycloak_admin_client_secret" in flat_root
assert "client_secret = var.keycloak_admin_client_secret" not in flat_root
assert "client_secret_wo_version" in flat_root

# --- the cutover E2E identity is confidential, minimal, and write-only -------
e2e_role_block = root_text.split(
    'resource "keycloak_openid_client_service_account_realm_role" "e2e"', 1
)
assert len(e2e_role_block) == 2, "the cutover E2E identity must be granted its realm role explicitly"
e2e_role_block = e2e_role_block[1].split("\n}\n", 1)[0]
assert 'keycloak_role.realm["wotbtools-user"].name' in e2e_role_block
for forbidden in ("wotbtools-admin", "boost-manager", "HoF-admin", "realm-admin"):
    assert forbidden not in e2e_role_block, f"cutover E2E identity must not hold {forbidden}"
assert 'client_id = "wotbtools-e2e"' in root_text, "cutover E2E client is missing"
assert "client_secret_wo             = var.e2e_client_secret" in root_text
assert "client_secret = var.e2e_client_secret" not in root_text
assert "client_secret_wo_version     = var.e2e_client_secret_version" in root_text
assert 'variable "e2e_client_secret"' in variables_text
assert 'variable "e2e_client_secret_version"' in variables_text
assert "KEYCLOAK_E2E_CLIENT_SECRET" in tofu_script, "the TX runner must forward the E2E secret"
assert "KEYCLOAK_E2E_CLIENT_SECRET" in deploy_text, "Deploy must inject the E2E secret"
assert "keycloak_openid_client.e2e" in read("infra/tofu/keycloak/validate-plan.sh"), \
    "the plan guard must protect the cutover E2E client"

# --- no legacy realm import and no resurrected aggregated QQ IdP -------------
for path_text in (read("docker/Dockerfile.keycloak"), tx_compose):
    assert "--import-realm" not in path_text
    assert "wotbtools-realm.json" not in path_text
flat_identity = flat(identity_text)
assert 'alias = "juhe-qq"' not in flat_identity
assert 'alias = "qq"' not in flat_identity
assert 'alias = "idp-qq"' in flat_identity
qq_block = identity_text.split('resource "keycloak_oidc_identity_provider" "qq"', 1)[1].split(
    "\n}\n\nlocals", 1
)[0]
assert 'client_secret_wo         = var.qq_client_secret' in qq_block
assert "prevent_destroy = true" in qq_block
assert "ignore_changes" not in qq_block
assert "bootstrap-not-configured" not in qq_block
assert "client_secret = var.qq_client_secret" not in qq_block
for expected in (
    'variable "qq_client_id"',
    'variable "qq_client_secret"',
    'variable "qq_client_secret_version"',
    'variable "qq_enabled"',
    "sensitive   = true",
):
    assert expected in variables_text, expected

# --- Wargaming IdP client_id is owned by the single existing WG secret -------
# The representation's client_id is not a placeholder any more, and the
# Wargaming application ID never reaches the repository as a second secret.
assert 'client_id    = var.wargaming_application_id' in identity_text, \
    "the Wargaming IdPs must consume the Wargaming application ID variable"
assert 'client_id    = "not-used"' not in identity_text, \
    "the Wargaming client_id placeholder is not the production model"
assert 'provider_id  = "wargaming"' in identity_text
for alias in ('alias        = "wargaming-asia"', 'alias        = "wargaming-eu"', 'alias        = "wargaming-na"'):
    assert alias in identity_text, alias
# One application ID serves all three regions, so the resource must read the
# variable exactly once instead of declaring a second per-instance source.
assert identity_text.count("var.wargaming_application_id") == 1
assert 'client_secret_wo         = "not-used"' in identity_text, \
    "the Wargaming OIDC adapter secret must stay the fixed schema placeholder"
wg_variable = variables_text.split('variable "wargaming_application_id"', 1)
assert len(wg_variable) == 2, "the Wargaming application ID must be a declared variable"
wg_variable = wg_variable[1].split("\n}\n", 1)[0]
for expected in ("type        = string", "sensitive   = true", "nullable    = false", "validation {"):
    assert expected in wg_variable, expected
assert 'contains(' in wg_variable and "not-used" in wg_variable, \
    "the Wargaming application ID must reject blank values and known placeholders"
for forbidden in ("TX_WG_APPLICATION_ID", "WG_CLIENT_ID", "WARGAMING_CLIENT_ID"):
    assert forbidden not in deploy_text, f"duplicate Wargaming credential source: {forbidden}"
    assert forbidden not in tofu_script, f"duplicate Wargaming credential source: {forbidden}"
for expected in (
    "WG_APPLICATION_ID",
    "TF_VAR_wargaming_application_id",
):
    assert expected in tofu_script, expected
assert 'export TF_VAR_wargaming_application_id="$WG_APPLICATION_ID"' in tofu_script
assert "WG_APPLICATION_ID" in deploy_text, "Deploy must inject the existing Wargaming secret"
assert "wargaming_application_id" not in outputs_text, "the Wargaming application ID must not be a Tofu output"
assert "qq_client_secret" not in outputs_text, "the QQ application secret must not be a Tofu output"

# --- production QQ inputs are only supplied through the TX deployment path --
for expected in (
    "TX_QQ_CLIENT_ID",
    "TX_QQ_CLIENT_SECRET",
    "TX_QQ_CLIENT_SECRET_VERSION",
    "TF_VAR_qq_client_id",
    "TF_VAR_qq_client_secret",
    "TF_VAR_qq_client_secret_version",
    "must not be a placeholder",
    "must be a positive integer",
):
    assert expected in tofu_script
assert "tfvars" not in deploy_text.lower()
assert 'echo "$KEYCLOAK_ADMIN_CLIENT_SECRET"' not in tofu_script

# --- Keycloak administration stays TX-loopback only --------------------------
assert '"127.0.0.1:18080:8080"' in tx_compose
assert '"0.0.0.0:18080:8080"' not in tx_compose

# --- the TX deploy path keeps the plan gates --------------------------------
assert "bash ./validate-plan.sh plan.tfplan" in tofu_script
assert "bash ./validate-plan.sh second-plan.tfplan" in tofu_script
assert "tofu apply -input=false -auto-approve plan.tfplan" in tofu_script
assert "second-plan.tfplan" in tofu_script
assert "any(.resource_changes[]?; ((.change.actions // []) | any(. != \"no-op\")))" in tofu_script

# --- the realm is applied only after an empty Keycloak is up -----------------
deploy = yaml.safe_load(deploy_text)
steps = deploy["jobs"]["deploy_tx"]["steps"]
names = [step.get("name", "") for step in steps]
for name in (
    "Install Keycloak OpenTofu root on TX",
    "Bootstrap TX Keycloak PostgreSQL before OpenTofu",
    "Start empty TX Keycloak for OpenTofu bootstrap",
    "Apply Keycloak OpenTofu on TX localhost",
):
    assert name in names, name
assert names.index("Bootstrap TX Keycloak PostgreSQL before OpenTofu") < names.index(
    "Start empty TX Keycloak for OpenTofu bootstrap"
) < names.index("Apply Keycloak OpenTofu on TX localhost")
apply_step = next(step for step in steps if step.get("name") == "Apply Keycloak OpenTofu on TX localhost")
apply_envs = set(apply_step["with"]["envs"].split(","))
assert apply_envs == {
    "KEYCLOAK_ADMIN_USERNAME",
    "KEYCLOAK_ADMIN_PASSWORD",
    "KEYCLOAK_ADMIN_CLIENT_SECRET",
    "KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION",
    "KEYCLOAK_E2E_CLIENT_SECRET",
    "KEYCLOAK_E2E_CLIENT_SECRET_VERSION",
    "WG_APPLICATION_ID",
    "TX_QQ_CLIENT_ID",
    "TX_QQ_CLIENT_SECRET",
    "TX_QQ_CLIENT_SECRET_VERSION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
}
assert apply_step["env"]["KEYCLOAK_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_BOOTSTRAP_ADMIN_PASSWORD }}"
assert apply_step["env"]["KEYCLOAK_ADMIN_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_ADMIN_CLIENT_SECRET }}"
assert apply_step["env"]["KEYCLOAK_E2E_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_E2E_CLIENT_SECRET }}"
# The OpenTofu step reuses the existing WG_APPLICATION_ID secret and never
# declares a Wargaming-specific TF_VAR name in the workflow itself.
assert apply_step["env"]["WG_APPLICATION_ID"] == "${{ secrets.WG_APPLICATION_ID }}"
assert apply_step["env"]["TX_QQ_CLIENT_ID"] == "${{ vars.TX_QQ_CLIENT_ID }}"
assert apply_step["env"]["TX_QQ_CLIENT_SECRET"] == "${{ secrets.TX_QQ_CLIENT_SECRET }}"
assert apply_step["env"]["TX_QQ_CLIENT_SECRET_VERSION"] == "${{ vars.TX_QQ_CLIENT_SECRET_VERSION }}"
assert "TF_VAR_" not in apply_step["with"]["envs"]
assert "KEYCLOAK_ADMIN_CLIENT_SECRET" not in apply_step["with"]["script"]

print("TX-local Keycloak ownership and production-safety contract OK")
PY
