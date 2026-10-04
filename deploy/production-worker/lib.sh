#!/usr/bin/env bash
# Production worker library (K7A).
#
# Shared helpers for the TX2 production-worker lifecycle. This owner is separate
# from `deploy/periphery` (which owns the Periphery binary, config, systemd
# lifecycle, identity and Core trust) and from `deploy/komodo` (which owns Komodo
# Core): it owns only general Docker-host prerequisites that Komodo/Periphery need
# in order to run a private production workload.
#
# The library is sourced by the host-side scripts after they establish their own
# error handling, and it never enables shell tracing: no secret may ever reach a
# log, and `set -x` would print the registry password that this phase reads from
# the environment.

## --- primitive output ---------------------------------------------------------

fail() { echo "ERROR: $*" >&2; exit 1; }

# pass <token> - one acceptance token per proven condition.
pass() { echo "$1: PASS"; }

## --- reviewed host roots ------------------------------------------------------
#
# Every path and command the lifecycle mutates is a variable so the fixture can run
# the real scripts against a disposable fake host root. Production never sets these
# overrides: they exist for tests and are always recorded in the artifact they own.
docker_bin="${WORKER_DOCKER_BIN:-docker}"
systemctl_bin="${WORKER_SYSTEMCTL_BIN:-systemctl}"
apt_get_bin="${WORKER_APT_GET_BIN:-apt-get}"
wg_bin="${WORKER_WG_BIN:-wg}"
ip_bin="${WORKER_IP_BIN:-ip}"
docker_daemon_dir="${WORKER_DOCKER_DAEMON_DIR:-/etc/docker}"
root_docker_config_dir="${WORKER_ROOT_DOCKER_CONFIG_DIR:-/root/.docker}"
worker_state_dir="${WORKER_STATE_DIR:-/var/lib/wotbtools-production-worker}"

docker_daemon_config_path() { printf '%s/daemon.json' "$docker_daemon_dir"; }
root_docker_config_path() { printf '%s/config.json' "$root_docker_config_dir"; }
credential_version_path() { printf '%s/tcr-credential-version' "$worker_state_dir"; }

## --- credential generation contract -------------------------------------------
#
# The applied credential generation is authoritative for desired-state convergence.
# `TCR_CREDENTIAL_VERSION` is a reviewed, NON-secret positive integer in the protected
# environment; the host records the generation it applied under its state root. A new
# desired version must force a login even while the previous credential still
# authenticates, so a rotation can never be silently ignored: authentication is an
# additional functional verification, never the trigger.
#
# The password itself is never hashed, copied or recorded anywhere.

# require_credential_version <value> - fail closed on a missing or malformed version.
require_credential_version() {
  local value="$1"
  [[ "$value" =~ ^[1-9][0-9]{0,8}$ ]] \
    || fail 'TCR_CREDENTIAL_VERSION must be a reviewed positive integer (1-9 digits).'
  credential_version="$value"
}

# applied_credential_version - the generation this host recorded, or empty.
applied_credential_version() {
  local path recorded
  path="$(credential_version_path)"
  [[ -f "$path" && ! -L "$path" ]] || return 0
  recorded="$(cat "$path")"
  recorded="${recorded//[[:space:]]/}"
  [[ "$recorded" =~ ^[1-9][0-9]{0,8}$ ]] || return 0
  printf '%s' "$recorded"
}

# record_credential_version <value> - atomically advance the applied generation.
record_credential_version() {
  local value="$1"
  install -d -m 700 -o root -g root "$worker_state_dir"
  printf '%s\n' "$value" | atomic_write "$(credential_version_path)" 600
}

## --- target profile -----------------------------------------------------------

# load_target_profile <target> <runtime-root>
#
# Reads `targets/<target>/target.env` and proves the reviewed shape before any of it
# is trusted. A profile may never carry a credential: this lifecycle reads its one
# secret from the environment only.
load_target_profile() {
  local target="$1" runtime="$2"
  local profile="$runtime/targets/$target/target.env"
  local target_pattern='^[a-z][a-z0-9-]*$'
  [[ "$target" =~ $target_pattern ]] || fail "Invalid production worker target: $target"
  require_real_file "$profile" "the $target target profile"

  # shellcheck disable=SC1090
  source "$profile"

  [[ "${WORKER_TARGET:-}" == "$target" ]] \
    || fail "The $target profile declares WORKER_TARGET=${WORKER_TARGET:-<unset>}."
  [[ -n "${WORKER_LOCK_ROOT:-}" && "$WORKER_LOCK_ROOT" == /* && "$WORKER_LOCK_ROOT" != / ]] \
    || fail "The $target profile must declare an absolute WORKER_LOCK_ROOT."
  [[ -n "${WORKER_STAGING_ROOT:-}" && "$WORKER_STAGING_ROOT" == "$WORKER_LOCK_ROOT"/* ]] \
    || fail "The $target profile must declare a WORKER_STAGING_ROOT under the host lock root."
  case "${WORKER_PRIVILEGE:-}" in
    sudo|root) ;;
    *) fail "The $target profile must declare WORKER_PRIVILEGE as root or sudo." ;;
  esac
  [[ "${WORKER_COMPOSE_PACKAGE:-}" =~ ^[a-z0-9][a-z0-9.+-]*$ ]] \
    || fail "The $target profile must declare a distribution WORKER_COMPOSE_PACKAGE."
  [[ "${WORKER_DOCKER_HUB_MIRROR:-}" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] \
    || fail "The $target profile must declare a reviewed https WORKER_DOCKER_HUB_MIRROR."
  [[ "${WORKER_VERIFY_IMAGE_REPOSITORY:-}" =~ ^[a-z0-9][a-z0-9._-]*$ ]] \
    || fail "The $target profile must declare a WORKER_VERIFY_IMAGE_REPOSITORY."
  [[ "${WORKER_VERIFY_IMAGE_TAG:-}" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*$ ]] \
    || fail "The $target profile must declare a WORKER_VERIFY_IMAGE_TAG."
  [[ "${WORKER_WIREGUARD_ADDRESS:-}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] \
    || fail "The $target profile must declare a WORKER_WIREGUARD_ADDRESS."
  [[ -n "${WORKER_REQUIRED_ENDPOINTS:-}" ]] \
    || fail "The $target profile must declare WORKER_REQUIRED_ENDPOINTS."
  [[ -n "${WORKER_PERIPHERY_UNIT:-}" ]] \
    || fail "The $target profile must declare WORKER_PERIPHERY_UNIT."
  [[ "${WORKER_READY_TOKEN:-}" =~ ^[A-Z][A-Z0-9_]*$ ]] \
    || fail "The $target profile must declare an uppercase WORKER_READY_TOKEN."
  [[ "${WORKER_READY_TOKEN}" != TX_RUNTIME_READY ]] \
    || fail "The production-worker owner must not reuse the TX runtime gate token."
  [[ -n "${WORKER_PERIPHERY_STATE:-}" ]] \
    || fail "The $target profile must declare the Periphery state it re-proves."

  # Host parameters are non-secret data. Refuse a profile that looks like it tried
  # to carry a credential, so the boundary cannot erode by accident. The readiness
  # token is the name of an output token, not a credential, so it is excluded.
  local credential_pattern='(PASSWORD|PASSWD|TOKEN|SECRET|_KEY|CREDENTIAL)'
  local profile_text
  profile_text="$(<"$profile")"
  if grep -Ev '^[[:space:]]*WORKER_READY_TOKEN=' <<< "$profile_text" \
      | grep -Eq "^[[:space:]]*[A-Z0-9_]*${credential_pattern}[A-Z0-9_]*="; then
    fail "The $target target profile must not carry credentials."
  fi
  profile_text=
}

# validate_registry_prefix <registry> <namespace>
#
# The reviewed production registry. The workflow passes the same repository
# variables every other TX owner uses, and this lifecycle accepts nothing else.
validate_registry_prefix() {
  local registry="$1" namespace="$2"
  [[ "$registry" =~ ^([a-z0-9][a-z0-9-]*\.)+tencentyun\.com$ ]] \
    || fail 'TCR_REGISTRY must be a Tencent TCR host.'
  [[ "$namespace" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || fail 'TCR_NAMESPACE is invalid.'
  registry_prefix="$registry/$namespace"
}

## --- path safety --------------------------------------------------------------

require_real_dir() {
  local path="$1" label="$2"
  [[ -d "$path" && ! -L "$path" ]] || fail "$label is not a real directory: $path"
}

require_existing_real_dir() {
  local path="$1" label="$2"
  [[ -e "$path" ]] || fail "$label does not exist: $path"
  require_real_dir "$path" "$label"
}

require_real_file() {
  local path="$1" label="$2"
  [[ -f "$path" && ! -L "$path" ]] || fail "$label is not a real file: $path"
}

require_existing_lock_file() {
  local path="$1"
  [[ -e "$path" ]] || fail "The host mutation lock file does not exist: $path"
  [[ -f "$path" && ! -L "$path" ]] || fail "The host mutation lock is not a real file: $path"
}

# The lock root and its lock file belong to the host's deploy owner. This owner
# never creates them: a missing lock means the host is not prepared for
# repository-owned mutation, which must stop K7A instead of weakening the lock.
require_host_lock() {
  require_existing_real_dir "$WORKER_LOCK_ROOT" "the $WORKER_TARGET host mutation lock root"
  require_existing_lock_file "$WORKER_LOCK_ROOT/.deploy.lock"
}

## --- docker daemon configuration ---------------------------------------------

# desired_daemon_json - the complete reviewed Docker daemon configuration.
#
# Exactly one reviewed setting: the in-network Docker Hub mirror. Any other live
# setting is unexpected and must stop reconciliation rather than being silently
# preserved or discarded, so this is deliberately not a templating mechanism.
desired_daemon_json() {
  printf '{\n  "registry-mirrors": [\n    "%s"\n  ]\n}\n' "$WORKER_DOCKER_HUB_MIRROR"
}

# daemon_config_matches <path> - 0 when the live file is exactly the reviewed state.
daemon_config_matches() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  # Process substitution, not a command substitution: the canonical form ends with a
  # newline and must be compared byte for byte.
  diff -q <(desired_daemon_json) "$path" >/dev/null 2>&1
}

# assert_supported_daemon_config <path>
#
# Validates the live JSON and refuses anything this owner does not explicitly own.
# A malformed file, an unsupported key, or a non-list mirror value all stop K7A. A
# differing mirror *value* on the reviewed key is drift this owner corrects, not an
# unsupported setting: the mirror is the one setting K7A owns.
assert_supported_daemon_config() {
  local path="$1"
  python3 - "$path" <<'PY' || fail "Unsupported Docker daemon configuration: $path"
import json, sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        raw = handle.read()
except OSError as error:
    print(f"cannot read {path}: {error}", file=sys.stderr)
    raise SystemExit(1)
try:
    document = json.loads(raw)
except ValueError as error:
    print(f"{path} is not valid JSON: {error}", file=sys.stderr)
    raise SystemExit(1)
if not isinstance(document, dict):
    print(f"{path} must contain a JSON object", file=sys.stderr)
    raise SystemExit(1)
unsupported = sorted(set(document) - {"registry-mirrors"})
if unsupported:
    print(
        "the production-worker owner does not own these daemon settings: "
        + ", ".join(unsupported),
        file=sys.stderr,
    )
    raise SystemExit(1)
mirrors = document.get("registry-mirrors", [])
if not isinstance(mirrors, list) or not all(isinstance(item, str) for item in mirrors):
    print("registry-mirrors must be a list of strings", file=sys.stderr)
    raise SystemExit(1)
PY
}

# atomic_write <path> <mode> - replace a file atomically, root-owned, never partial.
atomic_write() {
  local path="$1" mode="$2" dir tmp
  dir="$(dirname "$path")"
  tmp="$(mktemp "$dir/.wotb-worker.XXXXXX")"
  cat > "$tmp"
  chmod "$mode" "$tmp"
  chown root:root "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$path"
}

## --- docker helpers -----------------------------------------------------------

docker_daemon_healthy() {
  "$docker_bin" info >/dev/null 2>&1
}

# active_mirrors - the mirrors the running daemon actually reports.
active_mirrors() {
  "$docker_bin" info --format '{{json .RegistryConfig.Mirrors}}' 2>/dev/null || true
}

# running_container_ids - stable snapshot used to prove this reconcile created no
# workload (K7A must not adopt or start anything).
running_container_ids() {
  "$docker_bin" ps --quiet --no-trunc 2>/dev/null | sort || true
}
