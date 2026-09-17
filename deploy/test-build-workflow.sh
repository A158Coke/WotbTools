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
tx_deploy_text = (deploy_path.parent.parent.parent / "deploy/tx/deploy.sh").read_text(encoding="utf-8")
build = yaml.safe_load(build_text)
deploy = yaml.safe_load(deploy_text)

build_jobs = build["jobs"]
changes = build_jobs["changes"]
checkout = next(step for step in changes["steps"] if step.get("uses") == "actions/checkout@v5")
assert checkout["with"]["ref"] == "${{ github.sha }}", "Build must freeze the triggering commit"
assert "paths:" not in build_text, "Build must create a no-op manifest for docs-only pushes"
assert build["name"] == "Build"
assert deploy["name"] == "Deploy"
assert build["run-name"] == "Build ${{ inputs.service || github.sha }} by @${{ github.actor }}"
assert "github.event.workflow_run.head_sha" in deploy["run-name"]
assert "inputs.service || 'release'" not in build_text and "inputs.service || 'release'" not in deploy_text
assert build_jobs["build_backend"]["name"] == "Build Backend"
assert build_jobs["build_frontend"]["name"] == "Build Frontend"
assert build_jobs["build_keycloak"]["name"] == "Build Keycloak"
assert 'short_sha="${commit_sha:0:12}"' in build_text, "Build must use the deterministic 12-char SHA tag"
assert "rev-parse --short" not in build_text, "Build must not use git's nondeterministic abbreviation"
for output in ("commit_sha", "tag", "backend", "frontend", "keycloak", "deploy_services", "image_services", "target_services"):
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
    image_prefix = {"backend": "backend", "frontend": "frontend", "keycloak": "keycloak"}[output_name]
    assert "${{ env.GHCR_IMAGE_PREFIX }}-" + image_prefix + ":${{ needs.changes.outputs.tag }}" in tags
    assert "${{ env.GHCR_IMAGE_PREFIX }}-" + image_prefix + ":latest" in tags
    for other in {"backend", "frontend", "keycloak"} - {image_prefix}:
        assert "${{ env.GHCR_IMAGE_PREFIX }}-" + other + ":latest" not in tags, \
            f"{job_name} must not publish another component latest tag"
    build_args = str(build_step["with"].get("build-args", ""))
    assert "BUILD_COMMIT=${{ needs.changes.outputs.commit_sha }}" in build_args, \
        f"{job_name} must inject the frozen release SHA into the image"

manifest_job = build_jobs["manifest"]
assert "always()" in manifest_job["if"]
assert "build_backend" in str(manifest_job["needs"])
assert any(step.get("uses") == "actions/upload-artifact@v4" for step in manifest_job["steps"])
assert any("deployment-manifest.json" in str(step) for step in manifest_job["steps"])

assert "workflow_run:" in deploy_text, "Deploy must subscribe to Build workflow completion"
assert "      - Build" in deploy_text, "Deploy must subscribe to the Build workflow by its fixed name"
assert "conclusion == 'success'" in deploy_text, "Deploy must ignore failed Build runs"
assert "actions/download-artifact@v5" in deploy_text
deploy_changes = deploy["jobs"]["changes"]
assert deploy_changes["permissions"]["actions"] == "read", "Deploy artifact downloader requires actions: read"
assert "deploy_display_name" in deploy_changes["outputs"]
assert deploy["jobs"]["deploy"]["name"] == "Deploy ${{ needs.changes.outputs.deploy_display_name }}"
for label in ("Backend", "Frontend", "Keycloak", "Observability", "All"):
    assert f'"{label}"' in deploy_text, f"Deploy display mapping missing {label}"
assert "' + '.join(labels)" in deploy_text, "Deploy display name must preserve module combinations"
deploy_on = deploy.get("on", deploy.get(True, {}))
assert "workflow_run" in deploy_on, "Deploy must retain the automatic workflow_run trigger"
assert "workflow_dispatch" in deploy_on, "Deploy must expose a manual trigger"
manual_inputs = deploy_on["workflow_dispatch"]["inputs"]
assert set(manual_inputs) == {"tx_services"}, "Manual deploy must not accept an arbitrary SHA"
assert manual_inputs["tx_services"]["required"] is True
assert manual_inputs["tx_services"]["type"] == "string"
assert manual_inputs["tx_services"]["default"] == "keycloak-postgres,keycloak,wotb-frontend,caddy"
manifest_step = next(step for step in deploy_changes["steps"] if step.get("id") == "manifest")
manual_run = manifest_step["run"]
assert "GITHUB_EVENT_NAME" in manual_run and "workflow_dispatch" in manual_run
assert 'GITHUB_REF:-}" != refs/heads/main' in manual_run
assert "git fetch origin main --depth=1" in manual_run
assert 'source_sha="$(git rev-parse HEAD)"' in manual_run
assert 'main_sha="$(git rev-parse origin/main)"' in manual_run
assert 'if [ "$source_sha" != "$main_sha" ]; then' in manual_run
assert "Manual TX deploy must run from the current main HEAD." in manual_run
assert 'release_tag=sha-{commit_sha[:12]}' in manual_run
assert 'yecao_services=' in manual_run and 'yecao_image_services=' in manual_run
assert 'allowed = {"keycloak-postgres", "keycloak", "wotb-frontend", "caddy"}' in manual_run
assert "all|keycloak-postgres|keycloak|wotb-frontend|caddy" in tx_deploy_text
assert "is_selected all || is_selected keycloak || is_selected wotb-frontend || is_selected caddy" in tx_deploy_text
assert "latest" not in manual_run.lower(), "Manual TX deploy must never use latest"
assert "KC_POSTGRES_ADMIN_PASSWORD" not in manual_run and "KC_DB_PASSWORD" not in manual_run
assert "github.event.inputs.release_sha" not in deploy_text
assert "github.event.inputs.image_tag" not in deploy_text
assert "yecao_services" in deploy_text
assert "compose down" not in deploy_text.lower()
assert not any(token in manual_run.lower() for token in ("nsupdate", "route53", "cloudflare", "dns cutover"))
assert "export TF_VAR_postgresql_admin_username=\"$KC_POSTGRES_ADMIN_USER\"" in deploy_text
assert "export TF_VAR_postgresql_admin_password=\"$KC_POSTGRES_ADMIN_PASSWORD\"" in deploy_text
assert "export TF_VAR_keycloak_role_password=\"$KC_DB_PASSWORD\"" in deploy_text
assert "export TF_VAR_keycloak_role_password_version=\"$KC_DB_PASSWORD_VERSION\"" in deploy_text
assert "stale_release_guard" not in deploy_text
assert "WOTB_STALE_RELEASE_GUARD" not in deploy_text
assert "--allow-latest" not in deploy_text
assert "inputs.service" not in deploy_text
assert "image_tag" not in deploy_text, "Deploy must not expose image_tag input"
for workflow_text, workflow_name in ((build_text, "Manual Build"),):
    assert "git fetch origin main" in workflow_text, f"{workflow_name} must refresh origin/main"
    assert 'source_sha="$(git rev-parse HEAD)"' in workflow_text, \
        f"{workflow_name} must resolve the checked out source SHA"
    assert 'main_sha="$(git rev-parse origin/main)"' in workflow_text, \
        f"{workflow_name} must resolve the current main HEAD"
    assert 'if [ "$source_sha" != "$main_sha" ]; then' in workflow_text, \
        f"{workflow_name} must require the current main HEAD"
    assert "git merge-base --is-ancestor" not in workflow_text, \
        f"{workflow_name} must not accept an ancestor-only source"
assert "::error::Manual Build must run from the current main HEAD." in build_text
assert "Required immutable deploy image does not exist" in deploy_text
image_job = deploy["jobs"]["image_existence"]
assert image_job["needs"] == ["changes"]
assert "image_services" in image_job["if"]
assert "RELEASE_TAG" in image_job["steps"][-1]["env"]
assert "docker manifest inspect" in image_job["steps"][-1]["run"]
assert "workflow_run.head_sha" in deploy_text
assert "      - Build" in deploy_text
assert "Release / Build" not in deploy_text and "Release / Deploy" not in deploy_text
assert "ref: main" not in deploy_text, "Deploy must not checkout floating main"
assert "release_plan.py validate" in deploy_text
assert "docker manifest inspect" in deploy_text
assert "WOTB_DEPLOY_SERVICES" in deploy_text
assert "WOTB_DEPLOY_IMAGE_SERVICES" in deploy_text
assert "targetServices" in deploy_text
assert "deploy_tx" in deploy["jobs"]
assert "TX_VPS_HOST" in deploy_text
assert "WOTB_BACKEND_MIGRATION_MAX_VERSION" in deploy_text
tx_job = deploy["jobs"]["deploy_tx"]
tx_scp = next(step for step in tx_job["steps"] if step.get("name") == "Install TX deployment configuration")
assert tx_scp["with"]["source"] == "deploy/tx"
assert tx_scp["with"]["target"] == "/opt/wotb-tx/deploy.incoming"
assert 'rm -rf -- "$WOTB_DIR/deploy.incoming/deploy/tx"' in deploy_text
assert deploy_text.count("script: bash /opt/wotb-tx/deploy.incoming/deploy/tx/deploy.sh") == 2
assert "/opt/wotb-tx/deploy.incoming/tx/deploy.sh" not in deploy_text
assert "docker/build" not in deploy_text and "mvn test" not in deploy_text and "npm test" not in deploy_text
assert "cancel-in-progress: false" in deploy_text
tx_step_names = [step.get("name", "") for step in tx_job["steps"]]
assert tx_step_names.index("Prepare TX deployment directory") < tx_step_names.index("Install TX deployment configuration")
assert tx_step_names.index("Install TX deployment configuration") < tx_step_names.index("Bootstrap TX Keycloak PostgreSQL before OpenTofu")
assert tx_step_names.index("Bootstrap TX Keycloak PostgreSQL before OpenTofu") < tx_step_names.index("Install Keycloak PostgreSQL OpenTofu root on TX")
assert tx_step_names.index("Install Keycloak PostgreSQL OpenTofu root on TX") < tx_step_names.index("Apply Keycloak PostgreSQL OpenTofu on TX localhost")
assert tx_step_names.index("Apply Keycloak PostgreSQL OpenTofu on TX localhost") < tx_step_names.index("Deploy exact TX services via SSH")

print("Build/Deploy workflow release contract OK")
PY
