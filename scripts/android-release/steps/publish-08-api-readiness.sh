#!/usr/bin/env bash
set -euo pipefail
STAGING="$RUNNER_TEMP/staging.json"
ORIGIN="$(jq -r '.runtimeOrigin' "$STAGING")"
API="$(jq -r '.apiOrigin' "$STAGING")"
STATUS="$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null \
  -D "$RUNNER_TEMP/api-preflight.headers" -w '%{http_code}' -X OPTIONS \
  -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,content-type,content-encoding,accept' \
  "$API/api/users/profile")"
python3 scripts/android-release/android_contract.py cors \
  --headers "$RUNNER_TEMP/api-preflight.headers" --status "$STATUS" --origin "$ORIGIN" \
  --methods GET,POST,PUT,PATCH,DELETE,OPTIONS --request-headers authorization,content-type,content-encoding,accept
STATUS="$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null \
  -D "$RUNNER_TEMP/api-read.headers" -w '%{http_code}' -H "Origin: $ORIGIN" "$API/api/users/profile")"
python3 scripts/android-release/android_contract.py cors \
  --headers "$RUNNER_TEMP/api-read.headers" --status "$STATUS" --expected-status 401 --origin "$ORIGIN"
ASSET_ORIGIN="$STEP_STAGED_ASSETORIGIN"
STATUS="$(curl -sS --connect-timeout 5 --max-time 20 -o "$RUNNER_TEMP/asset-index.json" \
  -w '%{http_code}' "$ASSET_ORIGIN/index.json")"
if [ "$STATUS" != "200" ]; then
  echo "::error::asset origin is not anonymously readable (HTTP $STATUS): the native asset proxy cannot feed 3D assets." >&2
  exit 1
fi
jq -e 'type == "object"' "$RUNNER_TEMP/asset-index.json" >/dev/null
