#!/usr/bin/env bash
# Mocked-HTTP regression matrix for stage-17 Tsinghua Cloud offload.
# Exercises the real stage script; no network access or credentials are used.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STAGE_SCRIPT="$ROOT_DIR/scripts/android-release/steps/stage-17-upload-tsinghua.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/thu-upload-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
APK_NAME="wotbtools-android-v4.0.0.apk"
TOKEN="test-token-secret"
EXPECTED=""
CASE=""
CASE_NAME=""
LOG=""
LAST_RC=0

printf 'wotbtools android fixture apk\n' > "$TMP/expected.apk"
printf 'wrong android fixture apk\n' > "$TMP/wrong.apk"
EXPECTED="$(sha256sum "$TMP/expected.apk" | cut -d' ' -f1)"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/sleep" <<'MOCK_SLEEP'
#!/usr/bin/env bash
exit 0
MOCK_SLEEP
cat > "$TMP/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
ROOT="${TEST_ROOT:?}"
out=""
err=""
url=""
printf '%s\n' "$*" >> "$ROOT/curl-args.log"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --stderr) err="$2"; shift 2 ;;
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    --connect-timeout|--max-time) shift 2 ;;
    -H|-F) shift 2 ;;
    -sS|-L|-fsS|-fsSL) shift ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done

bump() {
  local file="$ROOT/$1" n=0
  if [ -f "$file" ]; then n="$(cat "$file")"; fi
  printf '%s\n' "$((n + 1))" > "$file"
}
write_body() {
  if [ -n "$out" ]; then printf '%s' "$1" > "$out"; fi
}
write_err() {
  if [ -n "$err" ]; then printf '%s\n' "$1" > "$err"; fi
}
body_size() {
  local bytes=0
  if [ -f "$out" ]; then bytes="$(wc -c < "$out" | tr -d ' ')"; fi
  printf '%s' "$bytes"
}

case "$url" in
  *"/upload-link/"*)
    bump upload-link-count
    n="$(cat "$ROOT/upload-link-count")"
    action="$(sed -n "$n p" "$ROOT/upload_link_actions")"
    action="${action:-ok}"
    case "$action" in
      ok)
        printf '%s\n' '"https://upload.example/signed?token=SIGNED-SECRET&expires=1"'
        exit 0
        ;;
      reset)
        write_err 'curl: (56) Recv failure: Connection reset by peer'
        exit 56
        ;;
      http500)
        write_err 'curl: (22) The requested URL returned error: 500'
        exit 22
        ;;
      invalid)
        printf '%s\n' '"not-a-url?token=SIGNED-SECRET&expires=1"'
        exit 0
        ;;
      *)
        echo "unknown mock upload-link action: $action" >&2
        exit 99
        ;;
    esac
    ;;
  *"upload.example"*)
    bump upload-count
    n="$(cat "$ROOT/upload-count")"
    action="$(sed -n "${n}p" "$ROOT/upload_actions")"
    action="${action:-ok}"
    case "$action" in
      ok)
        cp "$ROOT/expected.apk" "$ROOT/remote.apk"
        write_body '{"id":"mock-upload"}'
        printf '200 %s 0.10 1024' "$(body_size)"
        exit 0
        ;;
      c400)
        cp "$ROOT/expected.apk" "$ROOT/remote.apk"
        write_body '{"error":"Parent dir does not exist"}'
        printf '400 %s 0.10 1024' "$(body_size)"
        exit 0
        ;;
      wrong)
        cp "$ROOT/wrong.apk" "$ROOT/remote.apk"
        write_body '{"id":"mock-wrong"}'
        printf '200 %s 0.10 1024' "$(body_size)"
        exit 0
        ;;
      http500)
        write_body 'mock server error'
        printf '500 %s 0.10 1024' "$(body_size)"
        exit 0
        ;;
      reset)
        write_body 'partial upload body'
        write_err 'curl: (56) Recv failure: Connection reset by peer'
        printf '000 0 0.00 0'
        exit 56
        ;;
      reset_write)
        cp "$ROOT/expected.apk" "$ROOT/remote.apk"
        write_body 'partial upload body'
        write_err 'curl: (56) Recv failure: Connection reset by peer'
        printf '000 0 0.00 0'
        exit 56
        ;;
      reset_response)
        write_body 'partial upload body'
        write_err 'curl: (56) Recv failure: Connection reset by peer'
        printf '200 0 0.00 0'
        exit 56
        ;;
      reset_long)
        write_body "BODY_HEAD \"token\": \"BODY_TOKEN_SECRET\" https://signed.example/upload?token=URL_SECRET $(printf 'B%.0s' $(seq 1 800))BODY_TAIL"
        write_err "ERR_HEAD token=ERR_TOKEN_SECRET https://signed.example/upload?token=ERR_URL_SECRET $(printf 'E%.0s' $(seq 1 800))ERR_TAIL"
        printf '000 0 0.00 0'
        exit 56
        ;;
      *)
        echo "unknown mock upload action: $action" >&2
        exit 99
        ;;
    esac
    ;;
  *"dl=1"*)
    bump probe-count
    n="$(cat "$ROOT/probe-count")"
    mode="$(sed -n "${n}p" "$ROOT/share_actions" 2>/dev/null || true)"
    if [ -z "$mode" ]; then mode="$(cat "$ROOT/share_mode")"; fi
    case "$mode" in
      reset)
        write_err 'curl: (56) Recv failure: Connection reset by peer'
        printf '000 0'
        exit 56
        ;;
      403|404|429|500)
        write_body 'mock public-share error'
        printf '%s %s' "$mode" "$(body_size)"
        exit 0
        ;;
      empty200)
        if [ -n "$out" ]; then : > "$out"; fi
        printf '200 0'
        exit 0
        ;;
      wrong)
        cp "$ROOT/wrong.apk" "$out"
        printf '200 %s' "$(body_size)"
        exit 0
        ;;
      fix)
        cp "$ROOT/expected.apk" "$ROOT/remote.apk"
        cp "$ROOT/expected.apk" "$out"
        printf '200 %s' "$(body_size)"
        exit 0
        ;;
      ok)
        if [ -f "$ROOT/remote.apk" ]; then
          cp "$ROOT/remote.apk" "$out"
          printf '200 %s' "$(body_size)"
        else
          write_body 'mock public-share not found'
          printf '404 %s' "$(body_size)"
        fi
        exit 0
        ;;
      *)
        echo "unknown mock share mode: $mode" >&2
        exit 99
        ;;
    esac
    ;;
  *)
    echo "unexpected mock curl URL: $url" >&2
    exit 99
    ;;
esac
MOCK_CURL
chmod +x "$TMP/bin/curl" "$TMP/bin/sleep"

die() {
  echo "FAIL [$CASE_NAME]: $*" >&2
  echo "--- stage output (tail 100) ---" >&2
  tail -n 100 "$LOG" >&2 || true
  exit 1
}
assert_rc() {
  [ "$LAST_RC" = "$1" ] || die "expected exit $1, got $LAST_RC"
}
assert_contains() {
  grep -Fq -- "$1" "$LOG" || die "missing expected text: $1"
}
assert_not_contains() {
  if grep -Fq -- "$1" "$LOG"; then die "unexpected text: $1"; fi
}
assert_count() {
  local file="$CASE/$1" n=0
  if [ -f "$file" ]; then n="$(cat "$file")"; fi
  n="${n:-0}"
  [ "$n" = "$2" ] || die "expected $1=$2, got $n"
}
assert_remote_sha() {
  [ -f "$CASE/remote.apk" ] || die "remote.apk is missing"
  local actual
  actual="$(sha256sum "$CASE/remote.apk" | cut -d' ' -f1)"
  [ "$actual" = "$EXPECTED" ] || die "remote SHA mismatch: expected $EXPECTED, got $actual"
}
assert_curl_args_contains() {
  grep -Fq -- "$1" "$CASE/curl-args.log" || die "missing curl argument: $1"
}
assert_curl_args_not_contains() {
  if grep -Fq -- "$1" "$CASE/curl-args.log"; then die "unexpected curl argument: $1"; fi
}

init_case() {
  CASE_NAME="$1"
  CASE="$TMP/cases/$CASE_NAME"
  LOG="$CASE/run.log"
  mkdir -p "$CASE/fixture/release-staging" "$CASE/runner"
  cp "$TMP/expected.apk" "$CASE/fixture/release-staging/$APK_NAME"
  cp "$TMP/expected.apk" "$CASE/expected.apk"
  cp "$TMP/wrong.apk" "$CASE/wrong.apk"
  CASE_BUDGET=""
  printf 'ok\n' > "$CASE/share_mode"
  : > "$CASE/share_actions"
  printf 'ok\n' > "$CASE/upload_link_actions"
  : > "$CASE/upload_actions"
  : > "$CASE/upload-link-count"
  : > "$CASE/curl-args.log"
}
set_share() { printf '%s\n' "$1" > "$CASE/share_mode"; }
set_share_actions() { printf '%s\n' "$@" > "$CASE/share_actions"; }
set_actions() { printf '%s\n' "$@" > "$CASE/upload_actions"; }
set_link_actions() { printf '%s\n' "$@" > "$CASE/upload_link_actions"; }

run_stage() {
  set +e
  (
    cd "$CASE/fixture" || exit 99
    PATH="$TMP/bin:$PATH" \
      TEST_ROOT="$CASE" \
      RUNNER_TEMP="$CASE/runner" \
      STEP_ARTIFACT_APKNAME="$APK_NAME" \
      STEP_ARTIFACT_SHA256="$EXPECTED" \
      TSINGHUA_CLOUD_TOKEN="$TOKEN" \
      TSINGHUA_UPLOAD_BUDGET_SECONDS="$CASE_BUDGET" \
      bash "$STAGE_SCRIPT"
  ) > "$LOG" 2>&1
  LAST_RC=$?
  set -e
}

case_success() {
  init_case "success"
  set_actions ok
  run_stage
  assert_rc 0
  assert_count upload-count 1
  assert_count probe-count 2
  assert_count upload-link-count 1
  assert_contains "SHA-256 matches expected"
  assert_contains "$EXPECTED"
  assert_contains "response body: <withheld"
  assert_curl_args_contains "--max-time 900"
  assert_curl_args_contains "--max-time 2700"
  assert_remote_sha
  assert_not_contains "mock-upload"
  assert_not_contains "$TOKEN"
  assert_not_contains "SIGNED-SECRET"
  assert_not_contains "upload.example"
  assert_curl_args_contains "-F replace=1"
  assert_curl_args_contains "upload-link/?p=/wotbtools-android&reuse=1"
  echo "PASS success + SHA match"
}

case_reset_remote_matches() {
  init_case "reset-remote-matches"
  set_actions reset_write
  run_stage
  assert_rc 0
  assert_count upload-count 1
  assert_count probe-count 2
  assert_contains "curl rc=56"
  assert_contains "outcome uncertain, verifying remote content before any retry"
  assert_contains "SHA-256 matches expected"
  assert_not_contains "retrying in"
  assert_remote_sha
  echo "PASS curl 56 with matching remote object"
}

case_reset_then_retry_success() {
  init_case "reset-then-retry"
  set_actions reset ok
  run_stage
  assert_rc 0
  assert_count upload-count 2
  assert_count probe-count 7
  assert_count upload-link-count 2
  assert_contains "not confirmed; retrying in 5s"
  assert_contains "SHA-256 matches expected"
  assert_remote_sha
  echo "PASS curl 56, remote missing, retry succeeds"
}

case_preexisting_remote() {
  init_case "preexisting-remote"
  cp "$CASE/expected.apk" "$CASE/remote.apk"
  run_stage
  assert_rc 0
  assert_count upload-count 0
  assert_count probe-count 1
  assert_contains "already matches $EXPECTED"
  assert_contains "skipping upload"
  assert_curl_args_not_contains "upload-link"
  assert_curl_args_not_contains "upload.example"
  assert_remote_sha
  echo "PASS pre-existing matching remote skips upload"
}

case_reset_never_appears() {
  init_case "reset-never-appears"
  set_actions reset reset reset
  run_stage
  assert_rc 1
  assert_count upload-count 3
  assert_count upload-link-count 3
  assert_contains "public-share SHA-256 verification failed after 3"
  assert_contains "upload transport failed on all 3"
  assert_not_contains "upload endpoint returned an HTTP error"
  assert_not_contains "SHA-256 matches expected"
  echo "PASS repeated curl 56 with missing object fails closed"
}

case_transport_with_response() {
  init_case "reset-with-response"
  set_actions reset_response reset_response reset_response
  run_stage
  assert_rc 1
  assert_count upload-count 3
  assert_count probe-count 16
  assert_contains "curl rc=56"
  assert_contains "HTTP 200"
  assert_contains "upload transport failed on all 3 attempt(s) (last curl rc=56, HTTP 200)"
  assert_contains "public-share SHA-256 verification failed after 3"
  assert_not_contains "upload endpoint returned an HTTP error"
  assert_not_contains "SHA-256 matches expected"
  echo "PASS curl 56 carrying HTTP 200 is classified as transport failure"
}

case_http400_matches() {
  init_case "http400-remote-matches"
  set_actions c400
  run_stage
  assert_rc 0
  assert_count upload-count 1
  assert_contains "HTTP 400"
  assert_contains "Known Seafile anomaly"
  assert_contains "SHA-256 matches expected"
  assert_remote_sha
  echo "PASS HTTP 400 anomaly with matching remote object"
}

case_wrong_remote_sha() {
  init_case "wrong-remote-sha"
  cp "$CASE/wrong.apk" "$CASE/remote.apk"
  set_actions wrong wrong wrong
  run_stage
  assert_rc 1
  assert_count upload-count 3
  assert_count probe-count 7
  assert_contains "SHA-256 mismatch"
  assert_contains "full APK download 2/2 had the wrong SHA-256"
  assert_contains "expected $EXPECTED"
  assert_not_contains "full APK download 3/2"
  assert_not_contains "SHA-256 matches expected"
  echo "PASS wrong remote SHA is rejected"
}

case_partial_transport_failure() {
  init_case "partial-transport"
  set_actions reset wrong wrong
  set_share 404
  run_stage
  assert_rc 1
  assert_count upload-count 3
  assert_count probe-count 16
  assert_contains "upload transport failed on 1 of 3 attempt(s)"
  assert_not_contains "upload transport failed on all 3"
  assert_not_contains "upload transport failed on the final attempt"
  assert_contains "public-share SHA-256 verification failed after 3"
  echo "PASS partial upload transport failure is summarized without hiding the gate"
}

case_share_not_found() {
  init_case "share-404"
  set_actions ok
  set_share 404
  run_stage
  assert_rc 1
  assert_count upload-count 3
  assert_count probe-count 16
  assert_contains "HTTP 404, curl rc=0"
  assert_contains "the public share reports the object is absent"
  assert_contains "public-share SHA-256 verification failed after 3"
  assert_not_contains "upload transport failed on all 3"
  assert_not_contains "SHA-256 matches expected"
  assert_remote_sha
  echo "PASS definite public-share 404 stays bounded and fails closed"
}

case_preupload_unconfirmed() {
  local status="$1"
  init_case "preupload-$status"
  set_actions ok
  set_share "$status"
  run_stage
  assert_rc 1
  assert_count upload-count 0
  assert_count upload-link-count 0
  assert_count probe-count 5
  assert_contains "HTTP $status, curl rc=0"
  assert_contains "remote state is unconfirmed"
  assert_contains "refusing to overwrite an unverified object"
  assert_contains "release gate remains closed"
  assert_not_contains "SHA-256 matches expected"
  echo "PASS pre-upload public-share HTTP $status fails closed without upload"
}

case_preupload_empty_200() {
  init_case "preupload-empty-200"
  set_actions ok
  set_share empty200
  run_stage
  assert_rc 1
  assert_count upload-count 0
  assert_count upload-link-count 0
  assert_count probe-count 5
  assert_contains "HTTP 200 but the response body is empty"
  assert_contains "remote state is unconfirmed"
  assert_contains "refusing to overwrite an unverified object"
  assert_not_contains "SHA-256 matches expected"
  echo "PASS pre-upload empty HTTP 200 fails closed without overwrite"
}

case_preupload_transport() {
  init_case "preupload-transport"
  set_actions ok
  set_share reset
  run_stage
  assert_rc 1
  assert_count upload-count 0
  assert_count upload-link-count 0
  assert_count probe-count 5
  assert_contains "HTTP 000, curl rc=56"
  assert_contains "remote state is unconfirmed"
  assert_contains "refusing to overwrite an unverified object"
  assert_not_contains "SHA-256 matches expected"
  echo "PASS pre-upload transport failure fails closed without upload"
}

case_retry_budget_exhausted() {
  init_case "retry-budget"
  set_actions http500 http500 http500
  run_stage
  assert_rc 1
  assert_count upload-count 3
  assert_count probe-count 16
  assert_contains "HTTP 500"
  assert_contains "response body: <withheld"
  assert_not_contains "mock server error"
  assert_contains "public-share SHA-256 verification failed after 3"
  assert_contains "not confirmed; retrying in 10s"
  assert_contains "upload endpoint returned an HTTP error (last HTTP 500)"
  assert_not_contains "upload transport failed on all 3"
  echo "PASS retry budget exhausted after 3 upload attempts"
}

case_verify_curl_error() {
  init_case "verify-curl-error"
  set_actions ok
  set_share_actions 404 reset reset reset reset reset
  run_stage
  assert_rc 1
  assert_count upload-count 1
  assert_count probe-count 6
  assert_contains "curl rc=56"
  assert_contains "HTTP 000, curl rc=56"
  assert_contains "curl error: curl: (56) Recv failure: Connection reset by peer"
  assert_contains "refusing to re-upload"
  assert_contains "release gate remains closed"
  assert_not_contains "upload transport failed on all 3"
  assert_not_contains "SHA-256 matches expected"
  echo "PASS public-share curl error is captured and does not trigger re-upload"
}

case_diagnostics_bounded() {
  init_case "diagnostics-bounded"
  set_actions reset_long
  set_share_actions 404 reset reset reset reset reset
  run_stage
  assert_rc 1
  assert_count upload-count 1
  assert_count probe-count 6
  assert_contains "response body: <withheld"
  assert_not_contains "BODY_HEAD"
  assert_not_contains "BODY_TAIL"
  assert_contains "ERR_HEAD"
  assert_contains "<redacted-url>"
  assert_not_contains "ERR_TAIL"
  assert_not_contains "ERR_TOKEN_SECRET"
  assert_not_contains "ERR_URL_SECRET"
  assert_not_contains "BODY_TOKEN_SECRET"
  assert_not_contains "URL_SECRET"
  assert_not_contains "$TOKEN"
  assert_not_contains "SIGNED-SECRET"
  assert_not_contains "upload.example"
  echo "PASS diagnostics are bounded and secrets are redacted"
}

case_upload_link_retry() {
  init_case "upload-link-retry"
  set_link_actions reset ok
  set_actions ok
  run_stage
  assert_rc 0
  assert_count upload-link-count 2
  assert_count upload-count 1
  assert_count probe-count 2
  assert_contains "upload-link attempt 1/3 failed (curl rc=56)"
  assert_contains "upload-link acquired on attempt 2/3"
  assert_remote_sha
  echo "PASS upload-link transient failure retries and succeeds"
}

case_upload_link_exhausted() {
  init_case "upload-link-exhausted"
  set_link_actions reset reset reset
  set_actions ok
  run_stage
  assert_rc 1
  assert_count upload-link-count 3
  assert_count upload-count 0
  assert_count probe-count 1
  assert_contains "upload-link request failed after 3 attempt(s)"
  assert_contains "release gate remains closed"
  assert_not_contains "$TOKEN"
  assert_not_contains "SIGNED-SECRET"
  echo "PASS upload-link retry budget exhausted before upload"
}

case_upload_link_http_error() {
  init_case "upload-link-http-error"
  set_link_actions http500 ok
  set_actions ok
  run_stage
  assert_rc 0
  assert_count upload-link-count 2
  assert_count upload-count 1
  assert_count probe-count 2
  assert_contains "upload-link attempt 1/3 failed (curl rc=22)"
  assert_contains "upload-link acquired on attempt 2/3"
  assert_remote_sha
  echo "PASS upload-link HTTP error retries and succeeds"
}

case_content_mismatch_then_retry_success() {
  init_case "content-mismatch-retry"
  set_actions wrong ok
  run_stage
  assert_rc 0
  assert_count upload-count 2
  assert_count upload-link-count 2
  assert_count probe-count 4
  assert_contains "full APK download 2/2 had the wrong SHA-256"
  assert_contains "SHA-256 mismatch"
  assert_contains "SHA-256 matches expected"
  assert_remote_sha
  echo "PASS content mismatch limits full downloads and retry succeeds"
}

case_postupload_empty_200() {
  init_case "postupload-empty-200"
  set_actions ok
  set_share_actions 404 empty200 empty200 empty200 empty200 empty200
  run_stage
  assert_rc 1
  assert_count upload-count 1
  assert_count upload-link-count 1
  assert_count probe-count 6
  assert_contains "HTTP 200 but the response body is empty"
  assert_contains "refusing to re-upload an object whose remote state is unknown"
  assert_not_contains "not confirmed; retrying in 5s"
  assert_not_contains "public-share SHA-256 verification failed after 3"
  assert_remote_sha
  echo "PASS post-upload empty HTTP 200 fails closed without re-upload"
}

case_postupload_unconfirmed() {
  init_case "postupload-403"
  set_actions ok
  set_share_actions 404 403 403 403 403 403
  run_stage
  assert_rc 1
  assert_count upload-count 1
  assert_count upload-link-count 1
  assert_count probe-count 6
  assert_contains "HTTP 403"
  assert_contains "refusing to re-upload an object whose remote state is unknown"
  assert_contains "release gate remains closed"
  assert_not_contains "not confirmed; retrying in 5s"
  assert_not_contains "public-share SHA-256 verification failed after 3"
  assert_not_contains "SHA-256 matches expected"
  assert_remote_sha
  echo "PASS post-upload HTTP 403 fails closed without re-upload"
}

case_verify_counter_separation() {
  init_case "verify-counter-separation"
  set_actions wrong
  set_share_actions 404 reset reset reset wrong fix
  run_stage
  assert_rc 0
  assert_count upload-count 1
  assert_count upload-link-count 1
  assert_count probe-count 6
  assert_contains "full APK download 1/2 had the wrong SHA-256"
  assert_contains "SHA-256 mismatch"
  assert_contains "SHA-256 matches expected"
  assert_remote_sha
  echo "PASS content-download counter is separate from the probe counter"
}

case_global_budget_exhausted() {
  init_case "budget-exhausted"
  CASE_BUDGET=0
  set_actions ok
  run_stage
  assert_rc 1
  assert_count upload-count 0
  assert_count upload-link-count 0
  assert_count probe-count 0
  assert_contains "exhausted its 0s budget"
  assert_contains "release gate remains closed"
  echo "PASS global budget exhausted before the first HTTP operation"
}

case_budget_caps_operations() {
  init_case "budget-caps"
  CASE_BUDGET=100
  set_actions ok
  run_stage
  assert_rc 0
  assert_count upload-count 1
  assert_count probe-count 2
  assert_curl_args_contains "--max-time 60"
  assert_curl_args_not_contains "--max-time 900"
  assert_curl_args_not_contains "--max-time 2700"
  assert_contains "response body: <withheld"
  assert_remote_sha
  echo "PASS per-operation timeouts are capped by the remaining budget"
}

case_upload_link_invalid_response() {
  init_case "upload-link-invalid"
  set_link_actions invalid ok
  set_actions ok
  run_stage
  assert_rc 0
  assert_count upload-link-count 2
  assert_count upload-count 1
  assert_count probe-count 2
  assert_contains "invalid URL"
  assert_contains "response body: <withheld"
  assert_not_contains "not-a-url"
  assert_not_contains "SIGNED-SECRET"
  assert_remote_sha
  echo "PASS upload-link non-URL response is retried without logging the body"
}

case_upload_link_retry
case_upload_link_invalid_response
case_upload_link_http_error
case_upload_link_exhausted
case_content_mismatch_then_retry_success
case_success
case_preexisting_remote
case_reset_remote_matches
case_reset_then_retry_success
case_reset_never_appears
case_transport_with_response
case_http400_matches
case_wrong_remote_sha
case_partial_transport_failure
case_share_not_found
case_preupload_unconfirmed 403
case_preupload_unconfirmed 429
case_preupload_unconfirmed 500
case_preupload_empty_200
case_preupload_transport
case_postupload_empty_200
case_postupload_unconfirmed
case_verify_counter_separation
case_retry_budget_exhausted
case_verify_curl_error
case_diagnostics_bounded
case_global_budget_exhausted
case_budget_caps_operations

echo "Tsinghua upload mocked matrix: PASS"
