#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${1:-}"
OLD_BACKEND_FILE="${2:-}"
EXPECTED_SCHEMA="${3:-}"
EXPECTED_KEY="${4:-}"
PRIVATE_TMP_ROOT="${5:-}"

[[ -d "$ROOT_DIR" && -f "$ROOT_DIR/backend.tf" ]] || { echo 'A staged OpenTofu root is required.' >&2; exit 2; }
[[ -f "$OLD_BACKEND_FILE" ]] || { echo 'The trusted historical backend configuration is required.' >&2; exit 2; }
[[ "$EXPECTED_SCHEMA" =~ ^tofu_(keycloak|keycloak_postgres|grafana)$ ]] || { echo 'Unsupported destination schema.' >&2; exit 2; }
[[ "$EXPECTED_KEY" =~ ^wotbtools/prod/(keycloak|postgres-keycloak|grafana)\.tfstate$ ]] || { echo 'Unsupported historical state key.' >&2; exit 2; }
[[ -d "$PRIVATE_TMP_ROOT" ]] || { echo 'The protected temporary root must already exist.' >&2; exit 2; }

for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; do
  [[ -n "${!name:-}" ]] || { echo "$name is required." >&2; exit 2; }
done
[[ "$PGDATABASE" == tofu_state && "$PGUSER" == tofu_state ]] || { echo 'The PostgreSQL backend identity must be tofu_state.' >&2; exit 2; }

grep -Fq 'backend "s3"' "$OLD_BACKEND_FILE" || { echo 'Historical backend is not S3/COS.' >&2; exit 2; }
grep -Fq 'bucket = "wotbtools-prod-tofu-state-1478073677"' "$OLD_BACKEND_FILE" || { echo 'Historical backend bucket does not match the expected state bucket.' >&2; exit 2; }
grep -Fq "key    = \"$EXPECTED_KEY\"" "$OLD_BACKEND_FILE" || { echo 'Historical backend key does not match the selected root.' >&2; exit 2; }
grep -Fq 'backend "pg"' "$ROOT_DIR/backend.tf" || { echo 'The staged root does not declare the PostgreSQL backend.' >&2; exit 2; }
grep -Fq "schema_name          = \"$EXPECTED_SCHEMA\"" "$ROOT_DIR/backend.tf" || { echo 'The staged root schema does not match the selected root.' >&2; exit 2; }
grep -Fq 'skip_schema_creation = true' "$ROOT_DIR/backend.tf" || { echo 'The root must use the pre-created PostgreSQL schema.' >&2; exit 2; }

command -v tofu >/dev/null 2>&1 || { echo 'OpenTofu is required.' >&2; exit 2; }
mkdir -p "$PRIVATE_TMP_ROOT/tofu-state-migration"
chmod 700 "$PRIVATE_TMP_ROOT/tofu-state-migration"
work="$(mktemp -d "$PRIVATE_TMP_ROOT/tofu-state-migration/${EXPECTED_SCHEMA}.XXXXXXXX")"
chmod 700 "$work"
cleanup() {
  case "$work" in
    "$PRIVATE_TMP_ROOT"/tofu-state-migration/*) rm -rf -- "$work" ;;
    *) echo 'Refusing to remove a temporary path outside the protected migration directory.' >&2; return 1 ;;
  esac
}
trap cleanup EXIT
ulimit -c 0 || true
unset TF_LOG TF_LOG_PATH
export TF_IN_AUTOMATION=true CHECKPOINT_DISABLE=1 AWS_EC2_METADATA_DISABLED=true

work_root="$work/root"
mkdir -m 700 "$work_root"
cp -a "$ROOT_DIR"/. "$work_root"/
cp "$work_root/backend.tf" "$work/postgres-backend.tf"
install -m 600 "$OLD_BACKEND_FILE" "$work_root/backend.tf"
cd "$work_root"

run_quiet() {
  local label="$1"
  shift
  if "$@" >"$work/$label.log" 2>&1; then
    return 0
  fi
  echo "State migration stopped during $label; command output was suppressed to protect state and credentials." >&2
  return 1
}

probe_root="$work/postgres-preflight"
mkdir -m 700 "$probe_root"
cp -a "$ROOT_DIR"/. "$probe_root"/
cd "$probe_root"
run_quiet initialize-empty-postgres-backend tofu init -reconfigure -input=false
run_quiet verify-postgres-workspaces tofu workspace list
workspace_lines="$(sed -n '/[^[:space:]]/p' "$work/verify-postgres-workspaces.log")"
[[ "$workspace_lines" == '* default' ]] || {
  echo 'The PostgreSQL destination is not an empty default-workspace backend; refusing to overwrite it.' >&2
  exit 1
}
set +e
tofu state list >"$work/verify-postgres-state.log" 2>&1
target_state_status=$?
set -e
if [[ "$target_state_status" == 0 && ! -s "$work/verify-postgres-state.log" ]]; then
  : # Empty default workspace.
elif grep -Fq 'No state file was found!' "$work/verify-postgres-state.log" \
  || grep -Fq 'No stored state was found for the given workspace in the given backend.' "$work/verify-postgres-state.log"; then
  : # The backend has no state snapshot for the default workspace.
else
  echo 'Could not prove the PostgreSQL destination is empty; refusing to overwrite it.' >&2
  exit 1
fi

cd "$work_root"
run_quiet initialize-cos tofu init -reconfigure -input=false
run_quiet verify-cos-workspaces tofu workspace list
source_workspace_lines="$(sed -n '/[^[:space:]]/p' "$work/verify-cos-workspaces.log")"
[[ "$source_workspace_lines" == '* default' ]] || {
  echo 'The historical COS backend has unexpected workspaces; refusing to migrate them implicitly.' >&2
  exit 1
}
run_quiet verify-cos-state tofu state list
[[ -s "$work/verify-cos-state.log" ]] || {
  echo 'The historical COS backend contains no managed resource addresses; refusing to migrate an empty state.' >&2
  exit 1
}
set +e
tofu plan -input=false -no-color -detailed-exitcode >"$work/pre-migration-plan.log" 2>&1
pre_migration_status=$?
set -e
if [[ "$pre_migration_status" != 0 ]]; then
  echo "The historical COS-backed root is not zero-change (OpenTofu exit $pre_migration_status); state was not migrated and output was suppressed." >&2
  exit 1
fi
install -m 600 "$work/postgres-backend.tf" "$work_root/backend.tf"
run_quiet migrate-to-postgres tofu init -migrate-state -force-copy -input=false
run_quiet validate tofu validate

set +e
tofu plan -input=false -no-color -detailed-exitcode >"$work/zero-change-plan.log" 2>&1
plan_status=$?
set -e
if [[ "$plan_status" != 0 ]]; then
  echo "State migration did not produce a zero-change plan (OpenTofu exit $plan_status); no state or plan output was emitted." >&2
  exit 1
fi

echo "State migration and zero-change plan passed for $EXPECTED_SCHEMA."
