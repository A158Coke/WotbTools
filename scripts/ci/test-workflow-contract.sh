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
assert affected("deploy/test-caddy-route-inventory.sh") == {"caddy", "deployment"}
assert "deploy/test-caddy-route-inventory.sh" in json.dumps(
    load(workflow_dir / "ci-caddy.yml"), ensure_ascii=False
), "the Caddy owner must run its own public-site inventory and access-log fixtures"
assert not [
    step for job in load(workflow_dir / "ci-deployment.yml")["jobs"].values()
    for step in job.get("steps", [])
    if "bash deploy/test-caddy-route-inventory.sh" in step.get("run", "")
], "the gateway fixtures must run in exactly one owner"
assert affected("deploy/komodo/verify.sh") == {"komodo_controller"}
assert affected("deploy/tx/Caddyfile") == {"caddy"}
assert affected("docs/operations/komodo-public-ingress.md") == set()
assert affected("deploy/periphery/install.sh") == {"komodo_periphery"}
assert affected("deploy/periphery/periphery.release") == {"komodo_periphery"}
assert affected(".github/workflows/komodo-periphery.yml") == {"komodo_periphery"}
assert affected(".github/workflows/komodo-periphery-ali.yml") == {"komodo_periphery"}
assert not (affected("deploy/periphery/install.sh") & {"komodo_controller", "caddy"})
assert affected("docs/operations/komodo-periphery.md") == set()
assert affected("infra/komodo/resources/servers.toml") == {"deployment"}
assert affected("infra/komodo/resources/resource-sync.toml") == {"deployment"}
assert not (affected("infra/komodo/resources/servers.toml") & {"komodo_controller", "komodo_periphery", "caddy"})
komodo_controller_events = load(workflow_dir / "komodo-controller.yml")
for production_path in komodo_controller_events["on"]["push"]["paths"]:
    assert not fnmatch.fnmatchcase("infra/komodo/resources/servers.toml", production_path), production_path
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

_stage_sources = []
for _name in ("ci-android.yml", "android-release.yml"):
  _stage_sources.append((_name, (workflow_dir / _name).read_text(encoding="utf-8")))
_release_source = dict(_stage_sources)["android-release.yml"]
_stage_block = _release_source.split("\n  publish:", 1)[0]
assert _stage_block.count("actions/setup-node@v4") == 1, \
  f"android-release.yml stage must declare actions/setup-node@v4 exactly once, got {_stage_block.count('actions/setup-node@v4')}"

for android_workflow in ("ci-android.yml", "android-release.yml"):
  android_text = (workflow_dir / android_workflow).read_text(encoding="utf-8")
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
assert "steps.version.outputs" not in _publish_run_text, \
  "publish must not derive the candidate from the current main committed version"
assert "resolve-staged-version.sh" in _publish_run_text, \
  "publish must resolve the staged version from the tag target"
assert 'TAG="android-v$REQUESTED_VERSION"' in _publish_run_text and "git archive" in _publish_run_text
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
for _forbidden in ("assembleRelease", "wotbKeystorePath", "keystore.jks", "ANDROID_KEYSTORE_BASE64"):
  assert _forbidden not in _publish_run_text, f"publish must not rebuild or re-sign ({_forbidden})"
_publish_step_names = [step.get("name", "") for step in _publish_job["steps"]]
_write_i = next(i for i, name in enumerate(_publish_step_names) if name.startswith("Write version.json"))
_upload_i = next(i for i, name in enumerate(_publish_step_names) if name.startswith("Upload version.json"))
_verify_i = next(i for i, name in enumerate(_publish_step_names) if name.startswith("Verify production version.json"))
assert _write_i < _upload_i < _verify_i, _publish_step_names
assert "steps.staged.outputs" in _publish_job["steps"][_write_i]["run"], \
  "version.json must be written from the staged identity"

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

ai_service_ci = load(workflow_dir / "ci-ai-service.yml")
ai_runs = [step.get("run", "") for job in ai_service_ci["jobs"].values() for step in job.get("steps", [])]
assert any("-pl wotb-ai -am test" in run for run in ai_runs), "ci-ai-service.yml must run wotb-ai tests"
assert not any("-pl wotb-ai" in run and ("skipTests" in run or "maven.test.skip" in run) for run in ai_runs), \
    "ci-ai-service.yml must not skip wotb-ai tests"

legacy_tcr_publisher = (root / "deploy/tx/publish-loaded-image-to-tcr.sh").read_text(encoding="utf-8")
assert "<backend|frontend|keycloak>" not in legacy_tcr_publisher
assert "backend|frontend|keycloak)" not in legacy_tcr_publisher

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
caddy_tokens = {token for line in caddy_script.splitlines() for token in line.split()}
assert "-k" not in caddy_tokens, "curl -k is forbidden in the Caddy gateway verification"
assert "--insecure" not in caddy_tokens, "--insecure is forbidden in the Caddy gateway verification"

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
NON_TX_FIXED_DEPENDENCIES = {
    "frontend": (frontend_deploy, {
        "TX_AI_UPSTREAM": "http://10.20.0.2:8089",
    }),
    "business-api": (business_deploy, {}),
    "caddy": (caddy_deploy, {}),
}
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
for owner, (step, placements) in NON_TX_FIXED_DEPENDENCIES.items():
    exported = step["with"]["envs"].split(",")
    for name, value in {**placements, **CURRENT_K6B_CUTOVERS.get(owner, {})}.items():
        assert step["env"][name] == value, (owner, name, step["env"].get(name))
        assert name in exported, (owner, name)
for owner, (step, placements) in NON_TX_FIXED_DEPENDENCIES.items():
    for name, value in placements.items():
        assert not re.search(r"10\.20\.0\.[13]:", str(value)), (owner, name, value)
    for cut_over_name in CURRENT_K6B_CUTOVERS.get(owner, {}):
        assert cut_over_name in step["env"], (owner, cut_over_name)
        assert cut_over_name in step["with"]["envs"].split(","), (owner, cut_over_name)

assert business_script.index("dependency-readiness.sh business-api") \
    < business_script.index("deploy/tx/deploy.sh"), \
    "dependency readiness must run before the Business API deployment"

runtime_gate_workflow = load(workflow_dir / "tx-runtime-check.yml")
runtime_gate_step = next(
    step for step in runtime_gate_workflow["jobs"]["runtime_check"]["steps"]
    if step.get("name") == "Run exact-SHA read-only TX runtime gate"
)
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
cut_over_names = {name for cut_over in CURRENT_K6B_CUTOVERS.values() for name in cut_over}
for name, value in gate_expectations.items():
    if name not in cut_over_names:
        assert name == "TX_AI_UPSTREAM", (name, value)
        assert not re.search(r"10\.20\.0\.[13]:", str(value)), (name, value)
assert gate_expectations["TX_KEYCLOAK_DB_PORT"] == "15432", gate_expectations["TX_KEYCLOAK_DB_PORT"]
assert gate_expectations["TX_BUSINESS_DB_PORT"] == "25432", gate_expectations["TX_BUSINESS_DB_PORT"]
assert gate_expectations["CADDY_FRONTEND_UPSTREAM"] == "10.20.0.1:8081", \
    gate_expectations["CADDY_FRONTEND_UPSTREAM"]
assert gate_expectations["CADDY_KEYCLOAK_UPSTREAM"] == "10.20.0.1:8080", \
    gate_expectations["CADDY_KEYCLOAK_UPSTREAM"]
assert runtime_gate_step["env"]["TX_AI_UPSTREAM"] == "http://10.20.0.2:8089", \
    "the Yecao AI upstream must never move with a TX placement cutover"

# One Komodo Periphery owner serves every reviewed target host. The established
# private-WireGuard chain is followed by the Alibaba public-Core target, and the
# reusable Alibaba transport may only be reached as the final dependent job.
periphery_workflow = load(workflow_dir / "komodo-periphery.yml")
periphery_events = periphery_workflow.get("on", periphery_workflow.get(True, {}))
assert periphery_events["push"]["paths"] == periphery_workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
assert ".github/workflows/komodo-periphery-ali.yml" in periphery_events["push"]["paths"]
periphery_jobs = periphery_workflow["jobs"]
assert set(periphery_jobs) == {
    "reconcile_yecao", "reconcile_tx1", "reconcile_tx2", "reconcile_ali_asset",
}, sorted(periphery_jobs)
assert periphery_jobs["reconcile_yecao"]["name"] == "Reconcile Komodo Periphery on Yecao"
assert periphery_jobs["reconcile_tx1"]["name"] == "Reconcile Komodo Periphery on TX1"
assert periphery_jobs["reconcile_tx2"]["name"] == "Reconcile Komodo Periphery on TX2"
assert periphery_jobs["reconcile_ali_asset"]["name"] == "Reconcile Komodo Periphery on Alibaba asset host"
assert "needs" not in periphery_jobs["reconcile_yecao"], periphery_jobs["reconcile_yecao"]
assert periphery_jobs["reconcile_tx1"]["needs"] == ["reconcile_yecao"], periphery_jobs["reconcile_tx1"]["needs"]
assert periphery_jobs["reconcile_tx2"]["needs"] == ["reconcile_tx1"], periphery_jobs["reconcile_tx2"]["needs"]
assert periphery_jobs["reconcile_ali_asset"]["needs"] == ["reconcile_tx2"], periphery_jobs["reconcile_ali_asset"]
assert periphery_jobs["reconcile_ali_asset"]["uses"] == "./.github/workflows/komodo-periphery-ali.yml"
# Credential scoping: the reusable Alibaba transport receives ONLY its five
# declared secrets. `secrets: inherit` would expose every repository secret.
ali_secrets = {
    "ALI_ASSET_VPS_HOST": "${{ secrets.ALI_ASSET_VPS_HOST }}",
    "ALI_ASSET_VPS_USER": "${{ secrets.ALI_ASSET_VPS_USER }}",
    "ALI_ASSET_VPS_PORT": "${{ secrets.ALI_ASSET_VPS_PORT }}",
    "ALI_ASSET_VPS_SSH_KEY": "${{ secrets.ALI_ASSET_VPS_SSH_KEY }}",
    "KOMODO_ALI_ASSET_ONBOARDING_KEY": "${{ secrets.KOMODO_ALI_ASSET_ONBOARDING_KEY }}",
}
assert periphery_jobs["reconcile_ali_asset"]["secrets"] == ali_secrets, \
    periphery_jobs["reconcile_ali_asset"]["secrets"]
assert set(periphery_jobs["reconcile_ali_asset"]) == {"name", "needs", "uses", "secrets"}, \
    sorted(periphery_jobs["reconcile_ali_asset"])
assert "secrets: inherit" not in (workflow_dir / "komodo-periphery.yml").read_text(encoding="utf-8")

# The first three hosts retain the original inline transport contract. Alibaba's
# different SSH boundary is owned by the reusable workflow and validated below.
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
    assert "environment" not in job, f"Periphery uses repository-level secrets, never a GitHub Environment: {host}"
    steps = {step.get("name"): step for step in job["steps"]}
    release_step = steps["Read the pinned Periphery release"]["run"]
    assert "deploy/periphery/periphery.release" in release_step, release_step
    assert "PERIPHERY_SHA256" in release_step and "PERIPHERY_URL" in release_step
    artifact_step = steps["Download and verify the pinned Periphery artifact"]["run"]
    assert "sha256sum --check --strict" in artifact_step, artifact_step
    assert "--retry 3" in artifact_step, artifact_step
    profile_step = steps[f"Read the {label} target profile"]
    assert profile_step["env"]["TARGET"] == spec["profile"], profile_step["env"]
    assert "read-target-profile.sh" in profile_step["run"], profile_step["run"]
    for secret in spec["secrets"]:
        assert secret in json.dumps(job), (host, secret)
    ssh_steps = [step for step in job["steps"] if step.get("uses", "").startswith(("appleboy/ssh-action", "appleboy/scp-action"))]
    assert ssh_steps, host
    for step in ssh_steps:
        assert step["with"]["host"] == f"${{{{ secrets.{spec['secrets'][0]} }}}}", (host, step["with"]["host"])
    for staging_name in (f"Prepare safe {label} staging root", f"Cleanup staged {label} inputs"):
        staging_step = steps[staging_name]
        assert staging_step["with"]["script_path"] == "deploy/periphery/staging-root.sh", staging_name
        assert staging_step["env"]["PERIPHERY_STAGING_ROOT"] == "${{ steps.target.outputs.staging_root }}", staging_name
    assert steps[f"Cleanup staged {label} inputs"]["if"] == "always()"
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
    reconcile = steps[f"Reconcile {label} Periphery under the {label} host lock"]
    assert 'bash "$stage/deploy/periphery/reconcile.sh" "$PERIPHERY_TARGET" "$SOURCE_SHA" "$stage"' in reconcile["with"]["script"], host
    assert reconcile["env"]["PERIPHERY_TARGET"] == spec["profile"], host
    for token in ("curl", "wget"):
        assert token not in reconcile["with"]["script"], (host, token)
yecao_json = json.dumps(periphery_jobs["reconcile_yecao"], ensure_ascii=False)
assert "ONBOARDING_KEY" not in yecao_json, "the Yecao job must not reference an onboarding secret"
assert "KOMODO_YECAO_ONBOARDING_KEY" not in json.dumps(periphery_workflow, ensure_ascii=False)

ali_workflow = load(workflow_dir / "komodo-periphery-ali.yml")
ali_events = ali_workflow.get("on", ali_workflow.get(True, {}))
assert set(ali_events) == {"workflow_call"}, ali_events
# The `workflow_call` interface is exactly the caller's five-secret mapping.
ali_call = ali_events["workflow_call"]
assert set(ali_call) == {"secrets"}, sorted(ali_call)
assert set(ali_call["secrets"]) == set(ali_secrets), sorted(ali_call["secrets"])
assert {name: spec["required"] for name, spec in ali_call["secrets"].items()} == {
    "ALI_ASSET_VPS_HOST": "true",
    "ALI_ASSET_VPS_USER": "true",
    "ALI_ASSET_VPS_PORT": "true",
    "ALI_ASSET_VPS_SSH_KEY": "true",
    "KOMODO_ALI_ASSET_ONBOARDING_KEY": "false",
}, ali_call["secrets"]
# The transport may not read any other repository secret, directly or through an
# expression alias.
ali_text = (workflow_dir / "komodo-periphery-ali.yml").read_text(encoding="utf-8")
assert set(re.findall(r"secrets\.([A-Za-z0-9_]+)", ali_text)) == set(ali_secrets), \
    sorted(set(re.findall(r"secrets\.([A-Za-z0-9_]+)", ali_text)))
assert "secrets: inherit" not in ali_text
assert "concurrency" not in ali_workflow
assert set(ali_workflow["jobs"]) == {"reconcile"}
ali_job = ali_workflow["jobs"]["reconcile"]
assert "environment" not in ali_job
ali_steps = {step.get("name"): step for step in ali_job["steps"]}
assert ali_steps["Read the Alibaba asset target profile"]["env"]["TARGET"] == "ali-sh-asset-01"
for secret in ("ALI_ASSET_VPS_HOST", "ALI_ASSET_VPS_USER", "ALI_ASSET_VPS_PORT", "ALI_ASSET_VPS_SSH_KEY"):
    assert secret in json.dumps(ali_job), secret
for step in ali_job["steps"]:
    if step.get("uses", "").startswith(("appleboy/ssh-action", "appleboy/scp-action")):
        assert step["with"]["host"] == "${{ secrets.ALI_ASSET_VPS_HOST }}", step["with"]["host"]
assert ali_steps["Cleanup staged Alibaba asset inputs"]["if"] == "always()"
ali_stage = " ".join(ali_steps["Stage exact Periphery inputs on Alibaba asset host"]["with"]["source"].split())
ali_staged_files = {part for part in ali_stage.replace(" ", "").split(",") if part}
assert {
    "deploy/periphery/adopt-existing.sh",
    "deploy/periphery/validate-adoption-config.py",
    "deploy/periphery/targets/ali-sh-asset-01/target.env",
    "deploy/periphery/targets/ali-sh-asset-01/periphery.config.toml",
} <= ali_staged_files, sorted(ali_staged_files)
ali_reconcile = ali_steps["Reconcile Alibaba asset Periphery under the host lock"]
assert ali_reconcile["env"]["PERIPHERY_TARGET"] == "ali-sh-asset-01"
assert ali_reconcile["env"]["KOMODO_PERIPHERY_ONBOARDING_KEY"] == "${{ secrets.KOMODO_ALI_ASSET_ONBOARDING_KEY }}"

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
assert worker_workflow["concurrency"]["group"] == "production-maintenance"
assert worker_workflow["concurrency"]["cancel-in-progress"] == "false"
worker_text = json.dumps(worker_workflow, ensure_ascii=False)
for forbidden in (
    "infra/komodo", "resource-sync", "komodo-", "CADDY_", "TX_BACKEND_UPSTREAM",
    "TX_KEYCLOAK_", "TX_BUSINESS_DB_", "TX_AI_UPSTREAM", "caddy.yml", "frontend.yml",
    "business-api.yml", "keycloak.yml", "keycloak-postgres.yml", "business-postgres.yml",
    "alloy-tx.yml", "docker compose up", "docker run",
):
    assert forbidden not in worker_text, f"the production-worker owner must not own {forbidden}"
worker_steps = {step.get("name"): step for step in worker_job["steps"]}
assert worker_steps["Read the TX2 worker profile"]["env"]["TARGET"] == "tx2"
assert "read-target-profile.sh" in worker_steps["Read the TX2 worker profile"]["run"]
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
worker_reconcile = worker_steps["Reconcile the TX2 production worker under the TX2 host lock"]
assert 'bash "$stage/deploy/production-worker/reconcile.sh"' in worker_reconcile["with"]["script"]
assert 'grep -qx "$WORKER_READY_TOKEN" "$log"' in worker_reconcile["with"]["script"]
assert "TX2_PRODUCTION_WORKER_READY" not in json.dumps(worker_workflow, ensure_ascii=False), \
    "the readiness token must come from the reviewed host profile, never inlined"
worker_envs = worker_reconcile["with"]["envs"].split(",")
for name in ("TCR_REGISTRY", "TCR_NAMESPACE", "TCR_CREDENTIAL_VERSION", "TCR_USERNAME", "TCR_PASSWORD"):
    assert name in worker_envs, name
assert worker_reconcile["env"]["TCR_USERNAME"] == "${{ secrets.TCR_USERNAME }}"
assert worker_reconcile["env"]["TCR_PASSWORD"] == "${{ secrets.TCR_PASSWORD }}"
assert worker_reconcile["env"]["TCR_REGISTRY"] == "${{ vars.TCR_REGISTRY }}"
assert worker_reconcile["env"]["TCR_NAMESPACE"] == "${{ vars.TCR_NAMESPACE }}"
assert worker_reconcile["env"]["TCR_CREDENTIAL_VERSION"] == "${{ vars.TCR_CREDENTIAL_VERSION }}"
assert "secrets.TCR_CREDENTIAL_VERSION" not in json.dumps(worker_workflow, ensure_ascii=False)
assert "--password" not in json.dumps(worker_workflow, ensure_ascii=False)
assert affected("deploy/production-worker/install.sh") == {"production_worker"}
assert affected(".github/workflows/production-worker.yml") == {"production_worker"}
assert affected("deploy/production-worker/targets/tx2/target.env") == {"production_worker"}
assert not (affected("deploy/production-worker/install.sh")
            & {"komodo_controller", "komodo_periphery", "caddy", "frontend",
               "business_api", "keycloak", "business_postgres", "keycloak_postgres", "ai_service"})
for workload_input in (".github/workflows/frontend.yml", "deploy/tx/Caddyfile",
                       "deploy/tx/business-api.compose.yml", "infra/komodo/resources/servers.toml"):
    assert "production_worker" not in affected(workload_input), workload_input
for owner_path in ("deploy/production-worker/install.sh", "deploy/production-worker/verify.sh",
                   "deploy/production-worker/reconcile.sh", "deploy/production-worker/lib.sh"):
    worker_script = (root / owner_path).read_text(encoding="utf-8")
    for forbidden in ("infra/komodo", "resource-sync", "CADDY_", "TX_BACKEND_UPSTREAM",
                      "periphery.service", "wg set", "docker compose up"):
        assert forbidden not in worker_script, (owner_path, forbidden)
for lock_path in ("deploy/production-worker/install.sh", "deploy/production-worker/reconcile.sh"):
    lock_script = (root / lock_path).read_text(encoding="utf-8")
    assert "require_host_lock" in lock_script, lock_path
    assert 'exec 9>"$WORKER_LOCK_ROOT/.deploy.lock"' in lock_script, lock_path
    assert "flock -n 9" in lock_script, lock_path
    for forbidden in ('mkdir -p "$WORKER_LOCK_ROOT', 'touch "$WORKER_LOCK_ROOT',
                      'install -d "$WORKER_LOCK_ROOT', ' > "$WORKER_LOCK_ROOT/.deploy.lock'):
        assert forbidden not in lock_script, (lock_path, forbidden)
    assert lock_script.count(".deploy.lock") <= 2, lock_path
for tracked in sorted(root.rglob("*")):
    if not tracked.is_file() or ".git" in tracked.parts:
        continue
    if tracked.suffix in {".png", ".jpg", ".webp", ".gz", ".lock", ".jar", ".woff", ".woff2", ".ico"}:
        continue
    text = tracked.read_text(encoding="utf-8", errors="ignore")
    if '"auths"' in text and '"auth":' in text:
        relative = str(tracked.relative_to(root))
        assert relative in {
            "deploy/production-worker/test-production-worker.sh",
            "scripts/ci/test-workflow-contract.sh",
        }, f"a Docker credential must never be committed: {relative}"
    for assignment in re.finditer(
        r"^\s*(?:export\s+)?(TCR_PASSWORD|TCR_USERNAME|DOCKER_PASSWORD)\s*[=:]\s*[\"']?([^\s\"']+)",
        text, re.MULTILINE,
    ):
        relative = str(tracked.relative_to(root))
        value = assignment.group(2)
        assert relative.startswith("deploy/production-worker/test-") or value.startswith("$"), \
            f"a registry credential must never be assigned in the repository: {relative}"
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
for profile, expected in {
    "yecao": {"connect_as": "yecao", "lock_root": "/opt/wotb", "staging_root": "/opt/periphery", "privilege": "root"},
    "tx1": {"connect_as": "tx1", "lock_root": "/opt/wotb-tx", "staging_root": "/opt/wotb-tx/periphery", "privilege": "sudo"},
    "tx2": {"connect_as": "tx2", "lock_root": "/opt/wotb-tx2", "staging_root": "/opt/wotb-tx2/periphery", "privilege": "sudo"},
    "ali-sh-asset-01": {"connect_as": "ali-sh-asset-01", "lock_root": "/opt/wotb-asset", "staging_root": "/opt/wotb-asset/periphery", "privilege": "sudo"},
}.items():
    text = (root / f"deploy/periphery/targets/{profile}/target.env").read_text(encoding="utf-8")
    assert f"PERIPHERY_TARGET={profile}" in text, profile
    assert f"PERIPHERY_CONNECT_AS={expected['connect_as']}" in text, profile
    assert f"PERIPHERY_LOCK_ROOT:={expected['lock_root']}" in text, profile
    assert f"PERIPHERY_STAGING_ROOT:={expected['staging_root']}" in text, profile
    assert f"PERIPHERY_PRIVILEGE={expected['privilege']}" in text, profile
    effective_profile = "\n".join(line for line in text.splitlines() if not line.strip().startswith("#"))
    assert not re.search(r"(?i)(secret|password|passwd|token|private_key|onboarding_key)\s*=", effective_profile), profile
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
ali_config_text = (root / "deploy/periphery/targets/ali-sh-asset-01/periphery.config.toml").read_text(encoding="utf-8")
for invariant in (
    'root_directory = "/etc/komodo"',
    'core_addresses = ["https://komodo.wotbtools.com"]',
    'connect_as = "ali-sh-asset-01"',
    "server_enabled = false",
    'private_key = "file:/etc/komodo/keys/periphery.key"',
    'core_public_keys = ["file:/etc/komodo/keys/core.pub"]',
):
    assert invariant in ali_config_text, invariant
for forbidden in ("onboarding_key", "passkeys", "core_tls_insecure_skip_verify = true"):
    assert forbidden not in ali_config_text, forbidden
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

# --- asset origin source transport (Komodo Stack `wotbtools-asset-origin`) -----
# This owner may mutate ONLY the Gitee source mirror. It is also the single,
# narrowly scoped exception to "infra/komodo/resources/** is owned by no
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
asset_steps = asset_workflow["jobs"]["mirror_gitee"]["steps"]
asset_step_names = [step.get("name") for step in asset_steps]
freeze_index = asset_step_names.index("Freeze reviewed main source")
push_index = asset_step_names.index("Push frozen event SHA to Gitee main")
verify_index = asset_step_names.index("Require Gitee main at the reviewed GitHub SHA")
assert freeze_index < push_index < verify_index, asset_step_names
assert asset_steps[freeze_index]["env"]["EVENT_SHA"] == "${{ github.sha }}"
assert asset_steps[push_index]["env"]["EVENT_SHA"] == "${{ github.sha }}"
# For BOTH push and workflow_dispatch the shared-ref mutation requires the exact
# current main SHA, not merely "owned inputs unchanged".
assert asset_steps[push_index]["env"]["PRODUCTION_REQUIRE_EXACT_MAIN"] == "1"
freeze_run = asset_steps[freeze_index]["run"]
push_run = asset_steps[push_index]["run"]
for gate_run in (freeze_run, push_run):
    assert "deploy/check-production-freshness.sh" in gate_run
# The exact-current-main gate runs after local preparations and immediately
# before the only ref mutation.
assert push_run.index("git update-ref") < push_run.index("deploy/check-production-freshness.sh"), \
    push_run
assert push_run.index("deploy/check-production-freshness.sh") < push_run.index("git push --force"), \
    push_run
assert "refs/heads/asset-origin-frozen:refs/heads/main" in push_run
assert "force_update" not in asset_text, "account-level mirroring cannot freeze the event SHA"

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
    window = "\n".join(all_lines[index:index + 3])
    assert "<redacted>" in window, (
        "a set-cookie pipeline without redaction can leak live session identifiers: "
        + all_lines[index].strip()
    )

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

print("PR gate, production freshness/ownership, ToFu validation, and backup safety OK")
PY

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
# asset-origin: the shared Gitee `main` ref may only be force-updated by a run
# that is still EXACT current GitHub main. This executes the real workflow step
# against a disposable GitHub origin and a URL-rewritten local Gitee remote, so a
# stale queued run cannot roll that shared ref backward.
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
(work / 'push-step.sh').write_text(steps['Push frozen event SHA to Gitee main']['run'])
(work / 'input-paths').write_text(workflow['env']['PRODUCTION_INPUT_PATHS'])
PY

set_github_main() { git -C "$asset_work/seed" push -q "$asset_work/hub-bare" "+$1:refs/heads/main"; }
set_gitee_main() { git -C "$asset_work/seed" push -q "$asset_work/gitee.git" "+$1:refs/heads/main"; }
gitee_main() { git -C "$asset_work/gitee.git" rev-parse --verify 'refs/heads/main^{commit}'; }
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

# A newer mirror already published the newer main: the queued run for the older
# asset SHA must fail closed instead of force-updating the shared ref backward.
set_github_main "$sha_newer"
set_gitee_main "$sha_newer"
for stale_kind in push workflow_dispatch; do
  if run_asset_push "$stale_kind" "$sha_asset" "$asset_work/stale-$stale_kind.log"; then
    echo "a stale asset-origin $stale_kind run reached the shared Gitee push" >&2
    exit 1
  fi
  grep -Fq 'requires the exact current main SHA' "$asset_work/stale-$stale_kind.log" || {
    echo "a stale asset-origin $stale_kind run failed for an unexpected reason" >&2
    cat "$asset_work/stale-$stale_kind.log" >&2
    exit 1
  }
  current="$(gitee_main)"
  [ "$current" = "$sha_newer" ] || {
    echo "a stale asset-origin $stale_kind run rolled Gitee main backward: $current" >&2
    exit 1
  }
done

# The same frozen SHA still reaches the shared ref while it IS exact current main.
set_github_main "$sha_asset"
if ! run_asset_push push "$sha_asset" "$asset_work/fresh-push.log"; then
  echo 'a fresh asset-origin push run was rejected' >&2
  cat "$asset_work/fresh-push.log" >&2
  exit 1
fi
current="$(gitee_main)"
[ "$current" = "$sha_asset" ] || {
  echo "a fresh asset-origin run published the wrong Gitee main: $current" >&2
  exit 1
}
echo 'asset-origin freezes the reviewed SHA and rejects stale push/dispatch before Gitee: PASS'
