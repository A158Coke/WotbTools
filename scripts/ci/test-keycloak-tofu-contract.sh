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
client_text = read("infra/tofu/keycloak/client.tf")
identity_text = read("infra/tofu/keycloak/identity-providers.tf")
tx_compose = read("deploy/tx/docker-compose.yml")
tofu_script = read("deploy/tx/keycloak-tofu.sh")
deploy_text = read(".github/workflows/deploy.yml")

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

# --- the admin client is a machine identity only -----------------------------
admin_api = flat(client_text.split('resource "keycloak_openid_client" "admin_api"', 1)[1])
web = flat(
    client_text.split('resource "keycloak_openid_client" "web"', 1)[1].split(
        'resource "keycloak_openid_client" "admin_api"', 1
    )[0]
)
assert 'access_type = "CONFIDENTIAL"' in admin_api
assert "service_accounts_enabled = true" in admin_api
for forbidden in (
    "standard_flow_enabled = true",
    "implicit_flow_enabled = true",
    "direct_access_grants_enabled = true",
    "valid_redirect_uris",
    "web_origins",
):
    assert forbidden not in admin_api, f"browser login enabled on the Admin API client: {forbidden}"
for block in (web, admin_api):
    assert "prevent_destroy = true" in block

# --- the Admin API client secret is write-only -------------------------------
assert "client_secret_wo = var.keycloak_admin_client_secret" in flat_root
assert "client_secret = var.keycloak_admin_client_secret" not in flat_root
assert "client_secret_wo_version" in flat_root

# --- no legacy realm import and no resurrected aggregated QQ IdP -------------
for path_text in (read("docker/Dockerfile.keycloak"), tx_compose):
    assert "--import-realm" not in path_text
    assert "wotbtools-realm.json" not in path_text
assert "juhe-qq" not in flat_root
assert 'alias = "qq"' not in flat_root
assert 'alias = "idp-qq"' in flat(identity_text)
# Bootstrap owns only the initial IdP state; an operator manages `enabled`.
assert "ignore_changes = [ enabled, ]" in flat(identity_text)

# --- production secrets are never hardcoded or plumbed as OpenTofu variables -
assert not any(
    forbidden in flat_root
    for forbidden in ("qq_client_id", "qq_client_secret", "wargaming_placeholder_secret")
)
for forbidden in (
    "QQ_CLIENT_ID",
    "QQ_CLIENT_SECRET",
    "QQ_CLIENT_SECRET_VERSION",
    "WARGAMING_PLACEHOLDER_SECRET",
    "WARGAMING_PLACEHOLDER_SECRET_VERSION",
    "TF_VAR_qq_client",
    "TF_VAR_wargaming_placeholder",
):
    assert forbidden not in deploy_text
assert "tfvars" not in deploy_text.lower()
assert 'echo "$KEYCLOAK_ADMIN_CLIENT_SECRET"' not in tofu_script

# --- Keycloak administration stays TX-loopback only --------------------------
assert '"127.0.0.1:18080:8080"' in tx_compose
assert '"0.0.0.0:18080:8080"' not in tx_compose

# --- the TX deploy path keeps the plan gates --------------------------------
assert "bash ./validate-plan.sh plan.tfplan" in tofu_script
assert "bash ./validate-plan.sh second-plan.tfplan" in tofu_script
assert "tofu apply -input=false -auto-approve plan.tfplan" in tofu_script

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
assert apply_step["env"]["KEYCLOAK_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_BOOTSTRAP_ADMIN_PASSWORD }}"
assert apply_step["env"]["KEYCLOAK_ADMIN_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_ADMIN_CLIENT_SECRET }}"
assert "TF_VAR_" not in apply_step["with"]["envs"]
assert "KEYCLOAK_ADMIN_CLIENT_SECRET" not in apply_step["with"]["script"]

print("TX-local Keycloak ownership and production-safety contract OK")
PY
