#!/usr/bin/env bash
# One-time owner-host migration for a single active COS-backed OpenTofu root.
# The normal production workflows never call this script.
set -Eeuo pipefail
umask 077

usage() {
  echo "Usage: $0 <keycloak|postgres-keycloak|grafana> <staged-root-directory>" >&2
  exit 2
}
[[ $# == 2 ]] || usage
root_name="$1"
source_root="$(realpath -e -- "$2")"
[[ -d "$source_root" && ! -L "$2" ]] || { echo 'Staged OpenTofu root is not a real directory.' >&2; exit 2; }

case "$root_name" in
  keycloak)
    owner_root=/opt/wotb-tx
    state_path=/opt/wotb-tx/keycloak-tofu-state/terraform.tfstate
    cos_key=wotbtools/prod/keycloak.tfstate
    required_inputs=(
      TF_VAR_keycloak_admin_password TF_VAR_keycloak_admin_client_secret
      TF_VAR_keycloak_admin_client_secret_version TF_VAR_e2e_client_secret
      TF_VAR_e2e_client_secret_version TF_VAR_wargaming_application_id
      TF_VAR_qq_client_id TF_VAR_qq_client_secret
    )
    ;;
  postgres-keycloak)
    owner_root=/opt/wotb-tx
    state_path=/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate
    cos_key=wotbtools/prod/postgres-keycloak.tfstate
    required_inputs=(TF_VAR_postgresql_admin_password TF_VAR_keycloak_role_password)
    ;;
  grafana)
    owner_root=/opt/wotb
    state_path=/opt/wotb/grafana-tofu-state/terraform.tfstate
    cos_key=wotbtools/prod/grafana.tfstate
    required_inputs=()
    ;;
  *) usage ;;
esac

[[ -d "$owner_root" && ! -L "$owner_root" ]] || { echo 'This command must run on the root owner host.' >&2; exit 2; }
state_dir="$(dirname "$state_path")"
[[ ! -L "$state_dir" ]] || { echo 'Persistent state directory must not be a symbolic link.' >&2; exit 1; }
destination_is_clear() {
  local candidate
  for candidate in "$state_path" "$state_path.backup" "$state_path.lock.info"; do
    [[ ! -e "$candidate" && ! -L "$candidate" ]] || {
      echo "Destination state data already exists; refusing to overwrite it: $candidate" >&2
      return 1
    }
  done
}
destination_is_clear || exit 1
[[ -n "${TENCENTCLOUD_SECRET_ID:-}" && -n "${TENCENTCLOUD_SECRET_KEY:-}" ]] || {
  echo 'COS credentials are required for this one-time migration.' >&2
  exit 2
}
if [[ "$root_name" == grafana ]]; then
  [[ -n "${GRAFANA_PAT:-}" ]] || { echo 'GRAFANA_PAT is required to verify the existing Grafana state.' >&2; exit 2; }
fi
for name in "${required_inputs[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "$name is required for the zero-change migration plans." >&2; exit 2; }
done
command -v tofu >/dev/null || { echo 'OpenTofu is required.' >&2; exit 2; }
command -v flock >/dev/null || { echo 'flock is required.' >&2; exit 2; }

exec 9>"$owner_root/.deploy.lock"
flock -n 9 || { echo 'Another owner-host production mutation is running.' >&2; exit 1; }

install -d -m 700 "$(dirname "$state_path")"
chmod 700 "$(dirname "$state_path")"
work="$(mktemp -d "$owner_root/.tofu-cos-migration-${root_name}.XXXXXX")"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
root="$work/root"
mkdir -m 700 "$root"
cp -a -- "$source_root/." "$root/"

# COS identity is fixed and root-specific. Do not accept arbitrary bucket or key.
cat > "$root/backend.tf" <<EOF
terraform {
  backend "s3" {
    bucket = "wotbtools-prod-tofu-state-1478073677"
    key    = "$cos_key"
    region = "ap-shanghai"
    endpoints = { s3 = "https://cos.ap-shanghai.myqcloud.com" }
    use_path_style = false
    skip_credentials_validation = true
    skip_region_validation = true
    skip_requesting_account_id = true
    skip_metadata_api_check = true
    skip_s3_checksum = true
    use_lockfile = false
  }
}
EOF

export AWS_ACCESS_KEY_ID="$TENCENTCLOUD_SECRET_ID"
export AWS_SECRET_ACCESS_KEY="$TENCENTCLOUD_SECRET_KEY"
export AWS_EC2_METADATA_DISABLED=true
export TF_IN_AUTOMATION=true
export CHECKPOINT_DISABLE=1
unset TF_LOG TF_LOG_PATH TF_LOG_CORE TF_LOG_PROVIDER
if [[ "$root_name" == grafana ]]; then
  export TF_VAR_grafana_auth="$GRAFANA_PAT"
fi
log="$work/quiet.log"
run_quiet() {
  local label="$1"; shift
  if ! "$@" >"$log" 2>&1; then
    echo "Migration stopped during $label; command output was withheld to avoid state leakage." >&2
    exit 1
  fi
}

run_quiet 'COS initialization' tofu -chdir="$root" init -reconfigure -input=false
tofu -chdir="$root" workspace list >"$work/workspaces.txt" 2>/dev/null || {
  echo 'Could not verify the COS workspace identity.' >&2; exit 1;
}
[[ "$(wc -l < "$work/workspaces.txt")" == 1 ]] && grep -Fxq '* default' "$work/workspaces.txt" || {
  echo 'COS source is not the expected default workspace; refusing migration.' >&2; exit 1;
}
tofu -chdir="$root" state list >"$work/addresses.txt" 2>/dev/null || {
  echo 'Could not verify the COS state identity.' >&2; exit 1;
}
[[ -s "$work/addresses.txt" ]] || { echo 'COS source state is empty; refusing migration.' >&2; exit 1; }
set +e
tofu -chdir="$root" plan -input=false -no-color -detailed-exitcode >"$log" 2>&1
plan_status=$?
set -e
[[ $plan_status == 0 ]] || {
  echo "COS source plan was not zero-change (OpenTofu exit $plan_status); migration stopped." >&2
  exit 1
}

# Swap only the temporary workspace backend config. No state JSON is read or edited.
cat > "$root/backend.tf" <<EOF
terraform {
  backend "local" { path = "$state_path" }
}
EOF
destination_is_clear || { echo 'Destination appeared during migration; refusing to overwrite it.' >&2; exit 1; }
run_quiet 'COS-to-local state migration' tofu -chdir="$root" init -migrate-state -force-copy -input=false
[[ -f "$state_path" && -s "$state_path" && ! -L "$state_path" ]] || {
  echo 'Local destination state was not created safely.' >&2; exit 1;
}
chmod 600 "$state_path"
tofu -chdir="$root" workspace list >"$work/destination-workspaces.txt" 2>/dev/null || {
  echo 'Could not verify the local workspace identity.' >&2; exit 1;
}
[[ "$(wc -l < "$work/destination-workspaces.txt")" == 1 ]] \
  && grep -Fxq '* default' "$work/destination-workspaces.txt" || {
  echo 'Local destination is not the expected default workspace; migration stopped.' >&2; exit 1;
}
tofu -chdir="$root" state list >"$work/destination-addresses.txt" 2>/dev/null || {
  echo 'Could not verify the destination state identity.' >&2; exit 1;
}
cmp -s "$work/addresses.txt" "$work/destination-addresses.txt" || {
  echo 'Source and destination resource address sets differ; migration stopped.' >&2; exit 1;
}
set +e
tofu -chdir="$root" plan -input=false -no-color -detailed-exitcode >"$log" 2>&1
plan_status=$?
set -e
[[ $plan_status == 0 ]] || {
  echo "Local destination plan was not zero-change (OpenTofu exit $plan_status); COS source remains untouched." >&2
  exit 1
}
echo "COS state migrated and verified at $state_path. COS source state was not deleted."
