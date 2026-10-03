#!/usr/bin/env bash
# TX-local postgres-keycloak OpenTofu contract.
#
# Responsibility split (do not duplicate the other layers here):
#   tofu fmt / tofu validate / plan  -> syntax, schema and provider-legal fields
#   infra/tofu/postgres-keycloak/validate-plan.sh -> destructive plan policy
#   deploy/test-keycloak-tofu.sh     -> real apply + Admin API runtime smoke
# This file pins what native tooling considers valid but would still break the
# project's privilege boundary or production safety, plus the saved-plan policy
# fixtures for the root's own plan guard.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$ROOT" <<'PY'
import copy
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/postgres-keycloak"
workflow_text = (root / ".github/workflows/keycloak-postgres.yml").read_text(encoding="utf-8")
ci_text = (root / ".github/workflows/ci-keycloak-postgres.yml").read_text(encoding="utf-8")
root_text = "\n".join(path.read_text(encoding="utf-8") for path in tofu_root.glob("*.tf"))
workflow = yaml.load(workflow_text, Loader=yaml.BaseLoader)
ci = yaml.load(ci_text, Loader=yaml.BaseLoader)


def flat(text):
    return re.sub(r"\s+", " ", text)


# --- the isolated root applies only on TX localhost -------------------------
assert "tofu apply" not in str(ci["jobs"]["tofu_plans"])
assert "remote-exec" not in root_text

# --- only the main-only owner applies on TX under the shared queue -----------
expected_concurrency = {"group": "production-maintenance", "cancel-in-progress": "false", "queue": "max"}
assert workflow["concurrency"] == expected_concurrency
events = workflow.get("on", workflow.get(True, {}))
assert events["push"]["branches"] == ["main"]
assert "infra/tofu/postgres-keycloak/**" in events["push"]["paths"]
assert "workflow_dispatch" in events
owner_job = workflow["jobs"]["keycloak_postgres"]
freeze_step = next(step for step in owner_job["steps"] if step.get("name") == "Freeze current main")
freeze_script = freeze_step["run"]
assert '[[ "$EVENT_REF" == refs/heads/main ]]' in freeze_script
assert '"$(git rev-parse HEAD)" == "$SOURCE_SHA"' in freeze_script
assert '[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]' in freeze_script
assert "deploy/check-production-freshness.sh" in freeze_script
assert freeze_step["env"]["EVENT_SHA"] == "${{ github.sha }}"
pre_mutation = next(step for step in owner_job["steps"]
                    if step.get("name") == "Reject stale main before TX mutation")
assert "deploy/check-production-freshness.sh" in pre_mutation["run"]
assert pre_mutation["env"]["EVENT_SHA"] == "${{ github.sha }}"

# --- mirror-only fail-closed before tofu starts -----------------------------
apply_script = next(
    step
    for step in owner_job["steps"]
    if step.get("name") == "Reconcile runtime, apply exact Keycloak PostgreSQL plan, and verify"
)["with"]["script"]
assert "test -f /opt/wotb-tx/tofurc" in apply_script
assert "export TF_CLI_CONFIG_FILE=/opt/wotb-tx/tofurc" in apply_script
assert "flock -n 9" in apply_script
assert '"$WOTB_DEPLOY_CONFIG_SHA" == "$SOURCE_SHA"' in apply_script
assert "trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT" in apply_script
assert "tofu plan -input=false -no-color -out=plan.tfplan" in apply_script
assert "bash ./validate-plan.sh plan.tfplan" in apply_script
assert "tofu apply -input=false -auto-approve plan.tfplan" in apply_script
assert "tofu plan -input=false -no-color -out=second-plan.tfplan" in apply_script
assert "second-plan.tfplan" in apply_script
normalized_apply_script = re.sub(r"\s+", " ", apply_script)
assert 'if ! jq -e \'type == "object" and (.resource_changes | type == "array") and all(.resource_changes[]; ((.change.actions // []) == ["no-op"]))\'' in normalized_apply_script, \
    "malformed or non-no-op second plans must fail closed"
assert "Keycloak PostgreSQL second plan is malformed or not clean." in apply_script

# --- the standalone owner gates service exposure before live mutation --------
validator_path = "deploy/tx/runtime-check-lib.sh"
assert validator_path in events["push"]["paths"]
assert validator_path in workflow["env"]["PRODUCTION_INPUT_PATHS"].splitlines()
stage_step = next(step for step in owner_job["steps"] if "appleboy/scp-action" in step.get("uses", ""))
assert validator_path in stage_step["with"]["source"].split(",")
assert stage_step["with"]["target"].endswith("/${{ steps.source.outputs.source_sha }}")
assert 'validator="$stage/deploy/tx/runtime-check-lib.sh"' in apply_script
assert 'test -f "$validator"' in apply_script

def position(pattern):
    match = re.search(pattern, apply_script, re.MULTILINE)
    assert match, f"missing production safety command: {pattern}"
    return match.start()

lock = position(r"^\s*flock -n 9\b")
link = position(r"^\s*ip link show wg0\b")
address = position(r"^\s*ip -4 addr show dev wg0\s*\|")
route = position(r"^\s*ip route get 10\.20\.0\.2\b")
source = position(r'^\s*source "\$validator"')
render = position(r'^\s*compose_json="')
bindings = position(r'^\s*assert_tx_service_ports keycloak-postgres\s*<<<\s*"\$compose_json"')
identity = position(r"^\s*jq -e '")
install = position(r'^\s*install -m 600 "\$compose"')
replace = position(r'^\s*mv -f -- "\$live_compose')
recreate = position(r'^\s*docker compose .*\bup -d\b')
assert lock < link < address < route < source < render < bindings < identity < install < replace < recreate
assert "set -Eeuo pipefail" in apply_script
for command in ("docker", "python3", "ip"):
    assert f"command -v {command}" in apply_script
assert "docker compose version" in apply_script
assert "inet 10\\.20\\.0\\.1/24([[:space:]]|$)" in apply_script
assert "wg0 must have 10.20.0.1/24." in apply_script
assert "live runtime was not changed." in apply_script

# Native Bash checks the extracted SSH body rather than the YAML wrapper.
subprocess.run(["bash", "-n"], input=apply_script, text=True, check=True)

# Execute the real owner body through its last pre-mutation guard. Native
# Compose supplies the baseline; only host commands are isolated fixtures.
render_env = dict(os.environ, KC_POSTGRES_ADMIN_USER="ci", KC_POSTGRES_ADMIN_PASSWORD="ci")
rendered = subprocess.run(
    ["docker", "compose", "-p", "deploy", "-f", str(root / "deploy/tx/keycloak-postgres.compose.yml"),
     "config", "--format", "json"],
    env=render_env, text=True, capture_output=True, check=True,
).stdout
baseline = json.loads(rendered)
with tempfile.TemporaryDirectory(prefix="keycloak-postgres-owner-") as work:
    host = Path(work) / "host"
    sha = "a" * 40
    staged = host / "tofu.incoming" / sha
    (staged / "infra/tofu/postgres-keycloak").mkdir(parents=True)
    tx = staged / "deploy/tx"
    tx.mkdir(parents=True)
    (tx / "keycloak-postgres.compose.yml").write_text("# staged fixture\n")
    (tx / "runtime-check-lib.sh").write_text((root / validator_path).read_text(encoding="utf-8"))
    state = host / "postgres-keycloak-tofu-state"
    state.mkdir()
    (state / "terraform.tfstate").write_text("{}\n")
    (state / "bootstrap-complete").write_text("local-tofu-state-bootstrap-v1\n")
    (host / "tofurc").write_text("# unused before mutation\n")
    bin_dir = Path(work) / "bin"
    bin_dir.mkdir()
    stubs = {
        "docker": '''#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "compose version") exit 0 ;;
  *"config --format json") cat "$FIXTURE_COMPOSE_JSON" ;;
  *"volume inspect --format"*".project"*) echo deploy ;;
  *"volume inspect --format"*".volume"*) echo keycloak_postgres_data ;;
  "volume inspect "*|"network inspect "*) exit 0 ;;
  *"ps -aq keycloak-postgres") echo existing-container ;;
  "inspect --format "*) echo deploy_keycloak_postgres_data ;;
  *) echo "unexpected docker call: $*" >&2; exit 99 ;;
esac
''',
        "ip": '''#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "link show wg0") [ "${FIXTURE_WG_MISSING:-0}" = 0 ] ;;
  "-4 addr show dev wg0") printf 'inet %s scope global wg0\\n' "${FIXTURE_WG_ADDRESS:-10.20.0.1/24}" ;;
  "route get 10.20.0.2") [ "${FIXTURE_ROUTE_MISSING:-0}" = 0 ] ;;
  *) exit 99 ;;
esac
''',
        "tofu": "#!/usr/bin/env bash\nexit 99\n",
    }
    for name, content in stubs.items():
        path = bin_dir / name
        path.write_text(content)
        path.chmod(0o700)
    config = Path(work) / "compose.json"
    env = dict(render_env, PATH=f"{bin_dir}:{os.environ['PATH']}", SOURCE_SHA=sha,
               WOTB_DEPLOY_CONFIG_SHA=sha, KC_DB_PASSWORD="ci", KC_DB_PASSWORD_VERSION="1",
               FIXTURE_COMPOSE_JSON=str(config))
    # Static ordering above ties this prefix to install/mv/up in the full body.
    prefix = apply_script[:apply_script.index("live_compose=")]
    prefix = prefix.replace("/opt/wotb-tx", str(host)) + "\necho PRE_MUTATION_GATES_PASSED\n"
    def run(data, **overrides):
        config.write_text(json.dumps(data))
        return subprocess.run(["bash", "-c", prefix], env=dict(env, **overrides),
                              text=True, capture_output=True)
    result = run(baseline)
    assert result.returncode == 0 and "PRE_MUTATION_GATES_PASSED" in result.stdout, result.stderr
    for overrides in (
        {"FIXTURE_WG_MISSING": "1"}, {"FIXTURE_WG_ADDRESS": "10.20.0.9/24"},
        {"FIXTURE_WG_ADDRESS": "10.20.0.1/32"}, {"FIXTURE_ROUTE_MISSING": "1"},
    ):
        result = run(baseline, **overrides)
        assert result.returncode != 0 and "PRE_MUTATION_GATES_PASSED" not in result.stdout, overrides
    for index, port in enumerate(baseline["services"]["keycloak-postgres"]["ports"]):
        for field, value in (
            ("host_ip", "0.0.0.0"), ("host_ip", "::"), ("host_ip", "203.0.113.10"),
            ("host_ip", "10.20.0.9"), ("published", "5432"), ("target", 1),
            ("protocol", "udp"), ("remove", None), ("duplicate", None),
        ):
            data = copy.deepcopy(baseline)
            ports = data["services"]["keycloak-postgres"]["ports"]
            if field == "remove":
                ports.pop(index)
            elif field == "duplicate":
                ports.append(copy.deepcopy(port))
            else:
                ports[index][field] = value
            result = run(data)
            assert result.returncode != 0 and "PRE_MUTATION_GATES_PASSED" not in result.stdout, (index, field)
print("Keycloak PostgreSQL owner WG/binding guards precede live mutation: PASS")

# --- CI selects this root for PR fmt/init/validate ---------------------------
assert "tofu_plans" in ci["jobs"]
assert "infra/tofu/postgres-keycloak" in ci_text

# --- secrets arrive as ordinary runtime names, are never printed, and are
# --- never materialized into tfvars or a server env file -------------------
apply_step = next(step for step in owner_job["steps"]
                  if step.get("name") == "Reconcile runtime, apply exact Keycloak PostgreSQL plan, and verify")
assert "appleboy/ssh-action@v1" in apply_step["uses"]
assert "TF_VAR_" not in apply_step["with"]["envs"], "SSH envs must carry runtime names, not TF_VAR names"
assert apply_step["env"]["KC_POSTGRES_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_POSTGRES_ADMIN_PASSWORD }}"
assert apply_step["env"]["KC_DB_PASSWORD"] == "${{ secrets.TX_KC_DB_PASSWORD }}"
for secret_name in ("KC_POSTGRES_ADMIN_PASSWORD", "KC_DB_PASSWORD"):
    assert not any(
        secret_name in line for line in apply_script.splitlines() if "echo" in line or "printf" in line
    ), f"OpenTofu SSH script must not print {secret_name}"
assert "tfvars" not in workflow_text.lower()
for forbidden in ("TX_RUNTIME_ENV_FILE", "postgres-keycloak-tofu.env"):
    assert forbidden not in workflow_text, forbidden

# --- provider and state ownership boundaries ---------------------------------
assert 'source  = "cyrilgdn/postgresql"' in root_text
assert 'version = "1.27.0"' in root_text
assert 'backend "local"' in root_text
assert 'path = "/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate"' in root_text
assert 'state_dir=/opt/wotb-tx/postgres-keycloak-tofu-state' in apply_script
assert "password_wo" in root_text
for kind, resource_name in (
    ("postgresql_role", "keycloak"),
    ("postgresql_database", "keycloak"),
    ("postgresql_grant", "keycloak_database_access"),
):
    marker = f'resource "{kind}" "{resource_name}"'
    assert marker in root_text, marker
    assert "prevent_destroy = true" in flat(root_text.split(marker, 1)[1].split("\n}\n", 1)[0]), resource_name

# --- the database is reachable only on the TX loopback port -----------------
assert 'var.postgresql_host == "127.0.0.1"' in root_text
assert "var.postgresql_port == 15432" in root_text

print("TX-local postgres-keycloak OpenTofu contract OK")
PY

mkdir -p "$WORK/bin"
cat > "$WORK/bin/tofu" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = show ]; then
  if [ "${FAKE_TOFU_FAIL:-0}" = 1 ]; then
    echo "fixture tofu show failure" >&2
    exit 42
  fi
  cat "${FAKE_PLAN_JSON:?FAKE_PLAN_JSON is required}"
  exit 0
fi
echo "unexpected fake tofu command" >&2
exit 99
EOF
chmod +x "$WORK/bin/tofu"
: > "$WORK/plan.tfplan"

cat > "$WORK/safe.json" <<'EOF'
{"resource_changes":[{"address":"postgresql_database.keycloak","change":{"actions":["no-op"]}}]}
EOF
cat > "$WORK/delete.json" <<'EOF'
{"resource_changes":[{"address":"postgresql_database.keycloak","change":{"actions":["delete"]}}]}
EOF
cat > "$WORK/replace.json" <<'EOF'
{"resource_changes":[{"address":"postgresql_role.keycloak","change":{"actions":["delete","create"]}}]}
EOF
cat > "$WORK/malformed.json" <<'EOF'
{"resource_changes":
EOF
cat > "$WORK/missing-resource-changes.json" <<'EOF'
{"format_version":"1.0"}
EOF
cat > "$WORK/wrong-resource-changes-type.json" <<'EOF'
{"resource_changes":{}}
EOF

PATH="$WORK/bin:$PATH" FAKE_PLAN_JSON="$WORK/safe.json" \
  bash "$ROOT/infra/tofu/postgres-keycloak/validate-plan.sh" "$WORK/plan.tfplan"

if PATH="$WORK/bin:$PATH" FAKE_PLAN_JSON="$WORK/delete.json" \
    bash "$ROOT/infra/tofu/postgres-keycloak/validate-plan.sh" "$WORK/plan.tfplan"; then
  echo "FAIL: database deletion was accepted" >&2
  exit 1
fi

if PATH="$WORK/bin:$PATH" FAKE_PLAN_JSON="$WORK/replace.json" \
    bash "$ROOT/infra/tofu/postgres-keycloak/validate-plan.sh" "$WORK/plan.tfplan"; then
  echo "FAIL: role replacement was accepted" >&2
  exit 1
fi

for fixture in malformed missing-resource-changes wrong-resource-changes-type; do
  if output="$(PATH="$WORK/bin:$PATH" FAKE_PLAN_JSON="$WORK/$fixture.json" \
      bash "$ROOT/infra/tofu/postgres-keycloak/validate-plan.sh" "$WORK/plan.tfplan" 2>&1)"; then
    echo "FAIL: invalid plan JSON fixture was accepted: $fixture" >&2
    exit 1
  fi
  grep -Fq "plan JSON is malformed or missing resource changes" <<< "$output" || {
    echo "FAIL: invalid plan JSON fixture did not hit the fail-closed shape gate: $fixture" >&2
    printf '%s\n' "$output" >&2
    exit 1
  }
done

if output="$(PATH="$WORK/bin:$PATH" FAKE_TOFU_FAIL=1 \
    bash "$ROOT/infra/tofu/postgres-keycloak/validate-plan.sh" "$WORK/plan.tfplan" 2>&1)"; then
  echo "FAIL: tofu show failure was accepted" >&2
  exit 1
fi
grep -Fq "Unable to read the postgres-keycloak OpenTofu plan as JSON" <<< "$output" || {
  echo "FAIL: tofu show failure did not hit the fail-closed show gate" >&2
  printf '%s\n' "$output" >&2
  exit 1
}

echo "TX-local postgres-keycloak plan safety guard contract OK"
