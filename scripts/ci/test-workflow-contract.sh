#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import json
import fnmatch
import re
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
workflow_dir = root / ".github/workflows"
load = lambda path: yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)

ci = load(workflow_dir / "ci-gate.yml")
triggers = ci.get("on", ci.get(True, {}))
assert set(triggers) == {"pull_request", "workflow_dispatch"}
assert triggers["pull_request"]["branches"] == ["main"]
assert "paths" not in triggers["pull_request"], "the required gate must run for every PR"
assert set(triggers["workflow_dispatch"]["inputs"]) == {"pr_number", "head_sha"}
assert ci["permissions"] == {"contents": "read", "pull-requests": "read"}

pr_owners = []
for path in sorted((*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml"))):
    events = load(path).get("on", load(path).get(True, {}))
    if "pull_request" in events:
        pr_owners.append(path.name)
assert pr_owners == ["ci-gate.yml"], pr_owners

jobs = ci["jobs"]
required = jobs["required"]
assert required["name"] == "CI / Required Gate" and required["if"] == "always()"
assert set(required["needs"]) == set(jobs) - {"required"}
assert "ci-impact.py" not in json.dumps(ci)
assert "test-path-filters.py" not in json.dumps(ci)
assert "dorny/paths-filter@v3" in json.dumps(jobs["changes"])
assert set(jobs["changes"]["outputs"]) == set(jobs) - {"pr_identity", "changes", "required"}
filter_path = next(step for step in jobs["changes"]["steps"]
                   if step.get("id") == "filter")["with"]["filters"]
assert filter_path == ".github/ci-owner-paths.yml"
filters = load(root / filter_path)
def affected(path):
    return {owner for owner, patterns in filters.items()
            if any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)}
def covers_production_path(production_path, owner_pattern):
    if not any(char in production_path for char in "*?["):
        return fnmatch.fnmatchcase(production_path, owner_pattern)
    if production_path == owner_pattern:
        return True
    # A subtree glob can cover a narrower subtree glob; matching glob text
    # with fnmatch alone would incorrectly accept narrower owner patterns.
    return (owner_pattern.endswith("/**")
            and production_path.startswith(owner_pattern[:-2]))
assert affected("frontend/src/styles/base.css") == {"frontend"}
for tier in range(1, 11):
    assert {"python", "frontend", "business_api", "ai_service"} <= affected(
        f"common/tankopedia-tier{tier}.json"
    ), f"tier {tier} data must run Python integrity checks and its consumers"
assert affected("infra/tofu/postgres-business/main.tf") == {"business_postgres"}
assert affected("deploy/tx/business-postgres.compose.yml") == {"business_postgres"}
assert affected("docs/README.md") == set()
assert affected("frontend/src/platform/nativeBridgeContract.js") == {"frontend", "android"}
assert "android" in affected(".github/workflows/android-release.yml"), "release protocol changes must run Android helper tests"
assert affected("deploy/list-image-tags.sh") == {"business_api", "deployment", "observability"}
assert affected("deploy/tx/publish-loaded-image-to-tcr.sh") == {"deployment"}
assert affected("deploy/tx/validate-caddy-config.sh") == {"caddy", "deployment"}
# The gateway fixture suite is owned by the Caddy gateway: ci-caddy.yml is the only
# workflow that runs it, so a Caddyfile-only change still re-runs the runtime proof
# of the compliance access log instead of only its staged text/JSON assertions.
assert affected("deploy/test-caddy-route-inventory.sh") == {"caddy", "deployment"}
assert "deploy/test-caddy-route-inventory.sh" in json.dumps(
    load(workflow_dir / "ci-caddy.yml"), ensure_ascii=False
), "the Caddy owner must run its own public-site inventory and access-log fixtures"
assert not [
    step for job in load(workflow_dir / "ci-deployment.yml")["jobs"].values()
    for step in job.get("steps", [])
    if "bash deploy/test-caddy-route-inventory.sh" in step.get("run", "")
], "the gateway fixtures must run in exactly one owner"
# Owner-boundary guards for the Komodo control plane:
# - the Caddy gateway publishes Komodo but must never depend on Komodo-owned
#   inputs (a Core release bump may not re-run, or fail, the gateway on its own);
# - K2 documentation must live outside every production owner, so a docs-only
#   change cannot trigger a Komodo Core/Mongo/DNS reconciliation.
assert affected("deploy/komodo/verify.sh") == {"komodo_controller"}
assert affected("deploy/tx/Caddyfile") == {"caddy"}
assert affected("docs/operations/komodo-public-ingress.md") == set()
# K3.1 owner boundary: the Yecao Periphery agent has its own owner, so a Periphery
# change can neither trigger the Komodo Core/Mongo/DNS reconcile nor the Caddy
# gateway, and its documentation lives outside every production owner.
assert affected("deploy/periphery/install.sh") == {"komodo_periphery"}
assert affected("deploy/periphery/periphery.release") == {"komodo_periphery"}
assert affected(".github/workflows/komodo-periphery.yml") == {"komodo_periphery"}
assert not (affected("deploy/periphery/install.sh") & {"komodo_controller", "caddy"})
assert affected("docs/operations/komodo-periphery.md") == set()
# K4.1 owner boundary: the declarative Komodo resource root is reviewed data that CI
# only validates. Touching it must not reach the Komodo controller (whose production
# workflow reconciles Core/Mongo/DNS) nor any other production owner, and the
# controller's own production filter must not cover the new path.
assert affected("infra/komodo/resources/servers.toml") == {"deployment"}
assert affected("infra/komodo/resources/resource-sync.toml") == {"deployment"}
assert not (affected("infra/komodo/resources/servers.toml") & {"komodo_controller", "komodo_periphery", "caddy"})
komodo_controller_events = load(workflow_dir / "komodo-controller.yml")
for production_path in komodo_controller_events["on"]["push"]["paths"]:
    assert not fnmatch.fnmatchcase("infra/komodo/resources/servers.toml", production_path), production_path
# Frontend production builds now publish from TX through the Gitee exact-SHA builder.
# The GitHub-runner registry-list/retry helpers are no longer frontend-owned inputs;
# the Agent WASM pin/fetch contract and freshness gate remain production inputs.
assert affected("deploy/agent/source.json") == {"frontend"}
assert affected("scripts/fetch-agent-wasm.sh") == {"frontend"}
assert affected("scripts/ci/run-with-network-retry.sh") == {"deployment"}
assert affected("deploy/check-production-freshness.sh") == {
    "deployment", "frontend", "komodo_controller", "komodo_periphery", "production_worker",
}
for owner in jobs["changes"]["outputs"]:
    caller = jobs[owner]
    assert caller["if"] == f"needs.changes.outputs.{owner} == 'true'", owner
    assert caller["uses"] == f"./.github/workflows/ci-{owner.replace('_', '-')}.yml", owner
    workflow = load(workflow_dir / f"ci-{owner.replace('_', '-')}.yml")
    assert workflow["on"].keys() == {"workflow_call"}
    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            if step.get("uses") == "actions/checkout@v5":
                assert step.get("with", {}).get("ref") == "${{ inputs.head_sha }}", owner
ci_text = json.dumps(ci, ensure_ascii=False)
for forbidden in (
    "secrets.", "appleboy/ssh-action", "appleboy/scp-action",
    "docker/build-push-action", "docker/setup-buildx-action", "tofu apply",
):
    assert forbidden not in ci_text, f"PR CI must not access production credentials or mutate production: {forbidden}"
for workflow in [ci] + [load(path) for path in workflow_dir.glob("ci-*.yml")]:
  for job in workflow["jobs"].values():
    for step in job.get("steps", []):
        run = step.get("run", "")
        assert not any(line.lstrip().startswith(("ssh ", "scp ", "docker login", "docker push"))
                       for line in run.splitlines()), "PR CI must not run production mutation commands"

for owner in ("keycloak", "business-postgres", "keycloak-postgres", "observability", "komodo-controller"):
    tofu = load(workflow_dir / f"ci-{owner}.yml")["jobs"]["tofu_plans"]
    tofu_text = json.dumps(tofu, ensure_ascii=False)
    assert "tofu fmt -check -recursive" in tofu_text
    assert "tofu init -backend=false -input=false" in tofu_text
    assert "tofu validate" in tofu_text
    assert "tofu apply" not in tofu_text and "secrets." not in tofu_text

tx_runtime = load(workflow_dir / "tx-runtime-check.yml")
tx_runtime_events = tx_runtime.get("on", tx_runtime.get(True, {}))
assert set(tx_runtime_events) == {"workflow_dispatch"}
assert tx_runtime["permissions"] == {"contents": "read"}
assert tx_runtime["concurrency"] == {
    "group": "production-maintenance", "cancel-in-progress": "false", "queue": "max",
}
assert tx_runtime["env"]["PRODUCTION_INPUT_PATHS"].splitlines() == [
    ".github/workflows/tx-runtime-check.yml",
    "deploy/check-production-freshness.sh",
    "deploy/tx/runtime-check.sh",
    "deploy/tx/runtime-check-lib.sh",
    "deploy/tx/deploy.sh",
    "deploy/tx/with-deploy-lock.sh",
]
tx_runtime_job = tx_runtime["jobs"]["runtime_check"]
assert tx_runtime_job["name"] == "TX_RUNTIME_READY"
tx_runtime_steps = tx_runtime_job["steps"]
tx_runtime_checkout = next(step for step in tx_runtime_steps if step.get("uses") == "actions/checkout@v5")
assert tx_runtime_checkout["with"]["ref"] == "${{ github.sha }}"
assert tx_runtime_checkout["with"]["fetch-depth"] == "0"
tx_runtime_freshness = [
    step for step in tx_runtime_steps
    if "deploy/check-production-freshness.sh" in step.get("run", "")
]
assert len(tx_runtime_freshness) == 2
assert all(step.get("env", {}).get("EVENT_SHA") == "${{ github.sha }}" for step in tx_runtime_freshness)

tx_runtime_stage = next(step for step in tx_runtime_steps if step.get("name") == "Stage exact-SHA verifier bundle")
assert tx_runtime_stage["uses"] == "appleboy/scp-action@v1"
assert tx_runtime_stage["with"]["source"] == (
    "deploy/tx/runtime-check.sh,deploy/tx/runtime-check-lib.sh,"
    "deploy/tx/deploy.sh,deploy/tx/with-deploy-lock.sh"
)
assert tx_runtime_stage["with"]["target"] == "/tmp/wotb-tx-runtime-check-${{ github.run_id }}-${{ github.run_attempt }}"
assert tx_runtime_stage["with"]["strip_components"] == "2"

tx_runtime_run = next(step for step in tx_runtime_steps if step.get("name") == "Run exact-SHA read-only TX runtime gate")
tx_runtime_run_script = tx_runtime_run["with"]["script"]
for invariant in (
    'runtime="$VERIFIER_DIR/runtime-check.sh"',
    'lock_wrapper="$VERIFIER_DIR/with-deploy-lock.sh"',
    'deploy_helper="$VERIFIER_DIR/deploy.sh"',
    'runtime_lib="$VERIFIER_DIR/runtime-check-lib.sh"',
    "TX_FRONTEND_IMAGE_REF",
    "TX_BUSINESS_API_IMAGE_REF",
    "assert_digest_image",
    "grep -Fxq 'TX_RUNTIME_READY'",
):
    assert invariant in tx_runtime_run_script, invariant
assert tx_runtime_run["env"]["WOTB_TX_DIR"] == "/opt/wotb-tx"
assert tx_runtime_run["env"]["TX_RUNTIME_ROOT"] == "/opt/wotb-tx"
assert tx_runtime_run["env"]["VERIFIER_DIR"] == "/tmp/wotb-tx-runtime-check-${{ github.run_id }}-${{ github.run_attempt }}"

tx_runtime_cleanup = next(step for step in tx_runtime_steps if step.get("name") == "Clean up exact-SHA verifier bundle")
assert tx_runtime_cleanup["if"] == "always()"
assert tx_runtime_cleanup["uses"] == "appleboy/ssh-action@v1"
assert 'rmdir -- "$VERIFIER_DIR"' in tx_runtime_cleanup["with"]["script"]

tx_runtime_text = json.dumps(tx_runtime, ensure_ascii=False)
for required in (
    "TX_KC_POSTGRES_ADMIN_PASSWORD",
    "TX_KC_BOOTSTRAP_ADMIN_PASSWORD",
    "TX_KC_DB_PASSWORD",
    "WG_APPLICATION_ID",
    "TX_BUSINESS_POSTGRES_ADMIN_PASSWORD",
    "TX_BUSINESS_DB_PASSWORD",
    "KEYCLOAK_ADMIN_CLIENT_SECRET",
    "KEYCLOAK_E2E_CLIENT_SECRET",
):
    assert f"secrets.{required}" in tx_runtime_text, required
for forbidden in (
    "tofu apply",
    "docker push",
    "docker compose up",
    "deploy.incoming",
    "target: /opt/wotb-tx",
):
    assert forbidden not in tx_runtime_text, f"TX runtime check must not mutate production: {forbidden}"

backup = load(workflow_dir / "database-backup.yml")
assert backup["concurrency"] == {
    "group": "production-maintenance", "cancel-in-progress": "false", "queue": "max",
}
backup_text = json.dumps(backup, ensure_ascii=False)
for script in ("business-postgres-backup.sh", "keycloak-postgres-backup.sh", "tofu-local-state-backup.sh"):
    assert script in backup_text, f"scheduled production backup must retain {script}"

# PR #467 review: APK/bundle content assertions must never pipe into `grep -q`.
# Under `set -o pipefail` a hit makes grep exit early, the producer takes SIGPIPE (141), and the
# whole pipeline reports failure — i.e. a real file gets reported as missing.
# stage 里 setup-node 只能有一个：重复声明是 review 发现的真实冗余（PR #467 P2）。
_stage_sources = []
for _name in ("ci-android.yml", "android-release.yml"):
  _stage_sources.append((_name, (workflow_dir / _name).read_text(encoding="utf-8")))
_release_source = dict(_stage_sources)["android-release.yml"]
_stage_block = _release_source.split("\n  publish:", 1)[0]
assert _stage_block.count("actions/setup-node@v4") == 1, \
  f"android-release.yml stage must declare actions/setup-node@v4 exactly once, got {_stage_block.count('actions/setup-node@v4')}"

for android_workflow in ("ci-android.yml", "android-release.yml"):
  android_text = (workflow_dir / android_workflow).read_text(encoding="utf-8")
  # 注释里可以解释这个坑，真实命令里不允许再出现（YAML 注释以 # 开头）。
  offenders = [
    line.strip() for line in android_text.splitlines()
    if "| grep -q" in line and not line.lstrip().startswith("#")
  ]
  assert not offenders, \
    f"{android_workflow} must not pipe into grep -q (SIGPIPE false negative under pipefail): {offenders[:2]}"
  assert "listing_file" in android_text and "unzip -Z1" in android_text, \
    f"{android_workflow} must assert APK contents from a listing file"

_publish_block = _release_source.split("\n  publish:", 1)[1]
assert "https://wotbtools.com/version.json" not in _publish_block
assert "FE_COMMIT" not in _publish_block
assert "android_contract.py bundle" in _stage_block and "android_contract.py bundle" in _publish_block
assert "android_contract.py cors" in _publish_block

# PR #467 review P2: publish 的候选版本必须由 workflow_dispatch 的显式 version 输入决定，
# 不能从「当前 main 的 android/gradle.properties」推导。这两条断言的 owner 是 YAML wiring，
# 只测 shell helper 是锁不住的（helper 单测见 scripts/android-release/test-release.sh）。
_release_yaml = yaml.safe_load(_release_source)
_release_dispatch_inputs = _release_yaml.get(True, _release_yaml.get("on", {}))["workflow_dispatch"]["inputs"]
assert "version" in _release_dispatch_inputs, \
  "android-release.yml must expose an explicit workflow_dispatch version input for publish"
_version_input = _release_dispatch_inputs["version"]
assert _version_input.get("type") == "string" and _version_input.get("required") is False, _version_input
_publish_job = _release_yaml["jobs"]["publish"]
assert "inputs.version" in json.dumps(_publish_job, ensure_ascii=False), \
  "the publish job must consume the explicit version input"
_publish_run_text = "\n".join(step.get("run") or "" for step in _publish_job["steps"])
# 候选身份只能来自显式版本 + immutable tag target。
assert "steps.version.outputs" not in _publish_run_text, \
  "publish must not derive the candidate from the current main committed version"
assert "resolve-staged-version.sh" in _publish_run_text, \
  "publish must resolve the staged version from the tag target"
assert 'TAG="android-v$REQUESTED_VERSION"' in _publish_run_text and "git archive" in _publish_run_text
# staged versionCode：唯一来源是 stagedref 输出，且不得把 Python 局部变量当 shell 变量
# （`$expected` 在 set -euo pipefail 下会 unbound variable，直接炸掉整个 publish）。
_staged_step = next(step for step in _publish_job["steps"] if step.get("id") == "staged")
assert _staged_step.get("env", {}).get("STAGED_VERSION_CODE") == "${{ steps.stagedref.outputs.versionCode }}", \
  _staged_step.get("env", {})
_staged_shell_lines = [line for line in (_staged_step.get("run") or "").splitlines()
                       if not line.lstrip().startswith("#")]
assert any('echo "versionCode=$STAGED_VERSION_CODE" >> "$GITHUB_OUTPUT"' in line
           for line in _staged_shell_lines), \
  "publish must write the staged versionCode from STAGED_VERSION_CODE"
assert not any("$expected" in line or "${expected}" in line for line in _staged_shell_lines), \
  "publish shell must not read the Python-local `expected` variable"
# publish 绝不重建 / 重新签名。
for _forbidden in ("assembleRelease", "wotbKeystorePath", "keystore.jks", "ANDROID_KEYSTORE_BASE64"):
  assert _forbidden not in _publish_run_text, f"publish must not rebuild or re-sign ({_forbidden})"
# version.json 是最后一个 mutation，且只由 staged 身份写出。
_publish_step_names = [step.get("name", "") for step in _publish_job["steps"]]
_write_i = next(i for i, name in enumerate(_publish_step_names) if name.startswith("Write version.json"))
_upload_i = next(i for i, name in enumerate(_publish_step_names) if name.startswith("Upload version.json"))
_verify_i = next(i for i, name in enumerate(_publish_step_names) if name.startswith("Verify production version.json"))
assert _write_i < _upload_i < _verify_i, _publish_step_names
assert "steps.staged.outputs" in _publish_job["steps"][_write_i]["run"], \
  "version.json must be written from the staged identity"

# Production owner routing and freshness inputs are paired contracts. A workflow
# may only proceed when its triggering SHA is still current for every owned input.
owners = (
    "business-api", "frontend", "keycloak", "caddy",
    "business-postgres", "keycloak-postgres", "observability", "alloy-tx",
    "komodo-controller", "komodo-periphery", "production-worker",
)
pr_owner_for_production = {
    "business-api": "business_api",
    "frontend": "frontend",
    "keycloak": "keycloak",
    "caddy": "caddy",
    "business-postgres": "business_postgres",
    "keycloak-postgres": "keycloak_postgres",
    "observability": "observability",
    "alloy-tx": "alloy_tx",
    "komodo-controller": "komodo_controller",
    "komodo-periphery": "komodo_periphery",
    "production-worker": "production_worker",
}
assert set(pr_owner_for_production) == set(owners)
image_owners = {"business-api", "frontend", "keycloak"}
queue = {"group": "production-maintenance", "cancel-in-progress": "false", "queue": "max"}

# Business API and Frontend build on the same constrained TX host, so those shared
# mutation points stay serialized across the two otherwise-independent owner workflows.
# The Gitee mirror is NOT one of them: it is owned by `gitee-mirror.yml`, because a
# release run that also carries a mirror job (up to 180 minutes) finishes late — and
# `frontend-replica.yml` only rolls TX2 after the `Frontend` run completes successfully,
# so TX1 would serve the new bundle against a stale TX2 for hours (Caddy splits 2:8),
# and a run cancelled by the next push would never trigger the replica at all.
for owner in ("business-api", "frontend"):
    workflow = load(workflow_dir / f"{owner}.yml")
    assert "mirror_gitee" not in workflow["jobs"], owner
    assert workflow["jobs"]["build"]["concurrency"] == {
        "group": "tx-production-build", "cancel-in-progress": "false", "queue": "max",
    }, owner

mirror_workflow = load(workflow_dir / "gitee-mirror.yml")
mirror_job = mirror_workflow["jobs"]["mirror_gitee"]
assert mirror_job["concurrency"] == {
    "group": "production-gitee-main-sync", "cancel-in-progress": "false", "queue": "max",
}, "main sync must serialize only main writers, independently of asset-origin"
mirror_steps = mirror_job["steps"]
assert mirror_job["timeout-minutes"] == "10"
assert mirror_workflow["on"]["push"]["branches"] == ["main"]
checkout = next(step for step in mirror_steps if step.get("uses", "").startswith("actions/checkout@"))
assert checkout["with"] == {"ref": "${{ github.sha }}", "fetch-depth": "0"}
sync = next(step for step in mirror_steps if step.get("name") == "Sync and verify only Gitee main")
assert sync["env"]["SOURCE_SHA"] == "${{ github.sha }}"
sync_script = sync["run"]
assert '--force-with-lease="refs/heads/main:$observed"' in sync_script
assert '"$SOURCE_SHA:refs/heads/main"' in sync_script
assert '[ "$actual" = "$SOURCE_SHA"' in sync_script
for forbidden in ("hub-mirror-action", "force_update", "--mirror", "--all", "--tags", "--prune", "refs/tags/", "refs/heads/asset-origin"):
    assert forbidden not in json.dumps(mirror_workflow), forbidden

# Release identity must not cross the GitHub job-output boundary. GitHub may
# redact arbitrary SHA/digest values when they happen to match a configured secret,
# so deploy reconstructs the immutable tag from github.sha and resolves its digest
# on TX immediately before mutation.
for owner in ("business-api", "frontend"):
    workflow = load(workflow_dir / f"{owner}.yml")
    assert "outputs" not in workflow["jobs"]["build"], owner
    assert "needs.build.outputs" not in json.dumps(workflow, ensure_ascii=False), owner

# TX 生产 Git 来源只有 Gitee；必要的小型 staged inputs 不受影响。
for owner in ("business-api", "frontend"):
    workflow_text = (workflow_dir / f"{owner}.yml").read_text(encoding="utf-8")
    builder_text = (root / f"deploy/tx/build-{owner}-from-gitee.sh").read_text(encoding="utf-8")
    for forbidden in ("SOURCE_BUNDLE", "staged_bundle", "source_transport=staged-bundle",
                      "source_transport=github-exact-sha", "fetch_exact_sha_shallow",
                      "GITHUB_REPO_URL", "GITHUB_FETCH_", "SHALLOW_SOURCE_DIR", "STAGED_SOURCE_DIR",
                      "Package exact-commit source bundle", "steps.source.outputs"):
        assert forbidden not in workflow_text + builder_text, (owner, forbidden)
    assert 'source_transport=gitee-mirror' in builder_text
    assert 'merge-base --is-ancestor "$source_sha" refs/remotes/origin/main' in builder_text
    assert 'GITEE_WAIT_ATTEMPTS:-12' in builder_text
    assert 'GITEE_WAIT_INTERVAL_SECONDS:-15' in builder_text

frontend_workflow = load(workflow_dir / "frontend.yml")
assert frontend_workflow["env"]["ASSET_BASE_URL"] == "https://assets.wotbtools.com"
frontend_deploy = next(
    step for step in frontend_workflow["jobs"]["deploy"]["steps"]
    if step.get("name") == "Reconcile only Frontend under the TX host lock"
)
frontend_env = frontend_deploy["env"]
assert frontend_env["WOTB_DEPLOY_CONFIG_SHA"] == "${{ github.sha }}"
assert "ASSET_BASE_URL" not in frontend_env
assert "TX_FRONTEND_IMAGE_REF" not in frontend_env
frontend_events = frontend_workflow.get("on", frontend_workflow.get(True, {}))
assert "deploy/tx/with-deploy-lock.sh" in frontend_events["push"]["paths"]
assert "deploy/tx/with-deploy-lock.sh" in frontend_workflow["env"]["PRODUCTION_INPUT_PATHS"]
frontend_script = frontend_deploy["with"]["script"]
assert "with-deploy-lock.sh bash -s <<'LOCKED'" in frontend_script
assert "exec 9>/opt/wotb-tx/.deploy.lock" not in frontend_script
assert "flock -n 9" not in frontend_script
# Release identity = 与 TX1 构建脚本**同公式同输入**：
# sha256(source_sha + ASSET_BASE_URL + sponsor 内容指纹)[0:12]。
# 2026-10-10 事故：构建脚本纳入第三输入（sponsor 指纹）后，Frontend deploy 与 Frontend
# Replica 仍是两输入副本 ⇒ 每次 main 部署 `:sha-<另一枚> : not found`（CI 绿、部署红 ——
# 本契约当时抄的也是两输入，与实现一起漂移）。公式唯一定义见
# deploy/tx/build-frontend-from-gitee.sh；三处口径由 deploy/test_frontend_image_identity.py 看护。
for invariant in (
    "sponsor_fingerprint=\"$(bash /opt/wotb-tx/deploy.incoming/deploy/tx/sponsor-fingerprint.sh /opt/wotb-tx/deploy.incoming)\"",
    "identity=\"$(printf '%s\\n%s\\n%s' \"$source_sha\" \"$ASSET_BASE_URL\" \"$sponsor_fingerprint\" | sha256sum | cut -c1-12)\"",
    "wotbtools-frontend:sha-$identity",
    "docker buildx imagetools inspect --format '{{.Manifest.Digest}}'",
    'export TX_FRONTEND_IMAGE_REF="$TX_IMAGE_REGISTRY_PREFIX/wotbtools-frontend@$digest"',
):
    assert invariant in frontend_script, invariant

business_workflow = load(workflow_dir / "business-api.yml")
business_deploy = next(
    step for step in business_workflow["jobs"]["deploy"]["steps"]
    if step.get("name") == "Read dependencies and deploy Business API under one host lock"
)
business_env = business_deploy["env"]
assert business_env["WOTB_DEPLOY_CONFIG_SHA"] == "${{ github.sha }}"
assert "TX_BUSINESS_API_IMAGE_REF" not in business_env
business_script = business_deploy["with"]["script"]
for invariant in (
    'wotbtools-business-api:sha-${WOTB_DEPLOY_CONFIG_SHA:0:12}',
    "docker buildx imagetools inspect --format '{{.Manifest.Digest}}'",
    'export TX_BUSINESS_API_IMAGE_REF="$TX_IMAGE_REGISTRY_PREFIX/wotbtools-business-api@$digest"',
):
    assert invariant in business_script, invariant

# AI Service 的 CI 必须真正跑 wotb-ai 测试（不能退化成只 build image / -DskipTests）
ai_service_ci = load(workflow_dir / "ci-ai-service.yml")
ai_runs = [step.get("run", "") for job in ai_service_ci["jobs"].values() for step in job.get("steps", [])]
assert any("-pl wotb-ai -am verify" in run for run in ai_runs), "ci-ai-service.yml must run wotb-ai tests and verification"
assert not any("-pl wotb-ai" in run and ("skipTests" in run or "maven.test.skip" in run) for run in ai_runs), \
    "ci-ai-service.yml must not skip wotb-ai tests"

legacy_tcr_publisher = (root / "deploy/tx/publish-loaded-image-to-tcr.sh").read_text(encoding="utf-8")
assert "<backend|frontend|keycloak>" not in legacy_tcr_publisher
assert "backend|frontend|keycloak)" not in legacy_tcr_publisher

# Caddy owns public ingress. The Komodo route (K2) must be verified in two
# layers so a failure distinguishes a gateway problem from a Yecao/WireGuard one,
# and it must NOT depend on which Komodo release the Komodo owner has deployed:
# comparing the public answer with the private one keeps a Core upgrade from
# failing the gateway on its own.
caddy_workflow = load(workflow_dir / "caddy.yml")
caddy_events = caddy_workflow.get("on", caddy_workflow.get(True, {}))
caddy_paths = caddy_events["push"]["paths"]
caddy_freshness = caddy_workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
for owner_paths in (caddy_paths, caddy_freshness):
    assert not any(
        path.startswith("deploy/komodo/") or path.startswith("infra/tofu/komodo/")
        for path in owner_paths
    ), owner_paths
assert "komodo" not in " ".join(filters["caddy"]), filters["caddy"]
caddy_text = (workflow_dir / "caddy.yml").read_text(encoding="utf-8")
assert "pinned_core_version" not in caddy_text, "Caddy must not read the Komodo release pin"
assert not re.search(r"\bKOMODO_[A-Z0-9_]+", caddy_text), \
    "Caddy must not carry a Komodo runtime constant"
caddy_deploy = next(
    step for step in caddy_workflow["jobs"]["deploy"]["steps"]
    if step.get("name") == "Reconcile and verify Caddy under one TX host lock"
)
caddy_script = caddy_deploy["with"]["script"]
assert "http://10.20.0.2:9120/version" in caddy_script
assert "https://komodo.wotbtools.com/version" in caddy_script
assert "https://komodo.wotbtools.com/" in caddy_script
assert caddy_script.index("http://10.20.0.2:9120/version") \
    < caddy_script.index("https://komodo.wotbtools.com/version"), \
    "the private WireGuard upstream must be verified before the public route"
assert r"^[0-9]+\.[0-9]+\.[0-9]+$" in caddy_script, "the private answer must be a semantic version"
assert '[ "$komodo_public" = "$komodo_private" ]' in caddy_script, \
    "the public answer must be compared with the private one"
# TLS verification must never be weakened. Match whole tokens: `.well-known`
# contains "-k" but is not the curl insecure flag.
caddy_tokens = {token for line in caddy_script.splitlines() for token in line.split()}
assert "-k" not in caddy_tokens, "curl -k is forbidden in the Caddy gateway verification"
assert "--insecure" not in caddy_tokens, "--insecure is forbidden in the Caddy gateway verification"

# K6B logical endpoints: every owner that consumes a private placement dependency
# pins the *active* value in its own workflow, and the read-only runtime gate asserts
# exactly the same placement. That pairing is what keeps a merge from cutting
# production over through an existing repository variable, and it keeps
# `TX_RUNTIME_READY` from only proving that the gate agrees with itself. The Keycloak
# owner's equivalent pin lives in scripts/ci/test-keycloak-tofu-contract.sh with its
# own apply step.
#
# CURRENT_K6B_CUTOVERS is the reviewed production placement of every K6B-2 consumer, and
# since K6B-2 COMPLETE it is a frozen baseline rather than a migration in progress:
# K6B-2A moved Frontend -> Business API onto the TX1 WireGuard service endpoint,
# K6B-2B moved Business API -> Business PostgreSQL onto the TX1 WireGuard service
# endpoint at port 25432, K6B-2C moved Business API -> Keycloak Admin onto the TX1
# WireGuard endpoint at port 8080, K6B-2D moved Keycloak -> Keycloak PostgreSQL onto the
# TX1 WireGuard endpoint at port 15432, K6B-2E moved Caddy -> Frontend onto the TX1
# WireGuard endpoint at port 8081, and K6B-2F moved Caddy -> Keycloak onto the TX1
# WireGuard endpoint at port 8080. No private Docker-local TX placement remains, and the
# assertions below are the permanent guard that a later PR cannot drift the production
# baseline - by rolling a consumer back to its Docker-local rollback value, or by
# silently moving one to TX2 - without an explicit, reviewed edit of this file.
CURRENT_K6B_CUTOVERS = {
    "frontend": {"TX_BACKEND_UPSTREAM": "http://10.20.0.1:8087"},
    "business-api": {
        "TX_BUSINESS_DB_HOST": "10.20.0.1",
        "TX_BUSINESS_DB_PORT": "25432",
        "TX_KEYCLOAK_ADMIN_SERVER_URL": "http://10.20.0.1:8080",
    },
    "keycloak": {
        "TX_KEYCLOAK_DB_HOST": "10.20.0.1",
        "TX_KEYCLOAK_DB_PORT": "15432",
    },
    "caddy": {
        "CADDY_FRONTEND_UPSTREAM": "10.20.0.1:8081",
        "CADDY_KEYCLOAK_UPSTREAM": "10.20.0.1:8080",
    },
}
# K6B-2 is complete, so the only placement left outside CURRENT_K6B_CUTOVERS is the Yecao
# AI upstream: it is not a TX placement consumer and must never move with one. An empty
# dict for an owner means "this owner has no non-TX fixed dependency" rather than a
# missing assertion.
NON_TX_FIXED_DEPENDENCIES = {
    "frontend": (frontend_deploy, {
        "TX_AI_UPSTREAM": "http://10.20.0.2:8089",
    }),
    "business-api": (business_deploy, {}),
    "caddy": (caddy_deploy, {}),
}
# K6B-2 baseline invariant (frozen for K7): every TX consumer must sit on the reviewed TX1
# logical placement, asserted as an exact matrix instead of the weaker "no Docker-local
# value is left", so a future workload migration starts from an exact baseline.
K6B_FINAL_PLACEMENT_MATRIX = {
    "TX_BACKEND_UPSTREAM": "http://10.20.0.1:8087",
    "TX_BUSINESS_DB_HOST": "10.20.0.1",
    "TX_BUSINESS_DB_PORT": "25432",
    "TX_KEYCLOAK_ADMIN_SERVER_URL": "http://10.20.0.1:8080",
    "TX_KEYCLOAK_DB_HOST": "10.20.0.1",
    "TX_KEYCLOAK_DB_PORT": "15432",
    "CADDY_FRONTEND_UPSTREAM": "10.20.0.1:8081",
    "CADDY_KEYCLOAK_UPSTREAM": "10.20.0.1:8080",
}
assert {name: value for cut_over in CURRENT_K6B_CUTOVERS.values() for name, value in cut_over.items()} \
    == K6B_FINAL_PLACEMENT_MATRIX, "the K6B-2 cut-over matrix must match the reviewed final matrix"
# The Keycloak owner's own placement pin lives in scripts/ci/test-keycloak-tofu-contract.sh
# with its apply step, so it is deliberately not duplicated here; the gate expectation
# for the same consumer is asserted below.
for owner, (step, placements) in NON_TX_FIXED_DEPENDENCIES.items():
    exported = step["with"]["envs"].split(",")
    for name, value in {**placements, **CURRENT_K6B_CUTOVERS.get(owner, {})}.items():
        assert step["env"][name] == value, (owner, name, step["env"].get(name))
        assert name in exported, (owner, name)
# The Yecao AI upstream is the only non-TX placement left, and no consumer may be pinned
# by an owner workflow that does not own it.
for owner, (step, placements) in NON_TX_FIXED_DEPENDENCIES.items():
    for name, value in placements.items():
        assert not re.search(r"10\.20\.0\.[13]:", str(value)), (owner, name, value)
    for cut_over_name in CURRENT_K6B_CUTOVERS.get(owner, {}):
        assert cut_over_name in step["env"], (owner, cut_over_name)
        assert cut_over_name in step["with"]["envs"].split(","), (owner, cut_over_name)

# The secret-bearing readiness probe stays ahead of the deployment: it is the
# step that must reject an unreviewed endpoint before a credential is sent.
assert business_script.index("dependency-readiness.sh business-api") \
    < business_script.index("deploy/tx/deploy.sh"), \
    "dependency readiness must run before the Business API deployment"

runtime_gate_workflow = load(workflow_dir / "tx-runtime-check.yml")
runtime_gate_step = next(
    step for step in runtime_gate_workflow["jobs"]["runtime_check"]["steps"]
    if step.get("name") == "Run exact-SHA read-only TX runtime gate"
)
# The read-only gate must expect the same placement the owner workflows apply: the
# reviewed WireGuard values for every consumer in CURRENT_K6B_CUTOVERS, and only the Yecao
# AI upstream outside the TX service plane. A mismatch on either side fails the gate, so
# the two halves of a cutover cannot be merged separately, and a reverted cutover cannot
# be hidden behind a stale expectation.
gate_expectations = {
    "TX_AI_UPSTREAM": "http://10.20.0.2:8089",
}
for cut_over in CURRENT_K6B_CUTOVERS.values():
    gate_expectations.update(cut_over)
for name, value in gate_expectations.items():
    assert runtime_gate_step["env"][name] == value, (name, runtime_gate_step["env"].get(name))
    assert name in runtime_gate_step["with"]["envs"].split(","), name
assert {name: value for name, value in gate_expectations.items() if name != "TX_AI_UPSTREAM"} \
    == K6B_FINAL_PLACEMENT_MATRIX, "the runtime gate must expect the reviewed final matrix"
# Only the cut-over consumers may carry a WireGuard expectation in the gate, and the
# service-plane ports must never be swapped: 8081 is Frontend, 8080 is Keycloak,
# 8087 is Business API, 25432 is Business PostgreSQL, 15432 is Keycloak PostgreSQL. After
# K6B-2F the only non-cut-over expectation left is the Yecao AI upstream.
cut_over_names = {name for cut_over in CURRENT_K6B_CUTOVERS.values() for name in cut_over}
for name, value in gate_expectations.items():
    if name not in cut_over_names:
        assert name == "TX_AI_UPSTREAM", (name, value)
        assert not re.search(r"10\.20\.0\.[13]:", str(value)), (name, value)
assert gate_expectations["TX_KEYCLOAK_DB_PORT"] == "15432", gate_expectations["TX_KEYCLOAK_DB_PORT"]
assert gate_expectations["TX_BUSINESS_DB_PORT"] == "25432", gate_expectations["TX_BUSINESS_DB_PORT"]
assert gate_expectations["CADDY_FRONTEND_UPSTREAM"] == "10.20.0.1:8081", \
    gate_expectations["CADDY_FRONTEND_UPSTREAM"]
# Caddy -> Keycloak is part of the frozen baseline too, so its Docker-local rollback value
# must not appear as the reviewed placement.
assert gate_expectations["CADDY_KEYCLOAK_UPSTREAM"] == "10.20.0.1:8080", \
    gate_expectations["CADDY_KEYCLOAK_UPSTREAM"]
assert runtime_gate_step["env"]["TX_AI_UPSTREAM"] == "http://10.20.0.2:8089", \
    "the Yecao AI upstream must never move with a TX placement cutover"

# K3.2: one Komodo Periphery owner serves every reviewed target host. GitHub
# Actions owns each agent's systemd lifecycle, the hosts never download an
# artifact, the bootstrap credential only ever lives in a transient /run file, and
# every agent connects to Core's private WireGuard address rather than a public
# name. One lifecycle implementation, per-host reviewed profiles.
periphery_workflow = load(workflow_dir / "komodo-periphery.yml")
periphery_events = periphery_workflow.get("on", periphery_workflow.get(True, {}))
assert periphery_events["push"]["paths"] == periphery_workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
periphery_jobs = periphery_workflow["jobs"]
assert set(periphery_jobs) == {"reconcile_yecao", "reconcile_tx1", "reconcile_tx2"}, sorted(periphery_jobs)
assert periphery_jobs["reconcile_yecao"]["name"] == "Reconcile Komodo Periphery on Yecao"
assert periphery_jobs["reconcile_tx1"]["name"] == "Reconcile Komodo Periphery on TX1"
assert periphery_jobs["reconcile_tx2"]["name"] == "Reconcile Komodo Periphery on TX2"
# Each established host must be proven compatible before the next new host is
# mutated for the first time, so the chain is strictly ordered.
assert "needs" not in periphery_jobs["reconcile_yecao"], periphery_jobs["reconcile_yecao"]
assert periphery_jobs["reconcile_tx1"]["needs"] == ["reconcile_yecao"], periphery_jobs["reconcile_tx1"]["needs"]
assert periphery_jobs["reconcile_tx2"]["needs"] == ["reconcile_tx1"], periphery_jobs["reconcile_tx2"]["needs"]
periphery_hosts = {
    "yecao": {"job": "reconcile_yecao", "profile": "yecao", "label": "Yecao",
              "secrets": ("VPS_HOST", "VPS_USER", "VPS_PORT", "VPS_SSH_KEY")},
    "tx1": {"job": "reconcile_tx1", "profile": "tx1", "label": "TX1",
            "secrets": ("TX_VPS_HOST", "TX_VPS_USER", "TX_VPS_PORT", "TX_VPS_SSH_KEY")},
    "tx2": {"job": "reconcile_tx2", "profile": "tx2", "label": "TX2",
            "secrets": ("TX2_VPS_HOST", "TX2_VPS_USER", "TX2_VPS_PORT", "TX2_VPS_SSH_KEY")},
}
for host, spec in periphery_hosts.items():
    job = periphery_jobs[spec["job"]]
    label = spec["label"]
    assert "environment" not in job, f"K3.2 uses repository-level secrets, never a GitHub Environment: {host}"
    steps = {step.get("name"): step for step in job["steps"]}
    # The pinned release manifest and the same SHA-verified artifact, per job.
    release_step = steps["Read the pinned Periphery release"]["run"]
    assert "deploy/periphery/periphery.release" in release_step, release_step
    assert "PERIPHERY_SHA256" in release_step and "PERIPHERY_URL" in release_step
    artifact_step = steps["Download and verify the pinned Periphery artifact"]["run"]
    assert "sha256sum --check --strict" in artifact_step, artifact_step
    assert "--retry 3" in artifact_step, artifact_step
    # Host parameters come from the reviewed profile, never from inline YAML.
    profile_step = steps[f"Read the {label} target profile"]
    assert profile_step["env"]["TARGET"] == spec["profile"], profile_step["env"]
    assert "read-target-profile.sh" in profile_step["run"], profile_step["run"]
    # Host credentials.
    for secret in spec["secrets"]:
        assert secret in json.dumps(job), (host, secret)
    # Every SSH/SCP step targets this host's own secrets.
    ssh_steps = [step for step in job["steps"] if step.get("uses", "").startswith(("appleboy/ssh-action", "appleboy/scp-action"))]
    assert ssh_steps, host
    for step in ssh_steps:
        assert step["with"]["host"] == f"${{{{ secrets.{spec['secrets'][0]} }}}}", (host, step["with"]["host"])
    # Staging root handed to the pre-SCP helper and the cleanup step.
    for staging_name in (f"Prepare safe {label} staging root", f"Cleanup staged {label} inputs"):
        staging_step = steps[staging_name]
        assert staging_step["with"]["script_path"] == "deploy/periphery/staging-root.sh", staging_name
        assert staging_step["env"]["PERIPHERY_STAGING_ROOT"] == "${{ steps.target.outputs.staging_root }}", staging_name
    assert steps[f"Cleanup staged {label} inputs"]["if"] == "always()"
    # Exactly the production inputs plus this target's own profile and the verified
    # artifact are staged: fixtures and other hosts' profiles stay in CI.
    staged = " ".join(steps[f"Stage exact Periphery inputs on {label}"]["with"]["source"].split())
    staged_files = {part for part in staged.replace(" ", "").split(",") if part}
    assert staged_files == {
        "deploy/periphery/lib.sh",
        "deploy/periphery/staging-root.sh",
        "deploy/periphery/install.sh",
        "deploy/periphery/verify.sh",
        "deploy/periphery/reconcile.sh",
        "deploy/periphery/periphery.release",
        "deploy/periphery/periphery.service",
        f"deploy/periphery/targets/{spec['profile']}/target.env",
        f"deploy/periphery/targets/{spec['profile']}/periphery.config.toml",
        "periphery-x86_64",
    }, (host, sorted(staged_files))
    # The reconcile step runs the shared lifecycle with the target as data, and
    # never fetches or executes an unverified artifact.
    reconcile = steps[f"Reconcile {label} Periphery under the {label} host lock"]
    assert 'bash "$stage/deploy/periphery/reconcile.sh" "$PERIPHERY_TARGET" "$SOURCE_SHA" "$stage"' in reconcile["with"]["script"], host
    assert reconcile["env"]["PERIPHERY_TARGET"] == spec["profile"], host
    for token in ("curl", "wget"):
        assert token not in reconcile["with"]["script"], (host, token)
# Yecao's onboarding credential has been deleted: its job must not reference any
# onboarding secret at all, because it must reconcile from the committed marker.
yecao_json = json.dumps(periphery_jobs["reconcile_yecao"], ensure_ascii=False)
assert "ONBOARDING_KEY" not in yecao_json, "the Yecao job must not reference an onboarding secret"
assert "KOMODO_YECAO_ONBOARDING_KEY" not in json.dumps(periphery_workflow, ensure_ascii=False)

# K7A: the TX2 production-worker owner is a separate lifecycle from the Periphery
# agent lifecycle and from every workload owner. It owns host Docker prerequisites
# only (Compose, the reviewed daemon mirror, the root registry credential), so its
# inputs must not reach - and must not be reachable from - any workload owner.
worker_workflow = load(workflow_dir / "production-worker.yml")
worker_events = worker_workflow.get("on", worker_workflow.get(True, {}))
assert worker_events["push"]["branches"] == ["main"]
assert worker_events["push"]["paths"] == worker_workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
assert set(worker_events["push"]["paths"]) == {
    ".github/workflows/production-worker.yml",
    "deploy/check-production-freshness.sh",
    "deploy/production-worker/**",
}, worker_events["push"]["paths"]
worker_jobs = worker_workflow["jobs"]
assert set(worker_jobs) == {"reconcile_tx2"}, sorted(worker_jobs)
worker_job = worker_jobs["reconcile_tx2"]
# A host mutating workflow serializes with every other TX mutation through the shared maintenance queue.
assert worker_workflow["concurrency"]["group"] == "production-maintenance"
assert worker_workflow["concurrency"]["cancel-in-progress"] == "false"
# One owner, one host: the worker owns no other domain, and no workload owner's
# artifact may appear inside it.
worker_text = json.dumps(worker_workflow, ensure_ascii=False)
for forbidden in (
    "infra/komodo", "resource-sync", "komodo-", "CADDY_", "TX_BACKEND_UPSTREAM",
    "TX_KEYCLOAK_", "TX_BUSINESS_DB_", "TX_AI_UPSTREAM", "caddy.yml", "frontend.yml",
    "business-api.yml", "keycloak.yml", "keycloak-postgres.yml", "business-postgres.yml",
    "alloy-tx.yml", "docker compose up", "docker run",
):
    assert forbidden not in worker_text, f"the production-worker owner must not own {forbidden}"
worker_steps = {step.get("name"): step for step in worker_job["steps"]}
# Host parameters come from the reviewed profile, exactly like the Periphery owner.
assert worker_steps["Read the TX2 worker profile"]["env"]["TARGET"] == "tx2"
assert "read-target-profile.sh" in worker_steps["Read the TX2 worker profile"]["run"]
# TX2's own SSH boundary, and only that host's.
for secret in ("TX2_VPS_HOST", "TX2_VPS_USER", "TX2_VPS_PORT", "TX2_VPS_SSH_KEY"):
    assert secret in json.dumps(worker_job, ensure_ascii=False), secret
worker_ssh_steps = [step for step in worker_job["steps"]
                    if step.get("uses", "").startswith(("appleboy/ssh-action", "appleboy/scp-action"))]
assert worker_ssh_steps, "the worker must reach TX2 over the reviewed SSH boundary"
for step in worker_ssh_steps:
    assert step["with"]["host"] == "${{ secrets.TX2_VPS_HOST }}", step["with"]["host"]
for staging_name in ("Prepare safe TX2 worker staging root", "Cleanup staged TX2 worker inputs"):
    staging_step = worker_steps[staging_name]
    assert staging_step["with"]["script_path"] == "deploy/production-worker/staging-root.sh", staging_name
    assert staging_step["env"]["WORKER_STAGING_ROOT"] == "${{ steps.target.outputs.staging_root }}", staging_name
assert worker_steps["Cleanup staged TX2 worker inputs"]["if"] == "always()"
# Only this owner's reviewed inputs are staged: fixtures and every other owner stay in CI.
staged = " ".join(worker_steps["Stage exact worker inputs on TX2"]["with"]["source"].split())
staged_files = {part for part in staged.replace(" ", "").split(",") if part}
assert staged_files == {
    "deploy/production-worker/lib.sh",
    "deploy/production-worker/staging-root.sh",
    "deploy/production-worker/install.sh",
    "deploy/production-worker/verify.sh",
    "deploy/production-worker/reconcile.sh",
    "deploy/production-worker/read-target-profile.sh",
    "deploy/production-worker/targets/tx2/target.env",
}, sorted(staged_files)
# The reconcile runs the staged lifecycle under the host lock and asserts the
# host-scoped readiness token instead of trusting the exit status alone.
worker_reconcile = worker_steps["Reconcile the TX2 production worker under the TX2 host lock"]
assert 'bash "$stage/deploy/production-worker/reconcile.sh"' in worker_reconcile["with"]["script"]
assert 'grep -qx "$WORKER_READY_TOKEN" "$log"' in worker_reconcile["with"]["script"]
assert "TX2_PRODUCTION_WORKER_READY" not in json.dumps(worker_workflow, ensure_ascii=False), \
    "the readiness token must come from the reviewed host profile, never inlined"
# The registry credential is read from repository-level Actions secrets and handed over
# through the SSH action's environment: never inline, never an argument, never a file.
worker_envs = worker_reconcile["with"]["envs"].split(",")
for name in ("TCR_REGISTRY", "TCR_NAMESPACE", "TCR_CREDENTIAL_VERSION", "TCR_USERNAME", "TCR_PASSWORD"):
    assert name in worker_envs, name
assert worker_reconcile["env"]["TCR_USERNAME"] == "${{ secrets.TCR_USERNAME }}"
assert worker_reconcile["env"]["TCR_PASSWORD"] == "${{ secrets.TCR_PASSWORD }}"
assert worker_reconcile["env"]["TCR_REGISTRY"] == "${{ vars.TCR_REGISTRY }}"
assert worker_reconcile["env"]["TCR_NAMESPACE"] == "${{ vars.TCR_NAMESPACE }}"
# The credential generation is the authoritative, non-secret convergence input: it must
# come from a reviewed repository variable, so a rotation can never be ignored just
# because the previous credential still authenticates.
assert worker_reconcile["env"]["TCR_CREDENTIAL_VERSION"] == "${{ vars.TCR_CREDENTIAL_VERSION }}"
assert "secrets.TCR_CREDENTIAL_VERSION" not in json.dumps(worker_workflow, ensure_ascii=False)
assert "--password" not in json.dumps(worker_workflow, ensure_ascii=False)
# Ownership is mutual: worker inputs trigger only the worker owner, and no workload
# owner's inputs can reach the worker lifecycle.
assert affected("deploy/production-worker/install.sh") == {"production_worker"}
assert affected(".github/workflows/production-worker.yml") == {"production_worker"}
assert affected("deploy/production-worker/targets/tx2/target.env") == {"production_worker"}
assert not (affected("deploy/production-worker/install.sh")
            & {"komodo_controller", "komodo_periphery", "caddy", "frontend",
               "business_api", "keycloak", "business_postgres", "keycloak_postgres", "ai_service"})
for workload_input in (".github/workflows/frontend.yml", "deploy/tx/Caddyfile",
                       "deploy/tx/business-api.compose.yml", "infra/komodo/resources/servers.toml"):
    assert "production_worker" not in affected(workload_input), workload_input
# The worker never predicts or reads workload placement, and never expands the K4.1
# declarative Komodo scope (Servers + ResourceSync only; Stacks arrive in K7B).
for owner_path in ("deploy/production-worker/install.sh", "deploy/production-worker/verify.sh",
                   "deploy/production-worker/reconcile.sh", "deploy/production-worker/lib.sh"):
    worker_script = (root / owner_path).read_text(encoding="utf-8")
    for forbidden in ("infra/komodo", "resource-sync", "CADDY_", "TX_BACKEND_UPSTREAM",
                      "periphery.service", "wg set", "docker compose up"):
        assert forbidden not in worker_script, (owner_path, forbidden)
# The worker serializes through the host's existing mutation lock. A second, worker-only
# lock would let it race Periphery and any future workload, so the lifecycle must take
# the deploy-owned lock and must not name or create another one.
for lock_path in ("deploy/production-worker/install.sh", "deploy/production-worker/reconcile.sh"):
    lock_script = (root / lock_path).read_text(encoding="utf-8")
    assert "require_host_lock" in lock_script, lock_path
    assert 'exec 9>"$WORKER_LOCK_ROOT/.deploy.lock"' in lock_script, lock_path
    assert "flock -n 9" in lock_script, lock_path
    for forbidden in ('mkdir -p "$WORKER_LOCK_ROOT', 'touch "$WORKER_LOCK_ROOT',
                      'install -d "$WORKER_LOCK_ROOT', ' > "$WORKER_LOCK_ROOT/.deploy.lock'):
        assert forbidden not in lock_script, (lock_path, forbidden)
    assert lock_script.count(".deploy.lock") <= 2, lock_path
# No tracked file may carry a Docker registry credential. The worker materialises it on
# the host from repository-level Actions secrets, so the repository stays credential-free; only
# the owner's own fixture may contain a deliberately fake credential document.
for tracked in sorted(root.rglob("*")):
    if not tracked.is_file() or ".git" in tracked.parts:
        continue
    if tracked.suffix in {".png", ".jpg", ".webp", ".gz", ".lock", ".jar", ".woff", ".woff2", ".ico"}:
        continue
    text = tracked.read_text(encoding="utf-8", errors="ignore")
    if '"auths"' in text and '"auth":' in text:
        relative = tracked.relative_to(root).as_posix()
        # The owner's fixture carries a deliberately fake credential document, and this
        # scanner necessarily contains the markers it looks for.
        assert relative in {
            "deploy/production-worker/test-production-worker.sh",
            "scripts/ci/test-workflow-contract.sh",
        }, f"a Docker credential must never be committed: {relative}"
    # A registry credential assigned in a tracked file (a Compose file, a Komodo
    # resource, the Periphery config, a tracked env file) is the same violation as a
    # committed credential document: the worker reads it from the protected environment.
    for assignment in re.finditer(
        r"^\s*(?:export\s+)?(TCR_PASSWORD|TCR_USERNAME|DOCKER_PASSWORD)\s*[=:]\s*[\"']?([^\s\"']+)",
        text, re.MULTILINE,
    ):
        relative = tracked.relative_to(root).as_posix()
        value = assignment.group(2)
        assert relative.startswith("deploy/production-worker/test-") or value.startswith("$"), \
            f"a registry credential must never be assigned in the repository: {relative}"
# Every sudo host maps only its own onboarding secret into the generic runtime
# variable, and never echoes it.
for host, spec in periphery_hosts.items():
    if host == "yecao":
        continue
    label = spec["label"]
    reconcile = next(step for step in periphery_jobs[spec["job"]]["steps"]
                     if step.get("name") == f"Reconcile {label} Periphery under the {label} host lock")
    assert reconcile["with"]["envs"].split(",") == [
        "SOURCE_SHA", "PERIPHERY_TARGET", "KOMODO_PERIPHERY_ONBOARDING_KEY",
    ], host
    secret_name = f"KOMODO_{host.upper()}_ONBOARDING_KEY"
    assert reconcile["env"]["KOMODO_PERIPHERY_ONBOARDING_KEY"] == f"${{{{ secrets.{secret_name} }}}}", host
    script = reconcile["with"]["script"]
    assert "KOMODO_PERIPHERY_ONBOARDING_KEY" not in script.replace("$KOMODO_PERIPHERY_ONBOARDING_KEY", ""), host
# The per-host parameters are reviewed data, not workflow text.
for profile, expected in {
    "yecao": {"connect_as": "yecao", "lock_root": "/opt/wotb", "staging_root": "/opt/periphery", "privilege": "root"},
    "tx1": {"connect_as": "tx1", "lock_root": "/opt/wotb-tx", "staging_root": "/opt/wotb-tx/periphery", "privilege": "sudo"},
    "tx2": {"connect_as": "tx2", "lock_root": "/opt/wotb-tx2", "staging_root": "/opt/wotb-tx2/periphery", "privilege": "sudo"},
}.items():
    text = (root / f"deploy/periphery/targets/{profile}/target.env").read_text(encoding="utf-8")
    assert f"PERIPHERY_TARGET={profile}" in text, profile
    assert f"PERIPHERY_CONNECT_AS={expected['connect_as']}" in text, profile
    assert f"PERIPHERY_LOCK_ROOT:={expected['lock_root']}" in text, profile
    assert f"PERIPHERY_STAGING_ROOT:={expected['staging_root']}" in text, profile
    assert f"PERIPHERY_PRIVILEGE={expected['privilege']}" in text, profile
    # A profile is data: it may never assign a credential (comments excluded, and
    # `load_target_profile` enforces the same rule at runtime).
    effective_profile = "\n".join(line for line in text.splitlines() if not line.strip().startswith("#"))
    assert not re.search(r"(?i)(secret|password|passwd|token|private_key|onboarding_key)\s*=", effective_profile), profile
# Each target's config is outbound only, with its own Server identity, and the
# effective bodies are otherwise identical.
normalized_configs = {}
for profile, connect_as in (("yecao", "yecao"), ("tx1", "tx1"), ("tx2", "tx2")):
    config_text = (root / f"deploy/periphery/targets/{profile}/periphery.config.toml").read_text(encoding="utf-8")
    for invariant in (
        'root_directory = "/etc/komodo"',
        'core_addresses = ["http://10.20.0.2:9120"]',
        f'connect_as = "{connect_as}"',
        "server_enabled = false",
        'private_key = "file:/etc/komodo/keys/periphery.key"',
        'core_public_keys = ["file:/etc/komodo/keys/core.pub"]',
    ):
        assert invariant in config_text, (profile, invariant)
    for forbidden in ("45.136.14.101", "118.89.176.91", "10.20.0.3", "0.0.0.0",
                      "onboarding_key", "image_registry", "git_provider"):
        assert forbidden not in config_text, (profile, forbidden)
    effective_config = "\n".join(line for line in config_text.splitlines()
                                 if line.strip() and not line.strip().startswith("#"))
    normalized_configs[profile] = effective_config.replace(f'connect_as = "{connect_as}"', 'connect_as = "X"')
assert len(set(normalized_configs.values())) == 1, sorted(normalized_configs)
# No per-host lifecycle script may exist: only reviewed profiles differ.
for path in sorted((root / "deploy/periphery").glob("*.sh")):
    assert not any(host in path.name for host in periphery_hosts), path.name
periphery_unit_text = (root / "deploy/periphery/periphery.service").read_text(encoding="utf-8")
for invariant in (
    "EnvironmentFile=-/run/komodo/periphery-bootstrap.env",
    "ExecStart=/usr/local/bin/periphery --config-path /etc/komodo/periphery.config.toml",
    "Requires=docker.service",
    "WantedBy=multi-user.target",
):
    assert invariant in periphery_unit_text, invariant
assert "PERIPHERY_ONBOARDING_KEY" not in periphery_unit_text, \
    "the bootstrap credential must only reach Periphery through the transient /run file"
# The pinned release is a sha256 manifest, never a floating tag or image.
periphery_release_text = (root / "deploy/periphery/periphery.release").read_text(encoding="utf-8")
assert "latest" not in periphery_release_text.lower()
assert "40b78f377626799afad8331246a501f077d4ebcfb6d9096894cf55b64f6dcf13" in periphery_release_text
for owner in owners:
    workflow = load(workflow_dir / f"{owner}.yml")
    events = workflow.get("on", workflow.get(True, {}))
    assert events["push"]["branches"] == ["main"], owner
    trigger_paths = events["push"].get("paths", [])
    freshness_paths = workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
    assert trigger_paths == freshness_paths, owner
    pr_owner = pr_owner_for_production[owner]
    for production_path in freshness_paths:
        assert any(covers_production_path(production_path, pattern)
                   for pattern in filters[pr_owner]), (owner, production_path)
    checks = [
        step for job in workflow["jobs"].values() for step in job.get("steps", [])
        if "deploy/check-production-freshness.sh" in step.get("run", "")
    ]
    assert len(checks) >= 2, owner
    assert all(step.get("env", {}).get("EVENT_SHA") == "${{ github.sha }}" for step in checks), owner
    if owner in image_owners:
        assert workflow["concurrency"] == {
            "group": f"deploy-{owner}", "cancel-in-progress": "true"
        }, owner
        assert workflow["jobs"]["deploy"]["concurrency"] == queue, owner
    else:
        assert workflow["concurrency"] == queue, owner

# Replay parsing runs in the browser: the server-side parser plane, broker, and object store
# (and their CI/production owners) are retired and must not come back.
for retired in (
    "parser-worker.yml", "ci-parser-worker.yml", "rabbitmq.yml", "ci-rabbitmq.yml",
    "minio.yml", "ci-minio.yml",
):
    assert not (workflow_dir / retired).exists(), retired
for retired_owner in ("parser_worker", "rabbitmq", "minio"):
    assert retired_owner not in filters, retired_owner
    assert retired_owner not in jobs, retired_owner

freshness = (root / "deploy/check-production-freshness.sh").read_text(encoding="utf-8")
for invariant in (
    "Source SHA differs from the triggering event SHA.",
    "Production workflows require the main ref.",
    "Checkout SHA differs from the event SHA.",
    "workflow_dispatch",
    "git merge-base --is-ancestor",
    "git diff --quiet",
    "Production-owned inputs changed after the workflow source SHA.",
):
    assert invariant in freshness, invariant

# 诊断通道的 cookie 脱敏契约（review blocker 3）：prod-diagnostics 会把线上 Set-Cookie
# 打进 Actions 日志，而 AUTH_SESSION_ID / KC_RESTART 的值是动态 secret——GitHub 的
# secret masking 不认它们。这里锁两件事：
#   1) 任何读取 set-cookie 的管道之后必须紧跟脱敏（`=<redacted>`），且
#   2) 出现裸打印的形态（grep set-cookie 但没有脱敏）即失败。
diagnostics = (workflow_dir / "prod-diagnostics.yml").read_text(encoding="utf-8")
assert "set-cookie" in diagnostics, "prod-diagnostics must still probe live cookie attributes"
all_lines = diagnostics.splitlines()
read_pipelines = [
    index for index, line in enumerate(all_lines)
    if "set-cookie" in line.lower() and "grep" in line
]
assert read_pipelines, "cookie probe step disappeared"
assert "<redacted>" in diagnostics, "cookie values must be redacted before stdout"
for index in read_pipelines:
    # 脱敏必须出现在**读取 cookie 的管道本身**（同一段窗口内、到达 stdout 之前）
    window = "\n".join(all_lines[index:index + 3])
    assert "<redacted>" in window, (
        "a set-cookie pipeline without redaction can leak live session identifiers: "
        + all_lines[index].strip()
    )

# The exporter package may be private on first publication. Its pull credentials
# belong only to the exporter mutation and must never become host Docker state.
observability = load(workflow_dir / "observability.yml")
obs_steps = observability["jobs"]["observability"]["steps"]
obs_reconcile = next(step for step in obs_steps if step.get("name") == "Reconcile selected runtime, apply Grafana plan, and verify")
obs_script = obs_reconcile["with"]["script"]
assert "mktemp -d /run/wotb-dev-metrics-pull.XXXXXX" in obs_script
assert "trap 'rm -rf -- \"$DOCKER_CONFIG\"' EXIT" in obs_script
assert 'docker login ghcr.io --username "$DEV_METRICS_REGISTRY_USER" --password-stdin' in obs_script
assert 'printf \'%s\' "$DEV_METRICS_REGISTRY_TOKEN"' in obs_script
assert "unset DEV_METRICS_REGISTRY_TOKEN" in obs_script
assert obs_reconcile["env"]["DEV_METRICS_REGISTRY_TOKEN"] == "${{ contains(steps.source.outputs.runtime_services, 'dev-metrics-exporter') && secrets.GITHUB_TOKEN || '' }}"
assert "DEV_METRICS_REGISTRY_TOKEN" not in (root / "deploy/docker-compose.prod.yml").read_text(encoding="utf-8")

# --- asset origin source transport (Komodo Stack `wotbtools-asset-origin`) -----
# This owner may mutate ONLY the asset-owned Gitee transport branch. It is also the
# single, narrowly scoped exception to "infra/komodo/resources/** is owned by no
# production workflow": only asset-origin.toml is an input, and only for the
# source-transport gate. It never applies ResourceSync, mutates Komodo resources,
# or deploys the Stack.
asset_workflow = load(workflow_dir / "asset-origin.yml")
asset_events = asset_workflow.get("on", asset_workflow.get(True, {}))
asset_inputs = [
    ".github/workflows/asset-origin.yml",
    "deploy/assets/**",
    "deploy/check-production-freshness.sh",
    "infra/komodo/resources/asset-origin.toml",
]
assert set(asset_events) == {"push", "workflow_dispatch"}, sorted(asset_events)
assert asset_events["push"]["branches"] == ["main"]
assert asset_events["push"]["paths"] == asset_inputs, asset_events["push"]["paths"]
assert asset_workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines() == asset_inputs
assert not asset_events["workflow_dispatch"], "manual mirror dispatch takes no ref input"
assert affected("infra/komodo/resources/asset-origin.toml") == {"deployment"}
assert affected("deploy/assets/Caddyfile") == {"deployment"}
assert "scripts/ci/test-komodo-resources.py" in (
    workflow_dir / "ci-deployment.yml"
).read_text(encoding="utf-8")
# The resource tree stays non-production except this one source-transport input.
resource_production_inputs = {}
for candidate in sorted(workflow_dir.glob("*.yml")):
    document = load(candidate)
    for production_path in (
        (document.get("env") or {}).get("PRODUCTION_INPUT_PATHS") or ""
    ).splitlines():
        if production_path.startswith("infra/komodo/resources"):
            resource_production_inputs.setdefault(candidate.name, []).append(production_path)
assert resource_production_inputs == {
    "asset-origin.yml": ["infra/komodo/resources/asset-origin.toml"],
}, resource_production_inputs
resource_push_paths = []
for candidate in sorted(workflow_dir.glob("*.yml")):
    document = load(candidate)
    events = document.get("on", document.get(True, {}))
    push = events.get("push") if isinstance(events, dict) else None
    if not isinstance(push, dict):
        continue
    for trigger_path in push.get("paths", []):
        if trigger_path.startswith("infra/komodo/resources"):
            resource_push_paths.append((candidate.name, trigger_path))
assert resource_push_paths == [
    ("asset-origin.yml", "infra/komodo/resources/asset-origin.toml")
], resource_push_paths
# A resource change must never reconcile Komodo Core/Mongo/DNS via the controller.
controller = load(workflow_dir / "komodo-controller.yml")
controller_paths = controller["on"]["push"]["paths"]
assert controller_paths == controller["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
for controller_path in controller_paths:
    assert not fnmatch.fnmatchcase("infra/komodo/resources/asset-origin.toml", controller_path), \
        controller_path
assert "infra/komodo/resources" not in (workflow_dir / "komodo-controller.yml").read_text(encoding="utf-8")
# The source transport itself stays Gitee-only: no ResourceSync apply, no Stack
# deploy, no controller coupling, and only the existing Gitee credential.
asset_text = (workflow_dir / "asset-origin.yml").read_text(encoding="utf-8")
for forbidden in ("docker compose up", "docker run", "komodo-controller", "tofu apply",
                  "resource_sync", "infra/komodo/resources/**"):
    assert forbidden not in asset_text, f"the asset source transport must not own {forbidden}"
assert set(re.findall(r"secrets\.([A-Za-z0-9_]+)", asset_text)) == {"GITEE_TOKEN"}
asset_concurrency = asset_workflow["jobs"]["mirror_gitee"]["concurrency"]
assert asset_concurrency == {
    "group": "production-gitee-mirror", "cancel-in-progress": "false", "queue": "max",
}, "asset-origin keeps its existing owner queue"
assert mirror_job["concurrency"]["group"] != asset_concurrency["group"], \
    "asset-origin must not delay the release-critical Gitee main sync"
asset_steps = asset_workflow["jobs"]["mirror_gitee"]["steps"]
asset_step_names = [step.get("name") for step in asset_steps]
freeze_index = asset_step_names.index("Freeze reviewed main source")
push_index = asset_step_names.index("Push frozen event SHA to the Gitee asset-origin ref")
verify_index = asset_step_names.index("Require Gitee asset-origin ref at the reviewed GitHub SHA")
assert freeze_index < push_index < verify_index, asset_step_names
assert asset_steps[freeze_index]["env"]["EVENT_SHA"] == "${{ github.sha }}"
assert asset_steps[push_index]["env"]["EVENT_SHA"] == "${{ github.sha }}"
assert asset_steps[push_index]["env"]["PRODUCTION_REQUIRE_EXACT_MAIN"] == "1"
# The job may only publish the derived GitHub pointer branch; nothing else.
assert asset_workflow["jobs"]["mirror_gitee"]["permissions"] == {"contents": "write"}, \
    asset_workflow["jobs"]["mirror_gitee"].get("permissions")
freeze_run = asset_steps[freeze_index]["run"]
push_run = asset_steps[push_index]["run"]
for gate_run in (freeze_run, push_run):
    assert "deploy/check-production-freshness.sh" in gate_run
assert push_run.index("git update-ref") < push_run.index("deploy/check-production-freshness.sh"), \
    push_run
assert push_run.index("deploy/check-production-freshness.sh") < \
    push_run.index('git push --force origin "$SOURCE_SHA:refs/heads/asset-origin"'), push_run
assert 'git push --force origin "$SOURCE_SHA:refs/heads/asset-origin"' in push_run
assert push_run.index('git push --force origin "$SOURCE_SHA:refs/heads/asset-origin"') < \
    push_run.index("gitee.com/A158Coke/Wotbtools.git"), push_run
assert "refs/heads/asset-origin-frozen:refs/heads/asset-origin" in push_run
assert ":refs/heads/main" not in push_run, "the asset transport must never push shared Gitee main"
verify_run = asset_steps[verify_index]["run"]
assert "refs/heads/asset-origin" in verify_run
assert "refs/heads/main" not in verify_run, \
    "the asset gate must verify its own transport ref, not shared main"
assert "force_update" not in asset_text, "account-level mirroring cannot freeze the event SHA"
# The Stack consumes ONLY the asset-owned transport ref and never holds a host lock.
asset_toml = (root / "infra/komodo/resources/asset-origin.toml").read_text(encoding="utf-8")
assert re.search(r'^branch = "asset-origin"$', asset_toml, re.MULTILINE), \
    "the asset Stack must track the asset-origin transport ref"
assert not re.search(r'^branch = "main"$', asset_toml, re.MULTILINE), \
    "the asset Stack must never track shared Gitee main"
assert 'compose_cmd_wrapper = ""' in asset_toml
assert 'compose_cmd_wrapper_include = []' in asset_toml
# The canonical runbook and the authoritative workflow contract must state the same
# narrow exception, so neither can drift into "the whole tree is production-inert".
runbook_text = " ".join(
    (root / "docs/operations/komodo-resource-sync.md").read_text(encoding="utf-8").split()
)
for statement in (
    "the resource tree routes only to the non-production `deployment` PR gate",
    "Exactly one file is also a production input: `infra/komodo/resources/asset-origin.toml` "
    "is an input of `.github/workflows/asset-origin.yml`",
    "which may mutate only the asset-owned transport pair: the derived GitHub "
    "`asset-origin` pointer branch and the matching Gitee `asset-origin` transport "
    "branch (never shared `main`)",
    "It must not apply ResourceSync, must not mutate Komodo resources, and must not deploy the Stack.",
    "The Stack tracks the Gitee `asset-origin` branch",
    "the pinned mirror action force-pushes every GitHub branch to Gitee with `--prune`",
    "`deploy = false`, `webhook_enabled = false`, and `auto_update = false` remain mandatory, "
    "and ResourceSync Apply stays manual.",
    "No other file under `infra/komodo/resources/**` is a production input.",
):
    assert statement in runbook_text, statement
assert "the resource tree reaches only the non-production deployment contract gate" not in runbook_text
agents_text = " ".join((root / ".github/AGENTS.md").read_text(encoding="utf-8").split())
assert "唯一狭窄例外是 `infra/komodo/resources/asset-origin.toml`" in agents_text, \
    "the authoritative workflow contract lost its resource-tree exception"
assert "手动 bootstrap、手动管理 lifecycle" in agents_text, \
    "the workflow contract must document the manual Alibaba Periphery boundary"

print("PR gate, production freshness/ownership, ToFu validation, and backup safety OK")
PY

# The "reuse only an existing immutable image" release step must not confuse a
# brand-new application repository with a broken registry. Exercise the real gate
# helper through fake crane binaries: a first publish has to fall through to
# build + push, while an auth/server/network failure has to stay fatal.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
cat > "$work/bin/crane" <<'CRANE'
#!/usr/bin/env bash
set -euo pipefail
repository="${2:?repository is required}"
case "${FAKE_CRANE_MODE:?}" in
  tags) printf '%s\n' "${FAKE_CRANE_TAGS:?}" ;;
  name-unknown)
    echo "Error: reading tags for $repository: GET https://registry.example/v2/$repository/tags/list?n=1000: NAME_UNKNOWN: repository name not known to registry" >&2
    exit 1
    ;;
  unauthorized)
    echo "Error: reading tags for $repository: GET https://registry.example/v2/$repository/tags/list?n=1000: UNAUTHORIZED: authentication required" >&2
    exit 1
    ;;
  server-error)
    echo "Error: reading tags for $repository: GET https://registry.example/v2/$repository/tags/list?n=1000: unexpected status code 500 Internal Server Error" >&2
    exit 1
    ;;
  *) echo 'unsupported FAKE_CRANE_MODE' >&2; exit 2 ;;
esac
CRANE
chmod +x "$work/bin/crane"

repository=registry.example/team/wotbtools-business-api
tag=sha-0123456789ab

listed="$(PATH="$work/bin:$PATH" FAKE_CRANE_MODE=tags FAKE_CRANE_TAGS="$tag" \
  bash "$ROOT/deploy/list-image-tags.sh" "$repository")"
[ "$listed" = "$tag" ] || { echo "existing repository tags were not passed through: $listed" >&2; exit 1; }

first_publish="$(PATH="$work/bin:$PATH" FAKE_CRANE_MODE=name-unknown \
  bash "$ROOT/deploy/list-image-tags.sh" "$repository")"
[ -z "$first_publish" ] || { echo "a first publish must not report tags: $first_publish" >&2; exit 1; }

for mode in unauthorized server-error; do
  if PATH="$work/bin:$PATH" FAKE_CRANE_MODE="$mode" \
    bash "$ROOT/deploy/list-image-tags.sh" "$repository" >"$work/$mode.out" 2>&1; then
    echo "a registry failure was accepted as an empty repository: $mode" >&2
    exit 1
  fi
  [ -s "$work/$mode.out" ] || { echo "the registry error was swallowed: $mode" >&2; exit 1; }
done

echo "first publish falls through to build while registry failures stay fatal: PASS"

# Exercise the real exporter lookup/verification blocks without registry writes.
python3 - "$ROOT" "$work" <<'PY'
import pathlib, sys, yaml
root, work = map(pathlib.Path, sys.argv[1:])
workflow = yaml.load((root / '.github/workflows/observability.yml').read_text(), Loader=yaml.BaseLoader)
steps = {step.get('id'): step for step in workflow['jobs']['observability']['steps']}
assert steps['exporter_build']['if'] == "contains(steps.source.outputs.runtime_services, 'dev-metrics-exporter') && steps.exporter_existing.outputs.existing_digest == ''"
for identity in ('exporter_existing', 'exporter_image'):
    (work / (identity + '.sh')).write_text(steps[identity]['run'])
PY
cat > "$work/bin/crane" <<'CRANE'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  ls)
    [ "$FAKE_CRANE_MODE" != registry-error ] || { echo 'UNAUTHORIZED' >&2; exit 1; }
    [ "$FAKE_CRANE_MODE" = missing ] || echo "$TAG"
    ;;
  digest)
    if [ "$FAKE_CRANE_MODE" = changed ]; then printf 'sha256:%064d\n' 0; else echo "$FAKE_EXPORTER_DIGEST"; fi
    ;;
  config)
    if [ "$FAKE_CRANE_MODE" = wrong-revision ]; then revision=wrong; else revision="$SOURCE_SHA"; fi
    printf '{"config":{"Labels":{"org.opencontainers.image.revision":"%s"}}}\n' "$revision"
    ;;
  *) exit 2 ;;
esac
CRANE
chmod +x "$work/bin/crane"
exporter_test_sha="$(printf 'a%.0s' {1..40})"
exporter_test_digest="sha256:$(printf 'b%.0s' {1..64})"
exporter_step() {
  env PATH="$work/bin:$PATH" GITHUB_WORKSPACE="$ROOT" GITHUB_OUTPUT="$work/exporter.out" \
    REPOSITORY=ghcr.io/a158coke/dev-metrics-exporter TAG="$exporter_test_sha" SOURCE_SHA="$exporter_test_sha" \
    IMAGE="ghcr.io/a158coke/dev-metrics-exporter:$exporter_test_sha" \
    FAKE_EXPORTER_DIGEST="$exporter_test_digest" "$@"
}
for mode in existing missing; do
  : > "$work/exporter.out"
  exporter_step FAKE_CRANE_MODE="$mode" bash "$work/exporter_existing.sh"
  existing="$(sed -n 's/^existing_digest=//p' "$work/exporter.out")"
  if [ "$mode" = existing ]; then [ "$existing" = "$exporter_test_digest" ]; else [ -z "$existing" ]; fi
  exporter_step FAKE_CRANE_MODE="$mode" EXISTING_DIGEST="$existing" BUILD_DIGEST="$exporter_test_digest" bash "$work/exporter_image.sh"
  grep -Fxq "digest=$exporter_test_digest" "$work/exporter.out"
done
if exporter_step FAKE_CRANE_MODE=registry-error bash "$work/exporter_existing.sh" >"$work/exporter-error.out" 2>&1; then
  echo 'exporter lookup ignored registry authentication failure' >&2; exit 1
fi
for mode in changed wrong-revision; do
  if exporter_step FAKE_CRANE_MODE="$mode" EXISTING_DIGEST="$exporter_test_digest" BUILD_DIGEST='' \
    bash "$work/exporter_image.sh" >"$work/exporter-error.out" 2>&1; then
    echo "exporter accepted invalid registry identity: $mode" >&2; exit 1
  fi
done
echo 'exporter reuses immutable digests and rejects registry/identity drift: PASS'

# ---------------------------------------------------------------------------
# asset-origin: only the asset-owned transport ref `asset-origin` may be
# force-updated, and only by a run that is still EXACT current GitHub main. This
# executes the real workflow step against a disposable GitHub origin and a
# URL-rewritten local Gitee remote, so a stale queued run cannot move the asset ref
# and the Frontend/Business API mirror movement of shared `main` stays irrelevant.
# ---------------------------------------------------------------------------
asset_work="$work/asset-origin"
mkdir -p "$asset_work/runner-temp"
git init -q --bare "$asset_work/hub-bare"
git init -q --bare "$asset_work/gitee.git"
git -C "$asset_work/hub-bare" symbolic-ref HEAD refs/heads/main
git -C "$asset_work/gitee.git" symbolic-ref HEAD refs/heads/main

git init -q "$asset_work/seed"
git -C "$asset_work/seed" config user.email ci@example.invalid
git -C "$asset_work/seed" config user.name 'CI fixture'
mkdir -p "$asset_work/seed/deploy/assets"
printf 'name: wotbtools-asset-origin\n' > "$asset_work/seed/deploy/assets/compose.yaml"
git -C "$asset_work/seed" add -A
git -C "$asset_work/seed" commit -qm 'asset change'
sha_asset="$(git -C "$asset_work/seed" rev-parse HEAD)"
git -C "$asset_work/seed" remote add origin "$asset_work/hub-bare"
git -C "$asset_work/seed" push -q origin "$sha_asset":refs/heads/main
printf 'unrelated\n' > "$asset_work/seed/unrelated.txt"
git -C "$asset_work/seed" add -A
git -C "$asset_work/seed" commit -qm 'unrelated main commit'
sha_newer="$(git -C "$asset_work/seed" rev-parse HEAD)"
git clone -q "$asset_work/hub-bare" "$asset_work/repo"

# The workflow step pushes to the real Gitee URL; rewriting it to a disposable
# bare repository keeps the run offline while exercising the same command. An
# isolated HOME keeps the rewrite (and the runner's real git config) out of the
# way on every git version.
mkdir -p "$asset_work/home"
git config --file "$asset_work/home/.gitconfig" \
  url."$asset_work/gitee.git".insteadOf https://gitee.com/A158Coke/Wotbtools.git

python3 - "$ROOT" "$asset_work" <<'PY'
import pathlib, sys, yaml
root, work = map(pathlib.Path, sys.argv[1:])
workflow = yaml.load((root / '.github/workflows/asset-origin.yml').read_text(), Loader=yaml.BaseLoader)
steps = {step.get('name'): step for step in workflow['jobs']['mirror_gitee']['steps']}
(work / 'push-step.sh').write_text(steps['Push frozen event SHA to the Gitee asset-origin ref']['run'])
(work / 'input-paths').write_text(workflow['env']['PRODUCTION_INPUT_PATHS'])
PY

set_github_main() { git -C "$asset_work/seed" push -q "$asset_work/hub-bare" "+$1:refs/heads/main"; }
# Shared main is moved by the Frontend/Business API mirrors, never by this owner.
set_gitee_main() { git -C "$asset_work/seed" push -q "$asset_work/gitee.git" "+$1:refs/heads/main"; }
# The asset-owned transport ref is moved only by the asset source-transport step.
set_gitee_transport() { git -C "$asset_work/seed" push -q "$asset_work/gitee.git" "+$1:refs/heads/asset-origin"; }
gitee_main() { git -C "$asset_work/gitee.git" rev-parse --verify 'refs/heads/main^{commit}'; }
gitee_transport() { git -C "$asset_work/gitee.git" rev-parse --verify 'refs/heads/asset-origin^{commit}'; }
run_asset_push() {  # <event-name> <event-sha> <log>
  (
    cd "$asset_work/repo" || exit 1
    env \
      EVENT_NAME="$1" \
      EVENT_SHA="$2" \
      EVENT_REF=refs/heads/main \
      SOURCE_SHA="$2" \
      PRODUCTION_REQUIRE_EXACT_MAIN=1 \
      PRODUCTION_INPUT_PATHS="$(cat "$asset_work/input-paths")" \
      GITEE_USERNAME=fixture \
      GITEE_TOKEN=fixture \
      GITHUB_WORKSPACE="$ROOT" \
      RUNNER_TEMP="$asset_work/runner-temp" \
      HOME="$asset_work/home" \
      bash "$asset_work/push-step.sh"
  ) >"$3" 2>&1
}

# The step may only mutate its own transport ref.
if grep -q 'refs/heads/main' "$asset_work/push-step.sh"; then
  echo 'the asset source-transport step references shared Gitee main' >&2
  exit 1
fi

# A newer mirror and a newer asset run already published newer refs: the queued run
# for the older asset SHA must fail closed instead of moving its transport ref back.
set_github_main "$sha_newer"
set_gitee_main "$sha_newer"
set_gitee_transport "$sha_newer"
for stale_kind in push workflow_dispatch; do
  if run_asset_push "$stale_kind" "$sha_asset" "$asset_work/stale-$stale_kind.log"; then
    echo "a stale asset-origin $stale_kind run reached the Gitee asset-origin push" >&2
    exit 1
  fi
  grep -Fq 'requires the exact current main SHA' "$asset_work/stale-$stale_kind.log" || {
    echo "a stale asset-origin $stale_kind run failed for an unexpected reason" >&2
    cat "$asset_work/stale-$stale_kind.log" >&2
    exit 1
  }
  current="$(gitee_transport)"
  [ "$current" = "$sha_newer" ] || {
    echo "a stale asset-origin $stale_kind run moved the asset transport ref: $current" >&2
    exit 1
  }
  shared="$(gitee_main)"
  [ "$shared" = "$sha_newer" ] || {
    echo "a stale asset-origin $stale_kind run touched shared Gitee main: $shared" >&2
    exit 1
  }
done

# The same frozen SHA still reaches the asset-owned ref while it IS exact current
# main, and shared Gitee main (another owner's ref) is left exactly where it was.
set_github_main "$sha_asset"
if ! run_asset_push push "$sha_asset" "$asset_work/fresh-push.log"; then
  echo 'a fresh asset-origin push run was rejected' >&2
  cat "$asset_work/fresh-push.log" >&2
  exit 1
fi
current="$(gitee_transport)"
[ "$current" = "$sha_asset" ] || {
  echo "a fresh asset-origin run published the wrong asset transport ref: $current" >&2
  exit 1
}
shared="$(gitee_main)"
[ "$shared" = "$sha_newer" ] || {
  echo "a fresh asset-origin run moved shared Gitee main (Frontend/Business owner): $shared" >&2
  exit 1
}
echo 'asset-origin pins the reviewed SHA on its own ref and never touches shared main: PASS'

# asset-owned transport pair 保留；main-only sync 的 ref isolation 由真实 Git fixture 验证。
hub_transport="$(git -C "$asset_work/hub-bare" rev-parse --verify 'refs/heads/asset-origin^{commit}')"
[ "$hub_transport" = "$sha_asset" ] || {
  echo "the asset workflow did not publish the GitHub pointer branch: $hub_transport" >&2
  exit 1
}
echo 'asset-origin transport pair remains asset-owned: PASS'
