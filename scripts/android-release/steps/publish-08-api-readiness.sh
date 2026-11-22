#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 8: Verify production API CORS and asset storage readiness).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
STAGING="$RUNNER_TEMP/staging.json"
ORIGIN="$(jq -r '.runtimeOrigin' "$STAGING")"
API="$(jq -r '.apiOrigin' "$STAGING")"
# Stable authenticated profile route; OPTIONS never needs a token.
STATUS="$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null \
  -D "$RUNNER_TEMP/api-preflight.headers" -w '%{http_code}' -X OPTIONS \
  -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,content-type,content-encoding,accept' \
  "$API/api/users/profile")"
python3 scripts/android-release/android_contract.py cors \
  --headers "$RUNNER_TEMP/api-preflight.headers" --status "$STATUS" --origin "$ORIGIN" \
  --methods GET,POST,PUT,PATCH,DELETE,OPTIONS --request-headers authorization,content-type,content-encoding,accept
# An unauthenticated read must reach the real protected backend (401),
# not merely a gateway-generated OPTIONS response while the backend is down.
STATUS="$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null \
  -D "$RUNNER_TEMP/api-read.headers" -w '%{http_code}' -H "Origin: $ORIGIN" "$API/api/users/profile")"
python3 scripts/android-release/android_contract.py cors \
  --headers "$RUNNER_TEMP/api-read.headers" --status "$STATUS" --expected-status 401 --origin "$ORIGIN"
# Android 3D 资产由 Native AgentAssetProxy 直连资产源（原生代码不受 CORS
# 约束；staging.json 的 assetOrigin 是本机路径 /agent-assets，不可拼 URL）。
# 探测来源取自已核验 immutable tag 的源码，兼容仍可发布的旧 COS staged APK。
ASSET_ORIGIN="$STEP_STAGED_ASSETORIGIN"
STATUS="$(curl -sS --connect-timeout 5 --max-time 20 -o "$RUNNER_TEMP/asset-index.json" \
  -w '%{http_code}' "$ASSET_ORIGIN/index.json")"
if [ "$STATUS" != "200" ]; then
  echo "::error::asset origin is not anonymously readable (HTTP $STATUS): the native asset proxy cannot feed 3D assets." >&2
  exit 1
fi
jq -e 'type == "object"' "$RUNNER_TEMP/asset-index.json" >/dev/null
