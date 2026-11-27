#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 7: Verify the wotbtools-android runtime client (readiness, rerun)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
AUTH_ENDPOINT="https://auth.wotbtools.com/realms/wotbtools/protocol/openid-connect/auth"
STATE="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
NONCE="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
CHALLENGE="$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=' | cut -c1-43)"
PROBE_URL="$AUTH_ENDPOINT?client_id=wotbtools-android&response_type=code&scope=openid"
PROBE_URL="$PROBE_URL&redirect_uri=com.wotbtools.app%3A%2Foauth2redirect"
PROBE_URL="$PROBE_URL&code_challenge=$CHALLENGE&code_challenge_method=S256"
PROBE_URL="$PROBE_URL&state=$STATE&nonce=$NONCE"
attempts=8
for attempt in $(seq 1 "$attempts"); do
  code="$(curl -sS -o "$RUNNER_TEMP/android-client-probe.html" -w '%{http_code}' \
    --connect-timeout 5 --max-time 15 "$PROBE_URL" || true)"
  if [ "$code" = "200" ] && ! grep -qiE 'Client not found|Invalid parameter: redirect_uri|invalid_client|We are sorry' \
    "$RUNNER_TEMP/android-client-probe.html"; then
    echo "wotbtools-android runtime client verified (attempt $attempt)."
    exit 0
  fi
  echo "wotbtools-android not usable yet (attempt $attempt/$attempts, http=$code)."
  sleep 15
done
echo "::error::wotbtools-android is not a usable Keycloak client (client missing or its redirect URI is not registered). Refusing to publish version.json: the mandatory update must not point clients at an auth path that is not live." >&2
exit 1
