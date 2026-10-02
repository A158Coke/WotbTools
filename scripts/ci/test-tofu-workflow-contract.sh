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
owners = {
    "keycloak": "keycloak",
    "business-postgres": "business-postgres", "keycloak-postgres": "keycloak-postgres",
    "observability": "grafana", "komodo-controller": "komodo",
}
jobs = {
    owner: yaml.load((root / f".github/workflows/ci-{owner}.yml").read_text(encoding="utf-8"),
                     Loader=yaml.BaseLoader)["jobs"]["tofu_plans"]
    for owner in owners
}
assert all(job["name"] == f"OpenTofu validation / {owners[owner]}" for owner, job in jobs.items())
assert all("${{ secrets." not in json.dumps(job) for job in jobs.values())
for owner, job in jobs.items():
    validation = next(step for step in job["steps"] if step.get("name") == "Format, initialize without production state, and validate")
    assert validation["env"]["ROOT_DIR"] == {
        "keycloak": "infra/tofu/keycloak",
        "business-postgres": "infra/tofu/postgres-business", "keycloak-postgres": "infra/tofu/postgres-keycloak",
        "observability": "infra/tofu/grafana",
        "komodo-controller": "infra/tofu/komodo",
    }[owner]
    assert "tofu fmt -check -recursive" in validation["run"]
    assert "tofu init -backend=false -input=false" in validation["run"]
    assert "tofu validate" in validation["run"]
assert all(not re.search(r"(?i)\btofu(?:\s+-[^\s]+)*\s+(?:plan|apply)\b", json.dumps(job)) for job in jobs.values())
assert all("init -reconfigure" not in json.dumps(job) for job in jobs.values())

for owner in ("business-postgres",):
    fixture = next(step for step in jobs[owner]["steps"] if step.get("name") == "Validate local-root safety policy fixtures")
    assert "test-validate-plan.sh" in fixture["run"]
assert "bash deploy/test-business-postgres-runtime.sh" in fixture["run"]

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
    "komodo": ("infra/tofu/komodo", "/opt/komodo/tofu-state", True),
}
workflow_roots = {
    "postgres-business": ".github/workflows/business-postgres.yml",
    "postgres-keycloak": ".github/workflows/keycloak-postgres.yml",
    "keycloak": ".github/workflows/keycloak.yml",
    "grafana": ".github/workflows/observability.yml",
    "komodo": ".github/workflows/komodo-controller.yml",
}
for name, (relative, state_dir, requires_marker) in expected.items():
    state_path = f"{state_dir}/terraform.tfstate"
    root_text = "\n".join(path.read_text(encoding="utf-8") for path in (root / relative).glob("*.tf"))
    assert 'backend "local"' in root_text, name
    assert state_path in root_text, name
    assert "tofu_state" not in root_text, name
    assert 'backend "pg"' not in root_text and 'backend "s3"' not in root_text, name
    # Komodo keeps its mutation logic in `deploy/komodo/reconcile.sh` instead of a
    # giant YAML script, so that owner's safety contract spans workflow + script.
    workflow_text = (root / workflow_roots[name]).read_text(encoding="utf-8")
    safety_text = workflow_text
    if name == "komodo":
        safety_text += "\n" + (root / "deploy/komodo/reconcile.sh").read_text(encoding="utf-8")
    assert state_dir in safety_text, name
    assert "local opentofu state is not bootstrapped" in safety_text.lower(), name
    assert "! -L \"$state_file\"" in safety_text, name
    assert "-f \"$state_file\"" in safety_text, name
    assert "$SOURCE_SHA" not in state_dir
    if requires_marker:
        assert "bootstrap-complete" in safety_text, name
        assert "local-tofu-state-bootstrap-v1" in safety_text, name
    if name == "komodo":
        # State without its marker is corruption, not a fresh install: the
        # controller plane must fail closed instead of re-initializing.
        assert "state exists without a completed bootstrap marker" in safety_text
        assert "TENCENTCLOUD_SECRET_ID" in workflow_text
        assert "TENCENTCLOUD_SECRET_KEY" in workflow_text
        assert "AWS_ACCESS_KEY_ID" not in workflow_text
        assert "AWS_SECRET_ACCESS_KEY" not in workflow_text
    else:
        for credential in ("TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
            assert credential not in workflow_text, (name, credential)

for retired in (
    "deploy/tofu-cos-to-local.sh",
    ".github/workflows/cos.yml",
    "infra/tofu/environments/prod/cos.tf",
    "infra/tofu/environments/prod/lighthouse.tf",
    "scripts/ci/test-tofu-prod-plan-guard.sh",
    # Replay parsing runs in the browser: the broker and object-store roots are retired.
    "infra/tofu/rabbitmq",
    "infra/tofu/minio",
    "deploy/tx/rabbitmq.tofurc",
    "deploy/minio",
    ".github/workflows/ci-rabbitmq.yml",
    ".github/workflows/ci-minio.yml",
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
    root / ".github/workflows/komodo-controller.yml",
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

# Owner-host local state is inventoried per host root, so the Komodo controller
# state is a third target rather than a pretend child of /opt/wotb.
backup = (root / "deploy/tofu-local-state-backup.sh").read_text(encoding="utf-8")
for target, suffixes in {
    "tx": (
        "postgres-business-tofu-state/terraform.tfstate",
        "postgres-keycloak-tofu-state/terraform.tfstate",
        "keycloak-tofu-state/terraform.tfstate",
    ),
    "yecao": ("grafana-tofu-state/terraform.tfstate",),
    "komodo": ("tofu-state/terraform.tfstate",),
}.items():
    assert f"\n  {target})" in backup, target
    for suffix in suffixes:
        assert suffix in backup, (target, suffix)
assert "-L" in backup and "-s" in backup
assert "chmod 600" in backup and "sha256sum" in backup and "tar -tzf" in backup
assert "bootstrap_markers" in backup
assert "local-tofu-state-bootstrap-v1" in backup
backup_workflow = (root / ".github/workflows/database-backup.yml").read_text(encoding="utf-8")
assert "tofu-local-state-backup.sh yecao" in backup_workflow
assert "tofu-local-state-backup.sh komodo" in backup_workflow
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
