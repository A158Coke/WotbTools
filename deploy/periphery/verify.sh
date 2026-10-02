#!/usr/bin/env bash
# Production verification for the Yecao Komodo Periphery agent (K3.1).
#
# Read-only, and deliberately credential-free: onboarding is proven by the
# agent's own outbound connection to the pinned Core address and by the persistent
# identity it generated, never by the Komodo admin API.
set -Eeuo pipefail

runtime="${1:?usage: verify.sh <runtime-dir>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/periphery/lib.sh
source "$script_dir/lib.sh"

load_release_manifest "$runtime/periphery.release"

reported_version() {
  local out
  out="$("$periphery_bin" --version 2>&1 || true)"
  grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<<"$out" | head -n1
}

# 1. The installed binary is exactly the pinned release.
require_real_file "$periphery_bin" 'Installed Komodo Periphery binary'
installed_sha="$(sha256sum "$periphery_bin" | awk '{print $1}')"
[[ "$installed_sha" == "$PERIPHERY_SHA256" ]] || fail \
  "Installed binary does not match the pinned release (got $installed_sha, expected $PERIPHERY_SHA256)."
echo "PASS periphery-binary-sha256 $installed_sha"

# 2. The binary reports the pinned version.
version="$(reported_version)"
[[ "$version" == "$PERIPHERY_VERSION" ]] || fail \
  "Installed Periphery reports '${version:-<none>}', expected $PERIPHERY_VERSION."
echo "PASS periphery-version v$version"

# 3. systemd owns the lifecycle and the unit is live.
service_enabled || fail 'periphery.service is not enabled.'
service_active || fail 'periphery.service is not active.'
echo 'PASS periphery-systemd enabled+active'

# 4. The persistent identity and the pinned Core trust anchor are real state.
require_real_file "$periphery_identity" 'Persistent Komodo Periphery identity'
require_real_file "$periphery_core_pub" 'Pinned Komodo Core public key'
echo 'PASS periphery-persistent-identity'

# 4b. Onboarding committed. The identity file alone proves nothing: Periphery
# generates it during startup, before Server onboarding has succeeded.
marker_state="$(periphery_marker_state)"
[[ "$marker_state" == valid ]] || fail \
  "the durable Komodo Periphery onboarding marker is missing or unsafe (state: $marker_state): $periphery_marker"
echo 'PASS periphery-onboarding-complete'

# 5 + 9. Outbound connectivity from the running PID, after the final restart that
# no longer has the bootstrap credential available.
pid="$(main_pid 2>/dev/null || true)"
[[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" -gt 0 ]] || fail "periphery.service has no main PID ($pid)."
if [[ -e "$periphery_bootstrap_env" ]]; then
  fail "the transient bootstrap credential survived: $periphery_bootstrap_env"
fi
# Fail closed: an environment that cannot be inspected is NOT evidence that the
# credential is absent, so it is a hard verification failure.
process_env_state=0
process_env_is_clean "$pid" || process_env_state=$?
if [[ "$process_env_state" != 0 ]]; then
  fail "cannot prove the running Periphery process is credential-free: $(process_env_state_label "$process_env_state")."
fi
echo 'PASS periphery-process-env-clean'
connected=false
for attempt in $(seq 1 "$verify_attempts"); do
  if [[ -n "$(established_core_connections "$pid")" ]]; then
    connected=true
    break
  fi
  [[ "$verify_sleep" -gt 0 ]] && sleep "$verify_sleep"
done
[[ "$connected" == true ]] || fail \
  "Periphery (pid $pid) has no outbound connection to the pinned Core address 10.20.0.2:9120."
service_active || fail 'periphery.service became inactive during verification.'
echo "PASS periphery-outbound-connected pid=$pid -> 10.20.0.2:9120"

# 6. Outbound-only: Periphery must not listen on its inbound port.
listeners="$(listener_on_8120)"
[[ -z "$listeners" ]] || fail "Periphery must not listen on :8120, found: $listeners"
echo 'PASS periphery-no-inbound-8120'

# 7. The persistent config still expresses the reviewed outbound intent.
grep -Eq '^core_addresses = \["http://10\.20\.0\.2:9120"\]$' "$periphery_config" \
  || fail "persistent config must set core_addresses to the WireGuard Core address: $periphery_config"
grep -Eq '^connect_as = "yecao"$' "$periphery_config" \
  || fail "persistent config must set connect_as = \"yecao\": $periphery_config"
grep -Eq '^server_enabled = false$' "$periphery_config" \
  || fail "persistent config must set server_enabled = false: $periphery_config"
grep -Eq '^root_directory = "/etc/komodo"$' "$periphery_config" \
  || fail "persistent config must set root_directory = \"/etc/komodo\": $periphery_config"
echo 'PASS periphery-config-outbound-only'

# 8. No onboarding key is persisted anywhere that outlives the bootstrap.
if grep -Eq '(^|[^_])onboarding_key|PERIPHERY_ONBOARDING_KEY' "$periphery_config"; then
  fail "the persistent config must not contain an onboarding key: $periphery_config"
fi
if grep -q 'PERIPHERY_ONBOARDING_KEY' "$periphery_unit"; then
  fail "the systemd unit must not embed an onboarding key: $periphery_unit"
fi
echo 'PASS periphery-no-persisted-onboarding-key'

# 10. Docker is reachable for the container discovery Periphery performs.
[[ -S "$periphery_docker_socket" ]] \
  || fail "$periphery_docker_socket is missing: Periphery cannot discover containers."
[[ -r "$periphery_docker_socket" && -w "$periphery_docker_socket" ]] \
  || fail "$periphery_docker_socket is not readable and writable for the Periphery context."
docker info >/dev/null 2>&1 || fail 'the Docker daemon is not reachable from the Periphery host context.'
unit_user="$("$systemctl_bin" show periphery -p User --value 2>/dev/null || true)"
[[ -z "$unit_user" || "$unit_user" == root ]] \
  || fail "periphery.service runs as '$unit_user'; K3.1 expects the root systemd context with Docker access."
echo 'PASS periphery-docker-access'

echo "Komodo Periphery verification: PASS (v$PERIPHERY_VERSION, pid $pid)"
