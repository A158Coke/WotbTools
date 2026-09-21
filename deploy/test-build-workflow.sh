#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT/.github/workflows/build.yml" "$ROOT/.github/workflows/deploy.yml" <<'PY'
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import yaml

build_path = Path(sys.argv[1])
deploy_path = Path(sys.argv[2])
ci_path = deploy_path.parent / "ci.yml"
build_text = build_path.read_text(encoding="utf-8")
deploy_text = deploy_path.read_text(encoding="utf-8")
ci_text = ci_path.read_text(encoding="utf-8")
tx_deploy_text = (deploy_path.parent.parent.parent / "deploy/tx/deploy.sh").read_text(encoding="utf-8")
publication_helper = deploy_path.parent.parent.parent / "deploy/tx/publish-loaded-image-to-tcr.sh"
ssh_setup_helper = deploy_path.parent.parent.parent / "scripts/ci/setup-tx-ssh.sh"
oci_stream_helper = deploy_path.parent.parent.parent / "scripts/ci/stream-oci-to-tx.sh"
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
assert build_jobs["build_parser_worker"]["name"] == "Build Parser Worker"
assert 'short_sha="${commit_sha:0:12}"' in build_text, "Build must use the deterministic 12-char SHA tag"
assert "rev-parse --short" not in build_text, "Build must not use git's nondeterministic abbreviation"
for output in ("commit_sha", "tag", "backend", "frontend", "keycloak", "minio", "parserWorker", "deploy_services", "image_services", "target_services"):
    assert output in changes["outputs"], f"Build changes output missing: {output}"

for job_name, output_name in (
    ("build_backend", "backend"),
    ("build_frontend", "frontend"),
    ("build_keycloak", "keycloak"),
    ("build_minio", "minio"),
    ("build_parser_worker", "parserWorker"),
):
    job = build_jobs[job_name]
    assert output_name in job["if"], f"{job_name} is not conditional on detect output"
    checkout = next(step for step in job["steps"] if step.get("uses") == "actions/checkout@v5")
    assert checkout["with"]["ref"] == "${{ needs.changes.outputs.commit_sha }}"
    build_step = next(step for step in job["steps"] if step.get("uses") == "docker/build-push-action@v7")
    tags = str(build_step["with"]["tags"])
    image_prefix = {
        "backend": "backend", "frontend": "frontend", "keycloak": "keycloak",
        "minio": "minio", "parserWorker": "parser-worker",
    }[output_name]
    assert "${{ env.GHCR_IMAGE_PREFIX }}-" + image_prefix + ":${{ needs.changes.outputs.tag }}" in tags
    assert "${{ env.GHCR_IMAGE_PREFIX }}-" + image_prefix + ":latest" in tags
    if output_name in {"backend", "frontend", "keycloak"}:
        assert "tencentyun.com" not in tags, \
            f"{job_name} must not direct-push Tencent TCR from BuildKit"
        assert build_step["id"] == "build", f"{job_name} must expose its immutable build digest"
        outputs = str(build_step["with"]["outputs"])
        assert f"type=oci,dest=${{{{ runner.temp }}}}/{image_prefix}.oci.tar" in outputs
        assert f"name=wotb-transfer/{image_prefix}:${{{{ needs.changes.outputs.tag }}}}" in outputs
        assert "type=image,push=true,oci-mediatypes=true" in outputs
        digest_step = next(step for step in job["steps"] if step.get("id") == "digest")
        assert "${{ steps.build.outputs.digest }}" in str(digest_step)
        assert "docker buildx imagetools inspect" in digest_step["run"]
        assert "EXPECTED_DIGEST" in digest_step["run"]
        ssh_setup_step = next(step for step in job["steps"] if step.get("name") == "Set up native TX SSH")
        install_step = next(step for step in job["steps"] if step.get("name") == "Install TX loaded-image publication helper")
        stream_step = next(step for step in job["steps"] if step.get("name") == f"Import {image_prefix.title()} OCI image on TX")
        publish_step = next(step for step in job["steps"] if step.get("name") == f"Publish {image_prefix.title()} loaded image to TCR")
        assert "setup-tx-ssh.sh" in ssh_setup_step["run"]
        assert "TX_VPS_SSH_KEY" in str(ssh_setup_step)
        assert "scp -F \"$TX_SSH_DIR/config\"" in install_step["run"]
        assert "publish-loaded-image-to-tcr.sh" in install_step["run"]
        assert "stream-oci-to-tx.sh" in stream_step["run"]
        assert stream_step["env"]["NETWORK_RETRY_MAX_ATTEMPTS"] == 2
        assert "EXPECTED_DIGEST" not in stream_step["run"]
        assert "run-with-network-retry.sh" not in publish_step["run"]
        assert "ssh -F \"$TX_SSH_DIR/config\"" in publish_step["run"]
        assert "publish-loaded-image-to-tcr.sh" in publish_step["run"]
        assert "flock -w 1800" in publish_step["run"]
        assert "EXPECTED_DIGEST" in publish_step["run"]
        assert "TCR_USERNAME" not in str(ssh_setup_step) + str(install_step) + str(stream_step) + str(publish_step)
        assert "TCR_PASSWORD" not in str(ssh_setup_step) + str(install_step) + str(stream_step) + str(publish_step)
        assert job["steps"].index(build_step) < job["steps"].index(digest_step) < job["steps"].index(stream_step) < job["steps"].index(publish_step), \
            f"{job_name} must import then publish its one GHCR/OCI build"
    else:
        assert "tencentyun.com" not in tags, \
            f"{job_name} must remain GHCR-only"
        assert not any(step.get("with", {}).get("registry") == "${{ vars.TCR_REGISTRY }}" for step in job["steps"]), \
            f"{job_name} must not log in to Tencent TCR"
    for other in {"backend", "frontend", "keycloak", "minio", "parser-worker"} - {image_prefix}:
        assert "${{ env.GHCR_IMAGE_PREFIX }}-" + other + ":latest" not in tags, \
            f"{job_name} must not publish another component latest tag"
    assert str(build_step["with"]["file"]) == {
        "backend": "docker/Dockerfile.backend",
        "frontend": "docker/Dockerfile.frontend",
        "keycloak": "docker/Dockerfile.keycloak",
        "minio": "docker/Dockerfile.minio",
        "parserWorker": "docker/Dockerfile.parser-worker",
    }[output_name], f"{job_name} must build its own Dockerfile from the repository root context"
    assert str(build_step["with"]["context"]) == ".", f"{job_name} must build from the repository root context"
    build_args = str(build_step["with"].get("build-args", ""))
    assert "BUILD_COMMIT=${{ needs.changes.outputs.commit_sha }}" in build_args, \
        f"{job_name} must inject the frozen release SHA into the image"

assert publication_helper.is_file(), "Build must keep TX publication in a deployment-owned helper"
assert ssh_setup_helper.is_file() and oci_stream_helper.is_file()
helper_text = publication_helper.read_text(encoding="utf-8")
assert "set -euo pipefail" in helper_text
assert "backend|frontend|keycloak" in helper_text
assert "sha-[0-9a-f]{12}" in helper_text
assert "sha256:[0-9a-f]{64}" in helper_text
assert "ccr.ccs.tencentyun.com" in helper_text
assert "wotb-transfer" in helper_text
assert "docker image inspect" in helper_text and "docker tag" in helper_text and "docker push" in helper_text
assert "docker buildx imagetools inspect" in helper_text
assert "{{.Manifest.Digest}}" in helper_text
assert "{{.Digest}}" not in helper_text, "registry digest must use the buildx manifest descriptor"
assert "timeout --kill-after" in helper_text
assert "stage=publication-start" in helper_text and "stage=publication-end" in helper_text
assert "stage=push-immutable" in helper_text
assert "stage=verify-immutable" in helper_text and "stage=update-latest" in helper_text
assert "docker system prune" not in helper_text and "docker image prune" not in helper_text
assert "TCR_USERNAME" not in helper_text and "TCR_PASSWORD" not in helper_text
assert "ghcr.io" not in helper_text and "docker pull" not in helper_text and "crane" not in helper_text
assert "StrictHostKeyChecking yes" in ssh_setup_helper.read_text(encoding="utf-8")
assert "ssh-keyscan" in ssh_setup_helper.read_text(encoding="utf-8")
stream_text = oci_stream_helper.read_text(encoding="utf-8")
assert "gzip -c" in stream_text and "docker load" in stream_text and "flock -w 900" in stream_text
assert "bash -o pipefail -c" in stream_text
assert "timeout --kill-after=30s 1200s" in stream_text
assert "publish-loaded-image-to-tcr.sh" not in stream_text
assert "EXPECTED_DIGEST" not in stream_text
assert "docker pull" not in stream_text and "TCR_PASSWORD" not in stream_text
assert "appleboy/scp-action@v1" not in build_text and "appleboy/ssh-action@v1" not in build_text
assert "replicate-image-to-tcr.sh" not in build_text
assert not (deploy_path.parent.parent.parent / "scripts/ci/copy-image-to-tcr.sh").exists()
assert not (deploy_path.parent.parent.parent / "deploy/tx/replicate-image-to-tcr.sh").exists()

manifest_job = build_jobs["manifest"]
assert "always()" in manifest_job["if"]
assert "build_backend" in str(manifest_job["needs"])
assert "build_minio" in str(manifest_job["needs"])
assert "build_parser_worker" in str(manifest_job["needs"])
assert "needs.changes.outputs.parserWorker != 'true' || needs.build_parser_worker.result == 'success'" in manifest_job["if"]
assert "PARSER_WORKER: ${{ needs.changes.outputs.parserWorker }}" in build_text
assert '"parser-worker": os.environ["PARSER_WORKER"] == "true",' in build_text
assert 'for image in ("backend", "frontend", "keycloak", "minio", "parser-worker"):' in build_text
assert "          - parser-worker" in build_text
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
assert manual_inputs["target"]["options"] == ["tx", "minio", "parser-worker"]
assert manual_inputs["tx_services"]["required"] is True
assert manual_inputs["tx_services"]["description"] == "TX service (used only when target=tx)"
# The TX selector is a dropdown: the manual deploy must not accept free-form service
# strings any more, and ``all`` expands to the TX runtime set inside the manifest step.
assert manual_inputs["tx_services"]["type"] == "choice"
assert manual_inputs["tx_services"]["options"] == [
    "business-api", "rabbitmq", "business-postgres", "keycloak",
    "keycloak-postgres", "wotb-frontend", "caddy", "all",
]
assert manual_inputs["tx_services"]["default"] == "business-api"
manifest_step = next(step for step in deploy_changes["steps"] if step.get("id") == "manifest")
manual_run = manifest_step["run"]
manual_path, workflow_run_path = manual_run.split("manifest_path=release-artifact/deployment-manifest.json", 1)
workflow_run_path = "manifest_path=release-artifact/deployment-manifest.json" + workflow_run_path
assert manual_run.count("<<'PY'") == 3, \
    "Validate deployment manifest must syntax-check manual-image, manual-TX, and workflow-run Python heredocs"
for path_name, shell_path in (("workflow_dispatch", manual_path), ("workflow_run", workflow_run_path)):
    syntax = subprocess.run(["bash", "-n"], input=shell_path.encode("utf-8"), capture_output=True)
    assert syntax.returncode == 0, \
        f"Validate deployment manifest {path_name} Bash syntax failed:\n{syntax.stderr.decode('utf-8', errors='replace')}"
manual_heredoc = 'python3 - "$MANUAL_TARGET" "$TX_SERVICES_INPUT" "$main_sha" "$GITHUB_RUN_NUMBER" <<\'PY\' >> "$GITHUB_OUTPUT"\n'
manual_python = manual_path.split(manual_heredoc, 1)[1].split("\nPY\n", 1)[0]
compile(manual_python, "manual deployment manifest Python heredoc", "exec")
# The dropdown options and the manifest step's TX service set must stay in lockstep:
# every selectable service is deployable, caddy stays an explicit-only selector, and
# ``all`` is the only alias.
tx_all_service_set = (
    "keycloak-postgres", "business-postgres", "rabbitmq", "keycloak",
    "wotb-frontend", "business-api",
)
assert 'TX_SERVICES = (\n' + "".join(f'    "{service}",\n' for service in tx_all_service_set) + ")" in manual_python, \
    "Manual TX deploy must own one explicit TX service set"
assert set(manual_inputs["tx_services"]["options"]) == set(tx_all_service_set) | {"caddy", "all"}, \
    "The TX dropdown must offer exactly the deployable TX services plus all"
# ``all`` deliberately excludes caddy, exactly like deploy/tx/deploy.sh's own all
# selection: caddy is refreshed by the proxied services, and a caddy requirement would
# make a whole-runtime deploy depend on Caddy credentials.
assert 'all|keycloak-postgres|business-postgres|rabbitmq|keycloak|wotb-frontend|business-api|caddy) ;;' in tx_deploy_text, \
    "deploy/tx/deploy.sh must remain the owner of the accepted TX service names"


def manual_tx_services(target, tx_services):
    """Run the workflow's real manual manifest step for one dispatch payload.

    ``python3 -c`` takes the same argv the shell step passes, so this asserts the
    selected TX services (and their immutable image services) exactly as Deploy would.
    """
    result = subprocess.run(
        [sys.executable, "-c", manual_python, target, tx_services, "a" * 40, "777"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, (
        f"manual manifest step failed for target={target} tx_services={tx_services}:\n"
        f"{result.stderr}"
    )
    return dict(
        line.split("=", 1) for line in result.stdout.splitlines() if "=" in line
    )


for service in (*tx_all_service_set, "caddy"):
    manifest = manual_tx_services("tx", service)
    assert manifest["deploy_services"] == service, manifest
    assert manifest["tx_services"] == service, manifest
    assert manifest["yecao_services"] == "" and manifest["yecao_image_services"] == "", manifest
    expected_image = service in {"keycloak", "wotb-frontend", "business-api"}
    assert manifest["image_services"] == (service if expected_image else ""), manifest
    assert manifest["tx_image_services"] == manifest["image_services"], manifest
    assert manifest["release_tag"] == "sha-" + "a" * 12, manifest
    assert manifest["deploy_display_name"] == "Manual TX", manifest

# ``all`` expands to the whole TX runtime service set (caddy stays out of it) in the
# deployment order, and the literal value never reaches WOTB_DEPLOY_SERVICES.
all_manifest = manual_tx_services("tx", "all")
assert all_manifest["deploy_services"] == ",".join(tx_all_service_set), all_manifest
assert all_manifest["tx_services"] == ",".join(tx_all_service_set), all_manifest
assert all_manifest["image_services"] == "keycloak,wotb-frontend,business-api", all_manifest
assert all_manifest["tx_image_services"] == "keycloak,wotb-frontend,business-api", all_manifest
assert "all" not in all_manifest["deploy_services"].split(","), all_manifest
assert all_manifest["deploy_display_name"] == "Manual TX", all_manifest

# An unexpected dispatch payload is rejected instead of silently deploying nothing.
unknown = subprocess.run(
    [sys.executable, "-c", manual_python, "tx", "not-a-service", "a" * 40, "777"],
    capture_output=True, text=True,
)
assert unknown.returncode != 0, "the manual TX step must reject unknown services"
assert "tx_services must be one of" in unknown.stderr, unknown.stderr
assert "GITHUB_EVENT_NAME" in manual_run and "workflow_dispatch" in manual_run
assert 'GITHUB_REF:-}" != refs/heads/main' in manual_run
assert "git fetch origin main --depth=1" in manual_run
assert 'source_sha="$(git rev-parse HEAD)"' in manual_run
assert 'main_sha="$(git rev-parse origin/main)"' in manual_run
assert 'if [ "$source_sha" != "$main_sha" ]; then' in manual_run
assert "Manual TX deploy must run from the current main HEAD." in manual_run
assert 'release_tag=sha-{commit_sha[:12]}' in manual_run
assert 'yecao_services=' in manual_run and 'yecao_image_services=' in manual_run
assert 'if [ "$MANUAL_TARGET" = minio ] || [ "$MANUAL_TARGET" = parser-worker ]; then' in manual_run
assert "release_plan.py manual" in manual_run
assert '--service "$MANUAL_TARGET"' in manual_run
assert "--commit-sha \"$main_sha\"" in manual_run
assert 'if target == "minio":' not in manual_python
assert 'if target == "parser-worker":' not in manual_python
assert 'raise SystemExit("target must be tx, minio, or parser-worker")' in manual_run
assert "is_keycloak_group_selected" in tx_deploy_text
assert "is_business_postgres_group_selected" in tx_deploy_text
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
assert "TCR_REGISTRY: ${{ vars.TCR_REGISTRY }}" in deploy_text
assert "TCR_NAMESPACE: ${{ vars.TCR_NAMESPACE }}" in deploy_text
assert "MinIO immutable image for current main does not exist." in deploy_text
assert "Run Build workflow manually with service=minio first, then deploy the resulting release." in deploy_text
assert "Parser Worker immutable image for current main does not exist." in deploy_text
assert "Run Build workflow manually with service=parser-worker first, then deploy the resulting release." in deploy_text
image_job = deploy["jobs"]["image_existence"]
assert image_job["needs"] == ["changes"]
assert "image_services" in image_job["if"]
assert "RELEASE_TAG" in image_job["steps"][-1]["env"]
assert "docker manifest inspect" in image_job["steps"][-1]["run"]
assert image_job["steps"][1]["if"] == "needs.changes.outputs.tx_image_services != ''"
assert image_job["steps"][1]["with"] == {
    "registry": "${{ vars.TCR_REGISTRY }}",
    "username": "${{ secrets.TCR_USERNAME }}",
    "password": "${{ secrets.TCR_PASSWORD }}",
}
for job_name in ("deploy", "deploy_minio", "deploy_tx"):
    job = deploy["jobs"][job_name]
    assert job["needs"] == ["changes", "image_existence"], \
        f"{job_name} must not reach SSH/SCP before immutable-image validation"
    assert "needs.image_existence.result == 'success'" in job["if"], \
        f"{job_name} must require an existing immutable image before deployment proceeds"
assert "workflow_run.head_sha" in deploy_text
assert "      - Build" in deploy_text
assert "Release / Build" not in deploy_text and "Release / Deploy" not in deploy_text
assert "ref: main" not in deploy_text, "Deploy must not checkout floating main"
assert "release_plan.py validate" in deploy_text
assert "docker manifest inspect" in deploy_text
assert "TX_IMAGE_SERVICES" in image_job["steps"][-1]["env"]
assert "contains_tx_image_service" in image_job["steps"][-1]["run"]
assert "tcr_image_prefix" in image_job["steps"][-1]["run"]
assert "WOTB_DEPLOY_SERVICES" in deploy_text
assert "WOTB_DEPLOY_IMAGE_SERVICES" in deploy_text
assert "targetServices" in deploy_text
assert "parser-worker) image=ghcr.io/a158coke/wotbtools-parser-worker; remediation=" in image_job["steps"][-1]["run"]
tx_deploy_job = deploy["jobs"]["deploy_tx"]
tx_deploy_step = next(step for step in tx_deploy_job["steps"] if step.get("name") == "Deploy exact TX services via SSH")
assert "TCR_USERNAME" not in tx_deploy_step["with"]["envs"]
assert "TCR_PASSWORD" not in tx_deploy_step["with"]["envs"]
assert "TCR_USERNAME" not in tx_deploy_step["env"]
assert "TCR_PASSWORD" not in tx_deploy_step["env"]
assert "docker login" not in tx_deploy_text
assert 'if "parser-worker" in manifest["deployServices"]:' in deploy_text
assert 'labels.append("Parser Worker")' in deploy_text
yecao_deploy_job = deploy["jobs"]["deploy"]
yecao_deploy_env = yecao_deploy_job["steps"][-1]["env"]
for parser_worker_secret in (
    "TX_RABBITMQ_PARSER_WORKER_PASSWORD",
    "YECAO_MINIO_WORKER_ACCESS_KEY",
    "YECAO_MINIO_WORKER_SECRET_KEY",
):
    assert parser_worker_secret in yecao_deploy_env, parser_worker_secret
    assert parser_worker_secret in yecao_deploy_job["steps"][-1]["with"]["envs"], parser_worker_secret
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
    "YECAO_MINIO_CONTROL_API_ACCESS_KEY", "YECAO_MINIO_CONTROL_API_SECRET_KEY",
}
assert "DB_PASSWORD" not in str(minio_job)
minio_script = (deploy_path.parent.parent.parent / "deploy/minio-deploy.sh").read_text(encoding="utf-8")
assert "TF_CLI_CONFIG_FILE=\"$TOFU_CLI_CONFIG\"" in minio_script
assert "-lockfile=readonly" in minio_script
assert "--require-no-changes" in minio_script
assert "10.20.0.2:9000" in minio_script
assert "docker compose -f \"$COMPOSE_FILE\" up -d --wait minio" in minio_script
assert "YECAO_MINIO_ROOT_PASSWORD" in minio_script
assert 'export TF_VAR_control_api_access_key="$YECAO_MINIO_CONTROL_API_ACCESS_KEY"' in minio_script
assert 'export TF_VAR_control_api_secret_key="$YECAO_MINIO_CONTROL_API_SECRET_KEY"' in minio_script
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

bash "$ROOT/deploy/test-tx-publication-helper.sh"
