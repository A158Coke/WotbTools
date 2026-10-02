#!/usr/bin/env bash
# Komodo controller reconcile: private runtime first, DNS second, re-verify last.
#
# Ordering matters. The private Core is started and proven healthy before
# OpenTofu may create the public DNS record, so DNS can never point at an
# unavailable controller. DNS creation alone is not public exposure: that needs
# the separate TX Caddy ingress change. The host lock is held across the whole
# transaction, Compose and OpenTofu included.
set -Eeuo pipefail
umask 077

SOURCE_SHA="${1:?usage: reconcile.sh <source-sha> <staged-root>}"
stage="${2:?usage: reconcile.sh <source-sha> <staged-root>}"
runtime="$stage/deploy/komodo"
tofu_root="$stage/infra/tofu/komodo"
root=/opt/komodo
# Persistent controller state root. The literal path (rather than `${root}/...`)
# is what `scripts/ci/test-tofu-workflow-contract.sh` asserts verbatim, and it is
# the only place production OpenTofu state may live.
state_dir=/opt/komodo/tofu-state
state_marker="$state_dir/bootstrap-complete"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Komodo source SHA.' >&2; exit 2; }
# The TencentCloud credentials are required up front: without them the bootstrap
# must fail closed before it mutates anything, never with placeholder values.
for name in KOMODO_DATABASE_PASSWORD KOMODO_INIT_ADMIN_PASSWORD KOMODO_JWT_SECRET \
  KOMODO_WEBHOOK_SECRET TENCENTCLOUD_SECRET_ID TENCENTCLOUD_SECRET_KEY; do
  test -n "$(printenv "$name")" || { echo "$name is required." >&2; exit 2; }
done
for file in "$runtime/compose.yml" "$runtime/lib.sh" "$runtime/deploy.sh" "$runtime/verify.sh" \
  "$tofu_root/validate-plan.sh" "$tofu_root/versions.tf" "$tofu_root/.terraform.lock.hcl"; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Staged Komodo input is missing or unsafe: $file" >&2; exit 1; }
done
for command_name in docker tofu jq flock ip; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 2; }
done
# shellcheck source=deploy/komodo/lib.sh
source "$runtime/lib.sh"

require_real_dir "$root"
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another Komodo controller mutation is running.' >&2; exit 1; }
export KOMODO_DEPLOY_LOCK_FD=9

# Fail closed on a corrupt or half-bootstrapped state before any mutation.
require_bootstrap_state "$state_dir"

# 1. Runtime: validate, pull, promote, start, and prove the private controller.
bash "$runtime/deploy.sh" "$SOURCE_SHA" "$runtime"
bash "$runtime/verify.sh"

# 2. DNS: only the single Komodo A record, only from an exact saved plan, and
#    only while the private controller is healthy.
require_real_dir "$state_dir"
export TF_IN_AUTOMATION=true
export CHECKPOINT_DISABLE=1
cd "$tofu_root"
trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT
tofu fmt -check -recursive
tofu init -reconfigure -input=false -lockfile=readonly
tofu validate
tofu plan -input=false -no-color -out=plan.tfplan
bash ./validate-plan.sh plan.tfplan
tofu apply -input=false -auto-approve plan.tfplan
tofu plan -input=false -no-color -out=second-plan.tfplan
bash ./validate-plan.sh second-plan.tfplan --require-no-changes

if [[ ! -e "$state_marker" ]]; then
  printf '%s\n' "$bootstrap_marker_value" > "$state_marker"
  chmod 600 "$state_marker"
fi

# 3. Final private health check, still under the controller lock.
bash "$runtime/verify.sh"
echo "Komodo controller reconcile: PASS ($SOURCE_SHA)"
