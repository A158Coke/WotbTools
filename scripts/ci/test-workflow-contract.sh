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
assert "name: Release / Build" in build
assert "name: Release / Deploy" in deploy
assert "      - Release / Build" in deploy

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
assert "      - Release / Build" in deploy
print("CI workflow conditional and aggregation contract OK")
PY
