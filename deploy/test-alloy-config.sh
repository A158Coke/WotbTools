#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGS=(
  "$ROOT/deploy/observability/alloy/config.alloy"
  "$ROOT/deploy/tx/alloy/config.alloy"
)
VALIDATOR="$ROOT/deploy/validate-alloy-config.sh"

for CONFIG in "${CONFIGS[@]}"; do
  [ -f "$CONFIG" ] || { echo "FAIL: missing Alloy config: $CONFIG" >&2; exit 1; }
  bash "$VALIDATOR" "$CONFIG"

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
