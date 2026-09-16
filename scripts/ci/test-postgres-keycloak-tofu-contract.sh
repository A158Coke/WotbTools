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
workflow_text = workflow_path.read_text(encoding="utf-8")
root_text = "\n".join(path.read_text(encoding="utf-8") for path in tofu_root.glob("*.tf"))
workflow = yaml.safe_load(workflow_text)
triggers = workflow.get("on", workflow.get(True))

assert workflow["name"] == "Infra / TX Keycloak PostgreSQL"
assert "infra/tofu/postgres-keycloak/**" in triggers["pull_request"]["paths"]
assert triggers["push"]["branches"] == ["main"]
assert "infra/tofu/postgres-keycloak/**" in triggers["push"]["paths"]
assert workflow["concurrency"] == {"group": "tx-postgres-keycloak", "cancel-in-progress": False}
assert "tofu init -backend=false -input=false" in workflow_text
assert "TX_VPS_HOST" in workflow_text
assert "postgres-keycloak-tofu.env" in workflow_text
assert "/opt/wotb-tx/tofu.incoming/" in workflow_text
assert "keycloak-postgres.tofu-provisioned" in workflow_text
assert "tx-local-opentofu" in workflow_text
assert "TF_VAR_postgresql_admin_password" not in workflow_text
assert "TF_VAR_keycloak_role_password" not in workflow_text
assert "remote-exec" not in workflow_text
assert "ssh -L" not in workflow_text

assert 'key    = "wotbtools/prod/postgres-keycloak.tfstate"' in root_text
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
