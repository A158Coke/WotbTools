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

# D3：三个数据更新 workflow 的 PR 发布协议必须收敛到受限 helper，不允许第二份 inline 实现。
helper_path = root / "scripts/ci/publish-data-update.sh"
assert helper_path.exists(), "the shared data-update publish helper must exist"
helper_text = helper_path.read_text(encoding="utf-8")
# 只检查可执行代码行：helper 的注释解释了为什么禁止 git add -A / add . / eval。
helper_code = "\n".join(
    line for line in helper_text.splitlines() if not line.lstrip().startswith("#")
)
for automation_branch in (
    "automation/update-tankopedia",
    "automation/update-equipment",
    "automation/update-crew-skills",
):
    assert automation_branch in helper_text, automation_branch
for forbidden_helper in ("git add -A", "git add .", "eval "):
    assert forbidden_helper not in helper_code, forbidden_helper
data_publishers = {
    "update-tankopedia.yml": ["common/tankopedia-tier*.json", "common/tank_ids.json"],
    "update-equipment.yml": ["common/wotb-item-catalog-json/equipment.json"],
    "update-crew-skills.yml": ["common/crew-skills.json"],
}
for wf_name, expected_paths in data_publishers.items():
    wf_yaml = load(workflow_dir / wf_name)
    publish_runs = [
        step.get("run", "")
        for job in wf_yaml["jobs"].values()
        for step in job.get("steps", [])
        if "publish-data-update.sh" in step.get("run", "")
    ]
    assert len(publish_runs) == 1, f"{wf_name} must invoke the shared publish helper exactly once"
    run_text = publish_runs[0]
    for path in expected_paths:
        assert path in run_text, (wf_name, path)
    for forbidden_inline in ("gh pr create", "gh workflow run", "--force-with-lease",
                             "github-actions[bot]", "git commit -m"):
        assert forbidden_inline not in run_text, (wf_name, forbidden_inline)

jobs = ci["jobs"]
required = jobs["required"]
assert required["name"] == "CI / Required Gate" and required["if"] == "always()"
assert set(required["needs"]) == set(jobs) - {"required"}
assert "source_quality" in required["needs"]
assert "pr_identity" in jobs["source_quality"]["needs"]
assert "changes" not in jobs["source_quality"]["needs"]
assert "zero_debt" in required["needs"]
assert set(jobs["changes"]["outputs"]) == set(jobs) - {"pr_identity", "changes", "source_quality", "zero_debt", "required"}
assert "ci-impact.py" not in json.dumps(ci)
assert "test-path-filters.py" not in json.dumps(ci)
source_scan = next(step["run"] for step in jobs["source_quality"]["steps"]
                   if step.get("name") == "Scan duplicate candidates against verified PR base")
assert 'git merge-base "$BASE_SHA" "$HEAD_SHA"' in source_scan
assert "merge-base --is-ancestor" not in source_scan
assert '--baseline-from-ref "$MERGE_BASE_SHA"' in source_scan
zero_debt = jobs["zero_debt"]
assert zero_debt["name"] == "Zero-Debt Merge Gate"
assert zero_debt["runs-on"] == "ubuntu-latest"
assert zero_debt["steps"][1]["uses"] == "./.github/actions/zero-debt"
assert zero_debt["steps"][1]["with"] == {"base_sha": "${{ needs.pr_identity.outputs.base_sha }}",
                                           "head_sha": "${{ needs.pr_identity.outputs.head_sha }}"}
zero_debt_workflow = load(root / ".github/workflows/zero-debt.yml")
assert "workflow_call" in zero_debt_workflow["on"]
assert zero_debt_workflow["jobs"]["source_limits"]["steps"][1]["uses"] == "./.github/actions/zero-debt"
gate_action = load(root / ".github/actions/zero-debt/action.yml")
gate_steps = gate_action["runs"]["steps"]
scanner_self_test = next(step for step in gate_steps if step.get("name") == "Validate candidate strict scanner and policy")
assert scanner_self_test["run"] == "python3 scripts/ci/test-source-lines.py"
merge_candidate = next(step for step in gate_steps if step.get("name") == "Build the merge candidate tree")
assert merge_candidate["id"] == "merge_candidate"
merge_run = merge_candidate["run"]
assert 'git merge-tree --write-tree "$BASE_SHA" "$HEAD_SHA"' in merge_run
assert 'commit-tree "$merge_tree" -p "$BASE_SHA" -p "$HEAD_SHA"' in merge_run
assert '"$GITHUB_OUTPUT"' in merge_run
assert "steps.merge_candidate.outputs.merge_sha" in json.dumps(gate_steps)
tree_scans = [step["run"] for step in gate_steps if "Scan full " in step.get("name", "")]
assert tree_scans == [
    'python3 scripts/ci/check-source-lines.py --base "$BASE_SHA" --head "$MERGE_SHA"',
    'python3 scripts/ci/check-source-lines.py --base "$BASE_SHA" --head "$HEAD_SHA"',
]
allowlist_check = next(step for step in gate_steps if step.get("name") == "Reject allowlists in merge and candidate trees")
assert "steps.merge_candidate.outcome" in allowlist_check["if"]
assert '--head "$BASE_SHA"' not in json.dumps(gate_action), \
    "the gate must judge the merge result, not require the base tree to be clean"
assert gate_steps.index(scanner_self_test) < min(i for i, step in enumerate(gate_steps) if "Scan full " in step.get("name", ""))
assert gate_steps.index(merge_candidate) < min(i for i, step in enumerate(gate_steps) if "Scan full " in step.get("name", ""))
assert max(i for i, step in enumerate(gate_steps) if "Scan full " in step.get("name", "")) < gate_steps.index(allowlist_check)
assert all(step.get("if", "").startswith("${{ always()") for step in gate_steps if "Scan full " in step.get("name", ""))
assert "scripts/ci/source-line-allowlist.txt" in json.dumps(gate_action)
assert "check-source-lines.py" not in json.dumps(jobs["changes"]), \
    "the source LOC gate must not be conditioned on affected paths"
# #738：第三方 action 一律 pin 到 immutable SHA（版本号保留在 YAML 行尾注释，parse 后不存在）。
assert re.search(r"dorny/paths-filter@[0-9a-f]{40}", json.dumps(jobs["changes"])), "paths-filter must stay SHA-pinned"
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
# D4：备份 smoke 单一 owner —— 只在 keycloak_postgres 运行，deployment 不再重复执行；
# smoke 脚本与其直接生产依赖必须路由进该 owner。
assert "bash deploy/test-keycloak-postgres-backup.sh" not in json.dumps(
    load(workflow_dir / "ci-deployment.yml"), ensure_ascii=False
), "the backup smoke must have a single owner"
kc_pg_workflow = load(workflow_dir / "ci-keycloak-postgres.yml")
assert any(
    "bash deploy/test-keycloak-postgres-backup.sh" in step.get("run", "")
    for job in kc_pg_workflow["jobs"].values()
    for step in job.get("steps", [])
), "keycloak_postgres owner must run the backup smoke"
for backup_smoke_path in ("deploy/test-keycloak-postgres-backup.sh", "deploy/tx/keycloak-postgres-backup.sh"):
    assert backup_smoke_path in filters["keycloak_postgres"], backup_smoke_path
assert affected("deploy/tx/keycloak-postgres-backup.sh") == {"keycloak_postgres"}
# smoke 测试脚本同时被 deployment 的 deploy/test-*.sh 语法门禁覆盖：允许两个 owner 的
# 输入路由，但执行 smoke 的 owner 仍然只有 keycloak_postgres（上面的单执行断言）。
assert affected("deploy/test-keycloak-postgres-backup.sh") == {"deployment", "keycloak_postgres"}
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
# The pin is also an Android runtime input (the android owner's bundle→APK chain
# consumes it; issue #828), while frontend/src/** stays frontend-only on purpose:
# the frontend owner builds the same bundle, and the release workflow re-packs on main.
assert affected("deploy/agent/source.json") == {"frontend", "android"}
assert affected("scripts/fetch-agent-wasm.sh") == {"frontend"}
assert affected("scripts/ci/run-with-network-retry.sh") == {"deployment"}
assert affected("deploy/check-production-freshness.sh") == {
    "deployment", "frontend", "komodo_controller", "komodo_periphery", "production_worker",
}
# Issue #828 routing-gap verdicts — every row verified against real test-time consumers:
# shared replay/tabular fixtures are read by frontend golden/pure tests and wotb-web
# unit tests; replay-facts feed wotb-core/wotb-web (already ai_service); settings-ci.xml
# is the maven settings of three owner workflows; name/crew data feed wotb-core and
# common/python. frontend/src/** stays out of android (see the pin note above).
assert affected("common/fixtures/replays/random-battle-example.wotbreplay") == {"frontend", "business_api"}
assert affected("common/fixtures/hall-of-fame/training-room-example.wotbreplay") == {"frontend"}
assert affected("common/fixtures/tabular/csv/x.csv") == {"frontend", "business_api"}
assert affected("common/fixtures/tournament/csv/x.csv") == {"frontend", "business_api"}
assert affected("common/fixtures/replay-facts/random-battle-example.json.gz") == {"ai_service", "business_api"}
assert affected("java/settings-ci.xml") == {"business_api", "ai_service", "keycloak"}
assert affected("common/tank-name-aliases.json") == {"business_api", "ai_service"}
# review R1 P3：crew-skills 无任何 Java 消费方（pom classpath 无此资源），只归 python
assert affected("common/crew-skills.json") == {"python"}
# review R1 P2：map-semanticizer 的 DataIntegrityTest 直接读取这两类数据，
# 单独改动必须触发 python owner（与 business_api/ai_service/frontend 共享 fan-out）
assert "python" in affected("common/map_names.json")
assert "python" in affected("common/map-semantics/rift.semantic.json")
# The two formerly manual-only stdlib suites run in the python owner now.
assert affected("map-semanticizer/tests/test_map_semanticizer.py") == {"python"}
assert affected("tools/tests/test_cleanup_hundred_wargaming_api.py") == {"python"}
python_ci = load(workflow_dir / "ci-python.yml")
python_runs = [step.get("run", "") for job in python_ci["jobs"].values() for step in job.get("steps", [])]
assert any("unittest discover -s map-semanticizer/tests" in run for run in python_runs), "map-semanticizer suite must run in CI"
assert any("unittest discover -s tools/tests" in run for run in python_runs), "tools suite must run in CI"
for owner in jobs["changes"]["outputs"]:
    caller = jobs[owner]
    assert caller["if"] == f"needs.changes.outputs.{owner} == 'true'", owner
    assert caller["uses"] == f"./.github/workflows/ci-{owner.replace('_', '-')}.yml", owner
    workflow = load(workflow_dir / f"ci-{owner.replace('_', '-')}.yml")
    assert workflow["on"].keys() == {"workflow_call"}
    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            if step.get("uses", "").startswith("actions/checkout@") and len(step.get("uses", "").split("@", 1)[1].split(" ")[0]) == 40:
                assert step.get("with", {}).get("ref") == "${{ inputs.head_sha }}", owner

# HTTP 契约检查的唯一执行责任：Frontend affected 时由 ci-frontend.yml 承担完整检查，
# Business API 的 http_contract 跳过；BA-only 或未提供输入（保守默认）时 BA 独立执行。
# 全部从真实 YAML 断言 input 类型/default、with 连接与 job 条件，不维护第二份路由实现。
ba_ci = load(workflow_dir / "ci-business-api.yml")
fe_ci = load(workflow_dir / "ci-frontend.yml")
ba_inputs = ba_ci["on"]["workflow_call"]["inputs"]
assert ba_inputs["frontend_affected"]["type"] == "boolean", ba_inputs["frontend_affected"]
assert ba_inputs["frontend_affected"]["required"] == "false", ba_inputs["frontend_affected"]
assert ba_inputs["frontend_affected"]["default"] == "false", ba_inputs["frontend_affected"]
# 条件只挂在 http_contract 上，不影响 BA 的 Maven/镜像 job。
for job_name, job in ba_ci["jobs"].items():
    if job_name == "http_contract":
        assert job["if"] == "${{ !inputs.frontend_affected }}", job.get("if")
    else:
        assert "frontend_affected" not in str(job.get("if", "")), job_name
# Both 路由：gate 显式把字符串输出比较为 boolean，base_sha/head_sha 来源不变。
ba_caller = jobs["business_api"]
assert ba_caller["with"]["frontend_affected"] == "${{ needs.changes.outputs.frontend == 'true' }}", \
    ba_caller["with"]["frontend_affected"]
assert ba_caller["with"]["base_sha"] == "${{ needs.pr_identity.outputs.base_sha }}"
assert ba_caller["with"]["head_sha"] == "${{ needs.pr_identity.outputs.head_sha }}"
assert ba_caller["if"] == "needs.changes.outputs.business_api == 'true'", "BA-only/Neither 路由不变"
fe_caller = jobs["frontend"]
assert fe_caller["if"] == "needs.changes.outputs.frontend == 'true'", "FE 路由不变"
# FE-only 覆盖补齐：Frontend job 承担完整 HTTP 检查（lint/check/fixture 各一次，
# check 不重复），runtime coverage 由既有 pnpm test 承担，不制造新重复。
fe_steps = [step.get("run", "") for step in fe_ci["jobs"]["frontend"]["steps"]]
assert sum("pnpm run api:lint" in run for run in fe_steps) == 1, fe_steps
assert sum("pnpm run api:check" in run for run in fe_steps) == 1, fe_steps
assert sum("pnpm run api:fixture" in run for run in fe_steps) == 1, fe_steps
assert any(run.strip() == "pnpm test" for run in fe_steps), fe_steps
assert fe_ci["jobs"]["frontend"]["steps"][0]["with"]["ref"] == "${{ inputs.head_sha }}", \
    "FE 检查使用同一 head_sha"
# FE 与 BA 两个执行位置都不允许 continue-on-error 式放宽。
for dedupe_workflow in (ba_ci, fe_ci, ci):
    assert "continue-on-error" not in json.dumps(dedupe_workflow), "HTTP contract dedupe must not weaken the gate"

# 浏览器门禁分片矩阵：两条最慢的真浏览器门禁各三片，标签、script 与 args 必须一致；
# 其它门禁保持独立且顺序不变。分片选择逻辑本身由
# frontend/scripts/browser-scenario-args.test.mjs 对 n=1..4 验证；这里只锁定真实 workflow。
browser_gates = fe_ci["jobs"]["browser-gates"]
assert browser_gates["runs-on"] == "ubuntu-latest"
assert browser_gates["timeout-minutes"] == "30"
assert browser_gates["strategy"]["fail-fast"] == "false"
browser_matrix = browser_gates["strategy"]["matrix"]["gate"]
sharded_gates = {
    "test:browser-interaction": "Playback/Workspace interaction",
    "test:browser-armor-mobile": "Armor viewer mobile layout",
}
for script, label_prefix in sharded_gates.items():
    entries = [gate for gate in browser_matrix if gate["script"] == script]
    assert len(entries) == 3, (script, entries)
    assert [gate["label"] for gate in entries] == [
        f"{label_prefix} ({index}/3)" for index in (1, 2, 3)
    ], entries
    assert [gate["args"] for gate in entries] == [
        f"--shard {index}/3" for index in (1, 2, 3)
    ], entries
unsharded_gates = [gate for gate in browser_matrix if gate["script"] not in sharded_gates]
assert [gate["label"] for gate in unsharded_gates] == [
    "Armor viewer aiming interaction",
    "Armor viewer spaced backside thickness",
    "Creator recommendations",
    "Map preview mobile layout",
    "Battle data spawn bar themes",
    "Showcase hero compact computed styles",
    "HoF admin sticky tabs",
    "Replay3D HUD segmented control",
], unsharded_gates
assert [gate["script"] for gate in unsharded_gates] == [
    "test:browser-armor-aiming",
    "test:browser-armor-spaced-backside",
    "test:browser-creators",
    "test:browser-map-preview",
    "test:browser-battle-data",
    "test:browser-showcase-hero",
    "test:browser-hof-admin-tabs",
    "test:browser-replay3d-hud",
], unsharded_gates
assert all("args" not in gate for gate in unsharded_gates), unsharded_gates
assert len(browser_matrix) == 14, browser_matrix

# R2：对真实 Required Gate 聚合逻辑（ci-gate.yml 内嵌 Python）做失败传播测试，
# 断言具体失败原因，而不是只断言任意非零退出。
import subprocess

required_run = next(
    step.get("run", "") for step in jobs["required"]["steps"]
    if step.get("name") == "Aggregate affected owner results"
)
gate_py = required_run.split("python3 - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]

def run_gate(affected_owners, owner_results, identity_result="success", source_quality_result="success",
             zero_debt_result="success"):
    # 真实聚合逻辑会读取 changes.outputs 里的每个 owner 的 needs[owner]，
    # 所以 payload 必须覆盖全部 owner（未显式给出的按 skipped 处理）。
    payload = {"pr_identity": {"result": identity_result},
               "source_quality": {"result": source_quality_result},
               "zero_debt": {"result": zero_debt_result},
               "changes": {"result": "success",
                           "outputs": {owner: ("true" if owner in affected_owners else "false")
                                       for owner in owner_names}}}
    for owner in owner_names:
        payload[owner] = {"result": owner_results.get(owner, "skipped")}
    script = ("import json,os\nos.environ['NEEDS_JSON']=" + repr(json.dumps(payload)) + "\n"
              + gate_py)
    return subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=False)

owner_names = sorted(jobs["changes"]["outputs"])
r = run_gate({"frontend", "business_api"}, {"frontend": "failure", "business_api": "skipped"})
assert r.returncode != 0 and "frontend: affected=true, result=failure" in r.stderr, r.stderr
r = run_gate({"frontend", "business_api"}, {"frontend": "cancelled", "business_api": "skipped"})
assert r.returncode != 0 and "result=cancelled" in r.stderr, r.stderr
# FE 意外 skipped（此时 BA http_contract 也被跳过，整组 HTTP 检查没有执行位置）必须失败。
r = run_gate({"frontend", "business_api"}, {"frontend": "skipped", "business_api": "skipped"})
assert r.returncode != 0 and "result=skipped" in r.stderr, r.stderr
r = run_gate({"frontend", "business_api"},
             {owner: ("success" if owner in ("frontend", "business_api") else "skipped")
              for owner in owner_names})
assert r.returncode == 0, r.stderr
r = run_gate({"business_api"}, {"business_api": "failure"})
assert r.returncode != 0 and "business_api: affected=true, result=failure" in r.stderr, r.stderr
r = run_gate({"frontend"}, {"frontend": "success"})
assert r.returncode == 0, r.stderr
r = run_gate(set(), {owner: "skipped" for owner in owner_names})
assert r.returncode == 0, r.stderr
# identity 失败保持失败。
r = run_gate({"frontend"}, {"frontend": "success"}, identity_result="failure")
assert r.returncode != 0 and "PR identity, source quality, or changed-file detection failed" in r.stderr, r.stderr
r = run_gate({"frontend"}, {"frontend": "success"}, source_quality_result="failure")
assert r.returncode != 0 and "source quality" in r.stderr, r.stderr
r = run_gate({"frontend"}, {"frontend": "success"}, zero_debt_result="failure")
assert r.returncode != 0 and "source quality" in r.stderr, r.stderr
# Issue #738 review R2：CodeQL workflow 的 init 输入名与排除路径必须受 PR 契约保护
#（CodeQL 不由 PR 触发——输入名写错时实际扫描不会发现，只能靠这里阻断回归）。
codeql_wf = load(workflow_dir / "codeql.yml")
codeql_init = next(
    step for job in codeql_wf["jobs"].values() for step in job.get("steps", [])
    if str(step.get("uses", "")).startswith("github/codeql-action/init@")
)
codeql_init_with = codeql_init.get("with", {})
assert "config" in codeql_init_with, "codeql init must use `config` (not `configs`)"
assert "configs" not in codeql_init_with, "codeql init must NOT use `configs` (unsupported input)"
codeql_config_text = codeql_init_with["config"]
# review R2 P2-2：子串检查不够——必须解析内嵌 YAML，验证 paths-ignore 是包含
# 四项预期 glob 的列表；注释中放路径、paths-ignore 误写成 paths、或 YAML 语法
# 无效时都必须 fail。
codeql_paths_ignore = yaml.safe_load(codeql_config_text).get("paths-ignore", [])
assert isinstance(codeql_paths_ignore, list), "codeql paths-ignore must be a list"
for excluded in ("frontend/dist/**", "contracts/http/generated/**",
                 "frontend/src/api/generated/**",
                 "java/wotb-web/src/test/resources/archfixture/**"):
    assert excluded in codeql_paths_ignore, f"codeql paths-ignore missing {excluded}"
# review R2 P2-1：codeql.yml 变更必须触发 deployment owner（否则仅改 CodeQL 文件时契约不执行）
assert affected(".github/workflows/codeql.yml") == {"deployment"}, (
    "codeql.yml must route to deployment (and only deployment)")

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
    "deploy/tx/runtime-business-probes.sh",
    "deploy/tx/deploy.sh",
    "deploy/tx/deploy-stage.sh",
    "deploy/tx/deploy-health.sh",
    "deploy/tx/with-deploy-lock.sh",
]
tx_runtime_job = tx_runtime["jobs"]["runtime_check"]
assert tx_runtime_job["name"] == "TX_RUNTIME_READY"
tx_runtime_steps = tx_runtime_job["steps"]
tx_runtime_checkout = next(step for step in tx_runtime_steps
                           if step.get("uses", "").startswith("actions/checkout@")
                           and len(step.get("uses", "").split("@", 1)[1].split(" ")[0]) == 40)
assert tx_runtime_checkout["with"]["ref"] == "${{ github.sha }}"
assert tx_runtime_checkout["with"]["fetch-depth"] == "0"
tx_runtime_freshness = [
    step for step in tx_runtime_steps
    if "deploy/check-production-freshness.sh" in step.get("run", "")
]
assert len(tx_runtime_freshness) == 2
assert all(step.get("env", {}).get("EVENT_SHA") == "${{ github.sha }}" for step in tx_runtime_freshness)

tx_runtime_stage = next(step for step in tx_runtime_steps if step.get("name") == "Stage exact-SHA verifier bundle")
assert re.search(r"appleboy/scp-action@[0-9a-f]{40}", tx_runtime_stage["uses"]), "scp-action must stay SHA-pinned"
assert tx_runtime_stage["with"]["source"] == (
    "deploy/tx/runtime-check.sh,deploy/tx/runtime-check-lib.sh,deploy/tx/runtime-business-probes.sh,"
    "deploy/tx/deploy.sh,deploy/tx/deploy-stage.sh,deploy/tx/deploy-health.sh,deploy/tx/with-deploy-lock.sh"
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
assert re.search(r"appleboy/ssh-action@[0-9a-f]{40}", tx_runtime_cleanup["uses"]), "ssh-action must stay SHA-pinned"
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

import subprocess
subprocess.run([sys.executable, str(root / "scripts/ci/test-android-workflow-contract.py"), str(root)], check=True)

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
# 常规 CI 只允许普通 fast-forward push；历史分叉必须交给人工恢复。
assert "--force" not in sync_script
assert '"+$SOURCE_SHA:refs/heads/main"' not in sync_script
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
    assert release_step == "bash deploy/periphery/read-release.sh", release_step
    release_script = Path("deploy/periphery/read-release.sh").read_text()
    assert "deploy/periphery/periphery.release" in release_script
    assert "PERIPHERY_SHA256" in release_script and "PERIPHERY_URL" in release_script
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

exec(compile((root / "scripts/ci/test-workflow-contract-extra.py").read_text(encoding="utf-8"), "scripts/ci/test-workflow-contract-extra.py", "exec"))
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

# ---------------------------------------------------------------------------
# D3 helper behavior suite: scripts/ci/publish-data-update.sh
# Isolated fixtures only — a throwaway bare remote + work repo, and a fake `gh`
# on PATH. No real GitHub access, no real publishing target is ever touched.
# ---------------------------------------------------------------------------
helper_behavior_main() {
  HELPER="$ROOT/scripts/ci/publish-data-update.sh"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  FAKEBIN="$TMP/bin"; mkdir -p "$FAKEBIN"
  REAL_GIT="$(command -v git)"
  GH_LOG="$TMP/gh.log"; GIT_LOG="$TMP/git.log"; : > "$GH_LOG"; : > "$GIT_LOG"

  cat > "$FAKEBIN/git" <<EOF
#!/usr/bin/env bash
printf '%s\n' "git \$*" >> "$GIT_LOG"
exec "$REAL_GIT" "\$@"
EOF
  FAKE_CREATED="$TMP/fake-created"; export FAKE_CREATED
  cat > "$FAKEBIN/gh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "gh \$*" >> "$GH_LOG"
case "\$1 \$2" in
  "pr list")
    # FAKE_LIST_OUTPUT 覆盖模拟真实 gh --jq 的裸数字输出；默认路径模拟 JSON 形态。
    if [[ -n "\${FAKE_LIST_OUTPUT+x}" ]]; then
      printf '%s\n' "\$FAKE_LIST_OUTPUT"
    elif [[ -f "$FAKE_CREATED" ]]; then
      printf '[{"number":%s}]\n' "\${FAKE_NEW_PR_NUMBER-1}"
    else
      printf '%s\n' "\${FAKE_PR_LIST:-[]}"
    fi
    exit 0 ;;
  "pr create")
    if [[ -n "\${FAKE_CREATE_EXIT:-}" && "\$FAKE_CREATE_EXIT" != "0" ]]; then
      echo "create failed (fixture)" >&2; exit "\$FAKE_CREATE_EXIT"
    fi
    : > "$FAKE_CREATED"
    exit 0 ;;
  "pr view")
    head="\${FAKE_VIEW_HEAD_OVERRIDE:-\$(git -C "\$TEST_REPO" rev-parse HEAD)}"
    printf '{"state":"%s","baseRefName":"%s","headRefName":"%s","headRefOid":"%s"}\n' \
      "\${FAKE_VIEW_STATE:-OPEN}" "\${FAKE_VIEW_BASE:-main}" "\${FAKE_VIEW_BRANCH:-\${FAKE_EXPECT_BRANCH}}" "\$head"
    exit 0 ;;
  "workflow run") exit 0 ;;
  *) echo "unexpected gh call: \$*" >&2; exit 99 ;;
esac
EOF
  chmod +x "$FAKEBIN/git" "$FAKEBIN/gh"
  export PATH="$FAKEBIN:$PATH"

  PASS=0; FAIL=0
  HELPER_ERR="$TMP/helper.err"; : > "$HELPER_ERR"
  ok() { PASS=$((PASS+1)); echo "helper behavior PASS: $1"; }
  bad() {
    FAIL=$((FAIL+1)); echo "helper behavior FAIL: $1"
    if [ -s "$HELPER_ERR" ]; then
      sed 's/^/  helper stderr| /' "$HELPER_ERR" | tail -8
    fi
    if [ -d "$TMP/repo/.git" ]; then
      git -C "$TMP/repo" log --oneline -1 2>&1 | sed 's/^/  repo head| /'
      git -C "$TMP/repo" status --porcelain 2>&1 | sed 's/^/  repo status| /' | head -5
    fi
  }

  expect_fail() { # description, then command...
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then bad "$desc (expected failure, got success)"; else ok "$desc"; fi
  }

  setup_repo() {
    rm -rf "$TMP/repo" "$TMP/remote.git"
    rm -f "$FAKE_CREATED"
    git init -q --bare -b main "$TMP/remote.git"
    git init -q -b main "$TMP/repo"
    (
      cd "$TMP/repo"
      git config user.name tester && git config user.email tester@example.com
      git remote add origin "$TMP/remote.git"
      mkdir -p common
      printf 'v1\n' > common/crew-skills.json
      printf 'v1\n' > common/tank_ids.json
      printf 'v1\n' > common/tankopedia-tier1.json
      git add common/crew-skills.json common/tank_ids.json common/tankopedia-tier1.json
      git commit -qm init
      git push -q origin main
    )
    TEST_REPO="$TMP/repo"; export TEST_REPO
  }

  BODY="$TMP/body.md"; printf 'body\n' > "$BODY"

  run_in_repo() { (cd "$TMP/repo" && bash "$HELPER" "$@") 2>"$HELPER_ERR"; }

  # 1. crew-skills normal path: new branch, force-with-lease, create PR, dispatch exact HEAD.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  : > "$GIT_LOG"; : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message "chore(data): sync BlitzKit crew skills" \
    --pr-title "chore(data): sync BlitzKit crew skills" \
    --pr-body-file "$BODY" \
    --path common/crew-skills.json >/dev/null 2>&1 \
    && ok "normal path exits 0" || bad "normal path exits 0"
  git -C "$TMP/repo" rev-parse -q --verify automation/update-crew-skills >/dev/null \
    && ok "normal path created automation branch" || bad "normal path created automation branch"
  grep -q -- "--force-with-lease" "$GIT_LOG" \
    && ok "normal path pushes with --force-with-lease" || bad "normal path pushes with --force-with-lease"
  grep -q "gh pr create" "$GH_LOG" && ok "normal path creates PR" || bad "normal path creates PR"
  head_sha="$(git -C "$TMP/repo" rev-parse HEAD)"
  grep -q "head_sha=$head_sha" "$GH_LOG" \
    && ok "dispatch carries the generated commit HEAD" || bad "dispatch carries the generated commit HEAD"
  grep -q "pr_number=" "$GH_LOG" && ok "dispatch carries pr_number" || bad "dispatch carries pr_number"
  commit_files="$(git -C "$TMP/repo" show --name-only --format= HEAD)"
  [ "$commit_files" = "common/crew-skills.json" ] \
    && ok "commit contains only the whitelisted path" || bad "commit contains only the whitelisted path (got: $commit_files)"

  # 2. no changes: no commit, no push, no PR, no dispatch.
  setup_repo; : > "$GIT_LOG"; : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && ok "unchanged paths exit 0" || bad "unchanged paths exit 0"
  if grep -q "git push" "$GIT_LOG" || grep -q "pr create" "$GH_LOG" || grep -q "workflow run" "$GH_LOG"; then
    bad "unchanged paths must not push/create/dispatch"
  else
    ok "unchanged paths must not push/create/dispatch"
  fi

  # 3. existing PR（真实 gh --jq 的裸数字输出形态）: no create, dispatch with that number.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills FAKE_LIST_OUTPUT=7 run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && ok "existing-PR path exits 0" || bad "existing-PR path exits 0"
  grep -q "gh pr create" "$GH_LOG" && bad "existing-PR path must not create a PR" || ok "existing-PR path must not create a PR"
  grep -q "pr_number=7" "$GH_LOG" && ok "existing-PR path dispatches pr_number=7" || bad "existing-PR path dispatches pr_number=7"

  # 4. unresolvable PR number (create ok but list stays empty): fail, no dispatch.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  : > "$GH_LOG"
  export FAKE_NEW_PR_NUMBER=
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "unresolvable PR number must fail" || ok "unresolvable PR number must fail"
  grep -q "workflow run" "$GH_LOG" && bad "unresolvable PR number must not dispatch" || ok "unresolvable PR number must not dispatch"
  unset FAKE_NEW_PR_NUMBER

  # 5. wrong state / base / branch / head OID: fail, no dispatch.
  mismatch_names=(FAKE_VIEW_STATE FAKE_VIEW_BASE FAKE_VIEW_BRANCH FAKE_VIEW_HEAD_OVERRIDE)
  mismatch_vals=(MERGED develop automation/update-equipment 0000000000000000000000000000000000000000)
  for i in 0 1 2 3; do
    export "${mismatch_names[$i]}=${mismatch_vals[$i]}"
    setup_repo
    printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
    : > "$GH_LOG"
    FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
      --branch automation/update-crew-skills \
      --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
      && bad "PR identity mismatch (${mismatch_names[$i]}) must fail" || ok "PR identity mismatch (${mismatch_names[$i]}) must fail"
    grep -q "workflow run" "$GH_LOG" \
      && bad "PR identity mismatch (${mismatch_names[$i]}) must not dispatch" || ok "PR identity mismatch (${mismatch_names[$i]}) must not dispatch"
    unset "${mismatch_names[$i]}"
  done

  # 6. gh pr create failure: fail, no dispatch.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills FAKE_CREATE_EXIT=1 run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "gh create failure must fail the helper" || ok "gh create failure must fail the helper"
  grep -q "workflow run" "$GH_LOG" && bad "gh create failure must not dispatch" || ok "gh create failure must not dispatch"

  # 6b. git push failure: fail.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP/remote.git/hooks/pre-receive"
  chmod +x "$TMP/remote.git/hooks/pre-receive"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "git push failure must fail the helper" || ok "git push failure must fail the helper"
  rm -f "$TMP/remote.git/hooks/pre-receive"

  # 7. Tankopedia same-source path: no branch switch, plain push (no force flag).
  setup_repo
  git -C "$TMP/repo" switch -qC automation/update-tankopedia
  printf 'v2\n' > "$TMP/repo/common/tank_ids.json"
  : > "$GIT_LOG"
  FAKE_EXPECT_BRANCH=automation/update-tankopedia run_in_repo \
    --branch automation/update-tankopedia --source-ref automation/update-tankopedia \
    --commit-message "chore(data): sync BlitzKit Tankopedia" --pr-title t --pr-body-file "$BODY" \
    --path 'common/tankopedia-tier*.json' --path common/tank_ids.json >/dev/null 2>&1 \
    && ok "same-source path exits 0" || bad "same-source path exits 0"
  grep -q "git switch" "$GIT_LOG" && bad "same-source path must not switch branches" || ok "same-source path must not switch branches"
  grep -q -- "--force-with-lease" "$GIT_LOG" \
    && bad "same-source path keeps the plain push" || ok "same-source path keeps the plain push"

  # 8. Tankopedia different-source path: switch -C + force-with-lease.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/tank_ids.json"
  : > "$GIT_LOG"
  FAKE_EXPECT_BRANCH=automation/update-tankopedia run_in_repo \
    --branch automation/update-tankopedia --source-ref main \
    --commit-message "chore(data): sync BlitzKit Tankopedia" --pr-title t --pr-body-file "$BODY" \
    --path 'common/tankopedia-tier*.json' --path common/tank_ids.json >/dev/null 2>&1 \
    && ok "different-source path exits 0" || bad "different-source path exits 0"
  grep -q "git switch -C automation/update-tankopedia" "$GIT_LOG" \
    && ok "different-source path switches to the automation branch" || bad "different-source path switches to the automation branch"
  grep -q -- "--force-with-lease" "$GIT_LOG" \
    && ok "different-source path pushes with --force-with-lease" || bad "different-source path pushes with --force-with-lease"

  # 9. unexpected staged content: refuse, no commit, no push, no PR.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  printf 'x\n' > "$TMP/repo/other.txt"
  git -C "$TMP/repo" add other.txt
  : > "$GIT_LOG"; : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "unexpected staged content must be refused" || ok "unexpected staged content must be refused"
  grep -q "git commit" "$GIT_LOG" && bad "unexpected staged content must not commit" || ok "unexpected staged content must not commit"
  grep -q "git push" "$GIT_LOG" && bad "unexpected staged content must not push" || ok "unexpected staged content must not push"

  # 10. shell metacharacters in arguments stay data, never execute.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  rm -f "$TMP/pwned"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message "msg with 'quotes' and \$(touch $TMP/pwned) and \"dq\"" \
    --pr-title "title with 'quotes'" --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && ok "metacharacter args path exits 0" || bad "metacharacter args path exits 0"
  [ ! -e "$TMP/pwned" ] && ok "metacharacters were not executed" || bad "metacharacters were not executed"
  commit_subject="$(git -C "$TMP/repo" log -1 --format=%s)"
  [ "$commit_subject" = "msg with 'quotes' and \$(touch $TMP/pwned) and \"dq\"" ] \
    && ok "commit message preserved literally" || bad "commit message preserved literally (got: $commit_subject)"

  # 11. non-allowlist branch is rejected outright.
  setup_repo
  run_in_repo --branch main \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "non-allowlist branch must be rejected" || ok "non-allowlist branch must be rejected"

  echo "helper behavior suite: PASS=$PASS FAIL=$FAIL"
  [ "$FAIL" -eq 0 ] || exit 1
}
helper_behavior_main

# Agent WASM 下载器故障注入测试（本地 HTTP fixture，不访问上游）。
python3 "$ROOT/scripts/ci/test-fetch-agent-wasm.py"
