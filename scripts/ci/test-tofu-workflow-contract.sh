#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
plan_path = root / ".github/workflows/tofu-plan.yml"
apply_path = root / ".github/workflows/tofu-apply.yml"
guard_path = root / "scripts/ci/validate-tofu-prod-plan.sh"
plan_text = plan_path.read_text(encoding="utf-8")
apply_text = apply_path.read_text(encoding="utf-8")
guard_text = guard_path.read_text(encoding="utf-8")
plan = yaml.safe_load(plan_text)
apply = yaml.safe_load(apply_text)
apply_triggers = apply.get("on", apply.get(True))

assert plan["name"] == "Infra / COS Plan"
assert apply["name"] == "Infra / COS Apply"
assert "infra/tofu/environments/prod/**" in plan_text
assert '"infra/tofu/**"' not in plan_text
assert "infra/tofu/grafana" not in plan_text
assert "scripts/ci/validate-tofu-prod-plan.sh" in plan_text
assert "scripts/ci/validate-tofu-prod-plan.sh" in apply_text
assert "tofu apply" not in plan_text

assert apply_triggers["push"]["branches"] == ["main"]
assert "infra/tofu/environments/prod/**" in apply_triggers["push"]["paths"]
assert "scripts/ci/validate-tofu-prod-plan.sh" in apply_triggers["push"]["paths"]
assert apply["jobs"]["apply"]["if"] == "github.ref == 'refs/heads/main'"
checkout = next(step for step in apply["jobs"]["apply"]["steps"] if step.get("uses") == "actions/checkout@v5")
assert checkout["with"]["ref"] == "${{ github.sha }}"
assert apply["concurrency"] == {"group": "production-maintenance", "cancel-in-progress": False}
assert "tofu plan -input=false -no-color -out=plan.tfplan" in apply_text
assert "tofu apply -input=false -auto-approve plan.tfplan" in apply_text
assert "production_artifacts" in guard_text
assert "lighthouse_instance.production" in guard_text
assert "lighthouse_firewall_rule.production" in guard_text

print("COS OpenTofu Plan/Apply workflow contract OK")
PY
