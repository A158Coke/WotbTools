#!/usr/bin/env bash
# Shared Komodo Periphery helpers (K3.1), sourced by `install.sh`, `verify.sh`,
# `reconcile.sh`, and the local fixtures. Keeping the path rules and the release
# pin parsing here gives them exactly one audited implementation.
set -Eeuo pipefail

# --- production paths --------------------------------------------------------
# The PERIPHERY_* overrides exist only so `deploy/periphery/test-*.sh` can drive
# the real scripts against a disposable tree. The workflow never sets them.
periphery_etc="${PERIPHERY_ETC_DIR:-/etc/komodo}"
periphery_bin="${PERIPHERY_BIN_PATH:-/usr/local/bin/periphery}"
periphery_unit_dir="${PERIPHERY_UNIT_DIR:-/etc/systemd/system}"
periphery_unit="$periphery_unit_dir/periphery.service"
periphery_run_dir="${PERIPHERY_RUN_DIR:-/run/komodo}"
periphery_bootstrap_env="$periphery_run_dir/periphery-bootstrap.env"
periphery_opt_root="${PERIPHERY_OPT_ROOT:-/opt/periphery}"
# Read-only inspection root for process environments, so the fixtures can prove
# the credential-free check in both directions.
periphery_proc_root="${PERIPHERY_PROC_ROOT:-/proc}"
# The Yecao host-level mutation lock, shared with the observability / ai-service
# owners that mutate the same host and Docker daemon.
periphery_wotb_root="${PERIPHERY_WOTB_ROOT:-/opt/wotb}"
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
  periphery_opt_root periphery_wotb_root periphery_proc_root; do
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

# require_real_file <path> <label>
#
# Production state (the Periphery identity, the Core trust anchor, a staged
# artifact) must be a regular, non-empty, non-symlink file.
require_real_file() {
  local path="$1" label="$2"
  [[ -f "$path" && -s "$path" && ! -L "$path" ]] \
    || fail "$label is missing, empty, or unsafe: $path"
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

# process_env_has_onboarding_key <pid>: does the live process still carry the
# bootstrap credential? systemd copies the EnvironmentFile into the process
# environment, so deleting that file does NOT clear /proc/<pid>/environ. An
# unreadable environment cannot disprove the presence of the key, so it is
# reported as "not present" and the caller's other checks still apply.
process_env_has_onboarding_key() {
  local pid="$1" environ="$periphery_proc_root/$pid/environ"
  [[ -r "$environ" ]] || return 1
  tr '\0' '\n' < "$environ" | grep -q '^PERIPHERY_ONBOARDING_KEY='
}
