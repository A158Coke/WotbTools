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
assert "run-name: Deploy ${{ github.event_name == 'workflow_dispatch'" in deploy
assert "inputs.service || 'release'" not in build and "inputs.service || 'release'" not in deploy
assert "      - Build" in deploy
assert "Release / Build" not in build and "Release / Deploy" not in deploy
assert "name: Build Backend" in build
assert "name: Build Frontend" in build
assert "name: Build Keycloak" in build
assert "${{ env.GHCR_IMAGE_PREFIX }}-backend:latest" in build
assert "${{ env.GHCR_IMAGE_PREFIX }}-frontend:latest" in build
assert "${{ env.GHCR_IMAGE_PREFIX }}-keycloak:latest" in build
assert "workflow_run:" in deploy and "workflow_dispatch:" in deploy
assert "tx_services:" in deploy
assert "default: keycloak-postgres,keycloak,wotb-frontend,caddy" in deploy
assert "github.event.inputs.release_sha" not in deploy
assert "inputs.service" not in deploy
assert "stale_release_guard" not in deploy
assert "WOTB_STALE_RELEASE_GUARD" not in deploy
for workflow_text, workflow_name in ((build, "Manual Build"),):
    assert "git fetch origin main" in workflow_text, f"{workflow_name} must refresh origin/main"
    assert 'source_sha="$(git rev-parse HEAD)"' in workflow_text, \
        f"{workflow_name} must resolve the checked out source SHA"
    assert 'main_sha="$(git rev-parse origin/main)"' in workflow_text, \
        f"{workflow_name} must resolve the current main HEAD"
    assert 'if [ "$source_sha" != "$main_sha" ]; then' in workflow_text, \
        f"{workflow_name} must require the current main HEAD"
    assert "git merge-base --is-ancestor" not in workflow_text, \
        f"{workflow_name} must not accept an ancestor-only source"
assert "::error::Manual Build must run from the current main HEAD." in build
assert "Required immutable deploy image does not exist" in deploy
assert "name: Deploy ${{ needs.changes.outputs.deploy_display_name }}" in deploy
assert "WOTB_BACKEND_MIGRATION_MAX_VERSION" in deploy
ops_recovery = (root / ".github/workflows/ops-recovery.yml").read_text(encoding="utf-8")
assert re.search(r"^name: Ops Recovery$", ops_recovery, re.MULTILINE)
assert "workflow_dispatch:" in ops_recovery
assert "- all" not in ops_recovery
assert "recover-current" not in ops_recovery
assert "recover-specific-sha" not in ops_recovery
assert "ops-recovery.sh" in ops_recovery
assert "ref: ${{ inputs.target_sha || github.sha }}" not in ops_recovery
assert "ref: ${{ needs.prepare.outputs.target_sha }}" not in ops_recovery
assert "git fetch origin main" in ops_recovery
assert 'control_plane_sha="$(git rev-parse origin/main)"' in ops_recovery
assert 'if [ "$source_sha" != "$control_plane_sha" ]; then' in ops_recovery
assert "Ops Recovery must be dispatched from the current origin/main HEAD." in ops_recovery
assert "control_plane_sha: ${{ steps.target.outputs.control_plane_sha }}" in ops_recovery
assert "ref: ${{ needs.prepare.outputs.control_plane_sha }}" in ops_recovery
assert 'git ls-tree -r --name-only "$target_sha"' in ops_recovery
assert "source: deploy" in ops_recovery
assert "live_data: ${{ steps.plan.outputs.live_data }}" in ci
assert '"live_data": "liveData"' in ci
assert 'if: needs.changes.outputs.live_data == \'true\'' in ci
blocks = re.split(r"\n(?=  [A-Za-z0-9_]+:\n)", ci)
live_data_block = next(block for block in blocks if block.startswith("  live_data_contracts:\n"))
assert "needs.changes.outputs.data == 'true' || needs.changes.outputs.full == 'true'" not in live_data_block
assert "LIVE_DATA_CHANGED: ${{ needs.changes.outputs.live_data }}" in ci
assert 'live_data_contracts|$([ "$LIVE_DATA_CHANGED" = true ] && echo true || echo false)|$LIVE_DATA_CONTRACTS' in ci

expected_jobs = {
    "python_unit": "data",
    "live_data_contracts": "live_data",
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
