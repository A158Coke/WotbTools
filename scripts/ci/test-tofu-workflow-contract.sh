#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
workflow = yaml.safe_load((root / ".github/workflows/tofu-apply.yml").read_text())
triggers = workflow.get("on", workflow.get(True))
assert set(triggers) == {"workflow_call", "workflow_dispatch"}
assert set(triggers["workflow_call"]["inputs"]) == {"root", "source_sha"}
assert triggers["workflow_dispatch"]["inputs"]["root"]["options"] == [
    "keycloak", "rabbitmq", "business-postgres", "keycloak-postgres",
    "minio", "cos", "grafana",
]
assert workflow["concurrency"] == {
    "group": "production-maintenance",
    "cancel-in-progress": False,
    "queue": "max",
}
assert set(workflow["jobs"]) == {"preflight", "cloud", "tx", "yecao"}

def step(job, name):
    return next(s for s in workflow["jobs"][job]["steps"] if s.get("name") == name)

preflight = step("preflight", "Require one root at current main HEAD")["run"]
assert "git ls-remote origin refs/heads/main" in preflight
assert "Unknown OpenTofu root" in preflight
assert "business-postgres) root_path=infra/tofu/postgres-business" in preflight
assert "keycloak-postgres) root_path=infra/tofu/postgres-keycloak" in preflight

cloud = step("cloud", "Apply exact cloud plan")["run"]
assert "validate-tofu-prod-plan.sh\" plan.tfplan" in cloud
assert "./validate-plan.sh plan.tfplan" in cloud
assert "tofu apply -input=false -auto-approve plan.tfplan" in cloud
assert "second-plan.tfplan" in cloud

for name in ("Apply RabbitMQ on TX localhost", "Apply Business PostgreSQL on TX localhost",
             "Apply Keycloak PostgreSQL on TX localhost"):
    script = step("tx", name)["with"]["script"]
    assert "tofu plan -input=false -no-color -out=plan.tfplan" in script
    assert "bash ./validate-plan.sh plan.tfplan" in script
    assert "tofu apply -input=false -auto-approve plan.tfplan" in script
    assert "second-plan.tfplan" in script

minio = step("yecao", "Apply MinIO on Yecao local state")["with"]["script"]
assert "bash ./validate-plan.sh second-plan.tfplan --require-no-changes" in minio
assert "tofu apply -input=false -auto-approve plan.tfplan" in minio
assert (root / "infra/tofu/rabbitmq/bootstrap-provider-mirror.sh").is_file()
for retired in ("tofu-plan.yml", "grafana-tofu-plan.yml", "grafana-tofu-apply.yml",
                "postgres-keycloak-tofu.yml", "postgres-business-tofu.yml"):
    assert not (root / ".github/workflows" / retired).exists(), retired

print("Single OpenTofu Apply workflow safety contract OK")
PY

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
