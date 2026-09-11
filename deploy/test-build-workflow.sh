#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT/.github/workflows/build.yml" "$ROOT/.github/workflows/deploy.yml" <<'PY'
import sys
from pathlib import Path

import yaml

build_path = Path(sys.argv[1])
deploy_path = Path(sys.argv[2])
build_text = build_path.read_text(encoding="utf-8")
deploy_text = deploy_path.read_text(encoding="utf-8")
build = yaml.safe_load(build_text)
deploy = yaml.safe_load(deploy_text)

build_jobs = build["jobs"]
changes = build_jobs["changes"]
checkout = next(step for step in changes["steps"] if step.get("uses") == "actions/checkout@v5")
assert checkout["with"]["ref"] == "${{ github.sha }}", "Build must freeze the triggering commit"
assert "paths:" not in build_text, "Build must create a no-op manifest for docs-only pushes"
assert 'short_sha="${commit_sha:0:12}"' in build_text, "Build must use the deterministic 12-char SHA tag"
assert "rev-parse --short" not in build_text, "Build must not use git's nondeterministic abbreviation"
for output in ("commit_sha", "tag", "backend", "frontend", "keycloak", "deploy_services", "image_services"):
    assert output in changes["outputs"], f"Build changes output missing: {output}"

for job_name, output_name in (
    ("build_backend", "backend"),
    ("build_frontend", "frontend"),
    ("build_keycloak", "keycloak"),
):
    job = build_jobs[job_name]
    assert output_name in job["if"], f"{job_name} is not conditional on detect output"
    checkout = next(step for step in job["steps"] if step.get("uses") == "actions/checkout@v5")
    assert checkout["with"]["ref"] == "${{ needs.changes.outputs.commit_sha }}"
    build_step = next(step for step in job["steps"] if step.get("uses") == "docker/build-push-action@v7")
    tags = str(build_step["with"]["tags"])
    assert "latest" not in tags, f"{job_name} must publish only immutable tags"
    assert "${{ needs.changes.outputs.tag }}" in tags

manifest_job = build_jobs["manifest"]
assert "always()" in manifest_job["if"]
assert "build_backend" in str(manifest_job["needs"])
assert any(step.get("uses") == "actions/upload-artifact@v4" for step in manifest_job["steps"])
assert any("deployment-manifest.json" in str(step) for step in manifest_job["steps"])

assert "workflow_run:" in deploy_text, "Deploy must subscribe to Build workflow completion"
assert "conclusion == 'success'" in deploy_text, "Deploy must ignore failed Build runs"
assert "actions/download-artifact@v5" in deploy_text
deploy_changes = deploy["jobs"]["changes"]
assert deploy_changes["permissions"]["actions"] == "read", "Deploy artifact downloader requires actions: read"
assert "git merge-base --is-ancestor" in deploy_text, "Manual Deploy must require main ancestry"
assert "git merge-base --is-ancestor" in build_text, "Manual Build must require main ancestry"
assert "sha-[0-9a-f]{12}" in deploy_text, "Manual Deploy must validate 12-char tags"
assert "workflow_run.head_sha" in deploy_text
assert "ref: main" not in deploy_text, "Deploy must not checkout floating main"
assert "release_plan.py validate" in deploy_text
assert "docker manifest inspect" in deploy_text
assert "WOTB_DEPLOY_SERVICES" in deploy_text
assert "WOTB_DEPLOY_IMAGE_SERVICES" in deploy_text
assert "docker/build" not in deploy_text and "mvn test" not in deploy_text and "npm test" not in deploy_text
assert "cancel-in-progress: false" in deploy_text

print("Build/Deploy workflow release contract OK")
PY
