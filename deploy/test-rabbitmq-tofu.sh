#!/usr/bin/env bash
# Disposable RabbitMQ/OpenTofu ownership smoke. It never contacts TX.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOFU_ROOT="$ROOT/infra/tofu/rabbitmq"
TOFU="${TOFU_BIN:-tofu}"
NAME="wotb-rabbitmq-tofu-$RANDOM-$$"
WORK="$(mktemp -d)"
ADMIN_USER="ci-rabbitmq-admin"
ADMIN_PASSWORD="ci-rabbitmq-admin-password"
CONTROL_PASSWORD="ci-control-api-password"
PARSER_PASSWORD="ci-parser-worker-password"

fail() {
  echo "RABBITMQ OPENTOFU FAIL: $*" >&2
  docker logs --tail 160 "$NAME" >&2 || true
  exit 1
}

cleanup() {
  rm -rf -- "$WORK"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for command_name in docker curl python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done
command -v "$TOFU" >/dev/null 2>&1 || fail "$TOFU is required"
[ -d "$TOFU_ROOT" ] || fail "RabbitMQ OpenTofu root is missing"

docker run -d --name "$NAME" \
  -e RABBITMQ_DEFAULT_USER="$ADMIN_USER" \
  -e RABBITMQ_DEFAULT_PASS="$ADMIN_PASSWORD" \
  -p 127.0.0.1:15672:15672 \
  rabbitmq:4.3.6-management-alpine >/dev/null

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error --user "$ADMIN_USER:$ADMIN_PASSWORD" \
      http://127.0.0.1:15672/api/healthchecks/node >/dev/null; then
    echo "PASS: RabbitMQ Management API ready"
    break
  fi
  [ "$attempt" -lt 60 ] && sleep 1
  [ "$attempt" -eq 60 ] && fail "RabbitMQ Management API did not become ready"
done

export TF_VAR_rabbitmq_management_endpoint=http://127.0.0.1:15672
export TF_VAR_rabbitmq_admin_user="$ADMIN_USER"
export TF_VAR_rabbitmq_admin_password="$ADMIN_PASSWORD"
export TF_VAR_control_api_password="$CONTROL_PASSWORD"
export TF_VAR_parser_worker_password="$PARSER_PASSWORD"

MIRROR="$WORK/provider-mirror"
mkdir -p "$MIRROR"
"$TOFU" -chdir="$TOFU_ROOT" providers mirror "$MIRROR" >/dev/null
sed "s|/opt/wotb-tx/tofu-provider-mirror|$MIRROR|" "$ROOT/deploy/tx/rabbitmq.tofurc" \
  > "$WORK/tofurc"
export TF_CLI_CONFIG_FILE="$WORK/tofurc"
export TF_DATA_DIR="$WORK/tofu-data"
"$TOFU" -chdir="$TOFU_ROOT" init -reconfigure -input=false -lockfile=readonly \
  -backend-config="path=$WORK/terraform.tfstate" >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" validate >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" plan -input=false -no-color -out="$WORK/plan.tfplan" >/dev/null
(
  cd "$TOFU_ROOT"
  "$TOFU" show -json "$WORK/plan.tfplan" >/dev/null
  bash ./validate-plan.sh "$WORK/plan.tfplan"
)
"$TOFU" -chdir="$TOFU_ROOT" apply -input=false -auto-approve "$WORK/plan.tfplan" >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" plan -input=false -no-color -out="$WORK/second-plan.tfplan" >/dev/null
(
  cd "$TOFU_ROOT"
  bash ./validate-plan.sh "$WORK/second-plan.tfplan" --require-no-changes
)

python3 - "$ADMIN_USER" "$ADMIN_PASSWORD" <<'PY'
import base64
import json
import sys
from urllib.request import Request, urlopen

admin_user, admin_password = sys.argv[1:]
authorization = base64.b64encode(f"{admin_user}:{admin_password}".encode()).decode()

def api(path):
    request = Request(
        "http://127.0.0.1:15672" + path,
        headers={"Authorization": "Basic " + authorization},
    )
    with urlopen(request, timeout=10) as response:
        return json.load(response)

vhosts = {item["name"] for item in api("/api/vhosts")}
assert "/wotbtools" in vhosts, vhosts
expected = {
    "control-api": {"configure": "^$", "write": ".*", "read": "^$"},
    "parser-worker": {"configure": "^$", "write": "^$", "read": ".*"},
}
users = {item["name"]: item for item in api("/api/users")}
for name, permissions in expected.items():
    assert name in users, users.keys()
    assert users[name].get("tags", "") == "", users[name]
    actual = api(f"/api/permissions/%2Fwotbtools/{name}")
    assert actual["vhost"] == "/wotbtools", actual
    assert actual["user"] == name, actual
    assert actual["configure"] == permissions["configure"], actual
    assert actual["write"] == permissions["write"], actual
    assert actual["read"] == permissions["read"], actual
print("PASS: vhost, unprivileged identities, least-privilege permissions, and clean second plan")
PY

echo "RABBITMQ_OPENTOFU_SMOKE_PASS"
