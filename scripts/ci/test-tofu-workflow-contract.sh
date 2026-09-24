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
    "cos": "infra/tofu/environments/prod",
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
    "test-tofu-prod-plan-guard.sh",
    "test-keycloak-tofu-contract.sh",
    "test-postgres-keycloak-tofu-contract.sh",
    "test-postgres-business-tofu-contract.sh",
):
    assert fixture in deploy_runs, fixture

print("PR OpenTofu validation has no plan/apply or production credentials")
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
