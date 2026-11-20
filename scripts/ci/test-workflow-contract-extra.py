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
            "scripts/ci/test-workflow-contract-extra.py",
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

print("PR gate, production freshness/ownership, ToFu validation, and backup safety OK")
