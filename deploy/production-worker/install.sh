#!/usr/bin/env bash
# Production-worker reconcile for one reviewed target (K7A).
#
# Owner boundary: this lifecycle prepares a host to run a *future* Komodo
# workload. It owns the Docker Compose capability, the reviewed Docker daemon
# registry mirror, and the registry credential of the execution context that
# Komodo/Periphery actually uses (root). It never creates, adopts, starts, or
# migrates a workload, never touches Komodo Core or its resources, and never
# touches Periphery's identity, config, or systemd unit.
#
# Order: target profile -> privilege -> preflight -> staging re-proof -> host lock
# -> Compose -> Docker daemon mirror -> root registry credential -> authenticated
# private-image access -> "no workload was created" self-check. The lock is held
# across every mutation, so no other mutation of this host can interleave.
#
# Privilege model, from the target profile:
#   root -> the SSH account already is root; this runs in place.
#   sudo -> the SSH account is not root; this re-executes itself through
#           non-interactive sudo, preserving ONLY the registry credential this
#           phase owns (through the environment, never through argv, disk, or a
#           log).
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
  # Fail closed when privilege escalation needs a human: a workflow cannot type a
  # password, and a half-privileged run is worse than no run.
  sudo -n true >/dev/null 2>&1 \
    || fail "non-interactive (passwordless) sudo is required to reconcile target $WORKER_TARGET."
  sudo_args=(-n)
  # Preserve only the registry credential that this phase owns, and only when it
  # is present. --preserve-env hands it over in the environment; it never appears
  # in argv, on disk, or in a log, and `set -x` is never enabled.
  preserve=()
  if [[ -n "${TCR_USERNAME:-}" ]]; then preserve+=(TCR_USERNAME); fi
  if [[ -n "${TCR_PASSWORD:-}" ]]; then preserve+=(TCR_PASSWORD); fi
  if (( ${#preserve[@]} > 0 )); then
    sudo_args+=(--preserve-env="$(IFS=,; echo "${preserve[*]}")")
  fi
  # A deterministic PATH for the privileged half, independent of sudoers/sshd.
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

# Re-prove the staging root the workflow handed over: the SHA directory and both
# of its parents must still be real directories, never symlinks.
bash "$runtime/staging-root.sh" verify "$SOURCE_SHA" "$WORKER_STAGING_ROOT"

# Take this host's mutation lock for the whole transaction and pass the descriptor
# down. The lock and its root belong to the host's deploy owner: this owner never
# creates them, and it never introduces a second, worker-only lock.
require_host_lock
if [[ -n "${WORKER_DEPLOY_LOCK_FD:-}" ]]; then
  [[ "$WORKER_DEPLOY_LOCK_FD" == 9 ]] || fail 'Unsupported inherited production-worker lock fd.'
  { true >&9; } 2>/dev/null || fail 'Inherited production-worker lock fd is unavailable.'
else
  exec 9>"$WORKER_LOCK_ROOT/.deploy.lock"
  flock -n 9 || fail "Another $WORKER_TARGET host mutation is running."
fi
export WORKER_DEPLOY_LOCK_FD=9

# K7A must not create a workload. Snapshot the running set now, record it for the
# verification layer, and re-prove it at the end: any container that appeared
# during this reconcile is a scope violation.
containers_before="$(running_container_ids)"
install -d -m 700 -o root -g root "$worker_state_dir"
printf '%s\n' "$containers_before" | atomic_write "$worker_state_dir/containers.before" 600

## --- 1. Docker Compose v2 -----------------------------------------------------

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
# `docker compose ls` is the Komodo runtime operation itself, so it also proves
# the Docker daemon is answering plugin commands (not just that a binary exists).
"$docker_bin" compose ls --all --format json >/dev/null 2>&1 \
  || fail "docker compose ls failed on $WORKER_TARGET; the Compose plugin is not usable."
pass docker-compose-v2

## --- 2. Docker daemon registry mirror ----------------------------------------

daemon_config="$(docker_daemon_config_path)"
require_real_dir "$docker_daemon_dir" "the $WORKER_TARGET Docker daemon configuration directory"
if [[ -e "$daemon_config" || -L "$daemon_config" ]]; then
  [[ -f "$daemon_config" && ! -L "$daemon_config" ]] \
    || fail "The Docker daemon configuration is not a real file: $daemon_config"
  # Fail closed on a malformed file or on any setting this owner does not own,
  # before a single byte is replaced.
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
  # Docker only reads daemon.json at start; the mirror is therefore applied by a
  # restart, and only when the reviewed file actually changed. Restarting may
  # restart containers that opt into a restart policy, so the impact is recorded
  # before it happens: K7A is the reviewed moment for this prerequisite because
  # TX2 hosts no production WotBTools workload yet.
  affected="$(printf '%s' "$containers_before" | grep -c . || true)"
  echo "docker-hub-mirror: restarting $docker_bin (running containers visible before restart: $affected)"
  "$systemctl_bin" restart docker || fail "Restarting the Docker daemon failed on $WORKER_TARGET."
  for _ in $(seq 1 30); do
    docker_daemon_healthy && break
    sleep 2
  done
fi
docker_daemon_healthy || fail "The Docker daemon is not healthy after reconciliation."
active_mirrors | python3 -c '
import json, sys
expected = sys.argv[1]
raw = sys.stdin.read().strip() or "null"
mirrors = json.loads(raw)
if not isinstance(mirrors, list) or expected not in mirrors:
    print(f"the running daemon does not report the reviewed mirror {expected}: {mirrors}", file=sys.stderr)
    raise SystemExit(1)
' "$WORKER_DOCKER_HUB_MIRROR" \
  || fail "The reviewed Docker Hub mirror is not active on $WORKER_TARGET."
pass docker-hub-mirror

## --- 3. Registry credential for the root Docker context ----------------------
#
# Komodo/Periphery operates Docker as root, so the credential must live in root's
# Docker configuration. It is materialised from the protected production
# environment, never copied from another host, never committed, and never placed
# in a Compose file, a Komodo resource, or the Periphery config.

[[ -n "${TCR_USERNAME:-}" ]] || fail 'TCR_USERNAME is required to authenticate the root Docker context.'
[[ -n "${TCR_PASSWORD:-}" ]] || fail 'TCR_PASSWORD is required to authenticate the root Docker context.'
validate_registry_prefix "${TCR_REGISTRY:?TCR_REGISTRY is required}" "${TCR_NAMESPACE:?TCR_NAMESPACE is required}"
image_ref="$registry_prefix/$WORKER_VERIFY_IMAGE_REPOSITORY:$WORKER_VERIFY_IMAGE_TAG"

root_config="$(root_docker_config_path)"
if [[ -e "$root_config" || -L "$root_config" ]]; then
  [[ -f "$root_config" && ! -L "$root_config" ]] \
    || fail "The root Docker configuration is not a real file: $root_config"
  # The credential file is secret material: prove nobody else can read it, and
  # refuse a file that carries credentials this owner does not manage.
  [[ "$(stat -c '%a' "$root_config")" == 600 ]] \
    || fail "The root Docker configuration must be mode 600 (found $(stat -c '%a' "$root_config"))."
  [[ "$(stat -c '%U:%G' "$root_config")" == root:root ]] \
    || fail "The root Docker configuration must be owned by root:root."
  python3 - "$root_config" "${TCR_REGISTRY:?}" <<'PY' || fail "Unsupported root Docker credential state: $root_config"
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
fi

# Verify what is already there before rotating it: an unchanged secret must not
# rewrite the host state (idempotency), and a changed secret must update it.
authenticated_image_access() {
  DOCKER_CONFIG="$root_docker_config_dir" \
    "$docker_bin" manifest inspect "$image_ref" >/dev/null 2>&1
}

if authenticated_image_access; then
  echo "tcr-root-auth: existing root credential still authenticates (no rewrite)"
else
  echo "tcr-root-auth: provisioning the root Docker credential for $TCR_REGISTRY"
  credential_dir="$(mktemp -d)"
  cleanup_credential_dir() { rm -rf -- "$credential_dir"; }
  trap cleanup_credential_dir EXIT
  # The password reaches docker only through stdin: it is never an argument.
  printf '%s' "$TCR_PASSWORD" \
    | DOCKER_CONFIG="$credential_dir" "$docker_bin" login "$TCR_REGISTRY" \
        --username "$TCR_USERNAME" --password-stdin >/dev/null 2>&1 \
    || fail "Registry authentication failed for $TCR_REGISTRY."
  [[ -f "$credential_dir/config.json" && ! -L "$credential_dir/config.json" ]] \
    || fail 'Registry authentication produced no Docker credential file.'
  install -d -m 700 -o root -g root "$root_docker_config_dir"
  atomic_write "$root_config" 600 < "$credential_dir/config.json"
  cleanup_credential_dir
  trap - EXIT
fi

[[ "$(stat -c '%a' "$root_config")" == 600 ]] \
  || fail "The root Docker configuration must be mode 600 after reconciliation."
[[ "$(stat -c '%U:%G' "$root_config")" == root:root ]] \
  || fail "The root Docker configuration must be owned by root:root after reconciliation."
authenticated_image_access \
  || fail "The root Docker context cannot resolve the private production image $image_ref."
pass tcr-root-auth

## --- 4. No workload was created ----------------------------------------------

containers_after="$(running_container_ids)"
[[ "$containers_before" == "$containers_after" ]] \
  || fail 'The production-worker reconcile changed the running container set; it must never create or start a workload.'

echo "Production-worker reconcile: PASS (target $WORKER_TARGET, $SOURCE_SHA)"
