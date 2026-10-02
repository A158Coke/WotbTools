#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_SHA="${1:?usage: reconcile.sh <source-sha> <staged-root>}"
STAGE="${2:?usage: reconcile.sh <source-sha> <staged-root>}"
RUNTIME="$STAGE/deploy/komodo"
TOFU_ROOT="$STAGE/infra/tofu/komodo"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Komodo source SHA.' >&2; exit 2; }
for name in KOMODO_DATABASE_PASSWORD KOMODO_INIT_ADMIN_PASSWORD KOMODO_JWT_SECRET KOMODO_WEBHOOK_SECRET TENCENTCLOUD_SECRET_ID TENCENTCLOUD_SECRET_KEY; do
  test -n "$(printenv "$name")" || { echo "$name is required." >&2; exit 2; }
done
for file in "$RUNTIME/compose.yml" "$RUNTIME/deploy.sh" "$RUNTIME/verify.sh" "$TOFU_ROOT/validate-plan.sh"; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Staged Komodo input is missing or unsafe: $file" >&2; exit 1; }
done
command -v docker >/dev/null
command -v tofu >/dev/null
command -v jq >/dev/null
command -v flock >/dev/null

install -d -m 700 /opt/komodo
exec 9>/opt/komodo/.deploy.lock
flock -n 9 || { echo 'Another Komodo controller mutation is running.' >&2; exit 1; }
export KOMODO_DEPLOY_LOCK_FD=9

bash "$RUNTIME/deploy.sh" "$SOURCE_SHA" "$RUNTIME"
bash "$RUNTIME/verify.sh"

state_dir=/opt/komodo/tofu-state
state_file="$state_dir/terraform.tfstate"
state_marker="$state_dir/bootstrap-complete"
install -d -m 700 "$state_dir"
if [[ -e "$state_marker" || -L "$state_marker" ]]; then
  [[ -f "$state_marker" && -s "$state_marker" && ! -L "$state_marker" ]] &&
    grep -qx 'local-tofu-state-bootstrap-v1' "$state_marker" ||
    { echo 'Komodo OpenTofu bootstrap marker is unsafe.' >&2; exit 1; }
  [[ -f "$state_file" && -s "$state_file" && ! -L "$state_file" ]] ||
    { echo 'Local OpenTofu state is not bootstrapped or unsafe for Komodo.' >&2; exit 1; }
elif [[ -e "$state_file" || -L "$state_file" ]]; then
  echo 'Komodo OpenTofu state exists without a completed bootstrap marker; manual recovery is required.' >&2
  exit 1
fi

export TF_IN_AUTOMATION=true
export CHECKPOINT_DISABLE=1
cd "$TOFU_ROOT"
trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT
tofu fmt -check -recursive
tofu init -reconfigure -input=false
tofu validate
tofu plan -input=false -no-color -out=plan.tfplan
bash ./validate-plan.sh plan.tfplan
tofu apply -input=false -auto-approve plan.tfplan
tofu plan -input=false -no-color -out=second-plan.tfplan
bash ./validate-plan.sh second-plan.tfplan --require-no-changes

if [[ ! -e "$state_marker" ]]; then
  printf '%s\n' local-tofu-state-bootstrap-v1 > "$state_marker"
  chmod 600 "$state_marker"
fi

bash "$RUNTIME/verify.sh"
echo "Komodo controller reconcile: PASS ($SOURCE_SHA)"
