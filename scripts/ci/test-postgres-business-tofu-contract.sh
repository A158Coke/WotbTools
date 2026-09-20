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
workflow_text = (root / ".github/workflows/postgres-business-tofu.yml").read_text(encoding="utf-8")
deploy_text = (root / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
tx_deploy = (root / "deploy/tx/deploy.sh").read_text(encoding="utf-8")
tofurc = (root / "deploy/tx/business-postgres.tofurc").read_text(encoding="utf-8")
root_text = "\n".join(path.read_text(encoding="utf-8") for path in sorted(tofu_root.glob("*.tf")))
workflow = yaml.safe_load(workflow_text)
deploy = yaml.safe_load(deploy_text)


def flat(text):
    return re.sub(r"\s+", " ", text)


# --- the PR workflow runs for this root and never applies from a runner -----
triggers = workflow.get("on", workflow.get(True))
assert "infra/tofu/postgres-business/**" in triggers["pull_request"]["paths"]
assert triggers["push"]["branches"] == ["main"]
assert "tofu apply" not in workflow_text
for forbidden in ("apply_on_tx", "ssh", "remote-exec", "tunnel"):
    assert forbidden not in workflow_text, forbidden

# --- both apply paths share one serialization boundary ----------------------
expected_concurrency = {"group": "production-maintenance", "cancel-in-progress": False}
assert workflow["concurrency"] == expected_concurrency
assert deploy["concurrency"] == expected_concurrency

# --- provider, state and loopback ownership boundaries ----------------------
assert 'source  = "cyrilgdn/postgresql"' in root_text
assert 'version = "1.27.0"' in root_text
assert 'path = "/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate"' in root_text
assert 'var.postgresql_host == "127.0.0.1"' in root_text
assert "var.postgresql_port == 25432" in root_text
assert "password_wo" in root_text and "password_wo_version" in root_text

# --- Flyway owns every business table; OpenTofu owns only logical objects ---
for forbidden in ("postgresql_table", "postgresql_schema", "postgresql_extension", "postgresql_sequence"):
    assert forbidden not in root_text, f"Flyway must own {forbidden} objects, not OpenTofu"
for kind, resource_name in (
    ("postgresql_role", "control_api"),
    ("postgresql_database", "wotb"),
    ("postgresql_grant", "control_api_database_access"),
):
    marker = f'resource "{kind}" "{resource_name}"'
    assert marker in root_text, marker
    assert "prevent_destroy = true" in flat(root_text.split(marker, 1)[1].split("\n}\n", 1)[0]), resource_name

# --- the provider source is mirror-only -------------------------------------
tofurc_flat = flat(tofurc)
assert 'include = ["registry.opentofu.org/cyrilgdn/postgresql"]' in tofurc_flat
assert 'exclude = ["registry.opentofu.org/cyrilgdn/postgresql"]' in tofurc_flat
assert "/opt/wotb-tx/tofu-provider-mirror" in tofurc_flat

# --- the TX deploy path keeps both plan gates and one marker owner ----------
assert "bash ./validate-plan.sh plan.tfplan" in tx_deploy
assert "bash ./validate-plan.sh second-plan.tfplan --require-no-changes" in tx_deploy
assert 'TF_CLI_CONFIG_FILE="$BUSINESS_POSTGRES_TOFU_CLI_CONFIG"' in flat(tx_deploy)
assert "tfvars" not in tx_deploy.lower()
assert "business-postgres.tofu-provisioned" not in deploy_text, (
    "only deploy.sh creates the provisioning marker on TX"
)

# --- secrets arrive as ordinary runtime names, never as TF_VAR names --------
deploy_step = next(
    step for step in deploy["jobs"]["deploy_tx"]["steps"] if step.get("name") == "Deploy exact TX services via SSH"
)
assert "TF_VAR_" not in deploy_step["with"]["envs"], "SSH envs must carry runtime names, not TF_VAR names"
business_names = (
    "TX_BUSINESS_POSTGRES_ADMIN_USER",
    "TX_BUSINESS_POSTGRES_ADMIN_PASSWORD",
    "TX_BUSINESS_DB_NAME",
    "TX_BUSINESS_DB_USERNAME",
    "TX_BUSINESS_DB_PASSWORD",
    "TX_BUSINESS_DB_PASSWORD_VERSION",
)
for name in business_names:
    assert name in deploy_step["with"]["envs"].split(","), name
    assert name in deploy_step["env"], name
    assert name in tx_deploy, name
for secret in ("TX_BUSINESS_POSTGRES_ADMIN_PASSWORD", "TX_BUSINESS_DB_PASSWORD"):
    assert f"{secret}: ${{{{ secrets." in deploy_text, secret

print("TX Business PostgreSQL ownership and production-safety contract OK")
PY
