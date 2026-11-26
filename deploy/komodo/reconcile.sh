#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SOURCE_SHA="${1:?usage: reconcile.sh <source-sha> <staged-root>}"
stage="${2:?usage: reconcile.sh <source-sha> <staged-root>}"
runtime="$stage/deploy/komodo"
tofu_root="$stage/infra/tofu/komodo"
root="${KOMODO_CONTROLLER_ROOT:-/opt/komodo}"
state_dir="${KOMODO_CONTROLLER_STATE_DIR:-/opt/komodo/tofu-state}"
state_marker="$state_dir/bootstrap-complete"

[[ "$root" == /* && "$root" != *..* ]] || { echo "Refusing unsafe Komodo root: $root" >&2; exit 2; }
[[ "$state_dir" == "$root"/* && "$state_dir" != *..* ]] || {
  echo "Refusing unsafe Komodo state directory: $state_dir" >&2
  exit 2
}

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Komodo source SHA.' >&2; exit 2; }
for name in KOMODO_DATABASE_PASSWORD KOMODO_INIT_ADMIN_PASSWORD KOMODO_JWT_SECRET \
  KOMODO_WEBHOOK_SECRET TENCENTCLOUD_SECRET_ID TENCENTCLOUD_SECRET_KEY; do
  test -n "$(printenv "$name")" || { echo "$name is required." >&2; exit 2; }
done
for file in "$runtime/compose.yml" "$runtime/lib.sh" "$runtime/staging-root.sh" \
  "$runtime/deploy.sh" "$runtime/verify.sh" \
  "$tofu_root/validate-plan.sh" "$tofu_root/versions.tf" "$tofu_root/.terraform.lock.hcl"; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Staged Komodo input is missing or unsafe: $file" >&2; exit 1; }
done
for command_name in docker tofu jq flock ip; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 2; }
done
# shellcheck source=deploy/komodo/lib.sh
source "$runtime/lib.sh"

[[ "$stage" == "$root/incoming/$SOURCE_SHA" ]] || { echo "Unexpected Komodo staging root: $stage" >&2; exit 1; }
bash "$runtime/staging-root.sh" verify "$SOURCE_SHA" "$root"

require_real_dir "$root"
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another Komodo controller mutation is running.' >&2; exit 1; }
export KOMODO_DEPLOY_LOCK_FD=9

require_real_dir "$state_dir"
require_bootstrap_state "$state_dir"

bash "$runtime/deploy.sh" "$SOURCE_SHA" "$runtime"
bash "$runtime/verify.sh"

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

bash "$runtime/verify.sh"

tmp="$root/source-sha.incoming"
printf '%s\n' "$SOURCE_SHA" > "$tmp"
chmod 600 "$tmp"
mv -f -- "$tmp" "$root/source-sha"
echo "Komodo controller reconcile: PASS ($SOURCE_SHA)"
