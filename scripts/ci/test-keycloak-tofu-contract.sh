#!/usr/bin/env bash
# TX-local Keycloak OpenTofu ownership and production-safety contract. Reads
# repository files only, so it runs in the fast CI contract stage.
#
# Responsibility split (do not duplicate the other layers here):
#   tofu fmt / tofu validate / plan  -> syntax, schema and provider-legal fields
#   deploy/test-keycloak-tofu.sh     -> real fresh-realm apply + Admin API smoke
#   deploy/test-keycloak-runtime.sh  -> real Keycloak container contract
# This file only pins what native tooling considers valid but would still break
# the project's privilege boundary or production safety. It also replays fixture
# plan JSON through validate-plan.sh, so the destructive-change policy is tested
# without a Keycloak and without touching production state.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/keycloak"


def read(path):
    return (root / path).read_text(encoding="utf-8")


def flat(text):
    return re.sub(r"\s+", " ", text)


root_text = "\n".join(path.read_text(encoding="utf-8") for path in tofu_root.glob("*.tf"))
flat_root = flat(root_text)
versions = read("infra/tofu/keycloak/versions.tf")
providers = read("infra/tofu/keycloak/providers.tf")
identity_text = read("infra/tofu/keycloak/identity-providers.tf")
variables_text = read("infra/tofu/keycloak/variables.tf")
tx_compose = read("deploy/tx/keycloak.compose.yml")
keycloak_command = yaml.safe_load(tx_compose)["services"]["keycloak"]["command"].split()
assert keycloak_command == [
    "start", "--optimized", "--hostname=https://auth.wotbtools.com",
    "--hostname-strict=true", "--http-enabled=true", "--http-port=8080",
    "--proxy-headers=xforwarded",
], "TX Keycloak must publish the HTTPS canonical issuer while serving internal HTTP 8080"
tofu_script = read("deploy/tx/keycloak-tofu.sh")
keycloak_workflow_text = read(".github/workflows/keycloak.yml")
keycloak_workflow = yaml.load(keycloak_workflow_text, Loader=yaml.BaseLoader)
outputs_text = read("infra/tofu/keycloak/outputs.tf")

# --- reproducibility: provider pin, TLS verification, production state path --
assert 'keycloak/keycloak' in versions and 'version = "5.9.0"' in versions
assert "~>" not in versions
assert "tls_insecure_skip_verify = false" in providers
assert 'backend "local"' in root_text
assert 'path = "/opt/wotb-tx/keycloak-tofu-state/terraform.tfstate"' in root_text
assert 'TOFU_STATE_FILE="$TOFU_STATE_DIR/terraform.tfstate"' in tofu_script
assert 'TOFU_STATE_MARKER="$TOFU_STATE_DIR/bootstrap-complete"' in tofu_script
assert 'local-tofu-state-bootstrap-v1' in tofu_script
assert 'local OpenTofu state is not bootstrapped or is unsafe' in tofu_script

# --- no out-of-band execution path around the provider -----------------------
for forbidden in ("remote-exec", "local-exec", "null_resource"):
    assert forbidden not in root_text, forbidden

# --- the Admin API service account never gains realm administration ----------
for forbidden in (
    "realm-admin",
    "manage-realm",
    "manage-clients",
    "manage-identity-providers",
    "manage-events",
    "impersonation",
):
    assert forbidden not in flat_root, f"over-privileged Admin API role: {forbidden}"
for required in ("manage-users", "query-users", "view-realm"):
    assert required in flat_root, required

# --- the Admin API client secret is write-only -------------------------------
assert "client_secret_wo = var.keycloak_admin_client_secret" in flat_root
assert "client_secret = var.keycloak_admin_client_secret" not in flat_root
assert "client_secret_wo_version     = var.keycloak_admin_client_secret_version" in root_text

# --- the runtime E2E identity is confidential, minimal, and write-only -------
e2e_role_block = root_text.split(
    'resource "keycloak_openid_client_service_account_realm_role" "e2e"', 1
)
assert len(e2e_role_block) == 2, "the runtime E2E identity must be granted its realm role explicitly"
e2e_role_block = e2e_role_block[1].split("\n}\n", 1)[0]
assert 'keycloak_role.realm["wotbtools-user"].name' in e2e_role_block
for forbidden in ("wotbtools-admin", "HoF-admin", "realm-admin"):
    assert forbidden not in e2e_role_block, f"runtime E2E identity must not hold {forbidden}"
assert 'client_id = "wotbtools-e2e"' in root_text, "runtime E2E client is missing"
assert "client_secret_wo             = var.e2e_client_secret" in root_text
assert "client_secret = var.e2e_client_secret" not in root_text
assert "client_secret_wo_version     = var.e2e_client_secret_version" in root_text
assert 'variable "e2e_client_secret"' in variables_text
assert 'variable "e2e_client_secret_version"' in variables_text
assert "KEYCLOAK_E2E_CLIENT_SECRET" in tofu_script, "the TX runner must forward the E2E secret"
assert "KEYCLOAK_E2E_CLIENT_SECRET" in keycloak_workflow_text, \
    "the Keycloak owner workflow must inject the E2E secret"
assert "keycloak_openid_client.e2e" in read("infra/tofu/keycloak/validate-plan.sh"), \
    "the plan guard must protect the runtime E2E client"

# --- controlled security event logging (public-security self-assessment) -----
# 这是合规承诺的 IaC 载体：realm 已完全由 OpenTofu 管理，在 Admin UI 里手工打开不算完成。
# 事件类型清单与 TX Alloy 的 compliance selector 必须逐一对应——那条跨层断言的 owner 是
# deploy/validate-alloy-config.sh（它读 events.tf 作为唯一事实源），所以这里只锁 Keycloak
# 自己这一侧：声明存在、开关正确、listener 在、以及成功事件真的会被写出来。
events_text = read("infra/tofu/keycloak/events.tf")
assert 'resource "keycloak_realm_events" "wotbtools"' in events_text, \
    "realm events must be declared as code"
assert "keycloak_realm_events" not in read("infra/tofu/keycloak/realm.tf"), \
    "realm events must stay a separate declaration, not folded into realm.tf"
assert re.search(r"events_enabled\s+=\s+true", events_text), "realm events must be enabled"
assert re.search(r"events_expiration\s+=\s+[1-9][0-9]*", events_text), \
    "the Keycloak event store must expire: the 190-day source of truth is the Loki compliance stream"
assert re.search(r"admin_events_enabled\s+=\s+true", events_text), "admin events must be enabled"
# details = true 会把完整 resource representation（用户资料、client secret）写进一条
# 保存 190 天的日志里，所以它必须保持关闭。
assert re.search(r"admin_events_details_enabled\s+=\s+false", events_text), \
    "admin event details must stay off: the representation must never be retained"
assert re.search(r'events_listeners\s+=\s+\["jboss-logging"\]', events_text), \
    "the jboss-logging listener is what puts events on stdout; it must be declared explicitly"
enabled_block = events_text.split("enabled_event_types", 1)[1].split("]", 1)[0]
enabled_types = set(re.findall(r'"([A-Z_]+)"', enabled_block))
# 不在这里复制整份清单（那会是第三份事实源）：只锁住公安自评估文本真正承诺的下限——
# 认证操作与其访问结果。清单本身的跨层一致由 Alloy 侧断言。
for required_event in ("LOGIN", "LOGIN_ERROR"):
    assert required_event in enabled_types, f"the declared event list must cover {required_event}"
assert "keycloak_realm_events.wotbtools" in read("infra/tofu/keycloak/validate-plan.sh"), \
    "the plan guard must audit the security event logging contract against desired state"
# Keycloak 对**成功**事件（LOGIN / LOGOUT / 全部 admin event）默认只记到 DEBUG，只有失败
# 事件是 WARN。不抬 org.keycloak.events 的级别，190 天留存里就只有登录失败、没有任何成功
# 登录证据——这正是「日志信息留存措施」要证明的东西。
keycloak_environment = yaml.safe_load(tx_compose)["services"]["keycloak"]["environment"]
assert keycloak_environment.get("KC_LOG_LEVEL") == "info,org.keycloak.events:debug", \
    "TX Keycloak must raise org.keycloak.events to debug so successful events reach stdout"

# --- no legacy realm import and no resurrected aggregated QQ IdP -------------
for path_text in (read("docker/Dockerfile.keycloak"), tx_compose):
    assert "--import-realm" not in path_text
    assert "wotbtools-realm.json" not in path_text
flat_identity = flat(identity_text)
assert 'alias = "qq"' not in flat_identity
assert 'alias = "idp-qq"' in flat_identity
qq_block = identity_text.split('resource "keycloak_oidc_identity_provider" "qq"', 1)[1].split(
    "\n}\n\nlocals", 1
)[0]
# idp-qq owns the QQ App Key as plain desired state. The write-only pair would
# re-introduce a rotation version as the owner of "did the secret change?", which
# is exactly what this resource must not depend on.
assert re.search(r"client_secret\s+=\s+var\.qq_client_secret\b", qq_block), \
    "the QQ IdP must own the QQ App Key as plain desired state"
assert "client_secret_wo" not in qq_block, "idp-qq must not use the write-only secret field"
assert "prevent_destroy = true" in qq_block
assert "ignore_changes" not in qq_block
assert "bootstrap-not-configured" not in qq_block
for expected in (
    'variable "qq_client_id"',
    'variable "qq_client_secret"',
    'variable "qq_enabled"',
    "sensitive   = true",
):
    assert expected in variables_text, expected

# --- deletion protection is identity-scoped, not a blanket deletion ban ------
# `tofu plan` is the authoritative destructive-change audit gate, so realm-role
# membership follows desired state: the shared role resource carries no
# `prevent_destroy`, and the plan guard carries no role-deletion rule and no
# role-name exception (Boost-specific or otherwise). Everything that protects
# identity instead of role membership keeps its `prevent_destroy`.
role_block = root_text.split('resource "keycloak_role" "realm"', 1)
assert len(role_block) == 2, "the shared keycloak_role.realm resource is missing"
role_block = role_block[1].split("\n}\n", 1)[0]
assert "lifecycle" not in role_block and "prevent_destroy" not in role_block, \
    "realm roles are desired state; tofu plan must be able to show their removal"
guard_text = read("infra/tofu/keycloak/validate-plan.sh")
assert "keycloak_role." not in guard_text, \
    "the plan guard must not blanket-reject realm role deletions"
for role_name in ("booster", "boost-manager"):
    assert role_name not in guard_text, f"role-specific deletion exception: {role_name}"
for identity_resource in (
    'resource "keycloak_realm" "wotbtools"',
    'resource "keycloak_default_roles" "wotbtools"',
    'resource "keycloak_openid_client" "web"',
    'resource "keycloak_openid_client" "admin_api"',
    'resource "keycloak_openid_client" "e2e"',
    'resource "keycloak_oidc_identity_provider" "qq"',
):
    identity_block = root_text.split(identity_resource, 1)
    assert len(identity_block) == 2, identity_resource
    assert "prevent_destroy = true" in identity_block[1].split("\n}\n", 1)[0], \
        f"{identity_resource} must keep its deletion protection"

# --- Wargaming IdP client_id is owned by the single existing WG secret -------
# The representation's client_id is not a placeholder any more, and the
# Wargaming application ID never reaches the repository as a second secret.
assert 'client_id    = var.wargaming_application_id' in identity_text, \
    "the Wargaming IdPs must consume the Wargaming application ID variable"
assert 'client_id    = "not-used"' not in identity_text, \
    "the Wargaming client_id placeholder is not the production model"
assert 'provider_id  = "wargaming"' in identity_text
for alias in ('alias        = "wargaming-asia"', 'alias        = "wargaming-eu"', 'alias        = "wargaming-na"'):
    assert alias in identity_text, alias
# One application ID serves all three regions, so the resource must read the
# variable exactly once instead of declaring a second per-instance source.
assert identity_text.count("var.wargaming_application_id") == 1
assert 'client_secret_wo         = "not-used"' in identity_text, \
    "the Wargaming OIDC adapter secret must stay the fixed schema placeholder"
wg_variable = variables_text.split('variable "wargaming_application_id"', 1)
assert len(wg_variable) == 2, "the Wargaming application ID must be a declared variable"
wg_variable = wg_variable[1].split("\n}\n", 1)[0]
for expected in ("type        = string", "sensitive   = true", "nullable    = false", "validation {"):
    assert expected in wg_variable, expected
assert 'contains(' in wg_variable and "not-used" in wg_variable, \
    "the Wargaming application ID must reject blank values and known placeholders"
for forbidden in ("TX_WG_APPLICATION_ID", "WG_CLIENT_ID", "WARGAMING_CLIENT_ID"):
    assert forbidden not in keycloak_workflow_text, f"duplicate Wargaming credential source: {forbidden}"
    assert forbidden not in tofu_script, f"duplicate Wargaming credential source: {forbidden}"
for expected in (
    "WG_APPLICATION_ID",
    "TF_VAR_wargaming_application_id",
):
    assert expected in tofu_script, expected
assert 'export TF_VAR_wargaming_application_id="$WG_APPLICATION_ID"' in tofu_script
assert "WG_APPLICATION_ID" in keycloak_workflow_text, "Keycloak owner workflow must inject the existing Wargaming secret"
assert "wargaming_application_id" not in outputs_text, "the Wargaming application ID must not be a Tofu output"
assert "qq_client_secret" not in outputs_text, "the QQ application secret must not be a Tofu output"

# --- production QQ inputs are only supplied through the TX deployment path --
for expected in (
    "TX_QQ_CLIENT_ID",
    "TX_QQ_CLIENT_SECRET",
    "TF_VAR_qq_client_id",
    "TF_VAR_qq_client_secret",
    "must not be a placeholder",
    "must be a positive integer",
):
    assert expected in tofu_script, expected
# `TX_QQ_CLIENT_SECRET` is the only QQ credential input. Nothing may decide
# whether the QQ App Key changed except the injected value itself, so no rotation
# version - and no counter or hash standing in for one - exists anywhere on the
# QQ path (runner, Deploy step, Tofu root).
for forbidden in (
    "TX_QQ_CLIENT_SECRET_VERSION",
    "TF_VAR_qq_client_secret_version",
    "qq_client_secret_version",
):
    assert forbidden not in tofu_script, f"removed QQ secret version input: {forbidden}"
    assert forbidden not in keycloak_workflow_text, f"removed QQ secret version input in Keycloak owner workflow: {forbidden}"
    assert forbidden not in identity_text, f"removed QQ secret version input in the QQ IdP: {forbidden}"
    assert forbidden not in variables_text, f"removed QQ secret version variable: {forbidden}"
# The runtime proof of that model is the fresh-realm rotation check: rotating the
# injected secret must plan an idp-qq update against plain desired state.
assert "rotated QQ client secret converges without a rotation version" in read(
    "deploy/test-keycloak-tofu.sh"
), "the fresh-realm smoke must keep proving version-less QQ secret convergence"
assert "tfvars" not in keycloak_workflow_text.lower()
assert 'echo "$KEYCLOAK_ADMIN_CLIENT_SECRET"' not in tofu_script

# --- Keycloak administration stays TX-loopback only --------------------------
assert '"127.0.0.1:18080:8080"' in tx_compose
assert '"0.0.0.0:18080:8080"' not in tx_compose

# --- the TX deploy path keeps the plan gates --------------------------------
assert "bash ./validate-plan.sh plan.tfplan" in tofu_script
assert "bash ./validate-plan.sh second-plan.tfplan" in tofu_script
assert "tofu apply -input=false -auto-approve plan.tfplan" in tofu_script
assert "second-plan.tfplan" in tofu_script
# A clean second plan must be proven, not assumed: the runner fails when any
# action is not a no-op and also when jq cannot prove it (empty/invalid plan).
assert "all(.resource_changes[]?; ((.change.actions // []) | all(. == \"no-op\")))" in tofu_script
assert "second plan is invalid or not No changes" in tofu_script

# --- one main-only owner starts the empty runtime, applies the realm, verifies,
# --- under the same TX host lock ---------------------------------------------
keycloak_events = keycloak_workflow.get("on", keycloak_workflow.get(True, {}))
assert keycloak_events["push"]["branches"] == ["main"]
assert "workflow_dispatch" in keycloak_events
assert keycloak_workflow["concurrency"] == {
    "group": "deploy-keycloak", "cancel-in-progress": "true",
}
assert keycloak_workflow["jobs"]["deploy"]["concurrency"] == {
    "group": "production-maintenance", "cancel-in-progress": "false", "queue": "max",
}
build_steps = keycloak_workflow["jobs"]["build"]["steps"]
identity_step = next(step for step in build_steps if step.get("name") == "Freeze current main and image identity")
identity_script = identity_step["run"]
assert 'if [ "$EVENT_NAME" = workflow_dispatch ]; then' in identity_script
assert '[ "$REF_NAME" = refs/heads/main ]' in identity_script
assert '"$(git rev-parse HEAD)" = "$SOURCE_SHA"' in identity_script
assert 'deploy/check-production-freshness.sh' in identity_script
assert '"$EVENT_SHA"' in identity_script

smoke_steps = keycloak_workflow["jobs"]["smoke"]["steps"]
smoke = next(step for step in smoke_steps if "Run Keycloak runtime and realm Tofu smoke" in step.get("name", ""))
assert "${{ needs.build.outputs.image }}@${{ needs.build.outputs.digest }}" in smoke["env"]["WOTB_KEYCLOAK_TEST_IMAGE"]
assert "bash deploy/test-keycloak-runtime.sh" in smoke["run"]
assert "bash deploy/test-keycloak-tofu.sh" in smoke["run"]

deploy_job = keycloak_workflow["jobs"]["deploy"]
assert deploy_job["needs"] == ["build", "smoke"]
deploy_steps = deploy_job["steps"]
deploy_names = [step.get("name", "") for step in deploy_steps]
for required_name in (
    "Prepare TX runtime and realm staging",
    "Stage TX runtime files",
    "Stage Keycloak realm root and its actual TX runner",
    "Reject stale main before TX mutation",
    "Reconcile Keycloak, apply realm Tofu, and verify under one host lock",
):
    assert required_name in deploy_names, required_name
assert deploy_names.index("Prepare TX runtime and realm staging") < deploy_names.index("Stage TX runtime files")
assert deploy_names.index("Stage Keycloak realm root and its actual TX runner") < deploy_names.index(
    "Reject stale main before TX mutation"
) < deploy_names.index("Reconcile Keycloak, apply realm Tofu, and verify under one host lock")
freshness = next(step for step in deploy_steps if step.get("name") == "Reject stale main before TX mutation")
assert freshness["env"]["SOURCE_SHA"] == "${{ needs.build.outputs.commit_sha }}"
assert "deploy/check-production-freshness.sh" in freshness["run"]
assert freshness["env"]["EVENT_SHA"] == "${{ github.sha }}"

apply_step = next(step for step in deploy_steps
                  if step.get("name") == "Reconcile Keycloak, apply realm Tofu, and verify under one host lock")
assert apply_step["uses"] == "appleboy/ssh-action@v1"
apply_script = apply_step["with"]["script"]
assert "exec 9>/opt/wotb-tx/.deploy.lock" in apply_script
assert "flock -n 9" in apply_script
readiness_at = apply_script.index("bash /opt/wotb-tx/deploy.incoming/deploy/dependency-readiness.sh keycloak")
runtime_at = apply_script.index("bash /opt/wotb-tx/deploy.incoming/deploy/tx/deploy.sh")
tofu_at = apply_script.index('bash "$stage/deploy/tx/keycloak-tofu.sh" "$root"')
verify_at = apply_script.index("docker exec \"$keycloak_id\" test -f /opt/keycloak/providers/keycloak-qq-provider.jar")
assert readiness_at < runtime_at < tofu_at < verify_at
assert "docker exec \"$keycloak_id\" test -f /opt/keycloak/providers/keycloak-qq-provider.jar" in apply_script
assert "http://127.0.0.1:18080/realms/wotbtools/.well-known/openid-configuration" in apply_script
assert "release-metadata.py" not in apply_script

apply_envs = set(apply_step["with"]["envs"].split(","))
assert apply_envs == {
    "WOTB_DEPLOY_SERVICE",
    "WOTB_DEPLOY_CONFIG_SHA",
    "TX_IMAGE_REGISTRY_PREFIX",
    "KC_POSTGRES_ADMIN_USER",
    "KC_POSTGRES_ADMIN_PASSWORD",
    "KC_BOOTSTRAP_ADMIN_PASSWORD",
    "KC_DB_USERNAME",
    "KC_DB_PASSWORD",
    "TX_KEYCLOAK_DB_HOST",
    "TX_KEYCLOAK_DB_PORT",
    "WG_APPLICATION_ID",
    "WOTB_TX_BOOTSTRAP_KEYCLOAK",
    "KEYCLOAK_ADMIN_USERNAME",
    "KEYCLOAK_ADMIN_PASSWORD",
    "KEYCLOAK_ADMIN_CLIENT_SECRET",
    "KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION",
    "KEYCLOAK_E2E_CLIENT_SECRET",
    "KEYCLOAK_E2E_CLIENT_SECRET_VERSION",
    "WG_APPLICATION_ID",
    "TX_QQ_CLIENT_ID",
    "TX_QQ_CLIENT_SECRET",
}
assert apply_step["env"]["KEYCLOAK_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_BOOTSTRAP_ADMIN_PASSWORD }}"
assert apply_step["env"]["KEYCLOAK_ADMIN_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_ADMIN_CLIENT_SECRET }}"
assert apply_step["env"]["KEYCLOAK_E2E_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_E2E_CLIENT_SECRET }}"
assert apply_step["env"]["WG_APPLICATION_ID"] == "${{ secrets.WG_APPLICATION_ID }}"
assert apply_step["env"]["TX_QQ_CLIENT_ID"] == "${{ vars.TX_QQ_CLIENT_ID }}"
assert apply_step["env"]["TX_QQ_CLIENT_SECRET"] == "${{ secrets.TX_QQ_CLIENT_SECRET }}"
assert apply_step["env"]["KC_POSTGRES_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_POSTGRES_ADMIN_PASSWORD }}"
assert apply_step["env"]["KC_DB_PASSWORD"] == "${{ secrets.TX_KC_DB_PASSWORD }}"
# K6B-1 pinned the Keycloak database placement to Docker-local so that merging the
# logical-endpoint variables could not let an existing repository variable (or any
# other ambient environment) cut production over. K6B-2D is the reviewed cutover for
# exactly this consumer, so the assertion moves to the new desired state instead of
# being dropped; K6B-2E/2F stay Docker-local and are asserted in
# scripts/ci/test-workflow-contract.sh.
#
# This stays a placement pin, not a second allowlist: the canonical validator in
# deploy/tx/deploy.sh owns which values are legal, and the rails below only state which
# one is the reviewed production placement - TX1 (never TX2), the Keycloak PostgreSQL
# port (never 5432 on the WG host, and never the Business PostgreSQL port 25432).
assert apply_step["env"]["TX_KEYCLOAK_DB_HOST"] == "10.20.0.1"
assert apply_step["env"]["TX_KEYCLOAK_DB_PORT"] == "15432"
for unreviewed_host in ("10.20.0.3", "10.20.0.2", "keycloak-postgres", "db.example.com", ""):
    assert apply_step["env"]["TX_KEYCLOAK_DB_HOST"] != unreviewed_host, unreviewed_host
for unreviewed_port in ("5432", "25432", "15433", "5433", ""):
    assert apply_step["env"]["TX_KEYCLOAK_DB_PORT"] != unreviewed_port, unreviewed_port
assert apply_step["env"]["WG_APPLICATION_ID"] == "${{ secrets.WG_APPLICATION_ID }}"
assert apply_step["env"]["KEYCLOAK_E2E_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_E2E_CLIENT_SECRET }}"
assert "TF_VAR_" not in apply_step["with"]["envs"]
assert "echo \"$KEYCLOAK_ADMIN_CLIENT_SECRET\"" not in apply_script

print("TX-local Keycloak ownership and production-safety contract OK")
PY

# --- the plan guard audits destruction, it is not a no-deletion rule ---------
# A reviewed plan that retires realm roles must pass the guard, while deleting
# the realm, an authentication client or an identity provider must still fail
# closed through the rule that owns it. `tofu show -json` is stubbed with fixture
# plan JSON, so this needs neither a Keycloak nor network access.
guard_work="$(mktemp -d)"
trap 'rm -rf -- "$guard_work"' EXIT
mkdir -p "$guard_work/bin"
cat > "$guard_work/bin/tofu" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "$#" -eq 3 ] && [ "$1" = show ] && [ "$2" = -json ] || exit 2
if [ "${FAKE_TOFU_FAIL:-0}" = 1 ]; then
  echo "fixture tofu show failure" >&2
  exit 42
fi
cat "$3"
STUB
chmod 700 "$guard_work/bin/tofu"

write_guard_plan() {
  printf '%s\n' "$2" > "$guard_work/$1.tfplan"
}

assert_guard_passes() {
  local name="$1"
  PATH="$guard_work/bin:$PATH" bash "$ROOT/infra/tofu/keycloak/validate-plan.sh" "$guard_work/$name.tfplan" >/dev/null \
    || { echo "ERROR: $name must pass the Keycloak plan guard." >&2; exit 1; }
}

assert_guard_rejects() {
  local name="$1" expected="$2" output
  if output="$(PATH="$guard_work/bin:$PATH" bash "$ROOT/infra/tofu/keycloak/validate-plan.sh" "$guard_work/$name.tfplan" 2>&1)"; then
    echo "ERROR: $name must be rejected by the Keycloak plan guard." >&2
    exit 1
  fi
  # A fixture that merely crashes the validator must never count as a rejection,
  # and each fixture must be refused by the rule it is written to cover.
  grep -Fq -- "$expected" <<< "$output" \
    || { echo "ERROR: $name was not rejected by the expected rule." >&2; printf '%s\n' "$output" >&2; exit 1; }
}

readonly REALM_CLIENT_RULE="deletes or replaces a protected realm/client resource"
readonly IDP_RULE="deletes an identity provider"
readonly MASS_REPLACEMENT_RULE="unexpected mass resource replacement"
readonly ANDROID_ACTIONS_RULE="only the plan that creates or settles this client is approved"
readonly ANDROID_MAPPER_RULE="deletes or replaces an Android protocol mapper"

# The production Boost retirement shape: two roles leave desired state, the
# surviving roles are no-ops, and nothing else moves.
write_guard_plan boost-role-retirement '{"resource_changes":[
  {"address":"keycloak_role.realm[\"wotbtools-admin\"]","change":{"actions":["no-op"]}},
  {"address":"keycloak_role.realm[\"wotbtools-user\"]","change":{"actions":["no-op"]}},
  {"address":"keycloak_role.realm[\"HoF-admin\"]","change":{"actions":["no-op"]}},
  {"address":"keycloak_role.realm[\"booster\"]","change":{"actions":["delete"]}},
  {"address":"keycloak_role.realm[\"boost-manager\"]","change":{"actions":["delete"]}}
]}'
# Retiring any other role is the same legitimate desired-state transition.
write_guard_plan other-role-retirement \
  '{"resource_changes":[{"address":"keycloak_role.realm[\"HoF-admin\"]","change":{"actions":["delete"]}}]}'
write_guard_plan realm-delete \
  '{"resource_changes":[{"address":"keycloak_realm.wotbtools","change":{"actions":["delete"]}}]}'
write_guard_plan e2e-client-delete \
  '{"resource_changes":[{"address":"keycloak_openid_client.e2e","change":{"actions":["delete"]}}]}'
write_guard_plan idp-delete \
  '{"resource_changes":[{"address":"keycloak_oidc_identity_provider.qq","change":{"actions":["delete"]}}]}'
write_guard_plan malformed-json '{"resource_changes":'
write_guard_plan missing-resource-changes '{"format_version":"1.0"}'
write_guard_plan wrong-resource-changes-type '{"resource_changes":{}}'
# Dropping the role rule must not weaken the identity rules in the same plan.
write_guard_plan role-and-idp-delete '{"resource_changes":[
  {"address":"keycloak_role.realm[\"booster\"]","change":{"actions":["delete"]}},
  {"address":"keycloak_oidc_identity_provider.qq","change":{"actions":["delete"]}}
]}'
# The mass-replacement cap is a different invariant: it bounds unexpected
# recreation of resources the guard does not pin individually.
write_guard_plan mass-replacement '{"resource_changes":[
  {"address":"keycloak_openid_user_attribute_protocol_mapper.wotbtools_web[\"display_name\"]","change":{"actions":["delete","create"]}},
  {"address":"keycloak_openid_user_attribute_protocol_mapper.wotbtools_web[\"region\"]","change":{"actions":["delete","create"]}},
  {"address":"keycloak_openid_user_attribute_protocol_mapper.wotbtools_web[\"account_id\"]","change":{"actions":["delete","create"]}},
  {"address":"keycloak_openid_user_attribute_protocol_mapper.wotbtools_web[\"nickname\"]","change":{"actions":["delete","create"]}}
]}'

# --- Android client contract (the native PKCE client) ------------------------
# These fixtures are built as JSON with jq because the same body has to be reused
# across four cases and a fifth copy of it would only invite drift.
android_mapper_entry() {
  local key="$1" name="$2" actions="$3"
  jq -nc --arg address "keycloak_openid_user_attribute_protocol_mapper.wotbtools_android[\"$key\"]" \
    --arg name "$name" --argjson actions "$actions" \
    '{address: $address, change: {actions: $actions, after: {name: $name}}}'
}
android_mappers_json() {
  local actions="$1"
  jq -nc --argjson a "$(android_mapper_entry display_name display-name-mapper "$actions")" \
    --argjson b "$(android_mapper_entry region wotb-region-mapper "$actions")" \
    --argjson c "$(android_mapper_entry account_id wotb-account-id-mapper "$actions")" \
    --argjson d "$(android_mapper_entry nickname wotb-nickname-mapper "$actions")" \
    --argjson e "$(android_mapper_entry verified wotb-verified-mapper "$actions")" \
    '[$a, $b, $c, $d, $e]'
}
android_client_json() {
  jq -nc --argjson actions "$1" '{
    address: "keycloak_openid_client.android",
    change: {
      actions: $actions,
      after: {
        client_id: "wotbtools-android",
        access_type: "PUBLIC",
        standard_flow_enabled: true,
        implicit_flow_enabled: false,
        direct_access_grants_enabled: false,
        service_accounts_enabled: false,
        consent_required: false,
        login_theme: "wotbtools",
        always_display_in_console: true,
        frontchannel_logout_enabled: false,
        pkce_code_challenge_method: "S256",
        valid_redirect_uris: [
          "https://auth.wotbtools.com/android/oauth/callback",
          "com.wotbtools.app:/oauth2redirect"
        ],
        valid_post_logout_redirect_uris: [
          "https://auth.wotbtools.com/android/oauth/callback",
          "com.wotbtools.app:/oauth2redirect"
        ]
      }
    }
  }'
}
write_guard_plan android-client-contract "$(jq -nc --argjson client "$(android_client_json '["create"]')" \
  --argjson mappers "$(android_mappers_json '["create"]')" '{resource_changes: ([$client] + $mappers)}')"
write_guard_plan android-client-pkce-plain "$(jq -nc --argjson client "$(android_client_json '["create"]')" \
  --argjson mappers "$(android_mappers_json '["create"]')" \
  '{resource_changes: ([$client | .change.after.pkce_code_challenge_method = "plain"] + $mappers)}')"
write_guard_plan android-client-wildcard-redirect "$(jq -nc --argjson client "$(android_client_json '["create"]')" \
  --argjson mappers "$(android_mappers_json '["create"]')" \
  '{resource_changes: ([$client | .change.after.valid_redirect_uris += ["https://*.wotbtools.com/*"]] + $mappers)}')"
# The post-apply second plan `deploy/tx/keycloak-tofu.sh` requires to be all no-op:
# `resource_changes` is not diff-only, so a settled client and its mappers appear
# here as no-ops carrying their full `after` state. This must pass - requiring a
# create/non-no-op action would block every future Keycloak deploy forever.
write_guard_plan android-client-all-noop "$(jq -nc --argjson client "$(android_client_json '["no-op"]')" \
  --argjson mappers "$(android_mappers_json '["no-op"]')" '{resource_changes: ([$client] + $mappers)}')"
write_guard_plan android-client-delete "$(jq -nc --argjson client "$(android_client_json '["delete"]' | jq -c '.change.after = null')" \
  --argjson mappers "$(android_mappers_json '["no-op"]')" '{resource_changes: ([$client] + $mappers)}')"
write_guard_plan android-client-replace "$(jq -nc --argjson client "$(android_client_json '["delete","create"]' | jq -c '.change.after = null')" \
  --argjson mappers "$(android_mappers_json '["no-op"]')" '{resource_changes: ([$client] + $mappers)}')"
write_guard_plan android-mapper-missing "$(jq -nc --argjson client "$(android_client_json '["create"]')" \
  --argjson mappers "$(android_mappers_json '["create"]' | jq -c '.[0:4]')" '{resource_changes: ([$client] + $mappers)}')"
write_guard_plan android-mapper-delete "$(jq -nc --argjson client "$(android_client_json '["create"]')" \
  --argjson mappers "$(android_mappers_json '["create"]' | jq -c '.[0].change.actions = ["delete"]')" \
  '{resource_changes: ([$client] + $mappers)}')"

# --- controlled security event logging (public-security self-assessment) ------
# 合规开关的反向用例：关掉 events / admin events、打开 admin event details、摘掉
# jboss-logging listener、从清单里拿掉 LOGIN，或者整份声明被删除/替换，都必须在 apply
# 之前被拦下。同时必须保留 all-no-op 这个正向用例——落定后的第二个 plan 全是 no-op，
# 如果守卫要求「必须有变更」，以后每次 Keycloak 部署都会被自己的守卫卡住。
realm_events_json() {
  jq -nc --argjson actions "$1" '{
    address: "keycloak_realm_events.wotbtools",
    change: {
      actions: $actions,
      after: {
        events_enabled: true,
        events_expiration: 604800,
        admin_events_enabled: true,
        admin_events_details_enabled: false,
        events_listeners: ["jboss-logging"],
        enabled_event_types: [
          "LOGIN", "LOGIN_ERROR", "LOGOUT", "LOGOUT_ERROR",
          "IDENTITY_PROVIDER_LOGIN", "IDENTITY_PROVIDER_LOGIN_ERROR",
          "IDENTITY_PROVIDER_FIRST_LOGIN"
        ]
      }
    }
  }'
}
realm_events_plan() {
  jq -nc --argjson events "$1" '{resource_changes: [$events]}'
}
write_guard_plan realm-events-contract "$(realm_events_plan "$(realm_events_json '["create"]')")"
write_guard_plan realm-events-all-noop "$(realm_events_plan "$(realm_events_json '["no-op"]')")"
write_guard_plan realm-events-delete \
  "$(realm_events_plan "$(realm_events_json '["delete"]' | jq -c '.change.after = null')")"
write_guard_plan realm-events-replace \
  "$(realm_events_plan "$(realm_events_json '["delete","create"]')")"
write_guard_plan realm-events-disabled \
  "$(realm_events_plan "$(realm_events_json '["update"]' | jq -c '.change.after.events_enabled = false')")"
write_guard_plan realm-events-admin-off \
  "$(realm_events_plan "$(realm_events_json '["update"]' | jq -c '.change.after.admin_events_enabled = false')")"
write_guard_plan realm-events-details-on \
  "$(realm_events_plan "$(realm_events_json '["update"]' | jq -c '.change.after.admin_events_details_enabled = true')")"
write_guard_plan realm-events-listener-dropped \
  "$(realm_events_plan "$(realm_events_json '["update"]' | jq -c '.change.after.events_listeners = []')")"
write_guard_plan realm-events-login-dropped \
  "$(realm_events_plan "$(realm_events_json '["update"]' | jq -c '.change.after.enabled_event_types -= ["LOGIN"]')")"
write_guard_plan realm-events-duplicated "$(jq -nc --argjson events "$(realm_events_json '["no-op"]')" \
  '{resource_changes: [$events, $events]}')"

assert_guard_passes boost-role-retirement
assert_guard_passes other-role-retirement
assert_guard_passes android-client-contract
assert_guard_passes android-client-all-noop
assert_guard_rejects android-client-pkce-plain 'pkce_code_challenge_method=plain'
assert_guard_rejects android-client-wildcard-redirect 'valid_redirect_uris='
assert_guard_rejects android-client-delete "$ANDROID_ACTIONS_RULE"
assert_guard_rejects android-client-replace "$ANDROID_ACTIONS_RULE"
assert_guard_rejects android-mapper-missing 'missing the planned Android protocol mapper'
assert_guard_rejects android-mapper-delete "$ANDROID_MAPPER_RULE"
assert_guard_rejects realm-delete "$REALM_CLIENT_RULE"
assert_guard_rejects e2e-client-delete "$REALM_CLIENT_RULE"
assert_guard_rejects idp-delete "$IDP_RULE"
assert_guard_rejects role-and-idp-delete "$IDP_RULE"
assert_guard_rejects mass-replacement "$MASS_REPLACEMENT_RULE"
assert_guard_rejects malformed-json "plan JSON is malformed or missing resource changes"
assert_guard_rejects missing-resource-changes "plan JSON is malformed or missing resource changes"
assert_guard_rejects wrong-resource-changes-type "plan JSON is malformed or missing resource changes"
readonly REALM_EVENTS_RULE="does not satisfy the security log retention contract"
assert_guard_passes realm-events-contract
assert_guard_passes realm-events-all-noop
assert_guard_rejects realm-events-delete "$REALM_EVENTS_RULE"
assert_guard_rejects realm-events-replace "$REALM_EVENTS_RULE"
assert_guard_rejects realm-events-disabled 'events_enabled=false'
assert_guard_rejects realm-events-admin-off 'admin_events_enabled=false'
assert_guard_rejects realm-events-details-on 'admin_events_details_enabled=true'
assert_guard_rejects realm-events-listener-dropped 'expected to contain jboss-logging'
assert_guard_rejects realm-events-login-dropped 'expected to contain LOGIN'
assert_guard_rejects realm-events-duplicated 'must appear exactly once'

if output="$(FAKE_TOFU_FAIL=1 PATH="$guard_work/bin:$PATH" \
    bash "$ROOT/infra/tofu/keycloak/validate-plan.sh" "$guard_work/boost-role-retirement.tfplan" 2>&1)"; then
  echo "ERROR: tofu show failure must be rejected by the Keycloak plan guard." >&2
  exit 1
fi
grep -Fq "Unable to read the Keycloak OpenTofu plan as JSON" <<< "$output" \
  || { echo "ERROR: tofu show failure did not hit the fail-closed show gate." >&2; printf '%s\n' "$output" >&2; exit 1; }

echo "Keycloak OpenTofu plan guard fixtures OK"
