#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT/.github/workflows/build.yml" "$ROOT/.github/workflows/deploy.yml" <<'PY'
import subprocess
import sys
from pathlib import Path

import yaml

build_path = Path(sys.argv[1])
deploy_path = Path(sys.argv[2])
ci_path = deploy_path.parent / "ci.yml"
build_text = build_path.read_text(encoding="utf-8")
deploy_text = deploy_path.read_text(encoding="utf-8")
ci_text = ci_path.read_text(encoding="utf-8")
tx_deploy_text = (deploy_path.parent.parent.parent / "deploy/tx/deploy.sh").read_text(encoding="utf-8")
build = yaml.safe_load(build_text)
deploy = yaml.safe_load(deploy_text)
ci = yaml.safe_load(ci_text)

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
assert build_jobs["build_minio"]["name"] == "Build MinIO"
assert 'short_sha="${commit_sha:0:12}"' in build_text, "Build must use the deterministic 12-char SHA tag"
assert "rev-parse --short" not in build_text, "Build must not use git's nondeterministic abbreviation"
for output in ("commit_sha", "tag", "backend", "frontend", "keycloak", "minio", "deploy_services", "image_services", "target_services"):
    assert output in changes["outputs"], f"Build changes output missing: {output}"

for job_name, output_name in (
    ("build_backend", "backend"),
    ("build_frontend", "frontend"),
    ("build_keycloak", "keycloak"),
    ("build_minio", "minio"),
):
    job = build_jobs[job_name]
    assert output_name in job["if"], f"{job_name} is not conditional on detect output"
    checkout = next(step for step in job["steps"] if step.get("uses") == "actions/checkout@v5")
    assert checkout["with"]["ref"] == "${{ needs.changes.outputs.commit_sha }}"
    build_step = next(step for step in job["steps"] if step.get("uses") == "docker/build-push-action@v7")
    tags = str(build_step["with"]["tags"])
    image_prefix = {"backend": "backend", "frontend": "frontend", "keycloak": "keycloak", "minio": "minio"}[output_name]
    assert "${{ env.GHCR_IMAGE_PREFIX }}-" + image_prefix + ":${{ needs.changes.outputs.tag }}" in tags
    assert "${{ env.GHCR_IMAGE_PREFIX }}-" + image_prefix + ":latest" in tags
    for other in {"backend", "frontend", "keycloak", "minio"} - {image_prefix}:
        assert "${{ env.GHCR_IMAGE_PREFIX }}-" + other + ":latest" not in tags, \
            f"{job_name} must not publish another component latest tag"
    build_args = str(build_step["with"].get("build-args", ""))
    assert "BUILD_COMMIT=${{ needs.changes.outputs.commit_sha }}" in build_args, \
        f"{job_name} must inject the frozen release SHA into the image"

manifest_job = build_jobs["manifest"]
assert "always()" in manifest_job["if"]
assert "build_backend" in str(manifest_job["needs"])
assert "build_minio" in str(manifest_job["needs"])
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
assert set(manual_inputs) == {"target", "tx_services"}, "Manual deploy must expose only explicit target and TX service selection"
assert manual_inputs["target"]["type"] == "choice"
assert manual_inputs["target"]["default"] == "tx"
assert manual_inputs["target"]["options"] == ["tx", "minio"]
assert manual_inputs["tx_services"]["required"] is True
assert manual_inputs["tx_services"]["type"] == "string"
assert manual_inputs["tx_services"]["default"] == "keycloak-postgres,keycloak,wotb-frontend,caddy"
manifest_step = next(step for step in deploy_changes["steps"] if step.get("id") == "manifest")
manual_run = manifest_step["run"]
manual_path, workflow_run_path = manual_run.split("manifest_path=release-artifact/deployment-manifest.json", 1)
workflow_run_path = "manifest_path=release-artifact/deployment-manifest.json" + workflow_run_path
assert manual_run.count("<<'PY'") == 2, \
    "Validate deployment manifest must syntax-check both manual and workflow-run Python heredocs"
for path_name, shell_path in (("workflow_dispatch", manual_path), ("workflow_run", workflow_run_path)):
    syntax = subprocess.run(["bash", "-n"], input=shell_path.encode("utf-8"), capture_output=True)
    assert syntax.returncode == 0, \
        f"Validate deployment manifest {path_name} Bash syntax failed:\n{syntax.stderr.decode('utf-8', errors='replace')}"
assert "GITHUB_EVENT_NAME" in manual_run and "workflow_dispatch" in manual_run
assert 'GITHUB_REF:-}" != refs/heads/main' in manual_run
assert "git fetch origin main --depth=1" in manual_run
assert 'source_sha="$(git rev-parse HEAD)"' in manual_run
assert 'main_sha="$(git rev-parse origin/main)"' in manual_run
assert 'if [ "$source_sha" != "$main_sha" ]; then' in manual_run
assert "Manual TX deploy must run from the current main HEAD." in manual_run
assert 'release_tag=sha-{commit_sha[:12]}' in manual_run
assert 'yecao_services=' in manual_run and 'yecao_image_services=' in manual_run
assert 'allowed = {"keycloak-postgres", "rabbitmq", "keycloak", "wotb-frontend", "caddy"}' in manual_run
assert 'if target == "minio":' in manual_run
assert 'print("deploy_services=minio")' in manual_run
assert 'print("yecao_services=minio")' in manual_run
assert "all|keycloak-postgres|rabbitmq|keycloak|wotb-frontend|caddy" in tx_deploy_text
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
assert "deploy_minio" in deploy["jobs"]
minio_job = deploy["jobs"]["deploy_minio"]
minio_step_names = [step.get("name", "") for step in minio_job["steps"]]
assert minio_step_names == [
    "", "Prepare explicit MinIO deployment directory", "Install explicit MinIO deployment files", "Deploy and provision MinIO via SSH"
]
minio_scp = next(step for step in minio_job["steps"] if step.get("name") == "Install explicit MinIO deployment files")
assert minio_scp["with"]["source"] == "deploy/docker-compose.minio.yml,deploy/minio-deploy.sh,deploy/minio,infra/tofu/minio"
minio_deploy_step = next(step for step in minio_job["steps"] if step.get("name") == "Deploy and provision MinIO via SSH")
minio_env = minio_deploy_step["env"]
assert set(minio_env) == {
    "TAG", "RELEASE_SHA", "RELEASE_RUN_NUMBER", "YECAO_MINIO_ROOT_USER", "YECAO_MINIO_ROOT_PASSWORD",
    "YECAO_MINIO_WORKER_ACCESS_KEY", "YECAO_MINIO_WORKER_SECRET_KEY",
}
assert "DB_PASSWORD" not in str(minio_job)
minio_script = (deploy_path.parent.parent.parent / "deploy/minio-deploy.sh").read_text(encoding="utf-8")
assert "TF_CLI_CONFIG_FILE=\"$TOFU_CLI_CONFIG\"" in minio_script
assert "-lockfile=readonly" in minio_script
assert "--require-no-changes" in minio_script
assert "10.20.0.2:9000" in minio_script
assert "docker compose -f \"$COMPOSE_FILE\" up -d --wait minio" in minio_script
assert "YECAO_MINIO_ROOT_PASSWORD" in minio_script
assert "deploy/docker-compose.prod.yml" not in minio_script
assert 'command -v python3' in minio_script
minio_tofurc = (deploy_path.parent.parent.parent / "deploy/minio/tofurc").read_text(encoding="utf-8")
assert minio_tofurc.count("registry.terraform.io/aminueza/minio") == 2
ci_deploy = ci["jobs"]["deploy_smoke"]
tofu_setup = next(step for step in ci_deploy["steps"] if step.get("name") == "Set up OpenTofu")
assert tofu_setup["uses"] == "opentofu/setup-opentofu@v2"
assert tofu_setup["with"] == {"tofu_version": "1.12.6", "tofu_wrapper": False}
minio_ci = next(step for step in ci_deploy["steps"] if step.get("name") == "MinIO compose and source-image contract")
minio_ci_run = minio_ci["run"]
assert "docker/Dockerfile.minio" in minio_ci_run
assert "RELEASE.2025-10-15T17-29-55Z" in minio_ci_run
assert "127.0.0.1:19000" in minio_ci_run
assert "tofu -chdir=infra/tofu/minio providers mirror" in minio_ci_run
assert "deploy/minio/tofurc" in minio_ci_run
assert "TF_CLI_CONFIG_FILE=/tmp/minio-ci.tfrc" in minio_ci_run
assert "TF_DATA_DIR=/tmp/minio-ci-tofu-data" in minio_ci_run
assert "tofu -chdir=infra/tofu/minio apply" in minio_ci_run
assert "( cd infra/tofu/minio && bash validate-plan.sh plan.tfplan )" in minio_ci_run
assert "( cd infra/tofu/minio && bash validate-plan.sh second-plan.tfplan --require-no-changes )" in minio_ci_run
assert "--require-no-changes" in minio_ci_run
assert "YECAO_MINIO_" not in minio_ci_run
minio_dockerfile = (deploy_path.parent.parent.parent / "docker/Dockerfile.minio").read_text(encoding="utf-8")
assert 'ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z' in minio_dockerfile
assert 'ARG MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a' in minio_dockerfile
assert '"refs/tags/$MINIO_RELEASE:refs/tags/$MINIO_RELEASE" "$MINIO_COMMIT"' in minio_dockerfile
assert 'git -C /src checkout --detach --quiet "$MINIO_COMMIT"' in minio_dockerfile
assert 'test "$(git -C /src rev-parse HEAD)" = "$MINIO_COMMIT"' in minio_dockerfile
assert 'test "$(git -C /src rev-parse "$MINIO_RELEASE^{commit}")" = "$MINIO_COMMIT"' in minio_dockerfile
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
assert tx_step_names.index("Apply Keycloak PostgreSQL OpenTofu on TX localhost") < tx_step_names.index("Install Keycloak OpenTofu root on TX")
assert tx_step_names.index("Install Keycloak OpenTofu root on TX") < tx_step_names.index("Start empty TX Keycloak for OpenTofu bootstrap")
assert tx_step_names.index("Start empty TX Keycloak for OpenTofu bootstrap") < tx_step_names.index("Apply Keycloak OpenTofu on TX localhost")
assert tx_step_names.index("Apply Keycloak OpenTofu on TX localhost") < tx_step_names.index("Deploy exact TX services via SSH")
assert tx_step_names.index("Apply Keycloak PostgreSQL OpenTofu on TX localhost") < tx_step_names.index("Deploy exact TX services via SSH")

print("Build/Deploy workflow release contract OK")
PY
