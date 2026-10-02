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

for path_name in periphery_etc periphery_bin periphery_unit_dir periphery_run_dir \
  periphery_opt_root periphery_wotb_root; do
  path_value="${!path_name}"
  [[ "$path_value" == /* && "$path_value" != *..* ]] || {
    echo "Refusing unsafe Komodo Periphery path ($path_name): $path_value" >&2
    exit 2
  }
done
for count_name in onboard_attempts onboard_sleep verify_attempts verify_sleep; do
  [[ "${!count_name}" =~ ^[0-9]+$ ]] || {
    echo "Refusing non-numeric $count_name: ${!count_name}" >&2
    exit 2
  }
done

periphery_identity="$periphery_etc/keys/periphery.key"
periphery_core_pub="$periphery_etc/keys/core.pub"
periphery_config="$periphery_etc/periphery.config.toml"

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
