#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import fnmatch
import json
import os
import re
import shlex
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
workflow_dir = root / ".github/workflows"
ci_path = workflow_dir / "ci.yml"
ci_source = ci_path.read_text(encoding="utf-8")
ci = yaml.load(ci_path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
triggers = ci.get("on", ci.get(True, {}))

assert ci["name"] == "CI / PR"
assert set(triggers) == {"pull_request", "workflow_dispatch"}
assert triggers["pull_request"]["branches"] == ["main"]
assert "paths" not in triggers["pull_request"], "the required PR workflow must always create its gate"
assert triggers["workflow_dispatch"]["inputs"]["pr_number"]["required"] == "true"
assert triggers["workflow_dispatch"]["inputs"]["head_sha"]["required"] == "true"
assert set(ci["permissions"]) == {"contents", "pull-requests"}
assert ci["permissions"] == {"contents": "read", "pull-requests": "read"}
assert ci["jobs"]["required"]["name"] == "CI / Required Gate"
assert ci["jobs"]["required"]["if"] == "always()"
assert "packaging" not in ci["jobs"]
assert "packaging" not in ci["jobs"]["required"]["needs"]
assert "tofu_plans" in ci["jobs"]["required"]["needs"]
assert "deploy_smoke" in ci["jobs"]["required"]["needs"]
readiness_tests = [
    step for step in ci["jobs"]["deploy_smoke"]["steps"]
    if "deploy/test_dependency_readiness.py" in step.get("run", "")
]
assert len(readiness_tests) == 1, "deployment changes must run the read-only readiness protocol unit tests"

# There is one PR-triggered workflow, and it is the Required Gate owner.
pr_workflows = []
for pattern in ("*.yml", "*.yaml"):
    for path in workflow_dir.glob(pattern):
        workflow = yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
        events = workflow.get("on", workflow.get(True, {}))
        if "pull_request" in events:
            pr_workflows.append(path.name)
assert pr_workflows == ["ci.yml"], pr_workflows
assert not (workflow_dir / "local-plan-policy.yml").exists()
backup = yaml.load((workflow_dir / "database-backup.yml").read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
assert backup["concurrency"] == {
    "group": "production-maintenance", "cancel-in-progress": "false", "queue": "max",
}, "database backups must not be canceled while waiting behind a production mutation"

changes = ci["jobs"]["changes"]
assert {"base_sha", "head_sha", "tofu_roots", "java_modules", "browser_suites"} <= set(changes["outputs"])
assert "packaging_components" not in changes["outputs"]
steps = changes["steps"]
revision = next(step for step in steps if step.get("id") == "revisions")
revision_code = revision["run"]
assert revision["env"]["GH_TOKEN"] == "${{ github.token }}"
assert 'github.event.pull_request.base.sha' in str(revision["env"])
assert "api.github.com/repos/{repository}/pulls/{pr_number}" in revision_code
for expected in (
    'pr.get("state") == "open"',
    'base_ref == "main"',
    'head_repository.casefold() == repository.casefold()',
    'head_ref == current_branch',
    'head_sha == requested_head == current_sha',
    'current_sha == requested_head',
):
    assert expected in revision_code, expected
selection = next(step for step in steps if step.get("id") == "plan")
assert "scripts/ci/ci-impact.py --base" in selection["run"]
assert "deploy/release_plan.py --base" not in selection["run"]
assert "packagingComponents" not in selection["run"]

# Keep the CI Maven resolver isolated from the developer mirror settings.
ci_settings = (root / "java/settings-ci.xml").read_text(encoding="utf-8")
local_settings = (root / "java/settings.xml").read_text(encoding="utf-8")
assert "maven.aliyun.com" not in ci_settings
assert "<mirrors>" not in ci_settings and "<mirrorOf>" not in ci_settings
assert "maven.aliyun.com" in local_settings and "<mirrorOf>*</mirrorOf>" in local_settings
assert "settings.xml" not in re.sub(r"settings-ci\.xml", "", ci_source)
assert ci_source.count("-s settings-ci.xml") == 4
assert ci_source.count("-s ../java/settings-ci.xml") == 2
assert "-s settings.xml" not in ci_source

ci_text = json.dumps(ci, ensure_ascii=False)
workflow_runs = "\n".join(
    step.get("run", "")
    for job in ci["jobs"].values()
    for step in job.get("steps", [])
)
for forbidden in (
    "appleboy/ssh-action", "appleboy/scp-action", "secrets.",
    "test-keycloak-runtime.sh", "test-keycloak-tofu.sh",
    "test-rabbitmq-tofu.sh", "test-business-postgres-runtime.sh",
    "deploy/test-build-workflow.sh", "deploy/test-release-plan.sh",
):
    assert forbidden not in ci_text, forbidden
assert "docker/build-push-action" not in ci_text
assert "docker/setup-buildx-action" not in ci_text
assert not re.search(r"(?im)^\s*(?:(?:if|elif)\s+)?docker\s+(?:build(?:x\s+build)?|push|login)\b", workflow_runs)
assert not re.search(r"(?im)^\s*(?:(?:if|elif)\s+)?tofu(?:\s+-[^\s]+)*\s+(?:plan|apply)\b", workflow_runs)

# Scan directly invoked bash helpers as shell code. Syntax-only checks are not
# execution paths and are intentionally excluded from this reachable-script audit.
unsafe_command = re.compile(
    r"(?im)^\s*(?:(?:if|elif)\s+)?(?:"
    r"docker\s+(?:build(?:x\s+build)?|push|login)|"
    r"tofu(?:\s+-[^\s]+)*\s+(?:plan|apply)|ssh|scp)\b"
)
reachable = set()
for job in ci["jobs"].values():
    for step in job.get("steps", []):
        run = step.get("run", "")
        if re.search(r"(?m)^\s*bash\s+-n\b", run):
            continue
        for match in re.finditer(r"(?m)^\s*(?:bash|python3)\s+([A-Za-z0-9_./-]+\.(?:sh|py))\b", run):
            candidate = match.group(1)
            if (root / candidate).is_file():
                reachable.add(candidate)
for relative in sorted(reachable):
    source = (root / relative).read_text(encoding="utf-8")
    assert not unsafe_command.search(source), f"unsafe command is reachable through {relative}"

tofu_job = ci["jobs"]["tofu_plans"]
tofu_text = json.dumps(tofu_job)
assert "tofu fmt -check -recursive" in tofu_text
assert "tofu init -backend=false -input=false" in tofu_text
assert "tofu validate" in tofu_text
assert "test-validate-plan.sh" in tofu_text
assert "secrets." not in tofu_text
assert not re.search(r"(?i)\btofu(?:\s+-[^\s]+)*\s+(?:plan|apply)\b", tofu_text)

required = ci["jobs"]["required"]
required_text = "\n".join(step.get("run", "") for step in required["steps"])
for selected_gate in (
    "changes|true|$CHANGES", "backend|", "frontend|", "http_contract|",
    "android_contract|", "live_data_contracts|", "tofu_plans|",
):
    assert selected_gate in required_text, selected_gate
assert "packaging|" not in required_text

# Data updates stay independent and dispatch the exact newly created or updated PR head.
for owner in ("update-tankopedia", "update-equipment", "update-crew-skills"):
    path = workflow_dir / f"{owner}.yml"
    workflow = yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    assert workflow["permissions"].get("actions") == "write", \
        f"{owner} must be able to dispatch the exact-head CI workflow"
    sync_steps = [
        step
        for job in workflow["jobs"].values()
        for step in job.get("steps", [])
        if "gh pr create" in step.get("run", "")
    ]
    assert len(sync_steps) == 1, f"{owner} must retain its standalone PR publisher"
    run = sync_steps[0]["run"]
    create = run.index("gh pr create")
    lookups = [match.start() for match in re.finditer(r'pr_number="\$\(gh pr list ', run)]
    assert len(lookups) == 2 and lookups[1] > create, f"{owner} must resolve PR number after creation"
    validation = run.index('[[ "$pr_number" =~ ^[1-9][0-9]*$ ]]')
    head = run.index('head_sha="$(git rev-parse HEAD)"')
    view = run.index('gh pr view "$pr_number"')
    dispatch = run.index('gh workflow run ci.yml --ref "$BRANCH"')
    assert create < lookups[1] < validation < head < view < dispatch
    assert '--field "pr_number=$pr_number"' in run
    assert '--field "head_sha=$head_sha"' in run

# Every standalone image owner deploys the exact digest produced and validated by its build.
for owner in ("business-api", "frontend", "keycloak", "parser-worker", "minio"):
    path = workflow_dir / f"{owner}.yml"
    workflow = yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    deploy_steps = [
        step
        for job in workflow["jobs"].values()
        for step in job.get("steps", [])
        if step.get("uses") == "appleboy/ssh-action@v1" and "envs" in step.get("with", {})
    ]
    assert len(deploy_steps) == 1, f"{owner} must have one image deploy boundary"
    step = deploy_steps[0]
    assert "WOTB_DEPLOY_IMAGE_DIGEST" in step["with"]["envs"].split(",")
    assert step.get("env", {}).get("WOTB_DEPLOY_IMAGE_DIGEST") == "${{ needs.build.outputs.digest }}"
    assert "export WOTB_DEPLOY_IMAGE_DIGEST='${{ needs.build.outputs.digest }}'" in step["with"]["script"]

# Production image owner paths must cover Docker context sources and staged SCP inputs.
image_dockerfiles = {
    "business-api": "docker/Dockerfile.business-api",
    "frontend": "docker/Dockerfile.frontend",
    "keycloak": "docker/Dockerfile.keycloak",
    "parser-worker": "docker/Dockerfile.parser-worker",
    "minio": "docker/Dockerfile.minio",
}

def trigger_paths(owner):
    workflow = yaml.load((workflow_dir / f"{owner}.yml").read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    events = workflow.get("on", workflow.get(True, {}))
    return workflow, events.get("push", {}).get("paths", [])

def matches_input(patterns, path, is_directory=False):
    candidate = path.rstrip("/") + "/__workflow_input__" if is_directory else path.rstrip("/")
    return any(fnmatch.fnmatchcase(candidate, pattern) for pattern in patterns)

# Image work can build concurrently; only the host mutation job queues behind production maintenance.
production_owners = (
    "business-api", "frontend", "keycloak", "parser-worker", "minio",
    "rabbitmq", "business-postgres", "keycloak-postgres", "observability", "caddy",
)
image_owners = {"business-api", "frontend", "keycloak", "parser-worker", "minio"}
production_concurrency = {
    "group": "production-maintenance", "cancel-in-progress": "false", "queue": "max",
}
for owner in production_owners:
    workflow, paths = trigger_paths(owner)
    freshness_paths = workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
    assert freshness_paths == paths, (
        f"{owner} freshness paths must exactly match its trigger paths"
    )
    calls = [
        step
        for job in workflow["jobs"].values()
        for step in job.get("steps", [])
        if "deploy/check-production-freshness.sh" in step.get("run", "")
    ]
    assert len(calls) >= 2, f"{owner} must check freshness at source and before production mutation"
    assert all(
        step.get("env", {}).get("EVENT_SHA") == "${{ github.sha }}"
        for step in calls
    ), f"{owner} must validate the triggering event SHA at every freshness boundary"
    if owner in image_owners:
        assert "concurrency" not in workflow, f"{owner} build must not hold the production queue"
        assert workflow["jobs"]["deploy"]["concurrency"] == production_concurrency
    else:
        assert workflow["concurrency"] == production_concurrency, (
            f"{owner} infrastructure changes must retain workflow-level serialization"
        )

freshness_helper = (root / "deploy/check-production-freshness.sh").read_text(encoding="utf-8")
assert "git merge-base --is-ancestor" in freshness_helper
assert "git diff --quiet \"$source_sha\" \"$current_main\"" in freshness_helper
assert "workflow_dispatch" in freshness_helper and "refs/heads/main" in freshness_helper
assert "git ls-remote" not in freshness_helper


for owner, dockerfile in image_dockerfiles.items():
    workflow, paths = trigger_paths(owner)
    assert matches_input(paths, dockerfile), f"{owner} paths must include its Dockerfile"
    assert matches_input(paths, ".dockerignore"), f"{owner} paths must include the Docker context boundary"
    source_text = (root / dockerfile).read_text(encoding="utf-8")
    copied_context_inputs = []
    for line in source_text.splitlines():
        if not re.match(r"^COPY\s+", line) or "--from=" in line:
            continue
        tokens = shlex.split(line)
        sources = [token for token in tokens[1:-1] if not token.startswith("--")]
        copied_context_inputs.extend(sources)
    for source in copied_context_inputs:
        source_path = root / source.rstrip("/")
        assert source_path.exists(), f"{dockerfile} COPY source is missing: {source}"
        assert matches_input(paths, source, source_path.is_dir()), (
            f"{owner} workflow paths do not cover Docker COPY input {source}"
        )
    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            if step.get("uses") != "appleboy/scp-action@v1":
                continue
            for source in step.get("with", {}).get("source", "").split(","):
                source = source.strip()
                if not source:
                    continue
                source_path = root / source.rstrip("/")
                assert source_path.exists(), f"{owner} stages a missing SCP input: {source}"
                if source_path.is_dir():
                    assert any(
                        pattern == source.rstrip("/")
                        or pattern.startswith(source.rstrip("/") + "/")
                        or fnmatch.fnmatchcase(source.rstrip("/") + "/__workflow_input__", pattern)
                        for pattern in paths
                    ), f"{owner} workflow paths do not cover staged directory {source}"
                else:
                    assert matches_input(paths, source), f"{owner} workflow paths do not cover staged file {source}"

# The Java Docker builds copy every reactor module POM even when a service only
# copies source for its own Maven closure. Keep new modules buildable and trigger both owners.
namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
java_pom = ET.fromstring((root / "java/pom.xml").read_text(encoding="utf-8"))
modules = [node.text for node in java_pom.findall("m:modules/m:module", namespace)]
for owner in ("business-api", "parser-worker"):
    dockerfile = root / image_dockerfiles[owner]
    source = dockerfile.read_text(encoding="utf-8")
    copied_poms = set(re.findall(r"^COPY\s+java/([^/\s]+)/pom\.xml\s", source, flags=re.MULTILINE))
    assert set(modules) <= copied_poms, f"{owner} Dockerfile must copy every Maven reactor POM"
    _, paths = trigger_paths(owner)
    for module in modules:
        assert matches_input(paths, f"java/{module}/pom.xml"), f"{owner} paths omit {module} POM"

# Each independent Tofu owner must trigger on its own state root.
tofu_owner_roots = {
    "keycloak": "infra/tofu/keycloak",
    "minio": "infra/tofu/minio",
    "rabbitmq": "infra/tofu/rabbitmq",
    "business-postgres": "infra/tofu/postgres-business",
    "keycloak-postgres": "infra/tofu/postgres-keycloak",
    "observability": "infra/tofu/grafana",
}
for owner, path in tofu_owner_roots.items():
    _, paths = trigger_paths(owner)
    assert matches_input(paths, path, is_directory=True), f"{owner} workflow does not trigger for {path}"

def git(cwd, *args):
    result = subprocess.run(
        ["git", *args], cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    assert result.returncode == 0, f"git {' '.join(args)} failed:\n{result.stdout}"
    return result.stdout.strip()

def write_commit(repo, relative, content, message):
    target = repo / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    git(repo, "add", "--", relative)
    git(repo, "commit", "-m", message)
    return git(repo, "rev-parse", "HEAD")

def run_freshness(repo, source, event_name, event_ref, input_paths, expected, message, failure_text=None):
    git(repo, "fetch", "origin", "+refs/heads/main:refs/remotes/origin/main")
    git(repo, "checkout", "--detach", source)
    environment = os.environ.copy()
    environment["PRODUCTION_INPUT_PATHS"] = input_paths
    result = subprocess.run(
        [bash_executable, "deploy/check-production-freshness.sh", source, event_name,
         event_ref, source],
        cwd=repo, env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if expected:
        assert result.returncode == 0, f"{message} should pass:\n{result.stdout}"
    else:
        assert result.returncode != 0 and failure_text in result.stdout, (
            f"{message} should fail for the expected reason ({failure_text}):\n{result.stdout}"
        )

# Exercise the production helper against a local bare remote without network or credentials.
with tempfile.TemporaryDirectory(prefix="wotb-freshness-") as temp_name:
    temp = Path(temp_name)
    remote = temp / "origin.git"
    source_repo = temp / "source"
    runner_repo = temp / "runner"
    source_repo.mkdir()
    subprocess.run(["git", "init", "--bare", str(remote)], cwd=temp, check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    subprocess.run(["git", "init", "--initial-branch=main"], cwd=source_repo, check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    git(source_repo, "config", "user.name", "Workflow Contract")
    git(source_repo, "config", "user.email", "workflow-contract@example.invalid")
    write_commit(source_repo, ".github/workflows/frontend.yml", "name: frontend\n", "base")
    for relative, content in (
        (".dockerignore", "node_modules\n"),
        ("docker/Dockerfile.frontend", "FROM nginx\n"),
        ("frontend/src/app.js", "export const app = 1;\n"),
        ("docker/Dockerfile.business-api", "FROM eclipse-temurin\n"),
        ("java/wotb-core/src/Core.java", "class Core {}\n"),
        ("java/wotb-parser-worker/src/Parser.java", "class Parser {}\n"),
    ):
        target = source_repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    helper_target = source_repo / "deploy/check-production-freshness.sh"
    helper_target.parent.mkdir(parents=True, exist_ok=True)
    helper_target.write_text(freshness_helper, encoding="utf-8")
    git(source_repo, "add", "-A")
    git(source_repo, "commit", "-m", "production inputs")
    base = git(source_repo, "rev-parse", "HEAD")
    git(source_repo, "remote", "add", "origin", str(remote))
    git(source_repo, "push", "-u", "origin", "main")
    subprocess.run(["git", "clone", "--branch", "main", str(remote), str(runner_repo)], cwd=temp,
                   check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    git(runner_repo, "config", "user.name", "Workflow Contract")
    git(runner_repo, "config", "user.email", "workflow-contract@example.invalid")
    if os.name == "nt":
        git_exec_path = subprocess.run(
            ["git", "--exec-path"], check=True, text=True, stdout=subprocess.PIPE,
        ).stdout.strip()
        git_bash = Path(git_exec_path).parents[2] / "bin" / "bash.exe"
        assert git_bash.is_file(), f"Git Bash not found beside {git_exec_path}"
        bash_executable = str(git_bash)
    else:
        bash_executable = "bash"
    frontend_paths = "\n".join((
        ".github/workflows/frontend.yml", ".dockerignore", "docker/Dockerfile.frontend", "frontend/**",
        "common/map_names.json",
    ))
    business_paths = "\n".join(("docker/Dockerfile.business-api", "java/wotb-core/**"))
    parser_paths = "java/wotb-parser-worker/**"

    docs = write_commit(source_repo, "docs/README.md", "docs-only\n", "docs only")
    git(source_repo, "push", "origin", "main")
    run_freshness(runner_repo, base, "push", "refs/heads/main", frontend_paths, True, "docs-only main advance")

    frontend = write_commit(source_repo, "frontend/src/app.js", "export const app = 2;\n", "frontend change")
    git(source_repo, "push", "origin", "main")
    write_commit(
        source_repo, "deploy/check-production-freshness.sh",
        freshness_helper + "\n# shared helper-only change fixture\n", "freshness helper change",
    )
    git(source_repo, "push", "origin", "main")
    run_freshness(runner_repo, docs, "push", "refs/heads/main", frontend_paths, False, "frontend owner change",
                  "Production-owned inputs changed after the workflow source SHA.")
    run_freshness(runner_repo, frontend, "push", "refs/heads/main", frontend_paths, True,
                  "frontend stays fresh across a shared helper-only main advance")

    workflow = write_commit(source_repo, ".github/workflows/frontend.yml", "name: frontend updated\n", "workflow change")
    git(source_repo, "push", "origin", "main")
    run_freshness(runner_repo, frontend, "push", "refs/heads/main", frontend_paths, False, "frontend workflow change",
                  "Production-owned inputs changed after the workflow source SHA.")

    business_dockerfile = write_commit(source_repo, "docker/Dockerfile.business-api", "FROM eclipse-temurin:25\n", "business API Dockerfile change")
    git(source_repo, "push", "origin", "main")
    run_freshness(runner_repo, workflow, "push", "refs/heads/main", business_paths, False, "business API Dockerfile change",
                  "Production-owned inputs changed after the workflow source SHA.")

    shared_core = write_commit(source_repo, "java/wotb-core/src/Core.java", "class Core { int version = 2; }\n", "shared core change")
    git(source_repo, "push", "origin", "main")
    run_freshness(runner_repo, business_dockerfile, "push", "refs/heads/main", business_paths, False, "shared Java core change",
                  "Production-owned inputs changed after the workflow source SHA.")

    parser_module = write_commit(source_repo, "java/wotb-parser-worker/src/Parser.java", "class Parser { int version = 2; }\n", "parser worker change")
    git(source_repo, "push", "origin", "main")
    run_freshness(runner_repo, shared_core, "push", "refs/heads/main", parser_paths, False, "parser worker owner change",
                  "Production-owned inputs changed after the workflow source SHA.")

    unrelated = write_commit(source_repo, "java/wotb-parser-worker/README.md", "parser documentation\n", "unrelated parser worker change")
    git(source_repo, "push", "origin", "main")
    run_freshness(runner_repo, parser_module, "push", "refs/heads/main", frontend_paths, True, "unrelated parser worker change")
    run_freshness(runner_repo, unrelated, "workflow_dispatch", "refs/heads/main", frontend_paths, True, "current-main manual dispatch")
    run_freshness(runner_repo, parser_module, "workflow_dispatch", "refs/heads/main", frontend_paths, False, "stale manual dispatch",
                  "Manual deployment must use the exact current main SHA.")
    run_freshness(runner_repo, unrelated, "workflow_dispatch", "refs/heads/feature", frontend_paths, False, "non-main manual dispatch",
                  "Production workflows require the main ref.")

    git(runner_repo, "checkout", "--orphan", "unrelated", unrelated)
    git(runner_repo, "rm", "-r", "--cached", ".")
    non_ancestor = write_commit(runner_repo, "unrelated.txt", "independent history\n", "non-ancestor")
    run_freshness(runner_repo, non_ancestor, "push", "refs/heads/main", frontend_paths, False, "non-ancestor source",
                  "Source SHA is not an ancestor of current main.")

print("Service-scoped freshness contracts and production queue boundaries OK")
print("CI-only PR workflow, dispatcher, purity, Required Gate, and workflow input contracts OK")
PY

# Android release artifacts must land in the TX runtime path and use TX credentials.
if grep -Fq '/opt/wotb/android-release' .github/workflows/android-release.yml; then
  echo "ERROR: Android release workflow still targets the retired /opt/wotb runtime." >&2
  exit 1
fi
if ! grep -Fq '/opt/wotb-tx/android-release' .github/workflows/android-release.yml; then
  echo "ERROR: Android release must publish into the TX runtime bind mount." >&2
  exit 1
fi
if grep -Eq 'secrets\.VPS_(HOST|USER|PORT|SSH_KEY)' .github/workflows/android-release.yml; then
  echo "ERROR: Android release must not use the retired Yecao VPS_* SSH target." >&2
  exit 1
fi
for secret in TX_VPS_HOST TX_VPS_USER TX_VPS_PORT TX_VPS_SSH_KEY; do
  if ! grep -Fq "secrets.$secret" .github/workflows/android-release.yml; then
    echo "ERROR: Android release is missing TX SSH secret: $secret" >&2
    exit 1
  fi
done
