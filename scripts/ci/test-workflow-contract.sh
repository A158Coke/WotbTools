#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

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
publication_helper = root / "deploy/tx/publish-loaded-image-to-tcr.sh"
ssh_setup_helper = root / "scripts/ci/setup-tx-ssh.sh"
oci_transfer_helper = root / "scripts/ci/transfer-oci-to-tx.sh"

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
for component in ("backend", "frontend", "keycloak"):
    title = component.title()
    assert f"Transfer {title} OCI archive to TX" in build
    assert f"Import {title} OCI image on TX" in build
    assert f"Publish {title} loaded image to TCR" in build
    assert f"Remove {title} remote transfer material" in build
    assert f"bash scripts/ci/transfer-oci-to-tx.sh transfer {component}" in build
    assert f"bash scripts/ci/transfer-oci-to-tx.sh import {component}" in build
    assert f"bash scripts/ci/transfer-oci-to-tx.sh cleanup {component}" in build
    # Publication is invoked with the component and the immutable tag only: no identity
    # value is forwarded to TX any more.
    publish_call = f"publish-loaded-image-to-tcr.sh {component} '${{{{ needs.changes.outputs.tag }}}}'"
    assert publish_call in build, f"{component} publication must pass only its immutable tag"
    assert f"{publish_call} '" not in build, \
        f"{component} publication must not forward another identity argument"
# The long-lived OCI stream is gone for good: no gzip pipe and no stdin docker load.
assert "stream-oci-to-tx.sh" not in build
assert "gzip" not in build
assert "docker load" not in build
assert "oci-import.lock" not in build
assert "imjasonh/setup-crane@v0.7" not in build
assert "TCR_IMAGE_PREFIX" not in build
assert "TCR_USERNAME" not in build and "TCR_PASSWORD" not in build
assert "deploy/tx/replicate-image-to-tcr.sh" not in build
assert "appleboy/scp-action@v1" not in build and "appleboy/ssh-action@v1" not in build
# The direct runner -> TCR benchmark is the one sanctioned exception to "Build must not
# direct-push Tencent TCR". It has to stay manual-only, benchmark-tagged and completely
# outside the production release chain: no GHCR, no OCI export or archive transport, no SSH
# to TX, no retry, no deployment manifest, no production environment. The GHCR + OCI + TX
# publication path above remains the production fallback this workflow must not touch.
benchmark_path = root / ".github/workflows/benchmark-tcr.yml"
assert benchmark_path.is_file(), "the direct TCR publication benchmark must be dispatchable"
benchmark = yaml.safe_load(benchmark_path.read_text(encoding="utf-8"))
# PyYAML resolves an unquoted `on:` key as the YAML 1.1 boolean True.
benchmark_triggers = benchmark.get("on", benchmark.get(True))
assert benchmark_triggers, "the TCR benchmark must declare its triggers"
assert set(benchmark_triggers) == {"workflow_dispatch"}, \
    "the TCR benchmark must never run on push, pull_request or workflow_run"
assert benchmark["permissions"] == {"contents": "read"}, \
    "the TCR benchmark must not request packages: write or any other scope"
benchmark_job = benchmark["jobs"]["benchmark"]
assert "environment" not in benchmark_job, \
    "the TCR benchmark must not attach a production environment for repository-scoped TCR credentials"
benchmark_steps = benchmark_job["steps"]
assert [step.get("uses") for step in benchmark_steps if "uses" in step] == [
    "actions/checkout@v5",
    "docker/login-action@v4",
    "docker/setup-buildx-action@v4",
    "docker/build-push-action@v7",
], "the TCR benchmark must use only checkout, TCR login, Buildx and build-push"
benchmark_step_text = repr(benchmark_steps)
for forbidden in (
    "ghcr",
    "transfer-oci-to-tx.sh",
    "publish-loaded-image-to-tcr.sh",
    "rsync",
    "scp",
    "docker load",
    "type=oci",
    "upload-artifact",
    "deployment-manifest",
    "crane",
    "continue-on-error",
    "retry",
    "latest",
):
    assert forbidden not in benchmark_step_text, \
        f"the TCR benchmark must stay out of the production release chain: {forbidden}"
assert "ssh" not in benchmark_step_text.lower(), \
    "the TCR benchmark must never open an SSH or SCP session to TX"
benchmark_login = next(step for step in benchmark_steps if step.get("uses") == "docker/login-action@v4")
assert benchmark_login["with"] == {
    "registry": "${{ vars.TCR_REGISTRY }}",
    "username": "${{ secrets.TCR_USERNAME }}",
    "password": "${{ secrets.TCR_PASSWORD }}",
}, "the TCR benchmark must authenticate with the same TCR registry and credentials as Deploy"
benchmark_build = next(
    step for step in benchmark_steps if step.get("uses") == "docker/build-push-action@v7"
)
assert benchmark_build["with"]["file"] == "docker/Dockerfile.backend", \
    "the TCR benchmark must build the real Backend image"
# BUILD and TCR UPLOAD have to be observable as two separate stages, which is the primary
# result of this PoC: the image is built once into the runner's local Docker daemon and the
# publication stage pushes that same image. The production registry exporter is deliberately
# absent here because it streams blobs while building and would merge the two numbers.
assert benchmark_build["with"]["load"] is True, \
    "the TCR benchmark must build once into the runner Docker daemon"
assert "outputs" not in benchmark_build["with"], \
    "the TCR benchmark build must not export or push to the registry"
for step in benchmark_steps:
    assert not re.search(r"\bdocker build\b", step.get("run", "")), \
        "the TCR benchmark must build exactly once and never rebuild for publication"
    assert "buildx build" not in step.get("run", ""), \
        "the TCR benchmark must build exactly once and never rebuild for publication"
assert benchmark_build["with"]["tags"] == "${{ steps.identity.outputs.target_image }}", \
    "the TCR benchmark tag must come from the benchmark identity step"
assert "cache-from" not in benchmark_build["with"] and "cache-to" not in benchmark_build["with"], \
    "the first TCR benchmark run must be an uncached, raw measurement"
benchmark_identity = next(step for step in benchmark_steps if step.get("id") == "identity")
assert "benchmark-$GITHUB_RUN_ID" in benchmark_identity["run"], \
    "the TCR benchmark must use an isolated benchmark-<run id> tag"
assert "rev-parse origin/main" in benchmark_identity["run"], \
    "the TCR benchmark must run from the current main HEAD"
benchmark_push = next(step for step in benchmark_steps if step.get("id") == "push")
assert 'docker push "$TARGET_IMAGE"' in benchmark_push["run"], \
    "the TCR benchmark must publish with one raw docker push of the built image"
for forbidden in ("| tee", "|tee", "2>&1", "/dev/null", "timeout "):
    assert forbidden not in benchmark_push["run"], \
        f"the TCR benchmark must keep the push raw and unretried: {forbidden}"
assert "stage=tcr-push" in benchmark_push["run"] and "duration_seconds" in benchmark_push["run"], \
    "the TCR benchmark must report the upload duration separately"
benchmark_verify = next(
    step for step in benchmark_steps if step.get("name") == "Verify the published benchmark tag in TCR"
)
assert "docker buildx imagetools inspect" in benchmark_verify["run"], \
    "the TCR benchmark must verify publication by registry manifest inspection"
assert "{{.Manifest.Digest}}" in benchmark_verify["run"]
assert "stage=tcr-verify" in benchmark_verify["run"], \
    "the TCR benchmark must report the verification duration separately"
assert "TCR_PUBLICATION=PASS" in benchmark_verify["run"]
assert "docker pull" not in benchmark_verify["run"], \
    "the TCR benchmark must never pull the published image back"
assert any(
    "stage=build" in step.get("run", "") and "duration_seconds" in step.get("run", "")
    for step in benchmark_steps
), "the TCR benchmark must report the build duration separately"
assert publication_helper.is_file() and ssh_setup_helper.is_file() and oci_transfer_helper.is_file()
assert not (root / "scripts/ci/stream-oci-to-tx.sh").exists(), \
    "the obsolete long-lived OCI stream helper must stay deleted"
helper_text = publication_helper.read_text(encoding="utf-8")
assert "set -euo pipefail" in helper_text
assert "backend|frontend|keycloak" in helper_text
assert "docker image inspect" in helper_text and "docker push" in helper_text
assert "docker buildx imagetools inspect" in helper_text
assert "{{.Manifest.Digest}}" in helper_text
assert "{{.Digest}}" not in helper_text
# The publication takes only the component and the immutable tag: it derives the loaded
# and TCR references itself and never compares an image id or an expected digest.
assert "usage: %s <backend|frontend|keycloak> <sha-12>" in helper_text
assert "expected_digest" not in helper_text and "{{.Id}}" not in helper_text
assert "timeout --kill-after" in helper_text
assert "stage=publication-start" in helper_text and "stage=publication-end" in helper_text
assert "stage=verify-immutable" in helper_text and "stage=update-latest" in helper_text
assert "docker system prune" not in helper_text
assert "docker pull" not in helper_text and "crane" not in helper_text
assert "StrictHostKeyChecking yes" in ssh_setup_helper.read_text(encoding="utf-8")
transfer_text = oci_transfer_helper.read_text(encoding="utf-8")
assert "set -euo pipefail" in transfer_text
assert "rsync" in transfer_text
assert "--partial" in transfer_text and "--append-verify" in transfer_text
assert "sha256sum" in transfer_text
assert "docker load -i" in transfer_text
assert "flock -w" in transfer_text and "oci-transfer.lock" in transfer_text
assert "gzip -" not in transfer_text and "bash -o pipefail -c" not in transfer_text
assert "timeout --kill-after" in transfer_text
assert "run-with-network-retry.sh" not in transfer_text
assert "publish-loaded-image-to-tcr.sh" not in transfer_text
assert "EXPECTED_DIGEST" not in transfer_text
# Release identity is the immutable tag: the import derives the canonical loaded
# reference from its own component and tag and only checks that it is present. No image
# id, config digest or expected identity value crosses the workflow environment, and no
# TX-local image namespace exists any more.
assert "EXPECTED_IMAGE_REF" not in transfer_text
assert "EXPECTED_IMAGE_ID" not in transfer_text
assert "EXPECTED_IMAGE_REF" not in build
assert "EXPECTED_IMAGE_ID" not in build
assert "EXPECTED_DIGEST" not in build
assert "{{.Id}}" not in transfer_text
assert 'canonical_image_ref="$GHCR_IMAGE_PREFIX-$component:$tag"' in transfer_text
assert "wotb-transfer" not in transfer_text
assert "wotb-transfer" not in build
assert "wotb-transfer" not in helper_text
assert "TCR_PASSWORD" not in transfer_text and "docker pull" not in transfer_text
assert "crane" not in transfer_text
for component in ("Backend", "Frontend", "Keycloak"):
    assert f"Publish {component} loaded image to TCR" in build
# Publication and import are exactly-once steps; only the rsync upload retries.
assert "run-with-network-retry.sh 'publish" not in build.lower()
assert "run-with-network-retry.sh 'transfer" not in build.lower()
assert "run-with-network-retry.sh 'import" not in build.lower()
assert "run-with-network-retry.sh 'stream" not in build.lower()
assert not (root / "scripts/ci/copy-image-to-tcr.sh").exists()
assert not (root / "deploy/tx/replicate-image-to-tcr.sh").exists()
assert "TCR_REGISTRY: ${{ vars.TCR_REGISTRY }}" in deploy
assert "TCR_NAMESPACE: ${{ vars.TCR_NAMESPACE }}" in deploy
assert "TX_IMAGE_SERVICES" in deploy
assert "contains_tx_image_service" in deploy
assert "parser-worker) image=ghcr.io/a158coke/wotbtools-parser-worker" in deploy
assert "workflow_run:" in deploy and "workflow_dispatch:" in deploy
assert "tx_services:" in deploy
assert "        default: business-api" in deploy
assert "        type: choice" in deploy
assert "          - all" in deploy
assert '"rabbitmq"' in deploy
assert "TX_RABBITMQ_ADMIN_USER" in deploy
assert "TX_RABBITMQ_ADMIN_PASSWORD" in deploy
assert "TX_RABBITMQ_CONTROL_API_PASSWORD" in deploy
assert "TX_RABBITMQ_PARSER_WORKER_PASSWORD" in deploy
assert "Install RabbitMQ OpenTofu root on TX" in deploy
assert "RabbitMQ Compose and OpenTofu ownership smoke" in ci
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

# Maven resolves the aggregator's <modules> before it applies -pl, so a module listed in
# java/pom.xml without a matching COPY in the backend Dockerfile fails the image build with
# "Child module ... does not exist". Keep the two lists in lockstep.
backend_dockerfile = (root / "docker/Dockerfile.backend").read_text(encoding="utf-8")
java_pom = ET.parse(root / "java/pom.xml").getroot()
maven_namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
maven_modules = [
    element.text.strip() for element in java_pom.findall("./m:modules/m:module", maven_namespace)
]
assert maven_modules, "java/pom.xml must declare its modules"
for maven_module in maven_modules:
    assert f"COPY java/{maven_module}/pom.xml java/{maven_module}/pom.xml" in backend_dockerfile, \
        f"docker/Dockerfile.backend must pre-copy java/{maven_module}/pom.xml"

# The parser-worker image pre-copies every module pom as well (Maven resolves the aggregator's
# <modules> before it applies -pl); its source closure is checked together with every other image
# below.
parser_worker_dockerfile = (root / "docker/Dockerfile.parser-worker").read_text(encoding="utf-8")
assert "-pl wotb-parser-worker -am" in parser_worker_dockerfile, \
    "docker/Dockerfile.parser-worker must build the parser-worker reactor"
for maven_module in maven_modules:
    assert f"COPY java/{maven_module}/pom.xml java/{maven_module}/pom.xml" in parser_worker_dockerfile, \
        f"docker/Dockerfile.parser-worker must pre-copy java/{maven_module}/pom.xml"


def module_dependencies(module):
    """Direct, non-test com.wotb dependencies of one aggregator module."""
    pom = ET.parse(root / f"java/{module}/pom.xml").getroot()
    dependencies = set()
    for dependency in pom.findall("./m:dependencies/m:dependency", maven_namespace):
        group_id = dependency.findtext("m:groupId", default="", namespaces=maven_namespace)
        artifact_id = dependency.findtext("m:artifactId", default="", namespaces=maven_namespace)
        scope = dependency.findtext("m:scope", default="", namespaces=maven_namespace)
        if group_id == "com.wotb" and artifact_id in maven_modules and scope != "test":
            dependencies.add(artifact_id)
    return dependencies


def reactor_closure(roots):
    """Transitive com.wotb module closure of a Maven `-pl <roots> -am` reactor build."""
    closure = set()
    pending = list(roots)
    while pending:
        current = pending.pop()
        if current in closure:
            continue
        closure.add(current)
        pending.extend(module_dependencies(current))
    return closure


# Sources, not just poms. Any image that builds a Maven reactor must copy the sources of that
# reactor's whole module closure: `-am` pulls a module into the reactor the moment a sibling starts
# depending on it, and a reactor module with a pom but no sources compiles into an empty jar, so the
# dependent module dies with "package ... does not exist". That is exactly how wotb-web's new
# broker/object-storage dependencies broke the backend image build. Deriving the closure from the
# poms keeps every Dockerfile honest instead of hand-maintaining a COPY list per image.
reactor_builds_checked = 0
for dockerfile_path in sorted((root / "docker").glob("Dockerfile.*")):
    dockerfile = dockerfile_path.read_text(encoding="utf-8")
    for reactor in re.findall(r"-pl ([A-Za-z0-9_,-]+) -am", dockerfile):
        roots = [name.strip() for name in reactor.split(",") if name.strip()]
        for maven_module in sorted(reactor_closure(roots)):
            assert f"COPY java/{maven_module}/src java/{maven_module}/src" in dockerfile, \
                f"docker/{dockerfile_path.name} must copy java/{maven_module}/src (-pl {reactor} -am)"
        reactor_builds_checked += 1
assert reactor_builds_checked > 0, "no Dockerfile reactor build was discovered; the closure check is idle"

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
