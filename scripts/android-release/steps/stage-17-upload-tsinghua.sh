#!/usr/bin/env bash
set -euo pipefail
APK_NAME="$STEP_ARTIFACT_APKNAME"
APK_FILE="release-staging/$APK_NAME"
EXPECTED_SHA="$STEP_ARTIFACT_SHA256"
REPO_ID="a757b2fa-9bc9-42f9-bc90-d6a2c0a94ed0"
PARENT_DIR="/wotbtools-android"
SHARE_DIRECT="https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/$APK_NAME&dl=1"
UPLOAD_LINK_API="https://cloud.tsinghua.edu.cn/api2/repos/$REPO_ID/upload-link/?p=$PARENT_DIR&reuse=1"
UPLOAD_LINK_ATTEMPTS=3
UPLOAD_LINK_RETRY_DELAY=3
UPLOAD_ATTEMPTS=3
VERIFY_ATTEMPTS=5
VERIFY_ATTEMPTS_CONTENT=2
VERIFY_RETRY_DELAY=3
VERIFY_RESERVE_SECONDS="${TSINGHUA_UPLOAD_VERIFY_RESERVE_SECONDS:-900}"
STAGE_BUDGET_SECONDS="${TSINGHUA_UPLOAD_BUDGET_SECONDS:-3600}"
case "$STAGE_BUDGET_SECONDS" in
  ''|*[!0-9]*) echo "::error::TSINGHUA_UPLOAD_BUDGET_SECONDS must be a non-negative integer; release gate remains closed." >&2; exit 1 ;;
esac
STAGE_BUDGET_SECONDS=$((10#$STAGE_BUDGET_SECONDS))
JOB_TIMEOUT_SECONDS="${JOB_TIMEOUT_SECONDS:-7200}"
POST_STAGE_RESERVE_SECONDS="${POST_STAGE_RESERVE_SECONDS:-900}"
case "$JOB_TIMEOUT_SECONDS" in
  ''|*[!0-9]*) echo "::error::JOB_TIMEOUT_SECONDS must be a non-negative integer; release gate remains closed." >&2; exit 1 ;;
esac
case "$POST_STAGE_RESERVE_SECONDS" in
  ''|*[!0-9]*) echo "::error::POST_STAGE_RESERVE_SECONDS must be a non-negative integer; release gate remains closed." >&2; exit 1 ;;
esac
JOB_TIMEOUT_SECONDS=$((10#$JOB_TIMEOUT_SECONDS))
POST_STAGE_RESERVE_SECONDS=$((10#$POST_STAGE_RESERVE_SECONDS))
case "$VERIFY_RESERVE_SECONDS" in
  ''|*[!0-9]*) echo "::error::TSINGHUA_UPLOAD_VERIFY_RESERVE_SECONDS must be a positive integer; release gate remains closed." >&2; exit 1 ;;
esac
VERIFY_RESERVE_SECONDS=$((10#$VERIFY_RESERVE_SECONDS))
if [ "$VERIFY_RESERVE_SECONDS" -le 0 ]; then
  echo "::error::TSINGHUA_UPLOAD_VERIFY_RESERVE_SECONDS must be a positive integer; release gate remains closed." >&2
  exit 1
fi
if [ -n "${JOB_START_EPOCH:-}" ]; then
  case "$JOB_START_EPOCH" in
    ''|*[!0-9]*) echo "::error::JOB_START_EPOCH must be epoch seconds; release gate remains closed." >&2; exit 1 ;;
  esac
  JOB_START_EPOCH=$((10#$JOB_START_EPOCH))
  JOB_ELAPSED=$(( $(date +%s) - JOB_START_EPOCH ))
  if [ "$JOB_ELAPSED" -lt 0 ]; then JOB_ELAPSED=0; fi
  JOB_REMAINING=$((JOB_TIMEOUT_SECONDS - JOB_ELAPSED - POST_STAGE_RESERVE_SECONDS))
  if [ "$JOB_REMAINING" -lt 0 ]; then JOB_REMAINING=0; fi
  if [ "$JOB_REMAINING" -lt "$STAGE_BUDGET_SECONDS" ]; then
    echo "Job budget: ${JOB_REMAINING}s remaining after ${JOB_ELAPSED}s elapsed and ${POST_STAGE_RESERVE_SECONDS}s reserve; capping stage budget from ${STAGE_BUDGET_SECONDS}s to ${JOB_REMAINING}s."
    STAGE_BUDGET_SECONDS="$JOB_REMAINING"
  fi
fi
STAGE_DEADLINE_AT=$((SECONDS + STAGE_BUDGET_SECONDS))
echo "Tsinghua upload verify reserve: ${VERIFY_RESERVE_SECONDS}s (stage budget ${STAGE_BUDGET_SECONDS}s)."
WORK="$RUNNER_TEMP/thu-upload"
mkdir -p "$WORK"
: > "$WORK/upload-body.txt"
: > "$WORK/upload-curl.err"
: > "$WORK/probe-curl.err"
: > "$WORK/probe-sha.err"

budget_remaining() {
  local remaining=$((STAGE_DEADLINE_AT - SECONDS))
  if [ "$remaining" -lt 0 ]; then remaining=0; fi
  printf '%s' "$remaining"
}

REMAINING_BUDGET=0
require_budget() {
  local label="$1"
  REMAINING_BUDGET="$(budget_remaining)"
  if [ "$REMAINING_BUDGET" -le 0 ]; then
    echo "::error::Tsinghua upload stage exhausted its ${STAGE_BUDGET_SECONDS}s budget before $label; release gate remains closed." >&2
    exit 1
  fi
}

sleep_budgeted() {
  local seconds="$1"
  require_budget "retry backoff"
  if [ "$seconds" -ge "$REMAINING_BUDGET" ]; then
    echo "::error::Tsinghua upload stage budget (${STAGE_BUDGET_SECONDS}s) would be exhausted by a ${seconds}s backoff; release gate remains closed." >&2
    exit 1
  fi
  sleep "$seconds"
}

sanitize() {
  sed -E     -e 's#https?://[^"[:space:]]+#<redacted-url>#g'     -e 's/("?(token|access_token|signature|password)"?[[:space:]]*[:=][[:space:]]*"?)[^",}&[:space:]]+/\1<redacted>/g'     -e 's/[[:cntrl:]]+/ /g'     | cut -c1-400
}
bounded_file() {
  [ -f "$1" ] || return 0
  head -c 2000 "$1" | sanitize
}

PROBE_RC=0
PROBE_HTTP=000
PROBE_BYTES=0
PROBE_OUTCOME=""
probe_remote() {
  local label="$1" diag actual max_time sha_rc=0 sha_out
  PROBE_RC=0
  PROBE_HTTP=000
  PROBE_BYTES=0
  PROBE_OUTCOME=""
  require_budget "$label"
  max_time="$REMAINING_BUDGET"
  if [ "$max_time" -gt 900 ]; then max_time=900; fi
  : > "$WORK/probe.apk"
  : > "$WORK/probe-curl.err"
  diag="$(curl -sS -L --connect-timeout 5 --max-time "$max_time" \
    --stderr "$WORK/probe-curl.err" \
    -o "$WORK/probe.apk" -w '%{http_code} %{size_download}' "$SHARE_DIRECT")" || PROBE_RC=$?
  read -r PROBE_HTTP PROBE_BYTES <<< "$diag" || true
  PROBE_HTTP="${PROBE_HTTP:-000}"
  PROBE_BYTES="${PROBE_BYTES:-0}"
  if [ "$PROBE_RC" -ne 0 ]; then
    PROBE_OUTCOME="unconfirmed"
    echo "  $label: HTTP $PROBE_HTTP, curl rc=$PROBE_RC, size=${PROBE_BYTES}B; remote state is unconfirmed; curl error: $(bounded_file "$WORK/probe-curl.err")"
    return 1
  fi
  case "$PROBE_HTTP" in
    404|410)
      PROBE_OUTCOME="missing"
      echo "  $label: HTTP $PROBE_HTTP, curl rc=0, size=${PROBE_BYTES}B; the public share reports the object is absent."
      return 1
      ;;
    200) ;;
    *)
      PROBE_OUTCOME="unconfirmed"
      echo "  $label: HTTP $PROBE_HTTP, curl rc=0, size=${PROBE_BYTES}B; public share did not provide a usable APK; remote state is unconfirmed."
      return 1
      ;;
  esac
  if [ ! -s "$WORK/probe.apk" ] || [ "$PROBE_BYTES" = "0" ]; then
    PROBE_OUTCOME="unconfirmed"
    echo "  $label: HTTP 200 but the response body is empty; this is not proof the object is absent; remote state is unconfirmed."
    return 1
  fi
  sha_rc=0
  sha_out="$(sha256sum "$WORK/probe.apk" 2> "$WORK/probe-sha.err")" || sha_rc=$?
  if [ "$sha_rc" -ne 0 ]; then
    PROBE_OUTCOME="unconfirmed"
    echo "  $label: local SHA-256 calculation failed (sha256sum rc=$sha_rc); remote state is unconfirmed; refusing to overwrite."
    return 1
  fi
  actual="${sha_out%% *}"
  if [ "${#actual}" -ne 64 ]; then
    PROBE_OUTCOME="unconfirmed"
    echo "  $label: local SHA-256 output is malformed; remote state is unconfirmed; refusing to overwrite."
    return 1
  fi
  case "$actual" in
    *[!0-9a-f]*)
      PROBE_OUTCOME="unconfirmed"
      echo "  $label: local SHA-256 output is malformed; remote state is unconfirmed; refusing to overwrite."
      return 1
      ;;
  esac
  if [ "$actual" = "$EXPECTED_SHA" ]; then
    PROBE_OUTCOME="match"
    echo "  $label: HTTP 200, ${PROBE_BYTES}B, SHA-256 matches expected."
    return 0
  fi
  PROBE_OUTCOME="sha_mismatch"
  echo "  $label: HTTP 200, ${PROBE_BYTES}B, SHA-256 mismatch (expected $EXPECTED_SHA, got $actual)."
  return 1
}

preupload_probe() {
  local attempt=1
  while [ "$attempt" -le "$VERIFY_ATTEMPTS" ]; do
    if probe_remote "pre-upload remote check ($attempt/$VERIFY_ATTEMPTS)"; then
      return 0
    fi
    case "$PROBE_OUTCOME" in
      missing|sha_mismatch) return 1 ;;
    esac
    if [ "$attempt" -lt "$VERIFY_ATTEMPTS" ]; then
      sleep_budgeted "$VERIFY_RETRY_DELAY"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

CONFIRM_OUTCOME=""
confirm_remote() {
  local phase="$1" probe=1 downloads=0
  CONFIRM_OUTCOME=""
  while [ "$probe" -le "$VERIFY_ATTEMPTS" ]; do
    if probe_remote "$phase (probe $probe/$VERIFY_ATTEMPTS, full-downloads $downloads/$VERIFY_ATTEMPTS_CONTENT)"; then
      CONFIRM_OUTCOME="match"
      return 0
    fi
    CONFIRM_OUTCOME="$PROBE_OUTCOME"
    if [ "$PROBE_OUTCOME" = "sha_mismatch" ]; then
      downloads=$((downloads + 1))
      echo "  $phase: full APK download $downloads/$VERIFY_ATTEMPTS_CONTENT had the wrong SHA-256."
      if [ "$downloads" -ge "$VERIFY_ATTEMPTS_CONTENT" ]; then
        return 1
      fi
    fi
    if [ "$probe" -lt "$VERIFY_ATTEMPTS" ]; then
      sleep_budgeted "$VERIFY_RETRY_DELAY"
    fi
    probe=$((probe + 1))
  done
  return 1
}

ULINK=""
ULINK_RAW=""
fetch_upload_link() {
  local attempt=1 rc=0 jq_rc=0 delay max_time error_class
  local http_code=000 body_bytes=0 err_bytes=0 last_http=000 last_jq_rc=0
  ULINK=""
  while [ "$attempt" -le "$UPLOAD_LINK_ATTEMPTS" ]; do
    rc=0
    jq_rc=0
    http_code=000
    body_bytes=0
    err_bytes=0
    require_budget "upload-link request"
    max_time="$REMAINING_BUDGET"
    if [ "$max_time" -gt 60 ]; then max_time=60; fi
    : > "$WORK/upload-link.json"
    : > "$WORK/upload-link.err"
    : > "$WORK/upload-link-jq.err"
    http_code="$(curl -fsS --connect-timeout 10 --max-time "$max_time" \
      --stderr "$WORK/upload-link.err" -o "$WORK/upload-link.json" -w '%{http_code}' \
      -H "Authorization: Token $TSINGHUA_CLOUD_TOKEN" "$UPLOAD_LINK_API")" || rc=$?
    http_code="${http_code:-000}"
    if [ -f "$WORK/upload-link.json" ]; then
      body_bytes="$(wc -c < "$WORK/upload-link.json" | tr -d ' ')"
    fi
    if [ "$rc" -eq 0 ]; then
      ULINK_RAW="$(cat "$WORK/upload-link.json")"
      ULINK="$(printf '%s' "$ULINK_RAW" | jq -r '.' 2> "$WORK/upload-link-jq.err")" || jq_rc=$?
      case "$ULINK" in
        https://*)
          echo "Tsinghua upload-link acquired on attempt $attempt/$UPLOAD_LINK_ATTEMPTS (HTTP $http_code, body=${body_bytes}B)."
          return 0
          ;;
      esac
      echo "  Tsinghua upload-link attempt $attempt/$UPLOAD_LINK_ATTEMPTS returned an invalid URL (jq rc=$jq_rc, HTTP $http_code); response body: <withheld; ${body_bytes}B>"
    else
      if [ -f "$WORK/upload-link.err" ]; then
        err_bytes="$(wc -c < "$WORK/upload-link.err" | tr -d ' ')"
      fi
      if [ "$http_code" = "000" ]; then error_class="transport"; else error_class="HTTP"; fi
      echo "  Tsinghua upload-link attempt $attempt/$UPLOAD_LINK_ATTEMPTS failed (curl rc=$rc) (HTTP $http_code, error_class=$error_class); stderr bytes=${err_bytes}; response body: <withheld; ${body_bytes}B>"
    fi
    last_http="$http_code"
    last_jq_rc="$jq_rc"
    if [ "$attempt" -lt "$UPLOAD_LINK_ATTEMPTS" ]; then
      delay=$((UPLOAD_LINK_RETRY_DELAY * attempt))
      echo "  Retrying upload-link in ${delay}s."
      sleep_budgeted "$delay"
    fi
    attempt=$((attempt + 1))
  done
  echo "::error::Tsinghua upload-link request failed after $UPLOAD_LINK_ATTEMPTS attempt(s) (last curl rc=$rc, HTTP $last_http, jq rc=$last_jq_rc); release gate remains closed." >&2
  return 1
}

UPLOAD_RC=0
UPLOAD_HTTP=000
UPLOAD_UPBYTES=0
UPLOAD_SECONDS=0
UPLOAD_SPEED=0
upload_once() {
  local attempt="$1" diag body_bytes max_time err_bytes=0
  UPLOAD_RC=0
  UPLOAD_HTTP=000
  UPLOAD_UPBYTES=0
  UPLOAD_SECONDS=0
  UPLOAD_SPEED=0
  require_budget "upload attempt $attempt"
  if [ "$REMAINING_BUDGET" -le "$VERIFY_RESERVE_SECONDS" ]; then
    echo "::error::Only ${REMAINING_BUDGET}s remain before upload attempt $attempt; ${VERIFY_RESERVE_SECONDS}s are reserved for public-share SHA-256 verification. Refusing to start an unverifiable write; release gate remains closed." >&2
    exit 1
  fi
  max_time=$((REMAINING_BUDGET - VERIFY_RESERVE_SECONDS))
  if [ "$max_time" -gt 2700 ]; then max_time=2700; fi
  : > "$WORK/upload-body.txt"
  : > "$WORK/upload-curl.err"
  diag="$(curl -sS --connect-timeout 10 --max-time "$max_time" \
    --stderr "$WORK/upload-curl.err" \
    -o "$WORK/upload-body.txt" -w '%{http_code} %{size_upload} %{time_total} %{speed_upload}' \
    -H "Authorization: Token $TSINGHUA_CLOUD_TOKEN" \
    -F "parent_dir=$PARENT_DIR" -F "replace=1" -F "file=@$APK_FILE" "$ULINK")" || UPLOAD_RC=$?
  read -r UPLOAD_HTTP UPLOAD_UPBYTES UPLOAD_SECONDS UPLOAD_SPEED <<< "$diag" || true
  UPLOAD_HTTP="${UPLOAD_HTTP:-000}"
  UPLOAD_UPBYTES="${UPLOAD_UPBYTES:-0}"
  UPLOAD_SECONDS="${UPLOAD_SECONDS:-0}"
  UPLOAD_SPEED="${UPLOAD_SPEED:-0}"
  body_bytes=0
  if [ -f "$WORK/upload-body.txt" ]; then
    body_bytes="$(wc -c < "$WORK/upload-body.txt" | tr -d ' ')"
  fi
  echo "Tsinghua upload attempt $attempt/$UPLOAD_ATTEMPTS: curl rc=$UPLOAD_RC, HTTP $UPLOAD_HTTP, uploaded=${UPLOAD_UPBYTES}B, time=${UPLOAD_SECONDS}s, speed=${UPLOAD_SPEED}B/s"
  echo "  response body: <withheld; ${body_bytes}B>"
  if [ "$UPLOAD_RC" -ne 0 ]; then
    if [ -f "$WORK/upload-curl.err" ]; then
      err_bytes="$(wc -c < "$WORK/upload-curl.err" | tr -d ' ')"
    fi
    echo "  curl error class=transport (stderr bytes=${err_bytes}); HTTP status and transfer metrics are reported above."
  fi
}

if preupload_probe; then
  echo "Tsinghua Cloud object already matches $EXPECTED_SHA; skipping upload."
  exit 0
fi

case "$PROBE_OUTCOME" in
  missing|sha_mismatch)
    echo "Tsinghua remote object is $PROBE_OUTCOME; proceeding with replace=1 upload."
    ;;
  *)
    echo "::error::Cannot confirm the Tsinghua remote state before upload (last HTTP $PROBE_HTTP, curl rc=$PROBE_RC); refusing to overwrite an unverified object; release gate remains closed." >&2
    exit 1
    ;;
esac

echo "Tsinghua upload uses replace=1; the public SHA-256 remains the release gate."

CONFIRMED=false
UNCONFIRMED_AFTER_UPLOAD=false
LAST_UPLOAD_RC=0
LAST_UPLOAD_HTTP=000
LAST_UPLOAD_ERROR_HTTP=000
TRANSPORT_FAILED_ATTEMPTS=0
SAW_UPLOAD_HTTP_ERROR=false
SAW_HTTP_400=false
attempt=1
while [ "$attempt" -le "$UPLOAD_ATTEMPTS" ]; do
  if ! fetch_upload_link; then
    echo "::error::Tsinghua Cloud upload-link unavailable; release gate remains closed." >&2
    exit 1
  fi
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
  case "$CONFIRM_OUTCOME" in
    missing|sha_mismatch)
      ;;
    unconfirmed)
      UNCONFIRMED_AFTER_UPLOAD=true
      echo "::error::Tsinghua Cloud public-share verification could not be completed after upload attempt $attempt/$UPLOAD_ATTEMPTS (last HTTP $PROBE_HTTP, curl rc=$PROBE_RC); refusing to re-upload an object whose remote state is unknown; release gate remains closed." >&2
      break
      ;;
    *)
      echo "::error::Tsinghua Cloud public-share verification returned an unknown outcome; refusing to re-upload; release gate remains closed." >&2
      exit 1
      ;;
  esac
  if [ "$attempt" -lt "$UPLOAD_ATTEMPTS" ]; then
    delay=$((5 * attempt))
    echo "Tsinghua upload attempt $attempt/$UPLOAD_ATTEMPTS not confirmed; retrying in ${delay}s."
    sleep_budgeted "$delay"
  fi
  attempt=$((attempt + 1))
done

if [ "$UNCONFIRMED_AFTER_UPLOAD" = true ]; then
  echo "::error::Release gate remains closed: the public share never confirmed a readable object, so no further upload overwrite was attempted." >&2
  exit 1
fi

if [ "$CONFIRMED" = true ]; then
  echo "Tsinghua Cloud offload verified: $APK_NAME sha256=$EXPECTED_SHA"
  exit 0
fi

echo "::error::Tsinghua Cloud public-share SHA-256 verification failed after $UPLOAD_ATTEMPTS upload attempt(s); the expected APK is missing or has the wrong content." >&2
if [ "$TRANSPORT_FAILED_ATTEMPTS" -eq "$UPLOAD_ATTEMPTS" ]; then
  echo "::error::Tsinghua Cloud upload transport failed on all $UPLOAD_ATTEMPTS attempt(s) (last curl rc=$LAST_UPLOAD_RC, HTTP $LAST_UPLOAD_HTTP); no upload response was usable." >&2
elif [ "$LAST_UPLOAD_RC" -ne 0 ]; then
  echo "::error::Tsinghua Cloud upload transport failed on the final attempt (curl rc=$LAST_UPLOAD_RC, HTTP $LAST_UPLOAD_HTTP)." >&2
elif [ "$TRANSPORT_FAILED_ATTEMPTS" -gt 0 ]; then
  echo "::error::Tsinghua Cloud upload transport failed on $TRANSPORT_FAILED_ATTEMPTS of $UPLOAD_ATTEMPTS attempt(s) (last curl rc=$LAST_UPLOAD_RC, HTTP $LAST_UPLOAD_HTTP); later verification still failed." >&2
fi
if [ "$SAW_UPLOAD_HTTP_ERROR" = true ]; then
  echo "::error::Tsinghua Cloud upload endpoint returned an HTTP error (last HTTP $LAST_UPLOAD_ERROR_HTTP); the object was not confirmed." >&2
fi
if [ "$SAW_HTTP_400" = true ]; then
  echo "::error::Known Seafile HTTP 400 anomaly was observed, but the public SHA-256 never matched; HTTP 400 is not accepted as success." >&2
fi
echo "::error::Release gate remains closed: public /download/android/*.apk redirects would hit a missing or wrong drive object." >&2
exit 1
