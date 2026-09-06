#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/deploy/observability/alloy/config.alloy"
VALIDATOR="$ROOT/deploy/validate-alloy-config.sh"

bash "$VALIDATOR" "$CONFIG"

bad_config="$(mktemp)"
trap 'rm -f "$bad_config"' EXIT
cp "$CONFIG" "$bad_config"
sed -i '0,/\[\.\]/s//\\\\./' "$bad_config"

if bash "$VALIDATOR" "$bad_config" >/dev/null 2>&1; then
  echo "FAIL: validator accepted the invalid escaped-dot selector" >&2
  exit 1
fi

echo "OK: Alloy selector validator rejects the production failure spelling"
