#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import json
import fnmatch
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
assert affected("infra/tofu/minio/main.tf") == {"minio"}
assert affected("deploy/tx/business-postgres.compose.yml") == {"business_postgres"}
assert affected("docs/README.md") == set()
assert affected("frontend/src/platform/nativeBridgeContract.js") == {"frontend", "android"}
assert affected("deploy/list-image-tags.sh") == {"business_api", "deployment"}
assert affected("deploy/tx/validate-caddy-config.sh") == {"caddy", "deployment"}
# Frontend production builds now publish from TX through the Gitee exact-SHA builder.
# The GitHub-runner registry-list/retry helpers are no longer frontend-owned inputs;
# the Agent WASM pin/fetch contract and freshness gate remain production inputs.
assert affected("deploy/agent/source.json") == {"frontend"}
assert affected("scripts/fetch-agent-wasm.sh") == {"frontend"}
assert affected("scripts/ci/run-with-network-retry.sh") == {"deployment"}
assert affected("deploy/check-production-freshness.sh") == {"deployment", "frontend"}
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

for owner in ("keycloak", "rabbitmq", "business-postgres", "keycloak-postgres", "minio", "observability"):
    tofu = load(workflow_dir / f"ci-{owner}.yml")["jobs"]["tofu_plans"]
    tofu_text = json.dumps(tofu, ensure_ascii=False)
    assert "tofu fmt -check -recursive" in tofu_text
    assert "tofu init -backend=false -input=false" in tofu_text
    assert "tofu validate" in tofu_text
    assert "tofu apply" not in tofu_text and "secrets." not in tofu_text

backup = load(workflow_dir / "database-backup.yml")
assert backup["concurrency"] == {
    "group": "production-maintenance", "cancel-in-progress": "false", "queue": "max",
}
backup_text = json.dumps(backup, ensure_ascii=False)
for script in ("business-postgres-backup.sh", "keycloak-postgres-backup.sh", "tofu-local-state-backup.sh"):
    assert script in backup_text, f"scheduled production backup must retain {script}"

# Production owner routing and freshness inputs are paired contracts. A workflow
# may only proceed when its triggering SHA is still current for every owned input.
owners = (
    "business-api", "frontend", "keycloak", "parser-worker", "minio", "caddy",
    "rabbitmq", "business-postgres", "keycloak-postgres", "observability", "alloy-tx",
)
pr_owner_for_production = {
    "business-api": "business_api",
    "frontend": "frontend",
    "keycloak": "keycloak",
    "parser-worker": "parser_worker",
    "minio": "minio",
    "caddy": "caddy",
    "rabbitmq": "rabbitmq",
    "business-postgres": "business_postgres",
    "keycloak-postgres": "keycloak_postgres",
    "observability": "observability",
    "alloy-tx": "alloy_tx",
}
assert set(pr_owner_for_production) == set(owners)
image_owners = {"business-api", "frontend", "keycloak", "parser-worker", "minio"}
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
    assert mirror_step["with"]["force_update"] == "false", owner
    assert workflow["jobs"]["build"]["concurrency"] == {
        "group": "tx-production-build", "cancel-in-progress": "false", "queue": "max",
    }, owner
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
