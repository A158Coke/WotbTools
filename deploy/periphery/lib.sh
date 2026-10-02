#!/usr/bin/env bash
# Shared Komodo Periphery helpers (K3.2), sourced by `install.sh`, `verify.sh`,
# `reconcile.sh`, and the local fixtures. One lifecycle implementation serves
# every reviewed host target; per-host differences live in
# `targets/<target>/target.env` and are loaded through `load_target_profile`.
set -Eeuo pipefail

# --- host-local runtime paths ------------------------------------------------
# Identical on every target: the hosts are separate machines, so /etc/komodo,
# /usr/local/bin/periphery, the systemd unit, and the transient /run credential
# all keep the same absolute paths. The PERIPHERY_* overrides exist only so
# `deploy/periphery/test-periphery.sh` can drive the real scripts against a
# disposable tree; the production workflow never sets them.
periphery_etc="${PERIPHERY_ETC_DIR:-/etc/komodo}"
periphery_bin="${PERIPHERY_BIN_PATH:-/usr/local/bin/periphery}"
periphery_unit_dir="${PERIPHERY_UNIT_DIR:-/etc/systemd/system}"
periphery_unit="$periphery_unit_dir/periphery.service"
periphery_run_dir="${PERIPHERY_RUN_DIR:-/run/komodo}"
periphery_bootstrap_env="$periphery_run_dir/periphery-bootstrap.env"
# Read-only inspection root for process environments, so the fixtures can prove
# the credential-free check in both directions.
periphery_proc_root="${PERIPHERY_PROC_ROOT:-/proc}"
# Docker socket used for the container-discovery check.
periphery_docker_socket="${PERIPHERY_DOCKER_SOCKET:-/var/run/docker.sock}"
systemctl_bin="${PERIPHERY_SYSTEMCTL:-systemctl}"
# Bounded first-onboarding wait. Tunable so the fixtures do not sleep for real.
onboard_attempts="${PERIPHERY_ONBOARD_ATTEMPTS:-60}"
onboard_sleep="${PERIPHERY_ONBOARD_SLEEP_SECONDS:-2}"
# Bounded verification wait for the outbound connection to re-establish.
verify_attempts="${PERIPHERY_VERIFY_ATTEMPTS:-30}"
verify_sleep="${PERIPHERY_VERIFY_SLEEP_SECONDS:-2}"
# Bounded wait that a failed bootstrap really stops the service.
stop_attempts="${PERIPHERY_STOP_ATTEMPTS:-15}"
stop_sleep="${PERIPHERY_STOP_SLEEP_SECONDS:-2}"

for path_name in periphery_etc periphery_bin periphery_unit_dir periphery_run_dir \
  periphery_proc_root periphery_docker_socket; do
  path_value="${!path_name}"
  [[ "$path_value" == /* && "$path_value" != *..* ]] || {
    echo "Refusing unsafe Komodo Periphery path ($path_name): $path_value" >&2
    exit 2
  }
done
for count_name in onboard_attempts onboard_sleep verify_attempts verify_sleep \
  stop_attempts stop_sleep; do
  [[ "${!count_name}" =~ ^[0-9]+$ ]] || {
    echo "Refusing non-numeric $count_name: ${!count_name}" >&2
    exit 2
  }
done

periphery_identity="$periphery_etc/keys/periphery.key"
periphery_core_pub="$periphery_etc/keys/core.pub"
periphery_config="$periphery_etc/periphery.config.toml"
# The durable onboarding commit point. `keys/periphery.key` is NOT proof that
# onboarding completed: Komodo Periphery v2.3.3 generates it during startup
# (`state::periphery_keys().load()` from `main.rs`) before any Server onboarding
# can have succeeded, so a failed first attempt leaves an identity behind.
periphery_marker="$periphery_etc/keys/onboarding-complete"
periphery_marker_content='komodo-periphery-onboarding-v1'

# --- target profile state (set by load_target_profile) -----------------------
periphery_target=
periphery_connect_as=
periphery_privilege=
periphery_lock_root=
periphery_lock_file=
periphery_staging_root=
periphery_config_source=

fail() { echo "$*" >&2; exit 1; }

# require_real_dir <path>
#
# Create the directory, or refuse to continue. An existing component must be a
# real directory: a symlinked owner root would let a later promotion or cleanup
# escape the intended tree, so it fails closed instead of following the link.
require_real_dir() {
  local path="$1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    install -d -m 700 "$path"
    return 0
  fi
  [[ -d "$path" && ! -L "$path" ]] || fail "Refusing unsafe Komodo Periphery path: $path"
}

# require_existing_real_dir <path> <label>
#
# For directories owned by another host owner (the mutation lock root). Periphery
# must never create, or tighten the mode of, a root that the host's own deploy
# owner is responsible for.
require_existing_real_dir() {
  local path="$1" label="$2"
  [[ -d "$path" && ! -L "$path" ]] || fail "$label is missing or unsafe: $path"
}

# require_existing_lock_file <path>
#
# The host mutation lock must already exist, owned by the host's deploy owner.
# Creating it here as root would leave a root-only file that the host's own
# non-root deploy user could no longer lock.
require_existing_lock_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] \
    || fail "the host mutation lock is missing or unsafe: $path (the host's deploy owner must own it)"
}

# require_real_file <path> <label>
#
# Production state (the Periphery identity, the Core trust anchor, a staged
# artifact) must be a regular, non-empty, non-symlink file.
require_real_file() {
  local path="$1" label="$2"
  [[ -f "$path" && -s "$path" && ! -L "$path" ]] \
    || fail "$label is missing, empty, or unsafe: $path"
}

# load_target_profile <target> <runtime-dir>
#
# Sources the reviewed per-host profile and derives everything target-specific.
# The profile is data: no credential may appear in it, `connect_as` must equal the
# target name (so one host can never install another host's Server identity), and
# the lock and staging roots must be absolute.
load_target_profile() {
  local target="$1" runtime="$2"
  [[ -z "$periphery_target" ]] || fail 'A Komodo Periphery target profile was already loaded.'
  [[ "$target" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "Invalid Komodo Periphery target name: $target"
  local profile="$runtime/targets/$target/target.env"
  require_real_file "$profile" "Komodo Periphery target profile for '$target'"
  if grep -Eqi '(secret|password|passwd|token|onboarding_key|private_key)[[:space:]]*=' "$profile"; then
    fail "the Komodo Periphery target profile must not carry a credential: $profile"
  fi
  # The profile only supplies defaults, so the fixtures can still override the
  # lock and staging roots for a disposable tree.
  # shellcheck disable=SC1090
  source "$profile"
  [[ "${PERIPHERY_TARGET:-}" == "$target" ]] \
    || fail "the target profile in $profile declares PERIPHERY_TARGET=${PERIPHERY_TARGET:-<unset>}"
  [[ "${PERIPHERY_CONNECT_AS:-}" == "$target" ]] \
    || fail "the target profile must set PERIPHERY_CONNECT_AS to '$target', not '${PERIPHERY_CONNECT_AS:-<unset>}'"
  case "${PERIPHERY_PRIVILEGE:-}" in
    root|sudo) ;;
    *) fail "the target profile must declare PERIPHERY_PRIVILEGE as root or sudo: $profile" ;;
  esac
  periphery_target="$target"
  periphery_connect_as="$PERIPHERY_CONNECT_AS"
  periphery_privilege="$PERIPHERY_PRIVILEGE"
  periphery_lock_root="${PERIPHERY_LOCK_ROOT:-}"
  periphery_staging_root="${PERIPHERY_STAGING_ROOT:-}"
  for path_name in periphery_lock_root periphery_staging_root; do
    path_value="${!path_name}"
    [[ "$path_value" == /* && "$path_value" != *..* ]] \
      || fail "Refusing unsafe $path_name for target '$target': ${path_value:-<unset>}"
  done
  periphery_lock_file="$periphery_lock_root/.deploy.lock"
  periphery_config_source="$runtime/targets/$target/periphery.config.toml"
}

# load_release_manifest <path>: source and validate the pinned release contract.
load_release_manifest() {
  local manifest="$1"
  require_real_file "$manifest" 'Komodo Periphery release manifest'
  # shellcheck disable=SC1090
  source "$manifest"
  [[ "${PERIPHERY_VERSION:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || fail "Invalid PERIPHERY_VERSION in $manifest"
  [[ "${PERIPHERY_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "Invalid PERIPHERY_SHA256 in $manifest"
  [[ "${PERIPHERY_ASSET:-}" == "periphery-x86_64" ]] \
    || fail "Unsupported PERIPHERY_ASSET in $manifest: ${PERIPHERY_ASSET:-<unset>}"
  [[ "${PERIPHERY_RELEASE_TAG:-}" == "v${PERIPHERY_VERSION}" ]] \
    || fail "PERIPHERY_RELEASE_TAG must be v\${PERIPHERY_VERSION} in $manifest"
  [[ "${PERIPHERY_URL:-}" == "https://github.com/moghtech/komodo/releases/download/v${PERIPHERY_VERSION}/${PERIPHERY_ASSET}" ]] \
    || fail "PERIPHERY_URL does not match the pinned tag/asset in $manifest"
}

# assert_x86_64: Periphery is pinned to the x86_64 asset.
assert_x86_64() {
  case "$(uname -m)" in
    x86_64|amd64) ;;
    *) fail "Unsupported host architecture for the pinned Periphery artifact: $(uname -m)" ;;
  esac
}

# periphery_identity_present: persistent Noise identity already on the host?
periphery_identity_present() {
  [[ -f "$periphery_identity" && -s "$periphery_identity" && ! -L "$periphery_identity" ]]
}

# periphery_core_pub_present: pinned Core trust anchor already on the host?
periphery_core_pub_present() {
  [[ -f "$periphery_core_pub" && -s "$periphery_core_pub" && ! -L "$periphery_core_pub" ]]
}

# periphery_marker_state: valid | absent | corrupt
#
# The marker is the only durable proof that onboarding committed. Anything that
# is not exactly a root-owned, mode 0600, regular, non-symlink file holding the
# reviewed content counts as `corrupt`, so a tampered or partially written marker
# fails closed instead of being silently repaired.
periphery_marker_state() {
  if [[ ! -e "$periphery_marker" && ! -L "$periphery_marker" ]]; then
    printf 'absent'
    return 0
  fi
  if [[ ! -f "$periphery_marker" || ! -s "$periphery_marker" || -L "$periphery_marker" ]]; then
    printf 'corrupt'
    return 0
  fi
  local mode owner content
  mode="$(stat -c '%a' "$periphery_marker" 2>/dev/null || true)"
  owner="$(stat -c '%u' "$periphery_marker" 2>/dev/null || true)"
  content="$(cat "$periphery_marker" 2>/dev/null || true)"
  # Production runs this install as root, so the marker is root-owned; the
  # comparison uses the installing account so the fixtures can drive it too.
  if [[ "$mode" != 600 || "$owner" != "$(id -u)" || "$content" != "$periphery_marker_content" ]]; then
    printf 'corrupt'
    return 0
  fi
  printf 'valid'
}

service_active() { "$systemctl_bin" is-active --quiet periphery; }
service_inactive() { ! service_active; }
service_enabled() { "$systemctl_bin" is-enabled --quiet periphery; }

main_pid() { "$systemctl_bin" show periphery -p MainPID --value; }

# established_connections <pid>: outbound-established sockets to the pinned Core.
# Periphery dials Core over WireGuard; the check never uses a Komodo credential.
established_core_connections() {
  local pid="$1"
  ss -Htnp 2>/dev/null | grep -F "10.20.0.2:9120" | grep -F "pid=$pid," || true
}

# listener_on_8120: any host listener on the Periphery inbound port (must be none).
listener_on_8120() {
  ss -Hltn 'sport = :8120' 2>/dev/null || true
}

# process_env_is_clean <pid>
#   0 = the process environment is readable and holds no onboarding key
#   1 = the credential is still present in the process environment
#   2 = the environment cannot be read or is not a regular file, so a
#       credential-free process cannot be proven
#
# Fail closed: "cannot prove clean" is never reported as clean. systemd copies the
# EnvironmentFile into the process environment, and only a successful inspection
# can show that the credential is really gone.
process_env_is_clean() {
  local pid="$1" environ="$periphery_proc_root/$pid/environ" content
  [[ -r "$environ" ]] || return 2
  # A non-regular path is not an inspectable environment, and must be rejected
  # before the read: a FIFO here would otherwise block the check forever.
  [[ -f "$environ" ]] || return 2
  content="$(tr '\0' '\n' < "$environ")" || return 2
  if grep -q '^PERIPHERY_ONBOARDING_KEY=' <<<"$content"; then
    return 1
  fi
  return 0
}

# process_env_state_label <code>: the diagnostic for a non-zero probe result.
process_env_state_label() {
  case "$1" in
    1) printf 'PERIPHERY_ONBOARDING_KEY is still present in the process environment' ;;
    2) printf 'the process environment cannot be inspected, so a credential-free process cannot be proven' ;;
    *) printf 'the process environment was not inspected' ;;
  esac
}
