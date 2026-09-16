#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/postgres-keycloak"
workflow_path = root / ".github/workflows/postgres-keycloak-tofu.yml"
tx_compose = (root / "deploy/tx/docker-compose.yml").read_text(encoding="utf-8")
workflow_text = workflow_path.read_text(encoding="utf-8")
deploy_path = root / ".github/workflows/deploy.yml"
deploy_text = deploy_path.read_text(encoding="utf-8")
root_text = "\n".join(path.read_text(encoding="utf-8") for path in tofu_root.glob("*.tf"))
workflow = yaml.safe_load(workflow_text)
triggers = workflow.get("on", workflow.get(True))

assert workflow["name"] == "Infra / TX Keycloak PostgreSQL"
assert "infra/tofu/postgres-keycloak/**" in triggers["pull_request"]["paths"]
assert triggers["push"]["branches"] == ["main"]
assert "infra/tofu/postgres-keycloak/**" in triggers["push"]["paths"]
assert workflow["concurrency"] == {"group": "production-maintenance", "cancel-in-progress": False}
deploy = yaml.safe_load(deploy_text)
assert deploy["concurrency"] == workflow["concurrency"], (
    "all postgres-keycloak apply paths must share one GitHub Actions concurrency boundary"
)
assert "tofu apply -input=false -auto-approve plan.tfplan" in deploy_text
assert "infra/tofu/postgres-keycloak" in deploy_text
assert deploy_text.count('command -v tofu >/dev/null 2>&1') >= 1
assert "TX_RUNTIME_ENV_FILE" not in deploy_text
assert "postgres-keycloak-tofu.env" not in deploy_text
assert deploy_text.count("script: bash /opt/wotb-tx/deploy.incoming/tx/deploy.sh") == 2
for name in (
    "KC_POSTGRES_ADMIN_USER",
    "KC_POSTGRES_ADMIN_PASSWORD",
    "KC_BOOTSTRAP_ADMIN_PASSWORD",
    "KC_DB_USERNAME",
    "KC_DB_PASSWORD",
    "WG_APPLICATION_ID",
    "CADDY_ACME_EMAIL",
):
    assert deploy_text.count(f"{name}:") >= 2, f"TX deploy must inject {name} into both SSH deploy steps"

expected_concurrency = workflow["concurrency"]
for candidate in (root / ".github/workflows").glob("*.y*ml"):
    candidate_text = candidate.read_text(encoding="utf-8")
    if "infra/tofu/postgres-keycloak" not in candidate_text or "tofu apply" not in candidate_text:
        continue
    candidate_workflow = yaml.safe_load(candidate_text)
    assert candidate_workflow.get("concurrency") == expected_concurrency, (
        f"{candidate.name} can mutate postgres-keycloak state without the shared serialization boundary"
    )
assert "tofu init -backend=false -input=false" in workflow_text
assert "apply_on_tx" not in workflow_text
assert "tofu apply" not in workflow_text
assert "postgres-keycloak-tofu.env" not in workflow_text
assert "command -v tofu >/dev/null 2>&1" in deploy_text
assert deploy_text.count("tofu apply -input=false -auto-approve plan.tfplan") == 1
assert 'TF_VAR_postgresql_admin_username: kc_admin' in deploy_text
assert 'TF_VAR_keycloak_role_password_version' in deploy_text
assert "remote-exec" not in workflow_text
assert "ssh -L" not in workflow_text

assert 'key    = "wotbtools/prod/postgres-keycloak.tfstate"' in root_text
assert 'default     = "kc_admin"' in root_text
assert 'POSTGRES_USER: ${KC_POSTGRES_ADMIN_USER:?KC_POSTGRES_ADMIN_USER is required}' in tx_compose
assert 'source  = "cyrilgdn/postgresql"' in root_text
assert 'version = "1.27.0"' in root_text
assert 'default     = "127.0.0.1"' in root_text
assert "var.postgresql_host == \"127.0.0.1\"" in root_text
assert "var.postgresql_port == 15432" in root_text
assert "password_wo" in root_text
assert root_text.count("prevent_destroy = true") == 3
assert "remote-exec" not in root_text

print("TX-local postgres-keycloak OpenTofu workflow contract OK")
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
