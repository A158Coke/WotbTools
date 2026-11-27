#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TARGET="${1:?usage: install.sh <target> <source-sha> <staged-root>}"
SOURCE_SHA="${2:?usage: install.sh <target> <source-sha> <staged-root>}"
stage="${3:?usage: install.sh <target> <source-sha> <staged-root>}"
runtime="$stage/deploy/production-worker"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/production-worker/lib.sh
source "$script_dir/lib.sh"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid production-worker source SHA.'
load_target_profile "$TARGET" "$runtime"

if [[ "$WORKER_PRIVILEGE" == sudo && "$(id -u)" != 0 ]]; then
  command -v sudo >/dev/null 2>&1 \
    || fail "sudo is required to reconcile target $WORKER_TARGET from a non-root account."
  sudo -n true >/dev/null 2>&1 \
    || fail "non-interactive (passwordless) sudo is required to reconcile target $WORKER_TARGET."
  sudo_args=(-n)
  preserve=()
  for name in TCR_REGISTRY TCR_NAMESPACE TCR_CREDENTIAL_VERSION TCR_USERNAME TCR_PASSWORD; do
    if [[ -n "${!name:-}" ]]; then preserve+=("$name"); fi
  done
  if (( ${#preserve[@]} > 0 )); then
    sudo_args+=(--preserve-env="$(IFS=,; echo "${preserve[*]}")")
  fi
  exec sudo "${sudo_args[@]}" env \
    PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
    bash "$0" "$@"
fi
[[ "$(id -u)" == 0 ]] \
  || fail "Production-worker reconcile must run as root to own host packages, the Docker daemon and the root Docker credential (target $WORKER_TARGET)."
[[ "$stage" == "$WORKER_STAGING_ROOT/incoming/$SOURCE_SHA" ]] \
  || fail "Unexpected production-worker staging root for $WORKER_TARGET: $stage"

for command_name in "$docker_bin" "$systemctl_bin" flock python3 stat diff; do
  command -v "$command_name" >/dev/null \
    || fail "$command_name is required on $WORKER_TARGET (see docs/operations/tx2-production-worker.md)."
done

for staged in "$runtime/lib.sh" "$runtime/staging-root.sh" "$runtime/install.sh" \
  "$runtime/verify.sh" "$runtime/targets/$TARGET/target.env"; do
  [[ -f "$staged" && ! -L "$staged" ]] \
    || fail "Staged production-worker input is missing or unsafe: $staged"
done

bash "$runtime/staging-root.sh" verify "$SOURCE_SHA" "$WORKER_STAGING_ROOT"

require_host_lock
if [[ -n "${WORKER_DEPLOY_LOCK_FD:-}" ]]; then
  [[ "$WORKER_DEPLOY_LOCK_FD" == 9 ]] || fail 'Unsupported inherited production-worker lock fd.'
  { true >&9; } 2>/dev/null || fail 'Inherited production-worker lock fd is unavailable.'
else
  exec 9>"$WORKER_LOCK_ROOT/.deploy.lock"
  flock -n 9 || fail "Another $WORKER_TARGET host mutation is running."
fi
export WORKER_DEPLOY_LOCK_FD=9

containers_before="$(running_container_ids)"
install -d -m 700 -o root -g root "$worker_state_dir"
printf '%s\n' "$containers_before" | atomic_write "$worker_state_dir/containers.before" 600


compose_available() {
  "$docker_bin" compose version >/dev/null 2>&1
}

if compose_available; then
  echo "docker-compose-v2: already available (no install)"
else
  command -v "$apt_get_bin" >/dev/null \
    || fail "$apt_get_bin is required to install $WORKER_COMPOSE_PACKAGE on $WORKER_TARGET."
  echo "docker-compose-v2: installing distribution package $WORKER_COMPOSE_PACKAGE"
  DEBIAN_FRONTEND=noninteractive "$apt_get_bin" update -qq
  DEBIAN_FRONTEND=noninteractive "$apt_get_bin" install -y --no-install-recommends "$WORKER_COMPOSE_PACKAGE" \
    || fail "Installing $WORKER_COMPOSE_PACKAGE failed on $WORKER_TARGET."
fi
compose_available || fail "Docker Compose v2 is unusable on $WORKER_TARGET after reconciliation."
"$docker_bin" compose ls --all --format json >/dev/null 2>&1 \
  || fail "docker compose ls failed on $WORKER_TARGET; the Compose plugin is not usable."
pass docker-compose-v2


daemon_config="$(docker_daemon_config_path)"
require_real_dir "$docker_daemon_dir" "the $WORKER_TARGET Docker daemon configuration directory"
if [[ -e "$daemon_config" || -L "$daemon_config" ]]; then
  [[ -f "$daemon_config" && ! -L "$daemon_config" ]] \
    || fail "The Docker daemon configuration is not a real file: $daemon_config"
  assert_supported_daemon_config "$daemon_config"
fi

restart_required=0
if daemon_config_matches "$daemon_config"; then
  echo "docker-hub-mirror: no change (already the reviewed state)"
else
  desired_daemon_json | atomic_write "$daemon_config" 0644
  restart_required=1
  echo "docker-hub-mirror: written to $daemon_config"
fi
daemon_config_matches "$daemon_config" \
  || fail "The Docker daemon configuration does not match the reviewed state after reconciliation."
[[ "$(stat -c '%U:%G' "$daemon_config")" == root:root ]] \
  || fail "The Docker daemon configuration must be owned by root:root."
[[ "$(stat -c '%a' "$daemon_config")" == 644 ]] \
  || fail "The Docker daemon configuration must be mode 644."

if (( restart_required )); then
  affected="$(printf '%s' "$containers_before" | grep -c . || true)"
  echo "docker-hub-mirror: restarting $docker_bin (running containers visible before restart: $affected)"
  "$systemctl_bin" restart docker || fail "Restarting the Docker daemon failed on $WORKER_TARGET."
  for _ in $(seq 1 30); do
    docker_daemon_healthy && break
    sleep 2
  done
fi
docker_daemon_healthy || fail "The Docker daemon is not healthy after reconciliation."
assert_active_mirror "$WORKER_DOCKER_HUB_MIRROR" \
  || fail "The reviewed Docker Hub mirror is not active on $WORKER_TARGET."
pass docker-hub-mirror


[[ -n "${TCR_USERNAME:-}" ]] || fail 'TCR_USERNAME is required to authenticate the root Docker context.'
[[ -n "${TCR_PASSWORD:-}" ]] || fail 'TCR_PASSWORD is required to authenticate the root Docker context.'
require_credential_version "${TCR_CREDENTIAL_VERSION:-}"
validate_registry_prefix "${TCR_REGISTRY:?TCR_REGISTRY is required}" "${TCR_NAMESPACE:?TCR_NAMESPACE is required}"
image_ref="$registry_prefix/$WORKER_VERIFY_IMAGE_REPOSITORY:$WORKER_VERIFY_IMAGE_TAG"
applied_version="$(applied_credential_version)"

credential_file_safe() {
  local path="$1"
  python3 - "$path" "${TCR_REGISTRY:?}" <<'PY'
import json, sys

path, registry = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    document = json.load(handle)
if not isinstance(document, dict):
    raise SystemExit(1)
unsupported = sorted(set(document) - {"auths"})
if unsupported:
    print(f"unsupported root Docker configuration keys: {unsupported}", file=sys.stderr)
    raise SystemExit(1)
auths = document.get("auths", {})
if not isinstance(auths, dict):
    raise SystemExit(1)
foreign = sorted(set(auths) - {registry})
if foreign:
    print(f"the root Docker store holds credentials for unmanaged registries: {foreign}", file=sys.stderr)
    raise SystemExit(1)
PY
}

root_config="$(root_docker_config_path)"
have_credential=0
if [[ -e "$root_config" || -L "$root_config" ]]; then
  have_credential=1
  [[ -f "$root_config" && ! -L "$root_config" ]] \
    || fail "The root Docker configuration is not a real file: $root_config"
  [[ "$(stat -c '%a' "$root_config")" == 600 ]] \
    || fail "The root Docker configuration must be mode 600 (found $(stat -c '%a' "$root_config"))."
  [[ "$(stat -c '%U:%G' "$root_config")" == root:root ]] \
    || fail "The root Docker configuration must be owned by root:root."
  credential_file_safe "$root_config" || fail "Unsupported root Docker credential state: $root_config"
fi

authenticated_image_access() {
  DOCKER_CONFIG="$root_docker_config_dir" \
    "$docker_bin" manifest inspect "$image_ref" >/dev/null 2>&1
}

if (( have_credential )) && [[ "$applied_version" == "$credential_version" ]] \
    && authenticated_image_access; then
  echo "tcr-root-auth: generation $credential_version already applied and authenticating (no rewrite)"
else
  if (( have_credential )); then
    echo "tcr-root-auth: applying generation $credential_version for $TCR_REGISTRY (applied generation: ${applied_version:-none})"
  else
    echo "tcr-root-auth: provisioning generation $credential_version for $TCR_REGISTRY"
  fi
  credential_dir="$(mktemp -d)"
  backup_config="$worker_state_dir/tcr-credential-backup"
  cleanup_credential_material() {
    rm -rf -- "$credential_dir"
    rm -f -- "$backup_config"
  }
  trap cleanup_credential_material EXIT
  printf '%s' "$TCR_PASSWORD" \
    | DOCKER_CONFIG="$credential_dir" "$docker_bin" login "$TCR_REGISTRY" \
        --username "$TCR_USERNAME" --password-stdin >/dev/null 2>&1 \
    || fail "Registry authentication failed for $TCR_REGISTRY."
  [[ -f "$credential_dir/config.json" && ! -L "$credential_dir/config.json" ]] \
    || fail 'Registry authentication produced no Docker credential file.'
  credential_file_safe "$credential_dir/config.json" \
    || fail 'Registry authentication produced an unsupported Docker credential file.'
  install -d -m 700 -o root -g root "$root_docker_config_dir"
  install -d -m 700 -o root -g root "$worker_state_dir"
  if (( have_credential )); then
    atomic_write "$backup_config" 600 < "$root_config"
  fi
  atomic_write "$root_config" 600 < "$credential_dir/config.json"
  rm -rf -- "$credential_dir"
  if ! authenticated_image_access; then
    if (( have_credential )); then
      atomic_write "$root_config" 600 < "$backup_config" \
        || fail 'Failed to restore the previous root Docker credential.'
      rm -f -- "$backup_config"
    else
      rm -f -- "$root_config"
    fi
    fail "The newly installed root Docker credential cannot resolve the private production image $image_ref."
  fi
  rm -f -- "$backup_config"
  trap - EXIT
  record_credential_version "$credential_version"
fi

[[ "$(stat -c '%a' "$root_config")" == 600 ]] \
  || fail "The root Docker configuration must be mode 600 after reconciliation."
[[ "$(stat -c '%U:%G' "$root_config")" == root:root ]] \
  || fail "The root Docker configuration must be owned by root:root after reconciliation."
[[ "$(applied_credential_version)" == "$credential_version" ]] \
  || fail "The applied credential generation was not recorded as $credential_version."
authenticated_image_access \
  || fail "The root Docker context cannot resolve the private production image $image_ref."
pass tcr-root-auth


containers_after="$(running_container_ids)"
[[ "$containers_before" == "$containers_after" ]] \
  || fail 'The production-worker reconcile changed the running container set; it must never create or start a workload.'

echo "Production-worker reconcile: PASS (target $WORKER_TARGET, $SOURCE_SHA)"
