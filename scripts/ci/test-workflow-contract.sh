#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
ci = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
build = (root / ".github/workflows/build.yml").read_text(encoding="utf-8")
deploy = (root / ".github/workflows/deploy.yml").read_text(encoding="utf-8")

assert "name: CI / PR" in ci
assert "name: CI / Required Gate" in ci
assert "if: always()" in ci
assert re.search(r"^name: Build$", build, re.MULTILINE)
assert re.search(r"^name: Deploy$", deploy, re.MULTILINE)
assert "run-name: Build ${{ inputs.service || github.sha }} by @${{ github.actor }}" in build
assert "run-name: Deploy ${{ inputs.service || github.event.workflow_run.head_sha || github.sha }} by @${{ github.actor }}" in deploy
assert "inputs.service || 'release'" not in build and "inputs.service || 'release'" not in deploy
assert "      - Build" in deploy
assert "Release / Build" not in build and "Release / Deploy" not in deploy
assert "name: Build Backend" in build
assert "name: Build Frontend" in build
assert "name: Build Keycloak" in build
assert "${{ env.GHCR_IMAGE_PREFIX }}-backend:latest" in build
assert "${{ env.GHCR_IMAGE_PREFIX }}-frontend:latest" in build
assert "${{ env.GHCR_IMAGE_PREFIX }}-keycloak:latest" in build
assert "image_tag:" not in deploy
assert "Required deploy image does not exist" in deploy
for service in ("postgres", "node-exporter", "prometheus", "loki", "alloy", "grafana", "wotb-backend", "wotb-frontend"):
    assert f"          - {service}" not in deploy
assert "name: Deploy ${{ needs.changes.outputs.deploy_display_name }}" in deploy

expected_jobs = {
    "python_unit": "data",
    "live_data_contracts": "data",
    "backend": "backend",
    "frontend": "frontend",
    "http_contract": "http_contract",
    "keycloak_providers": "keycloak_provider",
    "keycloak_runtime": "keycloak_runtime",
    "android": "android",
    "android_release_helpers": "android",
    "android_contract": "android",
    "observability_config": "observability",
    "deploy_smoke": "deploy",
}
for job_id, output in expected_jobs.items():
    blocks = re.split(r"\n(?=  [A-Za-z0-9_]+:\n)", ci)
    block = next(block for block in blocks if block.startswith(f"  {job_id}:\n"))
    assert (
        f"needs.changes.outputs.{output} == 'true'" in block
        or "needs.changes.outputs.full == 'true'" in block
    ), (job_id, output)

for job_id in ("changes", *expected_jobs):
    assert f"      - {job_id}" in ci, job_id
assert "      - Build" in deploy
print("CI workflow conditional and aggregation contract OK")
PY
