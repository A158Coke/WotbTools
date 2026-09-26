#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import json
import re
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
ci = yaml.load(
    (root / ".github/workflows/ci.yml").read_text(encoding="utf-8"),
    Loader=yaml.BaseLoader,
)
tofu_job = ci["jobs"]["tofu_plans"]
steps = tofu_job["steps"]

def step(name):
    return next(item for item in steps if item.get("name") == name)

assert tofu_job["if"] == "needs.changes.outputs.tofu_roots != '[]'"
assert tofu_job["name"] == "OpenTofu validation / ${{ matrix.root }}"
assert "${{ secrets." not in json.dumps(tofu_job)
assert "tofu fmt -check -recursive" in step("Format, initialize without production state, and validate")["run"]
validation = step("Format, initialize without production state, and validate")["run"]
assert "tofu init -backend=false -input=false" in validation
assert "tofu validate" in validation
assert not re.search(r"(?i)\btofu(?:\s+-[^\s]+)*\s+(?:plan|apply)\b", json.dumps(tofu_job))
assert "init -reconfigure" not in json.dumps(tofu_job)

root_resolver = step("Resolve one declared root")["run"]
root_paths = {
    "keycloak": "infra/tofu/keycloak",
    "rabbitmq": "infra/tofu/rabbitmq",
    "business-postgres": "infra/tofu/postgres-business",
    "keycloak-postgres": "infra/tofu/postgres-keycloak",
    "minio": "infra/tofu/minio",
    "grafana": "infra/tofu/grafana",
}
for name, path in root_paths.items():
    assert f"{name}) path={path}" in root_resolver, name
fixture_step = step("Validate local-root safety policy fixtures")["run"]
assert "rabbitmq|minio|business-postgres" in fixture_step
assert "test-validate-plan.sh" in fixture_step

deploy_runs = "\n".join(
    item.get("run", "")
    for item in ci["jobs"]["deploy_smoke"]["steps"]
)
for fixture in (
    "test-keycloak-tofu-contract.sh",
    "test-postgres-keycloak-tofu-contract.sh",
    "test-postgres-business-tofu-contract.sh",
):
    assert fixture in deploy_runs, fixture

print("PR OpenTofu validation has no plan/apply or production credentials")
PY

# Production local state is owner-host persistent, never SHA-staged. Keep the
# bootstrap gate and backup inventory in this existing OpenTofu contract entry.
python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
expected = {
    "postgres-business": ("infra/tofu/postgres-business", "/opt/wotb-tx/postgres-business-tofu-state", False),
    "postgres-keycloak": ("infra/tofu/postgres-keycloak", "/opt/wotb-tx/postgres-keycloak-tofu-state", True),
    "keycloak": ("infra/tofu/keycloak", "/opt/wotb-tx/keycloak-tofu-state", True),
    "grafana": ("infra/tofu/grafana", "/opt/wotb/grafana-tofu-state", True),
}
workflow_roots = {
    "postgres-business": ".github/workflows/business-postgres.yml",
    "postgres-keycloak": ".github/workflows/keycloak-postgres.yml",
    "keycloak": ".github/workflows/keycloak.yml",
    "grafana": ".github/workflows/observability.yml",
}
for name, (relative, state_dir, requires_marker) in expected.items():
    state_path = f"{state_dir}/terraform.tfstate"
    root_text = "\n".join(path.read_text(encoding="utf-8") for path in (root / relative).glob("*.tf"))
    assert 'backend "local"' in root_text, name
    assert state_path in root_text, name
    assert "tofu_state" not in root_text, name
    assert 'backend "pg"' not in root_text and 'backend "s3"' not in root_text, name
    workflow_text = (root / workflow_roots[name]).read_text(encoding="utf-8")
    assert state_dir in workflow_text, name
    assert "local opentofu state is not bootstrapped" in workflow_text.lower(), name
    assert "! -L \"$state_file\"" in workflow_text, name
    assert "-f \"$state_file\"" in workflow_text, name
    assert "$SOURCE_SHA" not in state_dir
    if requires_marker:
        assert "bootstrap-complete" in workflow_text, name
        assert "local-tofu-state-bootstrap-v1" in workflow_text, name
    for credential in ("TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        assert credential not in workflow_text, (name, credential)

for retired in (
    "deploy/tofu-cos-to-local.sh",
    ".github/workflows/cos.yml",
    "infra/tofu/environments/prod/cos.tf",
    "infra/tofu/environments/prod/lighthouse.tf",
    "scripts/ci/test-tofu-prod-plan-guard.sh",
):
    assert not (root / retired).exists(), retired

for path in (root / "infra/tofu").rglob("*.tf"):
    text = path.read_text(encoding="utf-8")
    assert "tencentcloud_lighthouse_instance" not in text, path
    assert "tencentcloud_lighthouse_firewall_rule" not in text, path
    assert 'backend "pg"' not in text, path
    assert 'backend "s3"' not in text, path
    assert "tofu_state" not in text, path

for path in (
    root / ".github/workflows/business-postgres.yml",
    root / ".github/workflows/keycloak-postgres.yml",
    root / ".github/workflows/keycloak.yml",
    root / ".github/workflows/observability.yml",
    root / "deploy/docker-compose.prod.yml",
    root / "deploy/tx/docker-compose.yml",
):
    text = path.read_text(encoding="utf-8")
    for forbidden in (
        "TOFU_STATE_BACKEND_READY",
        "TX_TOFU_STATE_PASSWORD",
        "tofu_state",
        "tofu_keycloak",
        "backend \"pg\"",
        "backend \"s3\"",
    ):
        assert forbidden not in text, (path, forbidden)

backup = (root / "deploy/tofu-local-state-backup.sh").read_text(encoding="utf-8")
for suffix in (
    "postgres-business-tofu-state/terraform.tfstate",
    "postgres-keycloak-tofu-state/terraform.tfstate",
    "keycloak-tofu-state/terraform.tfstate",
    "grafana-tofu-state/terraform.tfstate",
):
    assert suffix in backup, suffix
assert "-L" in backup and "-s" in backup
assert "chmod 600" in backup and "sha256sum" in backup and "tar -tzf" in backup
assert "bootstrap_markers" in backup
assert "local-tofu-state-bootstrap-v1" in backup
backup_workflow = (root / ".github/workflows/database-backup.yml").read_text(encoding="utf-8")
assert "tofu-local-state-backup.sh yecao" in backup_workflow
assert "tofu-local-state-backup.sh tx" in backup_workflow

for workflow in ("keycloak.yml", "keycloak-postgres.yml", "observability.yml"):
    text = (root / ".github/workflows" / workflow).read_text(encoding="utf-8")
    for credential in ("TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        assert credential not in text, (workflow, credential)

print("Owner-host local state, bootstrap gates, backup, and retired ownership contracts OK")
PY

# Exercise the Grafana plan guard with local JSON fixtures only; this test never
# initializes a backend or contacts the Grafana API.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
cat > "$work/bin/tofu" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == show && "${2:-}" == -json ]] || exit 99
cat "${FAKE_PLAN_JSON:?}"
EOF
chmod +x "$work/bin/tofu"
: > "$work/plan.tfplan"
printf '%s\n' '{"resource_changes":[{"address":"grafana_dashboard.managed[\"wotbtools_usage\"]","type":"grafana_dashboard","change":{"actions":["update"]}}]}' > "$work/safe.json"
printf '%s\n' '{"resource_changes":[{"address":"grafana_data_source.prometheus","type":"grafana_data_source","change":{"actions":["delete"]}}]}' > "$work/delete.json"
PATH="$work/bin:$PATH" FAKE_PLAN_JSON="$work/safe.json" \
  bash "$ROOT/infra/tofu/grafana/validate-plan.sh" "$work/plan.tfplan"
if PATH="$work/bin:$PATH" FAKE_PLAN_JSON="$work/delete.json" \
  bash "$ROOT/infra/tofu/grafana/validate-plan.sh" "$work/plan.tfplan"; then
  echo 'Grafana datasource deletion was accepted.' >&2
  exit 1
fi
