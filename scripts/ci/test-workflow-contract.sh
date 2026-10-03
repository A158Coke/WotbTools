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
assert affected("infra/tofu/postgres-business/main.tf") == {"business_postgres"}
assert affected("deploy/tx/business-postgres.compose.yml") == {"business_postgres"}
assert affected("docs/README.md") == set()
assert affected("frontend/src/platform/nativeBridgeContract.js") == {"frontend", "android"}
assert "android" in affected(".github/workflows/android-release.yml"), "release protocol changes must run Android helper tests"
assert affected("deploy/list-image-tags.sh") == {"business_api", "deployment"}
assert affected("deploy/tx/publish-loaded-image-to-tcr.sh") == {"deployment"}
assert affected("deploy/tx/validate-caddy-config.sh") == {"caddy", "deployment"}
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
    "deployment", "frontend", "komodo_controller", "komodo_periphery",
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
tx_runtime_job = tx_runtime["jobs"]["runtime_check"]
assert tx_runtime_job["environment"] == "tx-production"
assert tx_runtime_job["name"] == "TX_RUNTIME_READY"
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
for invariant in (
    "/opt/wotb-tx/deploy/runtime-check.sh",
    "/opt/wotb-tx/deploy/with-deploy-lock.sh",
    "TX_RUNTIME_ROOT",
    "TX_FRONTEND_IMAGE_REF",
    "TX_BUSINESS_API_IMAGE_REF",
    "assert_digest_image",
    "grep -Fxq 'TX_RUNTIME_READY'",
):
    assert invariant in tx_runtime_text, invariant
for forbidden in (
    "appleboy/scp-action",
    "tofu apply",
    "docker push",
    "docker compose up",
    "deploy.incoming",
):
    assert forbidden not in tx_runtime_text, f"TX runtime check must stay read-only: {forbidden}"

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

# Production owner routing and freshness inputs are paired contracts. A workflow
# may only proceed when its triggering SHA is still current for every owned input.
owners = (
    "business-api", "frontend", "keycloak", "caddy",
    "business-postgres", "keycloak-postgres", "observability", "alloy-tx",
    "komodo-controller", "komodo-periphery",
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
}
assert set(pr_owner_for_production) == set(owners)
image_owners = {"business-api", "frontend", "keycloak"}
queue = {"group": "production-maintenance", "cancel-in-progress": "false", "queue": "max"}

# Business API and Frontend both mirror the same GitHub repository to Gitee and
# build on the same constrained TX host. Those shared mutation points must stay
# serialized across the two otherwise-independent owner workflows.
for owner in ("business-api", "frontend"):
    workflow = load(workflow_dir / f"{owner}.yml")
    assert workflow["jobs"]["mirror_gitee"]["concurrency"] == {
        "group": "production-gitee-mirror", "cancel-in-progress": "false", "queue": "max",
    }, owner
    mirror_step = next(
        step for step in workflow["jobs"]["mirror_gitee"]["steps"]
        if step.get("name") == "Mirror WotbTools to Gitee"
    )
    assert mirror_step["with"]["force_update"] == "true", owner
    assert workflow["jobs"]["build"]["concurrency"] == {
        "group": "tx-production-build", "cancel-in-progress": "false", "queue": "max",
    }, owner

# Release identity must not cross the GitHub job-output boundary. GitHub may
# redact arbitrary SHA/digest values when they happen to match a configured secret,
# so deploy reconstructs the immutable tag from github.sha and resolves its digest
# on TX immediately before mutation.
for owner in ("business-api", "frontend"):
    workflow = load(workflow_dir / f"{owner}.yml")
    assert "outputs" not in workflow["jobs"]["build"], owner
    assert "needs.build.outputs" not in json.dumps(workflow, ensure_ascii=False), owner

frontend_workflow = load(workflow_dir / "frontend.yml")
frontend_deploy = next(
    step for step in frontend_workflow["jobs"]["deploy"]["steps"]
    if step.get("name") == "Reconcile only Frontend under the TX host lock"
)
frontend_env = frontend_deploy["env"]
assert frontend_env["WOTB_DEPLOY_CONFIG_SHA"] == "${{ github.sha }}"
assert frontend_env["ASSET_BASE_URL"] == "${{ vars.ASSET_BASE_URL }}"
assert "TX_FRONTEND_IMAGE_REF" not in frontend_env
frontend_events = frontend_workflow.get("on", frontend_workflow.get(True, {}))
assert "deploy/tx/with-deploy-lock.sh" in frontend_events["push"]["paths"]
assert "deploy/tx/with-deploy-lock.sh" in frontend_workflow["env"]["PRODUCTION_INPUT_PATHS"]
frontend_script = frontend_deploy["with"]["script"]
assert "with-deploy-lock.sh bash -s <<'LOCKED'" in frontend_script
assert "exec 9>/opt/wotb-tx/.deploy.lock" not in frontend_script
assert "flock -n 9" not in frontend_script
for invariant in (
    "identity=\"$(printf '%s\\n%s' \"$source_sha\" \"$ASSET_BASE_URL\" | sha256sum | cut -c1-12)\"",
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
assert any("-pl wotb-ai -am test" in run for run in ai_runs), "ci-ai-service.yml must run wotb-ai tests"
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
