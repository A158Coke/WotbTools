#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 22: Upload APK to Tsinghua Cloud (public download offload + origin seed source)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
APK_NAME="$STEP_ARTIFACT_APKNAME"
APK_FILE="release-staging/$APK_NAME"
EXPECTED_SHA="$STEP_ARTIFACT_SHA256"
# 网盘约定（与 TX1 Caddyfile 的 redir 目标一一对应，改这边必须同步改 Caddy）：
# 仓库 = 个人资料库，目录 = /wotbtools-android/，
# 分享 = https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/（可下载、无密码、不过期）。
REPO_ID="a757b2fa-9bc9-42f9-bc90-d6a2c0a94ed0"
PARENT_DIR="/wotbtools-android"
SHARE_DIRECT="https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/$APK_NAME&dl=1"
UPLOAD_LINK_API="https://cloud.tsinghua.edu.cn/api2/repos/$REPO_ID/upload-link/?p=$PARENT_DIR&reuse=1"
UPLOAD_ATTEMPTS=3
VERIFY_ATTEMPTS=5
VERIFY_RETRY_DELAY=3
WORK="$RUNNER_TEMP/thu-upload"
mkdir -p "$WORK"
: > "$WORK/upload-body.txt"
: > "$WORK/upload-curl.err"
: > "$WORK/probe-curl.err"

# Keep diagnostics bounded and free of credentials or signed URLs. A signed
# upload-link is itself a URL, so every URL is redacted instead of truncated.
sanitize() {
  sed -E \
    -e 's#https?://[^"[:space:]]+#<redacted-url>#g' \
    -e 's/("?(token|access_token|signature|password)"?[[:space:]]*[:=][[:space:]]*"?)[^",}&[:space:]]+/\1<redacted>/g' \
    -e 's/[[:cntrl:]]+/ /g' \
    | cut -c1-400
}
bounded_file() {
  [ -f "$1" ] || return 0
  head -c 2000 "$1" | sanitize
}
bounded_string() {
  printf '%s' "$1" | sanitize
}

PROBE_RC=0
PROBE_HTTP=000
PROBE_BYTES=0
# Download the public-share object and compare its SHA-256. This is the sole
# release gate; an upload response is never accepted as proof of success.
probe_remote() {
  local label="$1" diag actual
  PROBE_RC=0
  PROBE_HTTP=000
  PROBE_BYTES=0
  : > "$WORK/probe.apk"
  : > "$WORK/probe-curl.err"
  diag="$(curl -sS -L --connect-timeout 5 --max-time 900 \
    --stderr "$WORK/probe-curl.err" \
    -o "$WORK/probe.apk" -w '%{http_code} %{size_download}' "$SHARE_DIRECT")" || PROBE_RC=$?
  read -r PROBE_HTTP PROBE_BYTES <<< "$diag" || true
  PROBE_HTTP="${PROBE_HTTP:-000}"
  PROBE_BYTES="${PROBE_BYTES:-0}"
  if [ "$PROBE_RC" -ne 0 ]; then
    echo "  $label: HTTP $PROBE_HTTP, curl rc=$PROBE_RC, size=${PROBE_BYTES}B; curl error: $(bounded_file "$WORK/probe-curl.err")"
    return 1
  fi
  if [ "$PROBE_HTTP" != "200" ]; then
    echo "  $label: HTTP $PROBE_HTTP, curl rc=0, size=${PROBE_BYTES}B; public share did not return the APK."
    return 1
  fi
  if [ ! -s "$WORK/probe.apk" ] || [ "$PROBE_BYTES" = "0" ]; then
    echo "  $label: HTTP 200 but the response body is empty; treating the object as missing."
    return 1
  fi
  actual="$(sha256sum "$WORK/probe.apk" | awk '{print $1}')"
  if [ "$actual" = "$EXPECTED_SHA" ]; then
    echo "  $label: HTTP 200, ${PROBE_BYTES}B, SHA-256 matches expected."
    return 0
  fi
  echo "  $label: HTTP 200, ${PROBE_BYTES}B, SHA-256 mismatch (expected $EXPECTED_SHA, got $actual)."
  return 1
}

# A failed or unconfirmed upload may still have written the object. Verify the
# public share (bounded) before deciding that another upload is needed.
confirm_remote() {
  local phase="$1" attempt=1
  while [ "$attempt" -le "$VERIFY_ATTEMPTS" ]; do
    if probe_remote "$phase (verify $attempt/$VERIFY_ATTEMPTS)"; then
      return 0
    fi
    if [ "$attempt" -lt "$VERIFY_ATTEMPTS" ]; then
      sleep "$VERIFY_RETRY_DELAY"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

ULINK=""
fetch_upload_link() {
  local rc=0 jq_rc=0
  : > "$WORK/upload-link.err"
  ULINK_RAW="$(curl -fsS --connect-timeout 10 --max-time 60 \
    --stderr "$WORK/upload-link.err" \
    -H "Authorization: Token $TSINGHUA_CLOUD_TOKEN" "$UPLOAD_LINK_API")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "::error::Tsinghua upload-link request failed (curl rc=$rc): $(bounded_file "$WORK/upload-link.err")" >&2
    return 1
  fi
  ULINK="$(printf '%s' "$ULINK_RAW" | jq -r '.' 2> "$WORK/upload-link-jq.err")" || jq_rc=$?
  case "$ULINK" in
    https://*) ;;
    *)
      echo "::error::Tsinghua upload-link response is not a JSON URL string (jq rc=$jq_rc, jq error: $(bounded_file "$WORK/upload-link-jq.err")); bounded response: $(bounded_string "$ULINK_RAW")" >&2
      return 1
      ;;
  esac
}

UPLOAD_RC=0
UPLOAD_HTTP=000
UPLOAD_UPBYTES=0
UPLOAD_SECONDS=0
UPLOAD_SPEED=0
# reuse=1 only makes the upload-link idempotent; it is not an overwrite switch.
# replace=1 keeps the immutable APK name stable instead of renaming the object
# to "name (1).apk". The response is diagnostic only: this deployment can return
# HTTP 400 "Parent dir doesn't exist" after a completed write, and transport
# errors can hide a completed write.
upload_once() {
  local attempt="$1" diag body
  UPLOAD_RC=0
  UPLOAD_HTTP=000
  UPLOAD_UPBYTES=0
  UPLOAD_SECONDS=0
  UPLOAD_SPEED=0
  : > "$WORK/upload-body.txt"
  : > "$WORK/upload-curl.err"
  diag="$(curl -sS --connect-timeout 10 --max-time 2700 \
    --stderr "$WORK/upload-curl.err" \
    -o "$WORK/upload-body.txt" -w '%{http_code} %{size_upload} %{time_total} %{speed_upload}' \
    -H "Authorization: Token $TSINGHUA_CLOUD_TOKEN" \
    -F "parent_dir=$PARENT_DIR" -F "replace=1" -F "file=@$APK_FILE" "$ULINK")" || UPLOAD_RC=$?
  read -r UPLOAD_HTTP UPLOAD_UPBYTES UPLOAD_SECONDS UPLOAD_SPEED <<< "$diag" || true
  UPLOAD_HTTP="${UPLOAD_HTTP:-000}"
  UPLOAD_UPBYTES="${UPLOAD_UPBYTES:-0}"
  UPLOAD_SECONDS="${UPLOAD_SECONDS:-0}"
  UPLOAD_SPEED="${UPLOAD_SPEED:-0}"
  body="$(bounded_file "$WORK/upload-body.txt")"
  echo "Tsinghua upload attempt $attempt/$UPLOAD_ATTEMPTS: curl rc=$UPLOAD_RC, HTTP $UPLOAD_HTTP, uploaded=${UPLOAD_UPBYTES}B, time=${UPLOAD_SECONDS}s, speed=${UPLOAD_SPEED}B/s"
  echo "  response body: ${body:-<empty>}"
  if [ "$UPLOAD_RC" -ne 0 ]; then
    echo "  curl error: $(bounded_file "$WORK/upload-curl.err")"
  fi
}

# If a previous run already delivered the expected object, do not upload again.
if probe_remote "pre-upload remote check"; then
  echo "Tsinghua Cloud object already matches $EXPECTED_SHA; skipping upload."
  exit 0
fi

fetch_upload_link
echo "Tsinghua upload uses replace=1; the public SHA-256 remains the release gate."

CONFIRMED=false
LAST_UPLOAD_RC=0
LAST_UPLOAD_HTTP=000
LAST_UPLOAD_ERROR_HTTP=000
TRANSPORT_FAILED_ATTEMPTS=0
SAW_UPLOAD_HTTP_ERROR=false
SAW_HTTP_400=false
attempt=1
while [ "$attempt" -le "$UPLOAD_ATTEMPTS" ]; do
  upload_once "$attempt"
  LAST_UPLOAD_RC="$UPLOAD_RC"
  LAST_UPLOAD_HTTP="$UPLOAD_HTTP"
  if [ "$UPLOAD_RC" -ne 0 ]; then
    TRANSPORT_FAILED_ATTEMPTS=$((TRANSPORT_FAILED_ATTEMPTS + 1))
  fi
  if [ "$UPLOAD_HTTP" != "000" ] && [ "$UPLOAD_HTTP" != "200" ] && [ "$UPLOAD_HTTP" != "400" ]; then
    SAW_UPLOAD_HTTP_ERROR=true
    LAST_UPLOAD_ERROR_HTTP="$UPLOAD_HTTP"
  fi
  if [ "$UPLOAD_HTTP" = "400" ]; then
    SAW_HTTP_400=true
    echo "  Known Seafile anomaly: HTTP 400 can follow a completed write; verifying the public object."
  elif [ "$UPLOAD_RC" -ne 0 ]; then
    echo "  Upload transport failed (curl rc=$UPLOAD_RC); outcome uncertain, verifying remote content before any retry."
  fi
  if confirm_remote "post-upload remote check"; then
    CONFIRMED=true
    break
  fi
  if [ "$attempt" -lt "$UPLOAD_ATTEMPTS" ]; then
    delay=$((5 * attempt))
    echo "Tsinghua upload attempt $attempt/$UPLOAD_ATTEMPTS not confirmed; retrying in ${delay}s."
    sleep "$delay"
  fi
  attempt=$((attempt + 1))
done

if [ "$CONFIRMED" = true ]; then
  echo "Tsinghua Cloud offload verified: $APK_NAME sha256=$EXPECTED_SHA"
  exit 0
fi

echo "::error::Tsinghua Cloud public-share SHA-256 verification failed after $UPLOAD_ATTEMPTS upload attempt(s); the expected APK is missing or has the wrong content." >&2
if [ "$TRANSPORT_FAILED_ATTEMPTS" -eq "$UPLOAD_ATTEMPTS" ]; then
  echo "::error::Tsinghua Cloud upload transport failed on all $UPLOAD_ATTEMPTS attempt(s) (last curl rc=$LAST_UPLOAD_RC, HTTP $LAST_UPLOAD_HTTP); no upload response was usable." >&2
elif [ "$LAST_UPLOAD_RC" -ne 0 ]; then
  echo "::error::Tsinghua Cloud upload transport failed on the final attempt (curl rc=$LAST_UPLOAD_RC, HTTP $LAST_UPLOAD_HTTP)." >&2
fi
if [ "$SAW_UPLOAD_HTTP_ERROR" = true ]; then
  echo "::error::Tsinghua Cloud upload endpoint returned an HTTP error (last HTTP $LAST_UPLOAD_ERROR_HTTP); the object was not confirmed." >&2
fi
if [ "$SAW_HTTP_400" = true ]; then
  echo "::error::Known Seafile HTTP 400 anomaly was observed, but the public SHA-256 never matched; HTTP 400 is not accepted as success." >&2
fi
echo "::error::Release gate remains closed: public /download/android/*.apk redirects would hit a missing or wrong drive object." >&2
exit 1
