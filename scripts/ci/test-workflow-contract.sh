#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import json
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
workflow_dir = root / ".github/workflows"
load = lambda path: yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)

ci = load(workflow_dir / "ci.yml")
triggers = ci.get("on", ci.get(True, {}))
assert set(triggers) == {"pull_request", "workflow_dispatch"}
assert triggers["pull_request"]["branches"] == ["main"]
assert "paths" not in triggers["pull_request"], "the required gate must run for every PR"
assert set(triggers["workflow_dispatch"]["inputs"]) == {"pr_number", "head_sha"}
assert ci["permissions"] == {"contents": "read", "pull-requests": "read"}

pr_owners = []
for path in sorted((*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml"))):
    events = load(path).get("on", load(path).get(True, {}))
    if "pull_request" in events:
        pr_owners.append(path.name)
assert pr_owners == ["ci.yml"], pr_owners

jobs = ci["jobs"]
required = jobs["required"]
assert required["name"] == "CI / Required Gate" and required["if"] == "always()"
assert set(required["needs"]) == set(jobs) - {"required"}
assert "ci-impact.py" not in json.dumps(ci)
assert "test-path-filters.py" not in json.dumps(ci)
ci_text = json.dumps(ci, ensure_ascii=False)
for forbidden in (
    "secrets.", "appleboy/ssh-action", "appleboy/scp-action",
    "docker/build-push-action", "docker/setup-buildx-action", "tofu apply",
):
    assert forbidden not in ci_text, f"PR CI must not access production credentials or mutate production: {forbidden}"
for job in jobs.values():
    for step in job.get("steps", []):
        run = step.get("run", "")
        assert not any(line.lstrip().startswith(("ssh ", "scp ", "docker login", "docker push"))
                       for line in run.splitlines()), "PR CI must not run production mutation commands"

tofu = jobs["tofu_plans"]
tofu_text = json.dumps(tofu, ensure_ascii=False)
assert "tofu fmt -check -recursive" in tofu_text
assert "tofu init -backend=false -input=false" in tofu_text
assert "tofu validate" in tofu_text
assert "tofu apply" not in tofu_text and "secrets." not in tofu_text
assert set(tofu["strategy"]["matrix"]["root"]) == {
    "keycloak", "rabbitmq", "business-postgres", "keycloak-postgres", "minio", "grafana"
}

backup = load(workflow_dir / "database-backup.yml")
assert backup["concurrency"] == {
    "group": "production-maintenance", "cancel-in-progress": "false", "queue": "max",
}
backup_text = json.dumps(backup, ensure_ascii=False)
for script in ("business-postgres-backup.sh", "keycloak-postgres-backup.sh", "tofu-local-state-backup.sh"):
    assert script in backup_text, f"scheduled production backup must retain {script}"

# Production owner routing and freshness inputs are paired contracts. A workflow
# may only proceed when its triggering SHA is still current for every owned input.
owners = (
    "business-api", "frontend", "keycloak", "parser-worker", "minio", "caddy",
    "rabbitmq", "business-postgres", "keycloak-postgres", "observability", "alloy-tx",
)
image_owners = {"business-api", "frontend", "keycloak", "parser-worker", "minio"}
queue = {"group": "production-maintenance", "cancel-in-progress": "false", "queue": "max"}
for owner in owners:
    workflow = load(workflow_dir / f"{owner}.yml")
    events = workflow.get("on", workflow.get(True, {}))
    assert events["push"]["branches"] == ["main"], owner
    trigger_paths = events["push"].get("paths", [])
    freshness_paths = workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
    if owner in image_owners:
        assert not trigger_paths, owner
    else:
        assert trigger_paths == freshness_paths, owner
    checks = [
        step for job in workflow["jobs"].values() for step in job.get("steps", [])
        if "deploy/check-production-freshness.sh" in step.get("run", "")
    ]
    assert len(checks) >= 2, owner
    assert all(step.get("env", {}).get("EVENT_SHA") == "${{ github.sha }}" for step in checks), owner
    if owner in image_owners:
        assert workflow["concurrency"] == {
            "group": f"deploy-{owner}", "cancel-in-progress": "true"
        }, owner
        assert workflow["jobs"]["deploy"]["concurrency"] == queue, owner
    else:
        assert workflow["concurrency"] == queue, owner

freshness = (root / "deploy/check-production-freshness.sh").read_text(encoding="utf-8")
for invariant in (
    "Source SHA differs from the triggering event SHA.",
    "Production workflows require the main ref.",
    "Checkout SHA differs from the event SHA.",
    "workflow_dispatch",
    "git merge-base --is-ancestor",
    "git diff --quiet",
    "Production-owned inputs changed after the workflow source SHA.",
):
    assert invariant in freshness, invariant

print("PR gate, production freshness/ownership, ToFu validation, and backup safety OK")
PY
