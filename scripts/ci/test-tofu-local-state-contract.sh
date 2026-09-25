#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
expected = {
    "postgres-business": ("infra/tofu/postgres-business", "/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate"),
    "postgres-keycloak": ("infra/tofu/postgres-keycloak", "/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate"),
    "keycloak": ("infra/tofu/keycloak", "/opt/wotb-tx/keycloak-tofu-state/terraform.tfstate"),
    "grafana": ("infra/tofu/grafana", "/opt/wotb/grafana-tofu-state/terraform.tfstate"),
}
for name, (relative, state_path) in expected.items():
    root_text = "\n".join(path.read_text(encoding="utf-8") for path in (root / relative).glob("*.tf"))
    assert 'backend "local"' in root_text, name
    assert state_path in root_text, name
    for forbidden in ('backend "pg"', 'backend "s3"', 'tofu_state', 'tofu_keycloak'):
        assert forbidden not in root_text, (name, forbidden)

workflow_roots = {
    "postgres-business": ".github/workflows/business-postgres.yml",
    "postgres-keycloak": ".github/workflows/keycloak-postgres.yml",
    "keycloak": ".github/workflows/keycloak.yml",
    "grafana": ".github/workflows/observability.yml",
}
for name, path in workflow_roots.items():
    text = (root / path).read_text(encoding="utf-8")
    _, state_path = expected[name]
    assert state_path in text
    assert "! -L \"$state_file\"" in text, name
    assert "missing or unsafe" in text, name

for path in (
    ".github/workflows/keycloak.yml",
    ".github/workflows/keycloak-postgres.yml",
    ".github/workflows/observability.yml",
):
    text = (root / path).read_text(encoding="utf-8")
    for removed in ("TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        assert removed not in text, (path, removed)

migration = (root / "deploy/tofu-cos-to-local.sh").read_text(encoding="utf-8")
assert "init -migrate-state -force-copy -input=false" in migration
assert migration.count("-detailed-exitcode") == 2
assert "Destination state data already exists; refusing to overwrite it" in migration
assert '"$state_path.backup" "$state_path.lock.info"' in migration
assert "Source and destination resource address sets differ" in migration
assert "tofu state pull" not in migration
assert "tofu apply" not in migration
assert "TF_VAR_keycloak_admin_password TF_VAR_keycloak_admin_client_secret" in migration
assert "TF_VAR_postgresql_admin_password TF_VAR_keycloak_role_password" in migration
assert "unset TF_LOG TF_LOG_PATH TF_LOG_CORE TF_LOG_PROVIDER" in migration

backup = (root / "deploy/tofu-local-state-backup.sh").read_text(encoding="utf-8")
for required in (
    "postgres-business-tofu-state/terraform.tfstate",
    "postgres-keycloak-tofu-state/terraform.tfstate",
    "keycloak-tofu-state/terraform.tfstate",
    "grafana-tofu-state/terraform.tfstate",
):
    assert required in backup
assert "chmod 600" in backup and "sha256sum" in backup and "tar -tzf" in backup

workflow = yaml.load((root / ".github/workflows/database-backup.yml").read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
assert not any(job.get("environment") for job in workflow["jobs"].values())
workflow_text = (root / ".github/workflows/database-backup.yml").read_text(encoding="utf-8")
assert "tofu-local-state-backup.sh yecao" in workflow_text
assert "tofu-local-state-backup.sh tx" in workflow_text

print("Owner-host local OpenTofu state, migration, and backup contracts OK")
PY
