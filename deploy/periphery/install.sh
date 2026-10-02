#!/usr/bin/env bash
# Install / reconcile the Komodo Periphery agent on Yecao (K3.1).
#
# Idempotent reconciliation: the binary, the persistent config, and the systemd
# unit always come from the staged repository source, while the persistent Noise
# identity (`keys/periphery.key`) and the pinned Core trust anchor
# (`keys/core.pub`) are never regenerated, overwritten, or re-onboarded.
#
# The onboarding key is a BOOTSTRAP credential only. It is written to a transient
# /run file (mode 0600, root-owned) for the first handshake, then deleted before
# the final restart, so it never reaches the persistent config, this unit's own
# environment, or the final process environment.
set -Eeuo pipefail
umask 077

SOURCE_SHA="${1:?usage: install.sh <source-sha> <runtime-dir> <artifact-path>}"
runtime="${2:?usage: install.sh <source-sha> <runtime-dir> <artifact-path>}"
artifact="${3:?usage: install.sh <source-sha> <runtime-dir> <artifact-path>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/periphery/lib.sh
source "$script_dir/lib.sh"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid Komodo Periphery source SHA.'
assert_x86_64
load_release_manifest "$runtime/periphery.release"
for staged in periphery.config.toml periphery.service; do
  require_real_file "$runtime/$staged" "Staged $staged"
done
require_real_file "$artifact" 'Staged Komodo Periphery artifact'

# Defense in depth, before anything on the host is mutated: a staged config or
# unit that carries the bootstrap credential must never be installed, even if the
# commit that produced it was wrong.
grep -q 'onboarding_key' "$runtime/periphery.config.toml" \
  && fail 'The staged Komodo Periphery config must not contain an onboarding key.'
grep -q 'PERIPHERY_ONBOARDING_KEY' "$runtime/periphery.service" \
  && fail 'The staged Komodo Periphery unit must not embed the onboarding key.'

# --- host lock ---------------------------------------------------------------
# The Yecao host-level lock, shared with the observability / ai-service owners
# that mutate the same host and Docker daemon. `reconcile.sh` acquires it and
# passes the descriptor down so the whole transaction is serialized; a standalone
# run acquires it here.
require_real_dir "$periphery_wotb_root"
if [[ -n "${PERIPHERY_DEPLOY_LOCK_FD:-}" ]]; then
  [[ "$PERIPHERY_DEPLOY_LOCK_FD" == 9 ]] || fail 'Unsupported inherited Periphery lock fd.'
  { true >&9; } 2>/dev/null || fail 'Inherited Periphery lock fd is unavailable.'
else
  exec 9>"$periphery_wotb_root/.deploy.lock"
fi
flock -n 9 || fail 'Another Yecao host mutation is running.'

# --- artifact verification (the runner verified it too; the host re-verifies) --
artifact_sha="$(sha256sum "$artifact" | awk '{print $1}')"
[[ "$artifact_sha" == "$PERIPHERY_SHA256" ]] || fail \
  "Staged Komodo Periphery artifact failed SHA256 verification (got $artifact_sha, expected $PERIPHERY_SHA256)."

# --- target paths ------------------------------------------------------------
# Every component must be a real directory, and a file we are about to replace
# must not be a symlink: a symlinked target would let the install escape /etc,
# /usr/local/bin, or the systemd unit directory.
require_real_dir "$periphery_etc"
require_real_dir "$periphery_etc/keys"
require_real_dir "$(dirname "$periphery_bin")"
require_real_dir "$periphery_unit_dir"
require_real_dir "$periphery_run_dir"

require_replaceable_file() {
  local path="$1"
  [[ ! -L "$path" ]] || fail "Refusing to replace a symlinked Komodo Periphery file: $path"
  [[ ! -e "$path" || -f "$path" ]] || fail "Refusing to replace a non-regular Komodo Periphery file: $path"
}
require_replaceable_file "$periphery_config"
require_replaceable_file "$periphery_unit"
require_replaceable_file "$periphery_bin"

# --- onboarding decision -----------------------------------------------------
# A valid persistent identity means onboarding is finished for good: the
# bootstrap secret is neither required nor read, so the operator may delete
# KOMODO_YECAO_ONBOARDING_KEY from GitHub and the UI onboarding key afterwards.
onboarding_required=false
onboarding_key=
bootstrap_written=false
# Safety net for the failure paths only. The successful path below removes the
# credential explicitly, *before* the final restart, because the ordering is the
# point: the last Periphery start must not be able to read it at all.
cleanup_bootstrap() {
  if [[ "$bootstrap_written" == true ]]; then
    rm -f -- "$periphery_bootstrap_env"
  fi
}
trap cleanup_bootstrap EXIT
if periphery_identity_present; then
  # Defensive: never leave a bootstrap credential behind once an identity exists.
  rm -f -- "$periphery_bootstrap_env"
  echo 'Persistent Komodo Periphery identity present: onboarding is not required.'
else
  onboarding_required=true
  onboarding_key="${KOMODO_YECAO_ONBOARDING_KEY:-}"
  [[ -n "$onboarding_key" ]] || fail \
    'No persistent Komodo Periphery identity and no KOMODO_YECAO_ONBOARDING_KEY. Refusing to generate a new Server identity or re-onboard automatically.'
fi

# --- persistent config + systemd unit (repo-owned, replaced deterministically) --
file_sha() { [[ -f "$1" && ! -L "$1" ]] && sha256sum "$1" | awk '{print $1}' || true; }
config_before="$(file_sha "$periphery_config")"
unit_before="$(file_sha "$periphery_unit")"
binary_before="$(file_sha "$periphery_bin")"
install -m 600 "$runtime/periphery.config.toml" "$periphery_config.incoming"
mv -f -- "$periphery_config.incoming" "$periphery_config"
install -m 644 "$runtime/periphery.service" "$periphery_unit.incoming"
mv -f -- "$periphery_unit.incoming" "$periphery_unit"

# --- binary (atomic replace with the service stopped) ------------------------
service_was_active=false
if service_active; then
  service_was_active=true
  "$systemctl_bin" stop periphery
fi
install -m 0755 "$artifact" "$periphery_bin.incoming"
mv -f -- "$periphery_bin.incoming" "$periphery_bin"
installed_sha="$(sha256sum "$periphery_bin" | awk '{print $1}')"
[[ "$installed_sha" == "$PERIPHERY_SHA256" ]] || fail \
  "Installed $periphery_bin does not match the pinned release (got $installed_sha)."

"$systemctl_bin" daemon-reload
"$systemctl_bin" enable periphery >/dev/null

# --- first onboarding ---------------------------------------------------------
if [[ "$onboarding_required" == true ]]; then
  # Transient bootstrap credential: tmpfs under /run, 0600, root-owned, and
  # removed again below. It is never written to the config, the unit, or the
  # process environment of the final restart.
  ( umask 077; printf 'PERIPHERY_ONBOARDING_KEY=%s\n' "$onboarding_key" > "$periphery_bootstrap_env" )
  chmod 600 "$periphery_bootstrap_env"
  bootstrap_written=true
  unset onboarding_key

  "$systemctl_bin" restart periphery

  # Onboarding succeeded only when Periphery has generated its persistent
  # identity, pinned the Core public key, and holds a live outbound connection to
  # Core. The identity file appears at startup, so the connection is what proves
  # the handshake actually completed.
  onboarded=false
  for attempt in $(seq 1 "$onboard_attempts"); do
    pid="$(main_pid 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" -gt 0 ]] \
       && periphery_identity_present \
       && [[ -f "$periphery_core_pub" && -s "$periphery_core_pub" && ! -L "$periphery_core_pub" ]] \
       && [[ -n "$(established_core_connections "$pid")" ]]; then
      onboarded=true
      break
    fi
    [[ "$onboard_sleep" -gt 0 ]] && sleep "$onboard_sleep"
  done
  if [[ "$onboarded" != true ]]; then
    "$systemctl_bin" status periphery --no-pager >&2 || true
    journalctl -u periphery --no-pager -n 80 >&2 || true
    rm -f -- "$periphery_bootstrap_env"
    fail 'Komodo Periphery did not complete onboarding (no persistent identity, pinned Core key, or outbound connection).'
  fi

  # The bootstrap credential has done its job. Drop it before the final restart,
  # which then relies purely on the persistent Periphery identity.
  rm -f -- "$periphery_bootstrap_env"
  bootstrap_written=false
  "$systemctl_bin" restart periphery
  echo 'Komodo Periphery onboarded; bootstrap credential removed.'
else
  # Ordinary reconcile: the persistent identity is already in place, so no
  # bootstrap credential is involved anywhere. Restart only when something the
  # running agent actually consumes changed, or when it is not running at all.
  if [[ "$binary_before" != "$PERIPHERY_SHA256" || "$config_before" != "$(file_sha "$periphery_config")" \
     || "$unit_before" != "$(file_sha "$periphery_unit")" || "$service_was_active" != true ]]; then
    "$systemctl_bin" restart periphery
  fi
fi

echo "Komodo Periphery install complete: $periphery_bin (v$PERIPHERY_VERSION, $SOURCE_SHA)"
