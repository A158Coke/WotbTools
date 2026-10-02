#!/usr/bin/env bash
# Runtime verification for the private Komodo controller.
#
# Proves the K1 boundary: only `mongo` and `core` exist in the `komodo` project,
# MongoDB publishes no host port, Core publishes the Yecao WireGuard address
# alone, and the pinned Core answers on that address. Nothing here touches
# unrelated WotBTools workloads, TX, or DNS.
set -Eeuo pipefail

root=/opt/komodo
compose_file="$root/compose.yml"
controller_bind=10.20.0.2:9120
# Bumping the Core digest in `compose.yml` requires bumping this value in the
# same change. The digest currently pinned is the official GHCR multi-arch index
# resolved from the `2.3.3` tag, so `/version` must report exactly this.
pinned_core_version=2.3.3

[[ -f "$compose_file" && ! -L "$compose_file" ]] || { echo 'Komodo live Compose file is unavailable.' >&2; exit 1; }
for command_name in docker curl; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 2; }
done

compose() { docker compose -p komodo -f "$compose_file" "$@"; }

for service in mongo core; do
  id="$(compose ps -q "$service")"
  test -n "$id" || { echo "Komodo $service container is missing." >&2; exit 1; }
  state="$(docker inspect --format '{{.State.Status}}' "$id")"
  [[ "$state" == running ]] || {
    compose logs --tail 120 "$service" >&2 || true
    echo "Komodo $service is not running: $state" >&2
    exit 1
  }
done

# Only the two controller services may exist in the `komodo` project, stopped
# containers included: a Periphery agent or an adopted workload is out of scope
# for this bootstrap phase.
project_services="$(docker ps -a --filter 'label=com.docker.compose.project=komodo' \
  --format '{{.Label "com.docker.compose.service"}}' | sort -u | tr '\n' ' ')"
[[ "$project_services" == "core mongo " ]] || {
  echo "Unexpected containers in the Komodo project: ${project_services:-<none>}" >&2
  exit 1
}

mongo_id="$(compose ps -q mongo)"
[[ -z "$(docker port "$mongo_id")" ]] || {
  echo 'MongoDB must not publish a host port.' >&2
  exit 1
}

core_id="$(compose ps -q core)"
listen="$(docker port "$core_id" 9120/tcp)"
[[ "$listen" == "$controller_bind" ]] || {
  echo "Unexpected Komodo Core host bind: $listen" >&2
  exit 1
}

# No container on this host may publish 9120 on a wildcard address, and no host
# listener may exist outside the WireGuard bind. An empty `ss` result is
# accepted: Docker can publish through iptables without a userland listener.
host_ports="$(docker ps --format '{{.Names}} {{.Ports}}')"
if grep -Eq '(0\.0\.0\.0|\[::\]|:::):9120' <<<"$host_ports"; then
  grep -E ':9120' <<<"$host_ports" >&2
  echo 'Komodo Core port 9120 is published on a wildcard address.' >&2
  exit 1
fi
if command -v ss >/dev/null; then
  while IFS= read -r address; do
    [[ -z "$address" ]] && continue
    [[ "$address" == "$controller_bind" ]] || {
      echo "Unexpected host listener for Komodo Core: $address" >&2
      exit 1
    }
  done < <(ss -H -ltn 'sport = :9120' | awk '{print $4}')
fi

# `/version` is unauthenticated and returns the Core release, so it proves both
# reachability over WireGuard and that the pinned release is what is running.
# A restarting container can look `running` between crashes, so bound the retries
# and fail instead of treating a crash loop as healthy.
reported_version=
for attempt in $(seq 1 60); do
  if reported_version="$(curl --fail --silent --show-error --max-time 5 \
    "http://$controller_bind/version" 2>/dev/null)" && [[ -n "$reported_version" ]]; then
    break
  fi
  reported_version=
  [[ "$attempt" -lt 60 ]] && sleep 2
done
[[ "$reported_version" == "$pinned_core_version" ]] || {
  compose logs --tail 160 core >&2 || true
  echo "Komodo Core did not report the pinned version $pinned_core_version on the Yecao WireGuard bind (reported: ${reported_version:-<unreachable>})." >&2
  exit 1
}

# The UI surface that TX Caddy will proxy in K2 must already answer privately.
curl --fail --silent --show-error --max-time 10 -o /dev/null "http://$controller_bind/" || {
  compose logs --tail 160 core >&2 || true
  echo 'Komodo Core did not serve its frontend on the Yecao WireGuard bind.' >&2
  exit 1
}

echo "Komodo private controller health: PASS (Core $reported_version)"
