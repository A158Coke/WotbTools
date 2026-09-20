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
workflow_text = (root / ".github/workflows/postgres-keycloak-tofu.yml").read_text(encoding="utf-8")
deploy_text = (root / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
root_text = "\n".join(path.read_text(encoding="utf-8") for path in tofu_root.glob("*.tf"))
workflow = yaml.safe_load(workflow_text)
deploy = yaml.safe_load(deploy_text)


def flat(text):
    return re.sub(r"\s+", " ", text)


# --- the isolated root never applies from a GitHub runner, and cannot reach
# --- production through a runner-side tunnel or remote execution ------------
assert "tofu apply" not in workflow_text
assert "apply_on_tx" not in workflow_text
for forbidden in ("remote-exec", "ssh -L", "tunnel"):
    assert forbidden not in workflow_text, forbidden
assert "remote-exec" not in root_text

# --- both apply paths share one serialization boundary ----------------------
expected_concurrency = {"group": "production-maintenance", "cancel-in-progress": False}
assert workflow["concurrency"] == expected_concurrency
assert deploy["concurrency"] == expected_concurrency

# --- mirror-only fail-closed before tofu starts -----------------------------
apply_script = next(
    step
    for step in deploy["jobs"]["deploy_tx"]["steps"]
    if step.get("name") == "Apply Keycloak PostgreSQL OpenTofu on TX localhost"
)["with"]["script"]
assert "test -f /opt/wotb-tx/tofurc || {" in apply_script
assert "export TF_CLI_CONFIG_FILE=/opt/wotb-tx/tofurc" in apply_script

# --- the PR workflow actually runs for this root ----------------------------
triggers = workflow.get("on", workflow.get(True))
assert "infra/tofu/postgres-keycloak/**" in triggers["pull_request"]["paths"]
assert triggers["push"]["branches"] == ["main"]

# --- secrets arrive as ordinary runtime names, are never printed, and are
# --- never materialized into tfvars or a server env file -------------------
apply_step = next(
    step
    for step in deploy["jobs"]["deploy_tx"]["steps"]
    if step.get("name") == "Apply Keycloak PostgreSQL OpenTofu on TX localhost"
)
assert "TF_VAR_" not in apply_step["with"]["envs"], "SSH envs must carry runtime names, not TF_VAR names"
assert apply_step["env"]["KC_POSTGRES_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_POSTGRES_ADMIN_PASSWORD }}"
assert apply_step["env"]["KC_DB_PASSWORD"] == "${{ secrets.TX_KC_DB_PASSWORD }}"
for secret_name in ("KC_POSTGRES_ADMIN_PASSWORD", "KC_DB_PASSWORD"):
    assert not any(
        secret_name in line for line in apply_script.splitlines() if "echo" in line or "printf" in line
    ), f"OpenTofu SSH script must not print {secret_name}"
assert "tfvars" not in deploy_text.lower()
for forbidden in ("TX_RUNTIME_ENV_FILE", "postgres-keycloak-tofu.env"):
    assert forbidden not in deploy_text, forbidden

# --- provider and state ownership boundaries ---------------------------------
assert 'source  = "cyrilgdn/postgresql"' in root_text
assert 'version = "1.27.0"' in root_text
assert 'key    = "wotbtools/prod/postgres-keycloak.tfstate"' in root_text
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

echo "TX-local postgres-keycloak plan safety guard contract OK"
