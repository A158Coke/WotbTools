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
tx_compose = read("deploy/tx/docker-compose.yml")
tofu_script = read("deploy/tx/keycloak-tofu.sh")
keycloak_workflow_text = read(".github/workflows/keycloak.yml")
keycloak_workflow = yaml.load(keycloak_workflow_text, Loader=yaml.BaseLoader)
outputs_text = read("infra/tofu/keycloak/outputs.tf")

# --- reproducibility: provider pin, TLS verification, production state path --
assert 'keycloak/keycloak' in versions and 'version = "5.9.0"' in versions
assert "~>" not in versions
assert "tls_insecure_skip_verify = false" in providers
assert 'backend "pg"' in root_text
assert 'schema_name          = "tofu_keycloak"' in root_text
assert 'skip_schema_creation = true' in root_text

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
# --- and commits release metadata under the same TX host lock -----------------
keycloak_events = keycloak_workflow.get("on", keycloak_workflow.get(True, {}))
assert keycloak_events["push"]["branches"] == ["main"]
assert "workflow_dispatch" in keycloak_events
assert "concurrency" not in keycloak_workflow
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
    "Reconcile Keycloak, apply realm Tofu, verify, and commit metadata under one host lock",
):
    assert required_name in deploy_names, required_name
assert deploy_names.index("Prepare TX runtime and realm staging") < deploy_names.index("Stage TX runtime files")
assert deploy_names.index("Stage Keycloak realm root and its actual TX runner") < deploy_names.index(
    "Reject stale main before TX mutation"
) < deploy_names.index("Reconcile Keycloak, apply realm Tofu, verify, and commit metadata under one host lock")
freshness = next(step for step in deploy_steps if step.get("name") == "Reject stale main before TX mutation")
assert freshness["env"]["SOURCE_SHA"] == "${{ needs.build.outputs.commit_sha }}"
assert "deploy/check-production-freshness.sh" in freshness["run"]
assert freshness["env"]["EVENT_SHA"] == "${{ github.sha }}"

apply_step = next(step for step in deploy_steps
                  if step.get("name") == "Reconcile Keycloak, apply realm Tofu, verify, and commit metadata under one host lock")
assert apply_step["uses"] == "appleboy/ssh-action@v1"
apply_script = apply_step["with"]["script"]
assert "exec 9>/opt/wotb-tx/.deploy.lock" in apply_script
assert "flock -n 9" in apply_script
readiness_at = apply_script.index("bash /opt/wotb-tx/deploy.incoming/deploy/dependency-readiness.sh keycloak")
runtime_at = apply_script.index("bash /opt/wotb-tx/deploy.incoming/deploy/tx/deploy.sh")
tofu_at = apply_script.index('bash "$stage/deploy/tx/keycloak-tofu.sh" "$root"')
verify_at = apply_script.index("docker exec \"$keycloak_id\" test -f /opt/keycloak/providers/keycloak-qq-provider.jar")
metadata_at = apply_script.index("release-metadata.py update")
assert readiness_at < runtime_at < tofu_at < verify_at < metadata_at
assert "docker exec \"$keycloak_id\" test -f /opt/keycloak/providers/keycloak-qq-provider.jar" in apply_script
assert "http://127.0.0.1:18080/realms/wotbtools/.well-known/openid-configuration" in apply_script
assert metadata_at > apply_script.index("docker run --rm --network host")
assert "WOTB_DEPLOY_DEFER_METADATA=1" in apply_script

apply_envs = set(apply_step["with"]["envs"].split(","))
assert apply_envs == {
    "WOTB_DEPLOY_SERVICE",
    "WOTB_DEPLOY_CONFIG_SHA",
    "WOTB_DEPLOY_IMAGE_TAG",
    "WOTB_DEPLOY_IMAGE_DIGEST",
    "WOTB_DEPLOY_IMAGE_COMMIT_SHA",
    "TX_IMAGE_REGISTRY_PREFIX",
    "KC_POSTGRES_ADMIN_USER",
    "KC_POSTGRES_ADMIN_PASSWORD",
    "KC_BOOTSTRAP_ADMIN_PASSWORD",
    "KC_DB_USERNAME",
    "KC_DB_PASSWORD",
    "WG_APPLICATION_ID",
    "WOTB_TX_BOOTSTRAP_KEYCLOAK",
    "WOTB_DEPLOY_DEFER_METADATA",
    "KEYCLOAK_ADMIN_USERNAME",
    "KEYCLOAK_ADMIN_PASSWORD",
    "KEYCLOAK_ADMIN_CLIENT_SECRET",
    "KEYCLOAK_ADMIN_CLIENT_SECRET_VERSION",
    "KEYCLOAK_E2E_CLIENT_SECRET",
    "KEYCLOAK_E2E_CLIENT_SECRET_VERSION",
    "WG_APPLICATION_ID",
    "TX_QQ_CLIENT_ID",
    "TX_QQ_CLIENT_SECRET",
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
}
assert apply_step["env"]["KEYCLOAK_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_BOOTSTRAP_ADMIN_PASSWORD }}"
assert apply_step["env"]["KEYCLOAK_ADMIN_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_ADMIN_CLIENT_SECRET }}"
assert apply_step["env"]["KEYCLOAK_E2E_CLIENT_SECRET"] == "${{ secrets.KEYCLOAK_E2E_CLIENT_SECRET }}"
assert apply_step["env"]["WG_APPLICATION_ID"] == "${{ secrets.WG_APPLICATION_ID }}"
assert apply_step["env"]["TX_QQ_CLIENT_ID"] == "${{ vars.TX_QQ_CLIENT_ID }}"
assert apply_step["env"]["TX_QQ_CLIENT_SECRET"] == "${{ secrets.TX_QQ_CLIENT_SECRET }}"
assert apply_step["env"]["KC_POSTGRES_ADMIN_PASSWORD"] == "${{ secrets.TX_KC_POSTGRES_ADMIN_PASSWORD }}"
assert apply_step["env"]["KC_DB_PASSWORD"] == "${{ secrets.TX_KC_DB_PASSWORD }}"
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

assert_guard_passes boost-role-retirement
assert_guard_passes other-role-retirement
assert_guard_rejects realm-delete "$REALM_CLIENT_RULE"
assert_guard_rejects e2e-client-delete "$REALM_CLIENT_RULE"
assert_guard_rejects idp-delete "$IDP_RULE"
assert_guard_rejects role-and-idp-delete "$IDP_RULE"
assert_guard_rejects mass-replacement "$MASS_REPLACEMENT_RULE"
assert_guard_rejects malformed-json "plan JSON is malformed or missing resource changes"
assert_guard_rejects missing-resource-changes "plan JSON is malformed or missing resource changes"
assert_guard_rejects wrong-resource-changes-type "plan JSON is malformed or missing resource changes"

if output="$(FAKE_TOFU_FAIL=1 PATH="$guard_work/bin:$PATH" \
    bash "$ROOT/infra/tofu/keycloak/validate-plan.sh" "$guard_work/boost-role-retirement.tfplan" 2>&1)"; then
  echo "ERROR: tofu show failure must be rejected by the Keycloak plan guard." >&2
  exit 1
fi
grep -Fq "Unable to read the Keycloak OpenTofu plan as JSON" <<< "$output" \
  || { echo "ERROR: tofu show failure did not hit the fail-closed show gate." >&2; printf '%s\n' "$output" >&2; exit 1; }

echo "Keycloak OpenTofu plan guard fixtures OK"
