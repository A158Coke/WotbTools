#!/usr/bin/env bash
# TX Business PostgreSQL OpenTofu ownership and production-safety contract.
#
# Responsibility split (do not duplicate the other layers here):
#   tofu fmt / tofu validate / plan  -> syntax, schema and provider-legal fields
#   infra/tofu/postgres-business/test-validate-plan.sh -> destructive plan policy
#   deploy/test-business-postgres-runtime.sh -> real disposable PostgreSQL apply
#   deploy/test-tx-runtime-config.sh         -> Compose runtime + deploy inputs
# This file pins what native tooling considers valid but would still break the
# project's ownership boundary or production safety.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/postgres-business"
workflow_text = (root / ".github/workflows/business-postgres.yml").read_text(encoding="utf-8")
ci_text = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
tx_deploy = (root / "deploy/tx/deploy.sh").read_text(encoding="utf-8")
tofurc = (root / "deploy/tx/business-postgres.tofurc").read_text(encoding="utf-8")
root_text = "\n".join(path.read_text(encoding="utf-8") for path in sorted(tofu_root.glob("*.tf")))
workflow = yaml.load(workflow_text, Loader=yaml.BaseLoader)
ci = yaml.load(ci_text, Loader=yaml.BaseLoader)


def flat(text):
    return re.sub(r"\s+", " ", text)


# --- CI validates this root; only the main-only owner applies on TX --------
assert "tofu_plans" in ci["jobs"]
assert "infra/tofu/postgres-business" in ci_text
assert "tofu apply" not in str(ci["jobs"]["tofu_plans"])
assert "remote-exec" not in root_text

events = workflow.get("on", workflow.get(True, {}))
assert events["push"]["branches"] == ["main"]
assert "infra/tofu/postgres-business/**" in events["push"]["paths"]
assert "workflow_dispatch" in events
freeze_step = next(step for step in workflow["jobs"]["business_postgres"]["steps"]
                   if step.get("name") == "Freeze current main")
freeze_script = freeze_step["run"]
assert '[[ "$EVENT_REF" == refs/heads/main ]]' in freeze_script
assert '"$(git rev-parse HEAD)" == "$SOURCE_SHA"' in freeze_script
assert '[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]' in freeze_script
assert "deploy/check-production-freshness.sh" in freeze_script
assert freeze_step["env"]["EVENT_SHA"] == "${{ github.sha }}"
assert 'echo "source_sha=$SOURCE_SHA" >> "$GITHUB_OUTPUT"' in freeze_script
pre_mutation = next(step for step in workflow["jobs"]["business_postgres"]["steps"]
                    if step.get("name") == "Reject stale main before TX mutation")
assert "deploy/check-production-freshness.sh" in pre_mutation["run"]
assert pre_mutation["env"]["EVENT_SHA"] == "${{ github.sha }}"

# --- the production owner shares the maintenance serialization boundary -----
expected_concurrency = {"group": "production-maintenance", "cancel-in-progress": "false", "queue": "max"}
assert workflow["concurrency"] == expected_concurrency

# --- provider, state and loopback ownership boundaries ----------------------
assert 'source  = "cyrilgdn/postgresql"' in root_text
assert 'version = "1.27.0"' in root_text
assert 'path = "/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate"' in root_text
assert 'var.postgresql_host == "127.0.0.1"' in root_text
assert "var.postgresql_port == 25432" in root_text
assert "password_wo" in root_text and "password_wo_version" in root_text

# --- Flyway owns every business table; OpenTofu owns only logical objects ---
for forbidden in ("postgresql_table", "postgresql_extension", "postgresql_sequence"):
    assert forbidden not in root_text, f"Flyway must own {forbidden} objects, not OpenTofu"
for kind, resource_name in (
    ("postgresql_role", "control_api"),
    ("postgresql_database", "wotb"),
    ("postgresql_grant", "control_api_database_access"),
    ("postgresql_role", "tofu_state"),
    ("postgresql_database", "tofu_state"),
    ("postgresql_grant", "tofu_state_database_access"),
    ("postgresql_grant", "tofu_state_revoke_public_database_access"),
    ("postgresql_grant", "tofu_state_revoke_public_schema_access"),
    ("postgresql_grant", "tofu_state_public_schema_access"),
):
    marker = f'resource "{kind}" "{resource_name}"'
    assert marker in root_text, marker
assert "prevent_destroy = true" in flat(root_text.split(marker, 1)[1].split("\n}\n", 1)[0]), resource_name

assert 'resource "postgresql_schema" "tofu_state"' in root_text
assert 'for_each = toset(var.tofu_state_schema_names)' in root_text
for schema_name in ("tofu_keycloak", "tofu_keycloak_postgres", "tofu_grafana"):
    assert schema_name in root_text
assert root_text.count("prevent_destroy = true") == 10

# --- the provider source is mirror-only -------------------------------------
tofurc_flat = flat(tofurc)
assert 'include = ["registry.opentofu.org/cyrilgdn/postgresql"]' in tofurc_flat
assert 'exclude = ["registry.opentofu.org/cyrilgdn/postgresql"]' in tofurc_flat
assert "/opt/wotb-tx/tofu-provider-mirror" in tofurc_flat

# --- the owner applies the exact guarded plan and proves convergence ---------
owner_job = workflow["jobs"]["business_postgres"]
tofu_step = next(step for step in owner_job["steps"]
                 if step.get("name") == "Reconcile runtime, apply exact Business PostgreSQL plan, and verify")
tofu_script = tofu_step["with"]["script"]
assert "flock -n 9" in tofu_script
assert "WOTB_DEPLOY_CONFIG_SHA" in tofu_script
assert '"$WOTB_DEPLOY_CONFIG_SHA" == "$SOURCE_SHA"' in tofu_script
assert "test -f /opt/wotb-tx/deploy/business-postgres.tofurc" in tofu_script
assert "bash ./validate-plan.sh plan.tfplan" in tofu_script
assert "bash ./validate-plan.sh second-plan.tfplan --require-no-changes" in tofu_script
assert "export TF_CLI_CONFIG_FILE=/opt/wotb-tx/deploy/business-postgres.tofurc" in tofu_script
assert "tofu plan -input=false -no-color -out=plan.tfplan" in tofu_script
assert "tofu apply -input=false -auto-approve plan.tfplan" in tofu_script
assert "tofu plan -input=false -no-color -out=second-plan.tfplan" in tofu_script
assert "business-postgres.tofu-provisioned" in tofu_script
assert "trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT" in tofu_script
assert "tfvars" not in tx_deploy.lower()
assert ' > "$BUSINESS_POSTGRES_TOFU_PROVISION_MARKER"' not in tx_deploy
assert "tofu apply -input=false -auto-approve plan.tfplan" in tofu_script

# --- secrets arrive as ordinary runtime names, never as TF_VAR names --------
assert "TF_VAR_" not in tofu_step["with"]["envs"], "SSH envs must carry runtime names, not TF_VAR names"
business_names = (
    "TX_BUSINESS_POSTGRES_ADMIN_USER",
    "TX_BUSINESS_POSTGRES_ADMIN_PASSWORD",
    "TX_BUSINESS_DB_NAME",
    "TX_BUSINESS_DB_USERNAME",
    "TX_BUSINESS_DB_PASSWORD",
    "TX_BUSINESS_DB_PASSWORD_VERSION",
)
for name in business_names:
    assert name in tofu_step["with"]["envs"].split(","), name
    assert name in tofu_step["env"], name
    assert name in tofu_script, name
for secret in ("TX_BUSINESS_POSTGRES_ADMIN_PASSWORD", "TX_BUSINESS_DB_PASSWORD"):
    assert f"{secret}: ${{{{ secrets." in workflow_text, secret
assert "TX_TOFU_STATE_PASSWORD" in tofu_step["with"]["envs"]
assert "TX_TOFU_STATE_PASSWORD" in tofu_step["env"]
assert "TF_VAR_tofu_state_role_password" in tofu_script
assert "TF_VAR_tofu_state_role_password_version" in tofu_script
assert "TX_TOFU_STATE_PASSWORD: ${{ secrets.TX_TOFU_STATE_PASSWORD }}" in workflow_text

print("TX Business PostgreSQL ownership and production-safety contract OK")
PY
