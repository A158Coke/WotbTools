#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT/.github/workflows/build.yml" <<'PY'
import sys
from pathlib import Path

import yaml

workflow_path = Path(sys.argv[1])
workflow_text = workflow_path.read_text(encoding="utf-8")
workflow = yaml.safe_load(workflow_text)
jobs = workflow["jobs"]

changes = jobs["changes"]
change_checkout = next(
    step for step in changes["steps"] if step.get("uses") == "actions/checkout@v5"
)
assert change_checkout["with"] == {"fetch-depth": 0, "ref": "main"}, \
    "changes job must resolve the moving main branch exactly once"
assert changes["outputs"]["commit_sha"] == "${{ steps.tag.outputs.commit_sha }}", \
    "changes job must expose the frozen full commit SHA"
assert changes["outputs"]["tag"] == "${{ steps.tag.outputs.tag }}", \
    "changes job must expose the immutable image tag"

freeze_step = next(step for step in changes["steps"] if step.get("id") == "tag")
freeze_run = freeze_step["run"]
for required in (
    'commit_sha="$(git rev-parse HEAD)"',
    'short_sha="$(git rev-parse --short "$commit_sha")"',
    'echo "commit_sha=$commit_sha"',
    'echo "tag=sha-$short_sha"',
):
    assert required in freeze_run, f"frozen main identity missing: {required}"

for job_name in ("build-backend", "build-frontend", "build-keycloak"):
    job = jobs[job_name]
    assert job["needs"] == ["changes"], f"{job_name} must use changes as its identity source"
    checkouts = [step for step in job["steps"] if step.get("uses") == "actions/checkout@v5"]
    assert len(checkouts) == 1, f"{job_name} must have one checkout"
    ref = checkouts[0]["with"]["ref"]
    assert ref == "${{ needs.changes.outputs.commit_sha }}", \
        f"{job_name} must checkout the frozen full SHA, got {ref!r}"
    assert ref != "main", f"{job_name} must not follow moving main"
    build_step = next(step for step in job["steps"] if step.get("uses") == "docker/build-push-action@v7")
    assert "${{ needs.changes.outputs.tag }}" in build_step["with"]["tags"], \
        f"{job_name} tag must derive from the frozen identity"

frontend_build = next(
    step for step in jobs["build-frontend"]["steps"]
    if step.get("uses") == "docker/build-push-action@v7"
)
assert "BUILD_COMMIT=${{ needs.changes.outputs.commit_sha }}" in frontend_build["with"]["build-args"], \
    "frontend BUILD_COMMIT must use the frozen full SHA"
assert "workflow_dispatch:" in workflow_text, "manual Build dispatch must remain available"

print("Build workflow frozen-commit contract OK")
PY
