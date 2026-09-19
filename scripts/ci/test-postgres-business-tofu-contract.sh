#!/usr/bin/env bash
# Static contract for the isolated TX Business PostgreSQL provisioning path.
# It never contacts TX, a database, or the OpenTofu registry.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/postgres-business"
workflow_path = root / ".github/workflows/postgres-business-tofu.yml"
tx_compose = (root / "deploy/tx/docker-compose.yml").read_text(encoding="utf-8")
tx_deploy = (root / "deploy/tx/deploy.sh").read_text(encoding="utf-8")
deploy_text = (root / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
tofurc = (root / "deploy/tx/business-postgres.tofurc").read_text(encoding="utf-8")
root_text = "\n".join(path.read_text(encoding="utf-8") for path in sorted(tofu_root.glob("*.tf")))

workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
triggers = workflow.get("on", workflow.get(True))
assert workflow["name"] == "Infra / TX Business PostgreSQL"
for event in ("pull_request", "push"):
    assert "infra/tofu/postgres-business/**" in triggers[event]["paths"], event
    assert ".github/workflows/postgres-business-tofu.yml" in triggers[event]["paths"], event
    assert "scripts/ci/test-postgres-business-tofu-contract.sh" in triggers[event]["paths"], event
assert triggers["push"]["branches"] == ["main"]
assert "workflow_dispatch" in triggers

# Both apply paths can mutate the same serialized production surface. The
# isolated root never applies on a GitHub runner.
assert workflow["concurrency"] == {"group": "production-maintenance", "cancel-in-progress": False}
assert yaml.safe_load(deploy_text)["concurrency"] == workflow["concurrency"], (
    "deploy.yml and the Business PostgreSQL workflow must share one serialization boundary"
)
assert "tofu apply" not in workflow_path.read_text(encoding="utf-8")
workflow_text = workflow_path.read_text(encoding="utf-8")
assert "tofu init -backend=false -input=false" in workflow_text
assert "tofu fmt -check -recursive" in workflow_text
assert "tofu validate" in workflow_text
assert "test-postgres-business-tofu-contract.sh" in workflow_text
for forbidden in ("ssh", "remote-exec", "apply_on_tx", "tunnel"):
    assert forbidden not in workflow_text, f"the PR workflow must stay runner-local and read-only: {forbidden}"

# Compose owns the runtime; OpenTofu owns only logical PostgreSQL resources.
assert "image: postgres:18-alpine" in tx_compose
assert '127.0.0.1:25432:5432' in tx_compose
assert "business_postgres_data:/var/lib/postgresql" in tx_compose
assert "business_postgres_data:" in tx_compose
assert 'POSTGRES_DB: postgres' in tx_compose
assert 'TX_BUSINESS_POSTGRES_ADMIN_USER:?TX_BUSINESS_POSTGRES_ADMIN_USER is required' in tx_compose
assert 'TX_BUSINESS_POSTGRES_ADMIN_PASSWORD:?TX_BUSINESS_POSTGRES_ADMIN_PASSWORD is required' in tx_compose

assert 'resource "postgresql_role" "control_api"' in root_text
assert 'resource "postgresql_database" "wotb"' in root_text
assert 'resource "postgresql_grant" "control_api_database_access"' in root_text
assert root_text.count("prevent_destroy = true") == 3
assert "password_wo" in root_text and "password_wo_version" in root_text
for forbidden in ("postgresql_table", "postgresql_schema", "postgresql_extension", "postgresql_sequence"):
    assert forbidden not in root_text, f"Flyway must own {forbidden} objects, not OpenTofu"
assert 'version = "1.27.0"' in root_text
assert 'path = "/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate"' in root_text
assert "postgresql_port == 25432" in root_text
assert 'var.postgresql_host == "127.0.0.1"' in root_text
assert (tofu_root / ".terraform.lock.hcl").is_file(), "the provider lock file must be committed"
assert (tofu_root / "validate-plan.sh").is_file()
assert (tofu_root / "test-validate-plan.sh").is_file()

assert "filesystem_mirror" in tofurc
assert 'include = ["registry.opentofu.org/cyrilgdn/postgresql"]' in tofurc
assert 'exclude = ["registry.opentofu.org/cyrilgdn/postgresql"]' in tofurc
assert "/opt/wotb-tx/tofu-provider-mirror" in tofurc

# The deploy helper provisions Business PostgreSQL on TX against its own
# loopback port and never touches the Keycloak database.
assert "business-postgres" in tx_deploy
assert "BUSINESS_POSTGRES_TOFU_ROOT" in tx_deploy
assert "business-postgres.tofurc" in tx_deploy
assert "business-postgres.tofu-provisioned" in tx_deploy
assert "second-plan.tfplan --require-no-changes" in tx_deploy
# bash disables errexit for a function invoked from an `||` list, so the
# provisioning steps must be chained explicitly instead of relying on set -e.
assert "tofu init -reconfigure -input=false -lockfile=readonly \\" in tx_deploy
assert "&& bash ./validate-plan.sh second-plan.tfplan --require-no-changes" in tx_deploy
assert "apply_and_provision()" in tx_deploy
assert "provision_business_postgres || return 1" in tx_deploy
assert "apply_services || ! " not in tx_deploy
assert "TF_CLI_CONFIG_FILE=\"$BUSINESS_POSTGRES_TOFU_CLI_CONFIG\"" in tx_deploy
for name in (
    "TX_BUSINESS_POSTGRES_ADMIN_USER",
    "TX_BUSINESS_POSTGRES_ADMIN_PASSWORD",
    "TX_BUSINESS_DB_NAME",
    "TX_BUSINESS_DB_USERNAME",
    "TX_BUSINESS_DB_PASSWORD",
    "TX_BUSINESS_DB_PASSWORD_VERSION",
):
    assert name in tx_deploy, name
    assert tx_deploy.count(name) >= 2, name
assert "tfvars" not in tx_deploy.lower()

deploy = yaml.safe_load(deploy_text)
steps = deploy["jobs"]["deploy_tx"]["steps"]
root_install = next(
    step for step in steps if step.get("name") == "Install Business PostgreSQL OpenTofu root on TX"
)
assert root_install["with"]["source"] == "infra/tofu/postgres-business"
assert "business-postgres" in root_install["if"]
deploy_step = next(
    step for step in steps if step.get("name") == "Deploy exact TX services via SSH"
)
for name in (
    "TX_BUSINESS_POSTGRES_ADMIN_USER",
    "TX_BUSINESS_POSTGRES_ADMIN_PASSWORD",
    "TX_BUSINESS_DB_NAME",
    "TX_BUSINESS_DB_USERNAME",
    "TX_BUSINESS_DB_PASSWORD",
    "TX_BUSINESS_DB_PASSWORD_VERSION",
):
    assert name in deploy_step["with"]["envs"].split(","), name
    assert name in deploy_step["env"], name
    assert "TF_VAR_" not in deploy_step["with"]["envs"], "SSH envs must carry runtime names, not TF_VAR names"
assert "business-postgres" in deploy_text
assert "TX_BUSINESS_POSTGRES_ADMIN_PASSWORD: ${{ secrets." in deploy_text
assert "TX_BUSINESS_DB_PASSWORD: ${{ secrets." in deploy_text
assert "business-postgres.tofu-provisioned" not in deploy_text, (
    "only deploy.sh creates the provisioning marker on TX"
)

print("TX Business PostgreSQL OpenTofu/workflow/deploy contract OK")
PY

echo "TX Business PostgreSQL contract OK"
