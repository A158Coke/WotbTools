#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(sys.argv[1])
ci = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
build = (root / ".github/workflows/build.yml").read_text(encoding="utf-8")
deploy = (root / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
ci_settings_path = root / "java/settings-ci.xml"
ci_settings_text = ci_settings_path.read_text(encoding="utf-8")
local_settings_text = (root / "java/settings.xml").read_text(encoding="utf-8")
android_settings_text = (root / "android/settings.gradle.kts").read_text(encoding="utf-8")
network_retry_helper = root / "scripts/ci/run-with-network-retry.sh"
network_retry_test = root / "scripts/ci/test-network-retry.sh"

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
assert '"rabbitmq"' in deploy
assert "TX_RABBITMQ_USER" in deploy
assert "TX_RABBITMQ_PASSWORD" in deploy
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

ET.parse(ci_settings_path)
assert "maven.aliyun.com" not in ci_settings_text
assert "<mirrors>" not in ci_settings_text
assert "<mirrorOf>" not in ci_settings_text
assert "maven.aliyun.com" in local_settings_text
assert "<mirrorOf>*</mirrorOf>" in local_settings_text
assert "settings.xml" not in re.sub(r"settings-ci\.xml", "", ci)
assert ci.count("-s settings-ci.xml") == 3
assert ci.count("-s ../java/settings-ci.xml") == 3
assert "-s settings.xml" not in ci

android_dependency_resolution = android_settings_text.split("dependencyResolutionManagement", 1)[1].split("rootProject.name", 1)[0]
android_plugin_management = android_settings_text.split("pluginManagement", 1)[1].split("dependencyResolutionManagement", 1)[0]
assert "google()" in android_dependency_resolution
assert "mavenCentral()" in android_dependency_resolution
assert 'name = "AliyunPublicFallback"' in android_dependency_resolution
assert 'https://maven.aliyun.com/repository/public' in android_dependency_resolution
assert "maven.aliyun.com" not in android_plugin_management
assert android_dependency_resolution.count("google()") == 1
assert android_dependency_resolution.count("mavenCentral()") == 1
assert android_dependency_resolution.index("google()") < android_dependency_resolution.index("mavenCentral()")
assert android_dependency_resolution.index("mavenCentral()") < android_dependency_resolution.index("AliyunPublicFallback")
assert "repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)" in android_dependency_resolution
assert network_retry_helper.is_file()
assert network_retry_test.is_file()
assert "bash scripts/ci/test-network-retry.sh" in ci

android_ci_match = re.search(
    r"- name: Assemble debug APK and run Android JVM unit tests.*?\n"
    r"\s+working-directory: android\n"
    r"\s+run: (?P<command>[^\n]+)",
    ci,
    re.DOTALL,
)
assert android_ci_match
android_command = android_ci_match.group("command")
assert ":app:assembleDebug" in android_command
assert ":app:testDebugUnitTest" in android_command
assert "--no-daemon" in android_command
assert "run-with-network-retry.sh" in android_command
assert ci.count("gradle :app:assembleDebug :app:testDebugUnitTest --no-daemon") == 1
assert "cache-read-only: false" not in ci
assert "path: android/app/build/outputs/apk/debug/app-debug.apk" in ci

for image in (
    "prom/prometheus:v2.55.1",
    "grafana/loki:3.3.2",
    "grafana/alloy:v1.4.2",
):
    assert f"docker pull {image}" in ci
    assert f"docker run" in ci and image in ci

assert ci.count("run-with-network-retry.sh \"Pull") == 3
for docker_run in re.findall(r"^\s+docker run .*?$", ci, re.MULTILINE):
    assert "run-with-network-retry.sh" not in docker_run

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
