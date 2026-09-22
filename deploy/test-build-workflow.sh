#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT/.github/workflows/build.yml" "$ROOT/.github/workflows/deploy.yml" <<'PY'
import json
import os
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
assert build_jobs["build_parser_worker"]["name"] == "Build Parser Worker"
assert 'short_sha="${commit_sha:0:12}"' in build_text, "Build must use the deterministic 12-char SHA tag"
assert "rev-parse --short" not in build_text, "Build must not use git's nondeterministic abbreviation"
for output in ("commit_sha", "tag", "backend", "frontend", "keycloak", "minio", "parserWorker", "deploy_services", "image_services", "target_services"):
    assert output in changes["outputs"], f"Build changes output missing: {output}"

PARSER_WORKER_IMAGE = "parser-worker"
IMAGE_PREFIX_BY_OUTPUT = {
    "backend": "backend", "frontend": "frontend", "keycloak": "keycloak",
    "minio": "minio", "parserWorker": PARSER_WORKER_IMAGE,
}
DOCKERFILE_BY_OUTPUT = {
    "backend": "docker/Dockerfile.backend",
    "frontend": "docker/Dockerfile.frontend",
    "keycloak": "docker/Dockerfile.keycloak",
    "minio": "docker/Dockerfile.minio",
    "parserWorker": "docker/Dockerfile.parser-worker",
}
JOB_RELEASE_IMAGE = {
    "build_backend": "wotbtools-backend",
    "build_frontend": "wotbtools-frontend",
    "build_keycloak": "wotbtools-keycloak",
}
BUILD_JOB_OUTPUTS = (
    ("build_backend", "backend"),
    ("build_frontend", "frontend"),
    ("build_keycloak", "keycloak"),
    ("build_minio", "minio"),
    ("build_parser_worker", "parserWorker"),
)

# The TX application images are built once and published straight into Tencent TCR by the
# BuildKit registry exporter: no GHCR publication, no OCI archive, no rsync, no SSH to TX
# and no TX-side docker load exist any more.
for job_name, release_image in JOB_RELEASE_IMAGE.items():
    job = build_jobs[job_name]
    image_prefix = release_image.removeprefix("wotbtools-")
    output_name = image_prefix
    assert output_name in job["if"], f"{job_name} is not conditional on detect output"
    # `packages: write` exists only for the BuildKit `type=gha` cache backend; the job
    # itself must never authenticate to or publish to GHCR (asserted below).
    assert job["permissions"] == {"contents": "read", "packages": "write"}, \
        f"{job_name} must keep the GHA cache scope and nothing else"
    # The honest cost of a direct GitHub-hosted Runner -> TCR publication is the layer
    # push, which production run 35728016485 proved can outlive the previous 80-minute
    # budget; the window is widened, the failure semantics are not.
    assert job["timeout-minutes"] == 150, \
        f"{job_name} must allow the slow TCR layer push a 150-minute budget"
    checkout = next(step for step in job["steps"] if step.get("uses") == "actions/checkout@v5")
    assert checkout["with"]["ref"] == "${{ needs.changes.outputs.commit_sha }}"
    release_step = next(step for step in job["steps"] if step.get("id") == "release")
    # The TCR reference is derived from the validated registry/namespace pair and the
    # frozen immutable tag, and the script itself refuses any non-Tencent registry.
    assert "${{ vars.TCR_REGISTRY }}" in str(release_step)
    assert "${{ vars.TCR_NAMESPACE }}" in str(release_step)
    assert "${{ needs.changes.outputs.tag }}" in str(release_step)
    assert "*.tencentyun.com)" in release_step["run"]
    assert f"wotbtools-{image_prefix}:$TAG" in release_step["run"]
    assert '[[ "$TAG" =~ ^sha-[0-9a-f]{12}$ ]]' in release_step["run"]
    tcr_logins = [
        step for step in job["steps"]
        if step.get("uses") == "docker/login-action@v4"
        and step.get("with", {}).get("registry") == "${{ vars.TCR_REGISTRY }}"
    ]
    assert len(tcr_logins) == 1, f"{job_name} must log in to TCR exactly once"
    assert tcr_logins[0]["with"] == {
        "registry": "${{ vars.TCR_REGISTRY }}",
        "username": "${{ secrets.TCR_USERNAME }}",
        "password": "${{ secrets.TCR_PASSWORD }}",
    }, f"{job_name} must authenticate with the repository-scoped TCR credentials"
    assert any(step.get("uses") == "docker/setup-buildx-action@v4" for step in job["steps"])
    build_step = next(step for step in job["steps"] if step.get("uses") == "docker/build-push-action@v7")
    assert build_step["id"] == "build", f"{job_name} must expose its immutable build digest"
    assert build_step["with"]["push"] is True, f"{job_name} must push straight into TCR"
    assert build_step["with"]["tags"] == "${{ steps.release.outputs.image }}", \
        f"{job_name} must push exactly the resolved immutable TCR tag"
    assert "latest" not in str(build_step["with"]["tags"]), \
        f"{job_name} must publish the immutable tag only"
    assert "outputs" not in build_step["with"], \
        f"{job_name} must not export an OCI archive any more"
    # `image-manifest` is the only recognized OCI media-type switch and it defaults to
    # false; `oci-mediatypes` is not an input of docker/build-push-action@v7 at all, so
    # passing it only emitted an "Unexpected input(s)" warning.
    assert "oci-mediatypes" not in build_step["with"], \
        f"{job_name} must not pass the unsupported oci-mediatypes input"
    assert "cache-from" in build_step["with"] and "cache-to" in build_step["with"]
    assert "BUILD_COMMIT=${{ needs.changes.outputs.commit_sha }}" in str(build_step["with"]["build-args"]), \
        f"{job_name} must inject the frozen release SHA into the image"
    digest_step = next(step for step in job["steps"] if step.get("id") == "digest")
    assert "${{ steps.build.outputs.digest }}" in str(digest_step)
    assert "docker buildx imagetools inspect" in digest_step["run"]
    assert "{{.Manifest.Digest}}" in digest_step["run"]
    assert "sha256:[0-9a-f]{64}" in digest_step["run"]
    assert digest_step["env"]["IMAGE"] == "${{ steps.release.outputs.image }}"
    assert "docker pull" not in digest_step["run"]
    assert [step.get("name") for step in job["steps"]] == [
        None,  # actions/checkout
        "Resolve the immutable %s TCR release image" % image_prefix.title(),
        None,  # docker/login-action: TCR login
        None,  # docker/setup-buildx-action
        "Build %s once and publish it directly to TCR" % image_prefix.title(),
        "Verify the immutable %s TCR manifest" % image_prefix.title(),
    ], f"{job_name} must build, publish and verify and nothing else"
    for forbidden in (
        "ghcr",
        "transfer-oci-to-tx.sh",
        "publish-loaded-image-to-tcr.sh",
        "setup-tx-ssh.sh",
        "rsync",
        "scp -",
        "docker load",
        "type=oci",
        ":latest",
        "replication.incoming",
        "TX_VPS_SSH_KEY",
        "sha256sum",
        "run-with-network-retry.sh",
        "flock",
    ):
        assert forbidden not in str(job), \
            f"{job_name} must keep the obsolete TX image transport out: {forbidden}"
    assert "ghcr" not in build_step["with"]["tags"], f"{job_name} must not publish to GHCR"

for job_name, output_name in BUILD_JOB_OUTPUTS:
    job = build_jobs[job_name]
    image_prefix = IMAGE_PREFIX_BY_OUTPUT[output_name]
    build_step = next(step for step in job["steps"] if step.get("uses") == "docker/build-push-action@v7")
    tags = str(build_step["with"]["tags"])
    if output_name in {"minio", "parserWorker"}:
        # The Yecao workloads keep their GHCR publication untouched.
        assert "${{ env.GHCR_IMAGE_PREFIX }}-" + image_prefix + ":${{ needs.changes.outputs.tag }}" in tags
        assert "${{ env.GHCR_IMAGE_PREFIX }}-" + image_prefix + ":latest" in tags
        assert "tencentyun.com" not in tags, f"{job_name} must remain GHCR-only"
        assert not any(
            step.get("with", {}).get("registry") == "${{ vars.TCR_REGISTRY }}" for step in job["steps"]
        ), f"{job_name} must not log in to Tencent TCR"
    else:
        assert "${{ env.GHCR_IMAGE_PREFIX }}" not in tags, \
            f"{job_name} must not publish a TX workload to GHCR"
    for other in {"backend", "frontend", "keycloak", "minio", "parser-worker"} - {image_prefix}:
        assert "${{ env.GHCR_IMAGE_PREFIX }}-" + other + ":latest" not in tags, \
            f"{job_name} must not publish another component latest tag"
    assert str(build_step["with"]["file"]) == DOCKERFILE_BY_OUTPUT[output_name], \
        f"{job_name} must build its own Dockerfile from the repository root context"
    assert str(build_step["with"]["context"]) == ".", f"{job_name} must build from the repository root context"

# docker/build-push-action@v7 does not expose an `oci-mediatypes` input; passing it only
# emitted an unsupported-input warning, so the option must not come back through any of the
# five build steps (TX application images included).
assert "oci-mediatypes" not in build_text, \
    "docker/build-push-action@v7 has no top-level oci-mediatypes input"

# The OCI/rsync TX image transport is gone for good: Build owns one BuildKit publication
# into TCR per TX component, so every helper that only served the archive detour must stay
# deleted and must never be wired back into a TX builder job.
root = deploy_path.parent.parent.parent
for deleted_helper in (
    "scripts/ci/transfer-oci-to-tx.sh",
    "scripts/ci/setup-tx-ssh.sh",
    "scripts/ci/stream-oci-to-tx.sh",
    "scripts/ci/copy-image-to-tcr.sh",
    "deploy/tx/replicate-image-to-tcr.sh",
):
    assert not (root / deleted_helper).exists(), \
        f"the obsolete TX image transport helper must stay deleted: {deleted_helper}"
for job_name in JOB_RELEASE_IMAGE:
    job_text = json.dumps(build_jobs[job_name], default=str)
    for forbidden in (
        "ghcr",
        "GITHUB_TOKEN",
        "transfer-oci-to-tx.sh",
        "setup-tx-ssh.sh",
        "publish-loaded-image-to-tcr.sh",
        "replication.incoming",
        "rsync",
        "scp",
        "docker load",
        "type=oci",
        "oci-import.lock",
        "oci-transfer.lock",
        "wotb-transfer",
        "EXPECTED_IMAGE_REF",
        "EXPECTED_IMAGE_ID",
        "EXPECTED_DIGEST",
        "run-with-network-retry.sh",
        "TX_VPS_HOST",
        "TX_VPS_SSH_KEY",
        "flock",
    ):
        assert forbidden not in job_text, \
            f"{job_name} must publish straight to TCR: {forbidden}"
for forbidden in ("benchmark-tcr.yml", "setup-tx-ssh.sh", "transfer-oci-to-tx.sh"):
    assert forbidden not in build_text
# TX images are published to Tencent TCR only; GHCR stays the Yecao registry.
assert not (root / ".github/workflows/benchmark-tcr.yml").exists(), \
    "the direct-TCR benchmark is superseded by the production Build publication"

manifest_job = build_jobs["manifest"]
assert "always()" in manifest_job["if"]
assert "build_backend" in str(manifest_job["needs"])
assert "build_minio" in str(manifest_job["needs"])
assert "build_parser_worker" in str(manifest_job["needs"])
assert "needs.changes.outputs.parserWorker != 'true' || needs.build_parser_worker.result == 'success'" in manifest_job["if"]
# A failed transfer, import or TCR publication fails its builder job, and the
# manifest is only created for builders that succeeded.
for component in ("backend", "frontend", "keycloak"):
    assert f"needs.changes.outputs.{component} != 'true' || needs.build_{component}.result == 'success'" in manifest_job["if"], \
        f"the manifest must stay fail-closed on {component} transfer/import/publication failure"
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
# Deploy still validates the exact immutable image identity before it touches TX; the
# TX application images now live only in TCR.
image_run = image_job["steps"][-1]["run"]
assert "tcr_image_prefix" in image_run
assert "business-api) image=\"$tcr_image_prefix/wotbtools-backend\"" in image_run
assert "wotb-frontend) image=\"$tcr_image_prefix/wotbtools-frontend\"" in image_run
assert "keycloak) image=\"$tcr_image_prefix/wotbtools-keycloak\"" in image_run
# The retired Yecao backend no longer resolves to a GHCR image: TX publishes the Backend
# image as `business-api` under TCR, and an unsupported service fails closed instead of
# falling back to another registry.
assert "wotb-backend)" not in image_run
assert "unsupported image service" in image_run
assert "minio) image=ghcr.io/a158coke/wotbtools-minio" in image_run
assert "docker manifest inspect \"$image:$RELEASE_TAG\"" in image_run
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
assert "WOTB_DEPLOY_SERVICES" in deploy_text
assert "WOTB_DEPLOY_IMAGE_SERVICES" in deploy_text
assert "targetServices" in deploy_text
assert "parser-worker) image=ghcr.io/a158coke/wotbtools-parser-worker; remediation=" in image_run
# The TX deploy consumes TCR references only: neither the image-existence gate nor the TX
# SSH steps may resolve a TX application image through GHCR any more.
assert "ghcr.io/a158coke/wotbtools-backend" not in deploy_text
assert "ghcr.io/a158coke/wotbtools-frontend" not in deploy_text
assert "ghcr.io/a158coke/wotbtools-keycloak" not in deploy_text
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
