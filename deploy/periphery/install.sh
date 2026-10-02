#!/usr/bin/env bash
# Install / reconcile the Komodo Periphery agent on one reviewed target (K3.2).
#
# The lifecycle is target-agnostic: the per-host differences (Server name, host
# mutation lock, staging root, privilege model) come from
# `targets/<target>/target.env` through `lib.sh`, so Yecao and TX1 share exactly
# this implementation.
#
# Idempotent reconciliation: the binary, the persistent config, and the systemd
# unit always come from the staged repository source, while the persistent Noise
# identity (`keys/periphery.key`), the pinned Core trust anchor (`keys/core.pub`),
# and the onboarding completion marker are never regenerated or overwritten.
#
# Onboarding completion is recorded by an explicit durable marker and NEVER
# inferred from the identity file: Komodo Periphery v2.3.3 generates
# `periphery.key` during startup (`state::periphery_keys().load()`), before Server
# onboarding can have succeeded. While the marker is absent the bootstrap
# credential is required on every attempt, so a half-finished first run is retried
# with the existing identity instead of wedging the host.
#
# The onboarding key is a BOOTSTRAP credential only, passed in as the generic
# KOMODO_PERIPHERY_ONBOARDING_KEY. It is written to a transient /run file (mode
# 0600, root-owned) for the handshake, deleted before the credential-free restart,
# and a bootstrap that fails after the service was started leaves Periphery
# STOPPED, so no live process can keep the credential.
set -Eeuo pipefail
umask 077

TARGET="${1:?usage: install.sh <target> <source-sha> <runtime-dir> <artifact-path>}"
SOURCE_SHA="${2:?usage: install.sh <target> <source-sha> <runtime-dir> <artifact-path>}"
runtime="${3:?usage: install.sh <target> <source-sha> <runtime-dir> <artifact-path>}"
artifact="${4:?usage: install.sh <target> <source-sha> <runtime-dir> <artifact-path>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/periphery/lib.sh
source "$script_dir/lib.sh"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid Komodo Periphery source SHA.'
assert_x86_64
load_target_profile "$TARGET" "$runtime"
load_release_manifest "$runtime/periphery.release"
for staged in "targets/$TARGET/target.env" "targets/$TARGET/periphery.config.toml" periphery.service; do
  require_real_file "$runtime/$staged" "Staged $staged"
done
require_real_file "$artifact" 'Staged Komodo Periphery artifact'

# Defense in depth, before anything on the host is mutated: a staged config or
# unit that carries the bootstrap credential must never be installed, even if the
# commit that produced it was wrong.
grep -q 'onboarding_key' "$periphery_config_source" \
  && fail 'The staged Komodo Periphery config must not contain an onboarding key.'
grep -q 'PERIPHERY_ONBOARDING_KEY' "$runtime/periphery.service" \
  && fail 'The staged Komodo Periphery unit must not embed the onboarding key.'
# Target isolation: one host must never be able to install another host's Server
# identity, and that must fail before anything on the host changes.
grep -Eq "^connect_as = \"$periphery_connect_as\"\$" "$periphery_config_source" \
  || fail "the staged $periphery_target config must set connect_as = \"$periphery_connect_as\"."

# --- host lock ---------------------------------------------------------------
# The target host's own mutation lock, shared with every other owner that mutates
# that host (Yecao: observability / ai-service; TX1: Business API / Frontend /
# Caddy / Alloy). `reconcile.sh` acquires it and passes the descriptor down so the
# whole transaction is serialized; a standalone run acquires it here. The lock and
# its root belong to the host's deploy owner, so Periphery never creates them.
require_existing_real_dir "$periphery_lock_root" "the $periphery_target host mutation lock root"
require_existing_lock_file "$periphery_lock_file"
if [[ -n "${PERIPHERY_DEPLOY_LOCK_FD:-}" ]]; then
  [[ "$PERIPHERY_DEPLOY_LOCK_FD" == 9 ]] || fail 'Unsupported inherited Periphery lock fd.'
  { true >&9; } 2>/dev/null || fail 'Inherited Periphery lock fd is unavailable.'
else
  exec 9>"$periphery_lock_file"
fi
flock -n 9 || fail "Another $periphery_target host mutation is running."

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

# --- helpers -----------------------------------------------------------------
bootstrap_written=false
bootstrap_started=false
bootstrap_committed=false
onboarding_key=

# Any exit that did not commit onboarding must leave no usable credential behind:
# the transient file is removed AND the service is stopped, because systemd
# already copied the credential into the running process environment and deleting
# the EnvironmentFile cannot take it back out of /proc/<pid>/environ.
cleanup_bootstrap() {
  local status=$? attempt
  if [[ "$bootstrap_written" == true ]]; then
    rm -f -- "$periphery_bootstrap_env"
  fi
  if [[ "$bootstrap_started" == true && "$bootstrap_committed" != true ]]; then
    echo 'Komodo Periphery bootstrap did not commit: stopping periphery.service so no live process keeps the bootstrap credential.' >&2
    "$systemctl_bin" stop periphery >/dev/null 2>&1 || true
    for attempt in $(seq 1 "$stop_attempts"); do
      if service_inactive; then
        break
      fi
      [[ "$stop_sleep" -gt 0 ]] && sleep "$stop_sleep"
    done
    if service_active; then
      # A plain stop was not enough. Force-kill before giving up: a live process
      # whose environment still holds the bootstrap credential is worse than a
      # failed workflow.
      echo 'komodo-periphery: periphery.service is still active after stop; force-killing it because the bootstrap credential must not stay live.' >&2
      "$systemctl_bin" kill --kill-who=all --signal=KILL periphery >/dev/null 2>&1 || true
      for attempt in $(seq 1 "$stop_attempts"); do
        if service_inactive; then
          break
        fi
        [[ "$stop_sleep" -gt 0 ]] && sleep "$stop_sleep"
      done
    fi
    if service_active; then
      echo 'CRITICAL: komodo-periphery could not terminate periphery.service after a failed bootstrap. A Periphery process whose environment may still contain PERIPHERY_ONBOARDING_KEY can be alive on this host. Kill it before retrying, for example: systemctl kill --kill-who=all --signal=KILL periphery; ps -ef | grep [p]eriphery' >&2
      status=1
    fi
  fi
  return "$status"
}
trap cleanup_bootstrap EXIT

# The first handshake is done when Periphery has an identity, has pinned the Core
# public key, and holds a live outbound connection to Core.
bootstrap_ready() {
  local pid
  pid="$(main_pid 2>/dev/null || true)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || [[ "$pid" -le 0 ]]; then
    return 1
  fi
  periphery_identity_present || return 1
  periphery_core_pub_present || return 1
  [[ -n "$(established_core_connections "$pid")" ]] || return 1
  return 0
}

# The credential-free restart is good when the service is active, the transient
# file is gone, the process environment is provably credential-free, and the
# outbound connection came back purely from the persistent identity.
credential_free_env_state=-1
credential_free_ready() {
  local pid
  pid="$(main_pid 2>/dev/null || true)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || [[ "$pid" -le 0 ]]; then
    credential_free_env_state=-1
    return 1
  fi
  if ! service_active; then
    credential_free_env_state=-1
    return 1
  fi
  if [[ -e "$periphery_bootstrap_env" ]]; then
    credential_free_env_state=-1
    return 1
  fi
  # Fail closed. 1 = the credential is still in the environment, 2 = the
  # environment cannot be inspected. Both block the onboarding commit; neither is
  # evidence that the process is credential-free.
  credential_free_env_state=0
  process_env_is_clean "$pid" || credential_free_env_state=$?
  if [[ "$credential_free_env_state" != 0 ]]; then
    return 1
  fi
  [[ -n "$(established_core_connections "$pid")" ]] || return 1
  return 0
}

wait_for() {
  local attempts="$1" sleep_seconds="$2" check="$3" attempt
  for attempt in $(seq 1 "$attempts"); do
    if "$check"; then
      return 0
    fi
    [[ "$sleep_seconds" -gt 0 ]] && sleep "$sleep_seconds"
  done
  return 1
}

# Commit the bootstrap transaction. Written LAST and atomically, only after the
# credential-free restart has been proven healthy.
commit_onboarding() {
  local incoming="$periphery_marker.incoming"
  [[ ! -L "$incoming" ]] \
    || fail "Refusing to write the Komodo Periphery onboarding marker through a symlinked staging path: $incoming"
  ( umask 077; printf '%s\n' "$periphery_marker_content" > "$incoming" )
  chmod 600 "$incoming"
  mv -f -- "$incoming" "$periphery_marker"
  [[ "$(periphery_marker_state)" == valid ]] \
    || fail 'The Komodo Periphery onboarding marker is not a valid root-owned regular file.'
}

# --- onboarding state machine -------------------------------------------------
# A) marker valid + identity valid + core.pub valid  -> onboarding is complete and
#    the bootstrap credential is neither required nor read, so the operator may
#    delete the host's onboarding secret from GitHub and the UI onboarding key.
# B) marker absent + credential available            -> bootstrap, or retry a
#    previous failed bootstrap reusing the identity it already generated.
# C) marker absent + no credential                   -> fail closed before any
#    host mutation: no identity is generated and nothing is re-onboarded.
# D) marker present but the identity or core.pub is missing/unsafe -> corrupted
#    completed state; fail closed instead of silently regenerating anything.
onboarding_required=false
marker_state="$(periphery_marker_state)"
case "$marker_state" in
  valid)
    periphery_identity_present || fail \
      'Corrupted Komodo Periphery state: onboarding is marked complete but the persistent identity is missing or unsafe.'
    periphery_core_pub_present || fail \
      'Corrupted Komodo Periphery state: onboarding is marked complete but the pinned Core public key is missing or unsafe.'
    rm -f -- "$periphery_bootstrap_env"
    echo "Komodo Periphery onboarding already complete on $periphery_target: the bootstrap credential is not required."
    ;;
  absent)
    onboarding_required=true
    onboarding_key="${KOMODO_PERIPHERY_ONBOARDING_KEY:-}"
    [[ -n "$onboarding_key" ]] || fail \
      "Komodo Periphery onboarding has not completed on $periphery_target and no KOMODO_PERIPHERY_ONBOARDING_KEY is available. Refusing to generate a Server identity or to re-onboard automatically."
    if periphery_identity_present; then
      echo 'Reusing the Komodo Periphery identity left by a previous attempt; onboarding will be retried.'
    fi
    ;;
  *)
    fail 'Corrupted Komodo Periphery onboarding marker (unsafe path type, wrong mode or owner, or unexpected content). Refusing to continue.'
    ;;
esac

# --- desired-state changes ---------------------------------------------------
# Recorded explicitly, and BEFORE anything is replaced, so an idempotent reconcile
# can leave an already-correct, healthy service completely untouched. Stopping the
# service preemptively is not an option: the restart decision below would then have
# nothing left to distinguish "already active" from "left stopped".
service_was_active=false
if service_active; then
  service_was_active=true
fi
file_sha() { [[ -f "$1" && ! -L "$1" ]] && sha256sum "$1" | awk '{print $1}' || true; }
config_before="$(file_sha "$periphery_config")"
unit_before="$(file_sha "$periphery_unit")"
binary_before="$(file_sha "$periphery_bin")"

# --- persistent config + systemd unit (repo-owned, replaced deterministically) --
install -m 600 "$periphery_config_source" "$periphery_config.incoming"
mv -f -- "$periphery_config.incoming" "$periphery_config"
install -m 644 "$runtime/periphery.service" "$periphery_unit.incoming"
mv -f -- "$periphery_unit.incoming" "$periphery_unit"

# --- binary (atomic replace) --------------------------------------------------
# Safe to replace while Periphery runs: the running process keeps the inode it
# started from, so availability is preserved and the restart decision below is what
# makes the new binary take effect.
install -m 0755 "$artifact" "$periphery_bin.incoming"
mv -f -- "$periphery_bin.incoming" "$periphery_bin"
installed_sha="$(sha256sum "$periphery_bin" | awk '{print $1}')"
[[ "$installed_sha" == "$PERIPHERY_SHA256" ]] || fail \
  "Installed $periphery_bin does not match the pinned release (got $installed_sha)."

binary_changed=false
config_changed=false
unit_changed=false
[[ "$binary_before" == "$PERIPHERY_SHA256" ]] || binary_changed=true
[[ "$config_before" == "$(file_sha "$periphery_config")" ]] || config_changed=true
[[ "$unit_before" == "$(file_sha "$periphery_unit")" ]] || unit_changed=true

"$systemctl_bin" daemon-reload

if [[ "$onboarding_required" == true ]]; then
  # The service is deliberately NOT enabled yet: it only starts for the bootstrap
  # handshake, and it is enabled once onboarding has fully committed.
  ( umask 077; printf 'PERIPHERY_ONBOARDING_KEY=%s\n' "$onboarding_key" > "$periphery_bootstrap_env" )
  chmod 600 "$periphery_bootstrap_env"
  bootstrap_written=true
  unset onboarding_key

  bootstrap_started=true
  "$systemctl_bin" restart periphery

  if ! wait_for "$onboard_attempts" "$onboard_sleep" bootstrap_ready; then
    "$systemctl_bin" status periphery --no-pager >&2 || true
    journalctl -u periphery --no-pager -n 80 >&2 || true
    fail 'Komodo Periphery onboarding did not complete (no identity, no pinned Core key, or no outbound connection to Core).'
  fi

  # Drop the credential, then prove a credential-free start still reaches Core.
  rm -f -- "$periphery_bootstrap_env"
  bootstrap_written=false
  "$systemctl_bin" restart periphery

  if ! wait_for "$verify_attempts" "$verify_sleep" credential_free_ready; then
    "$systemctl_bin" status periphery --no-pager >&2 || true
    journalctl -u periphery --no-pager -n 80 >&2 || true
    fail "Komodo Periphery did not reconnect without the bootstrap credential, or its process environment is not provably clean: $(process_env_state_label "$credential_free_env_state")."
  fi

  # Commit point, written last.
  commit_onboarding
  bootstrap_committed=true
  "$systemctl_bin" enable periphery >/dev/null
  echo 'Komodo Periphery onboarded: credential removed, credential-free reconnect proven, onboarding marker committed.'
else
  "$systemctl_bin" enable periphery >/dev/null
  # Ordinary reconcile: no bootstrap credential is involved anywhere. Restart only
  # when the running agent's desired state actually changed or it is not running, so
  # a completed, healthy host stays active and is not disturbed — and can never be
  # left stopped by an idempotent run.
  if [[ "$binary_changed" == true || "$config_changed" == true || "$unit_changed" == true \
     || "$service_was_active" != true ]]; then
    "$systemctl_bin" restart periphery
  else
    echo "Komodo Periphery already at the desired state on $periphery_target: the running service is untouched."
  fi
fi

echo "Komodo Periphery install complete on $periphery_target: $periphery_bin (v$PERIPHERY_VERSION, $SOURCE_SHA)"
