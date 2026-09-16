#!/usr/bin/env bash
# Read-only TX host preflight. Secrets are validated by the GitHub workflow;
# this script checks only host capabilities and WireGuard reachability.
set -Eeuo pipefail

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker compose version >/dev/null || { echo "docker compose is required" >&2; exit 1; }
command -v tofu >/dev/null || { echo "tofu is required" >&2; exit 1; }
ip link show wg0 >/dev/null || { echo "wg0 is required" >&2; exit 1; }
ip -4 addr show dev wg0 | grep -Eq 'inet 10\.20\.0\.1/24([[:space:]]|$)' \
  || { echo "wg0 must have 10.20.0.1/24" >&2; exit 1; }
ip route get 10.20.0.2 >/dev/null || { echo "10.20.0.2 route is required" >&2; exit 1; }
timeout 3 bash -c 'cat </dev/null >/dev/tcp/10.20.0.2/8087' \
  || { echo "10.20.0.2:8087 is unreachable" >&2; exit 1; }

echo TX_PREFLIGHT_OK
