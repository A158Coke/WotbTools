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
import re
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/postgres-keycloak"
workflow_text = (root / ".github/workflows/keycloak-postgres.yml").read_text(encoding="utf-8")
ci_text = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
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
assert 'state_file=/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate' in apply_script
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
