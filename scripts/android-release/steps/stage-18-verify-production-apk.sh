#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 25: Verify production APK (HTTP 200 + non-empty + SHA matches)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
APK_NAME="$STEP_ARTIFACT_APKNAME"
EXPECTED_SHA="$STEP_ARTIFACT_SHA256"
URL="https://wotbtools.com/download/android/$APK_NAME"
TMP_APK="$RUNNER_TEMP/prod.apk"
ATTEMPTS=5
for attempt in $(seq 1 "$ATTEMPTS"); do
  rm -f "$TMP_APK"
  VERIFY_URL="$URL?verify=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${attempt}-$(date +%s%N)"
  RESULT="$(curl -sS -L --connect-timeout 5 --max-time 900 \
    -H 'Cache-Control: no-cache' \
    -o "$TMP_APK" -w '%{http_code} %{size_download}' "$VERIFY_URL" || true)"
  read -r HTTP_CODE SIZE <<< "$RESULT"
  HTTP_CODE="${HTTP_CODE:-000}"
  SIZE="${SIZE:-0}"

  if [ "$HTTP_CODE" != "200" ]; then
    echo "Production APK verify attempt $attempt/$ATTEMPTS: HTTP $HTTP_CODE."
  elif [ ! -s "$TMP_APK" ] || [ "$SIZE" = "0" ]; then
    echo "Production APK verify attempt $attempt/$ATTEMPTS: empty response (size=$SIZE)."
  else
    PROD_SHA="$(sha256sum "$TMP_APK" | awk '{print $1}')"
    if [ "$PROD_SHA" = "$EXPECTED_SHA" ]; then
      echo "Production APK verified on attempt $attempt/$ATTEMPTS: HTTP 200, $SIZE bytes, SHA-256 $PROD_SHA"
      exit 0
    fi
    echo "Production APK verify attempt $attempt/$ATTEMPTS: SHA-256 mismatch (expected $EXPECTED_SHA, got $PROD_SHA)."
  fi

  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    sleep 5
  fi
done
echo "::error::Production APK verification failed after $ATTEMPTS attempts; expected SHA-256 $EXPECTED_SHA." >&2
exit 1
