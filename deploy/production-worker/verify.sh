#!/usr/bin/env bash
# Production-worker readiness verification for one reviewed target (K7A).
#
# Read-only: every check below proves a condition and emits one acceptance token.
# The final `<TARGET>_PRODUCTION_WORKER_READY` token is printed only when all of
# them passed, so a partially prepared host can never report readiness. This token
# is the worker boundary only; the TX1 production topology keeps its own
# `TX_RUNTIME_READY` gate.
#
# The verification context is the one Komodo/Periphery actually uses: root Docker,
# root Docker credential store, host systemd and host WireGuard.
set -Eeuo pipefail
umask 077

TARGET="${1:?usage: verify.sh <target> <staged-root>}"
stage="${2:?usage: verify.sh <target> <staged-root>}"
runtime="$stage/deploy/production-worker"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/production-worker/lib.sh
source "$script_dir/lib.sh"

load_target_profile "$TARGET" "$runtime"

if [[ "$WORKER_PRIVILEGE" == sudo && "$(id -u)" != 0 ]]; then
  sudo -n true >/dev/null 2>&1 \
    || fail "non-interactive (passwordless) sudo is required to verify target $WORKER_TARGET."
  exec sudo -n env PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
    bash "$0" "$@"
fi
[[ "$(id -u)" == 0 ]] || fail "Production-worker verification must run as root (target $WORKER_TARGET)."
[[ "$stage" == "$WORKER_STAGING_ROOT/incoming/"* ]] \
  || fail "Unexpected production-worker staging root for $WORKER_TARGET: $stage"

for command_name in "$docker_bin" "$systemctl_bin" ss python3 stat "$wg_bin" "$ip_bin" timeout; do
  command -v "$command_name" >/dev/null || fail "$command_name is required to verify $WORKER_TARGET."
done

# The verification may not assume a credential is present in its environment: it
# re-proves what the host already holds. Only the registry variables are needed.
validate_registry_prefix "${TCR_REGISTRY:?TCR_REGISTRY is required}" "${TCR_NAMESPACE:?TCR_NAMESPACE is required}"
image_ref="$registry_prefix/$WORKER_VERIFY_IMAGE_REPOSITORY:$WORKER_VERIFY_IMAGE_TAG"

## 1. Docker daemon healthy ----------------------------------------------------

docker_daemon_healthy || fail 'The Docker daemon is not healthy.'
pass docker-daemon

## 2. Docker Compose v2 --------------------------------------------------------

"$docker_bin" compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is unavailable.'
"$docker_bin" compose ls --all --format json >/dev/null 2>&1 \
  || fail 'docker compose ls failed; the Compose plugin is not usable.'
pass docker-compose-v2

## 3. Reviewed Docker Hub mirror ----------------------------------------------

daemon_config="$(docker_daemon_config_path)"
daemon_config_matches "$daemon_config" \
  || fail "The Docker daemon configuration is not the reviewed state: $daemon_config"
[[ "$(stat -c '%U:%G' "$daemon_config")" == root:root && "$(stat -c '%a' "$daemon_config")" == 644 ]] \
  || fail 'The Docker daemon configuration must be root:root mode 644.'
active_mirrors | python3 -c '
import json, sys
expected = sys.argv[1]
raw = sys.stdin.read().strip() or "null"
mirrors = json.loads(raw)
if not isinstance(mirrors, list) or expected not in mirrors:
    print(f"the running daemon does not report the reviewed mirror {expected}: {mirrors}", file=sys.stderr)
    raise SystemExit(1)
' "$WORKER_DOCKER_HUB_MIRROR" \
  || fail "The reviewed Docker Hub mirror is not active: $WORKER_DOCKER_HUB_MIRROR"
pass docker-hub-mirror

## 4. Root Docker credential state --------------------------------------------
#
# The credential is the one Komodo/Periphery needs, because Periphery operates
# Docker as root. It may hold only this registry, and only root may read it.

root_config="$(root_docker_config_path)"
require_real_file "$root_config" 'the root Docker credential'
[[ "$(stat -c '%a' "$root_config")" == 600 ]] \
  || fail "The root Docker credential must be mode 600 (found $(stat -c '%a' "$root_config"))."
[[ "$(stat -c '%U:%G' "$root_config")" == root:root ]] \
  || fail 'The root Docker credential must be owned by root:root.'
[[ "$(stat -c '%a' "$root_docker_config_dir")" == 700 ]] \
  || fail "The root Docker configuration directory must be mode 700 (found $(stat -c '%a' "$root_docker_config_dir"))."
python3 - "$root_config" "$TCR_REGISTRY" <<'PY' || fail "Unsupported root Docker credential state: $root_config"
import json, sys

path, registry = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    document = json.load(handle)
if not isinstance(document, dict) or sorted(set(document) - {"auths"}):
    raise SystemExit(1)
auths = document.get("auths", {})
if not isinstance(auths, dict) or sorted(set(auths) - {registry}):
    raise SystemExit(1)
PY
pass tcr-root-credential

## 5. Authenticated private image access --------------------------------------
#
# The manifest resolution and the pull both authenticate through the root Docker
# credential, so they prove the same boundary from two directions: the registry
# accepts the credential, and the layers of a private WotBTools image are actually
# retrievable. No container is created and none is left running.
DOCKER_CONFIG="$root_docker_config_dir" "$docker_bin" manifest inspect "$image_ref" >/dev/null 2>&1 \
  || fail "The root Docker context cannot resolve the private production image: $image_ref"
DOCKER_CONFIG="$root_docker_config_dir" "$docker_bin" pull --quiet "$image_ref" >/dev/null 2>&1 \
  || fail "The root Docker context cannot pull the private production image: $image_ref"
pass private-image-pull

## 6. Periphery regression -----------------------------------------------------
#
# The worker owner never writes Periphery's identity, config or unit: this only
# proves the agent is still healthy, still connected outbound to Core, and still
# not an inbound server.

"$systemctl_bin" is-active --quiet "$WORKER_PERIPHERY_UNIT" \
  || fail "The $WORKER_PERIPHERY_UNIT unit is not active."
"$systemctl_bin" is-enabled --quiet "$WORKER_PERIPHERY_UNIT" \
  || fail "The $WORKER_PERIPHERY_UNIT unit is not enabled."
periphery_pid="$("$systemctl_bin" show "$WORKER_PERIPHERY_UNIT" -p MainPID --value)"
[[ "$periphery_pid" =~ ^[0-9]+$ && "$periphery_pid" != 0 ]] \
  || fail "The $WORKER_PERIPHERY_UNIT unit has no main process."
ss -Htnp 2>/dev/null | grep -F "pid=$periphery_pid," | grep -q 'ESTAB' \
  || fail 'Periphery has no established outbound connection to Komodo Core.'
if ss -Hltn 2>/dev/null | grep -qE '[:.]8120\b'; then
  fail 'A :8120 listener exists; Periphery must remain an outbound-only agent.'
fi
for owned in $WORKER_PERIPHERY_STATE; do
  [[ -e "$owned" ]] || fail "Periphery state is missing after worker reconciliation: $owned"
done
pass periphery-regression

## 7. WireGuard regression -----------------------------------------------------
#
# K7A never modifies WireGuard. It proves the reviewed address is still present and
# that the service-plane endpoints a future TX2 workload needs are reachable, with
# the K6B values frozen in Git.

"$wg_bin" show interfaces 2>/dev/null | grep -q . || fail 'No WireGuard interface is present.'
"$ip_bin" -4 addr show 2>/dev/null | grep -q "inet $WORKER_WIREGUARD_ADDRESS/" \
  || fail "The reviewed WireGuard address $WORKER_WIREGUARD_ADDRESS is not present."
for endpoint in $WORKER_REQUIRED_ENDPOINTS; do
  host="${endpoint%%:*}"
  port="${endpoint##*:}"
  timeout 5 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null \
    || fail "The TX service-plane endpoint $endpoint is not reachable from $WORKER_TARGET."
done
pass wireguard-regression

## 8. No workload was created by the worker reconcile -------------------------
#
# `install.sh` records the running container set it found before mutating anything;
# readiness requires that the set is still identical, so a worker reconcile can
# never adopt, create, or start a workload. The check remains valid once Komodo
# starts managing workloads: it constrains this lifecycle, not the workloads.

snapshot="$worker_state_dir/containers.before"
require_real_file "$snapshot" 'the production-worker container snapshot'
expected="$(cat "$snapshot")"
expected="${expected%$'\n'}"
current="$(running_container_ids)"
[[ "$expected" == "$current" ]] \
  || fail 'The running container set changed during production-worker reconciliation.'
pass no-workload-created

echo "$WORKER_READY_TOKEN"
