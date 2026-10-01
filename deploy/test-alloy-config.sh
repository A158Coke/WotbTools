#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGS=(
  "$ROOT/deploy/observability/alloy/config.alloy"
  "$ROOT/deploy/tx/alloy/config.alloy"
)
VALIDATOR="$ROOT/deploy/validate-alloy-config.sh"

# Canonical services are shared by application metrics, log streams and probes;
# legacy job/container_name values remain compatible with the existing dashboards.
grep -Eq 'replacement[[:space:]]*=[[:space:]]*"business-api"' "$ROOT/deploy/tx/alloy/config.alloy"
grep -Eq 'replacement[[:space:]]*=[[:space:]]*"web"' "$ROOT/deploy/tx/alloy/config.alloy"
grep -Eq 'replacement[[:space:]]*=[[:space:]]*"keycloak"' "$ROOT/deploy/tx/alloy/config.alloy"
! grep -Eq 'service:[[:space:]]*(wotb-backend|frontend|auth-endpoint)([[:space:]]|$)' "$ROOT/deploy/observability/prometheus/prometheus.yml"
! grep -Eq 'replacement[[:space:]]*=[[:space:]]*"frontend"' "$ROOT/deploy/tx/alloy/config.alloy"

for CONFIG in "${CONFIGS[@]}"; do
  [ -f "$CONFIG" ] || { echo "FAIL: missing Alloy config: $CONFIG" >&2; exit 1; }
  if ! bash "$VALIDATOR" "$CONFIG"; then
    # When the validator rejects a production config, print the canonical
    # formatting diff so the fix is mechanical instead of guesswork.
    echo "== alloy fmt -d diff for $CONFIG ==" >&2
    docker run --rm --entrypoint alloy \
      -v "$CONFIG:/etc/alloy/config.alloy:ro" \
      grafana/alloy:v1.4.2 fmt -d /etc/alloy/config.alloy >&2 || true
    exit 1
  fi

  grep -Fq 'loki.process "android_download"' "$CONFIG" || continue
  bad_config="$(mktemp)"
  trap 'rm -f "$bad_config"' EXIT
  cp "$CONFIG" "$bad_config"
  sed -i '0,/\[\.\]/s//\\\\./' "$bad_config"

  if bash "$VALIDATOR" "$bad_config" >/dev/null 2>&1; then
    echo "FAIL: validator accepted the invalid escaped-dot selector for $CONFIG" >&2
    exit 1
  fi
done

echo "OK: Alloy selector validator rejects the production failure spelling"
