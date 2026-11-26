#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

sha=0123456789abcdef0123456789abcdef01234567
marker_value=local-tofu-state-bootstrap-v1
mutation_marker="$work/mutation-started"
run_log="$work/reconcile.log"

mkdir -p "$work/bin"
for tool in docker tofu jq ip; do
  printf '#!/usr/bin/env bash\nexit 1\n' > "$work/bin/$tool"
  chmod +x "$work/bin/$tool"
done

stage_tree() {
  local root="$1"
  local staged="$root/incoming/$sha"
  mkdir -p "$staged/deploy/komodo" "$staged/infra/tofu/komodo"
  cp "$ROOT/lib.sh" "$ROOT/staging-root.sh" "$staged/deploy/komodo/"
  cat > "$staged/deploy/komodo/deploy.sh" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "${1:-}" > "${KOMODO_TEST_MUTATION_MARKER:?}"
exit 1
STUB
  : > "$staged/deploy/komodo/compose.yml"
  : > "$staged/deploy/komodo/verify.sh"
  : > "$staged/infra/tofu/komodo/validate-plan.sh"
  : > "$staged/infra/tofu/komodo/versions.tf"
  : > "$staged/infra/tofu/komodo/.terraform.lock.hcl"
}

state_ok() {
  local dir="$1"
  printf '%s\n' '{"version":4}' > "$dir/terraform.tfstate"
  printf '%s\n' "$marker_value" > "$dir/bootstrap-complete"
}

run() {
  rm -f "$mutation_marker"
  local status=0
  env -i \
    PATH="$work/bin:/usr/local/bin:/usr/bin:/bin" \
    HOME="${HOME:-/tmp}" \
    KOMODO_CONTROLLER_ROOT="$1" \
    KOMODO_CONTROLLER_STATE_DIR="$1/tofu-state" \
    KOMODO_TEST_MUTATION_MARKER="$mutation_marker" \
    KOMODO_DATABASE_PASSWORD=fixture KOMODO_INIT_ADMIN_PASSWORD=fixture \
    KOMODO_JWT_SECRET=fixture KOMODO_WEBHOOK_SECRET=fixture \
    TENCENTCLOUD_SECRET_ID=fixture TENCENTCLOUD_SECRET_KEY=fixture \
    bash "$ROOT/reconcile.sh" "$sha" "$1/incoming/$sha" >"$run_log" 2>&1 || status=$?
  return "$status"
}

expect_no_mutation() {
  local label="$1" root="$2" expected="$3"
  if run "$root"; then
    echo "unsafe Komodo preflight was accepted: $label" >&2
    exit 1
  fi
  if [[ -e "$mutation_marker" ]]; then
    echo "runtime mutation started before the state root was validated: $label" >&2
    exit 1
  fi
  grep -q -- "$expected" "$run_log" || {
    echo "Komodo preflight for '$label' failed for the wrong reason (expected to see: $expected)" >&2
    cat "$run_log" >&2
    exit 1
  }
}

expect_mutation_reached() {
  local label="$1" root="$2"
  run "$root" || true
  [[ -e "$mutation_marker" ]] || {
    echo "safe Komodo preflight never reached the runtime mutation: $label" >&2
    cat "$run_log" >&2
    exit 1
  }
  [[ "$(cat "$mutation_marker")" == "$sha" ]] || {
    echo "the runtime mutation was reached with an unexpected source SHA: $label" >&2
    exit 1
  }
}

fresh="$work/roots/fresh"
stage_tree "$fresh"
expect_mutation_reached 'fresh absent tofu-state' "$fresh"
[[ -d "$fresh/tofu-state" && ! -L "$fresh/tofu-state" ]] || {
  echo 'a fresh bootstrap did not end up with a real state directory' >&2
  exit 1
}

bootstrapped="$work/roots/bootstrapped"
stage_tree "$bootstrapped"
mkdir -p "$bootstrapped/tofu-state"
state_ok "$bootstrapped/tofu-state"
expect_mutation_reached 'valid real tofu-state' "$bootstrapped"

unsafe_target="$work/roots/unsafe-target"
mkdir -p "$unsafe_target"
state_ok "$unsafe_target"

symlinked="$work/roots/symlinked"
stage_tree "$symlinked"
ln -s "$unsafe_target" "$symlinked/tofu-state"
expect_no_mutation 'tofu-state symlink' "$symlinked" 'Refusing unsafe Komodo path'

dangling="$work/roots/dangling"
stage_tree "$dangling"
ln -s "$work/roots/absent-target" "$dangling/tofu-state"
expect_no_mutation 'dangling tofu-state symlink' "$dangling" 'Refusing unsafe Komodo path'

file_state="$work/roots/file-state"
stage_tree "$file_state"
: > "$file_state/tofu-state"
expect_no_mutation 'tofu-state regular file' "$file_state" 'Refusing unsafe Komodo path'

state_without_marker="$work/roots/state-without-marker"
stage_tree "$state_without_marker"
mkdir -p "$state_without_marker/tofu-state"
printf '%s\n' '{"version":4}' > "$state_without_marker/tofu-state/terraform.tfstate"
expect_no_mutation 'state without marker' "$state_without_marker" \
  'state exists without a completed bootstrap marker'

marker_without_state="$work/roots/marker-without-state"
stage_tree "$marker_without_state"
mkdir -p "$marker_without_state/tofu-state"
printf '%s\n' "$marker_value" > "$marker_without_state/tofu-state/bootstrap-complete"
expect_no_mutation 'marker without state' "$marker_without_state" \
  'Local OpenTofu state is not bootstrapped'

linked_root_real="$work/roots/linked-root-real"
stage_tree "$linked_root_real"
linked_root="$work/roots/linked-root"
ln -s "$linked_root_real" "$linked_root"
expect_no_mutation 'controller root symlink' "$linked_root" 'Refusing unsafe Komodo staging path'

echo 'Komodo reconcile preflight fixtures: PASS'
