#!/usr/bin/env bash
set -Eeuo pipefail

base="${1:-https://assets.wotbtools.com}"
base="${base%/}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl_common=(--silent --show-error --connect-timeout 5 --max-time 20)

fail() {
  echo "asset-origin verification failed: $*" >&2
  exit 1
}

status="$(curl "${curl_common[@]}" -o /dev/null -D "$work/head" -w '%{http_code}' -I "$base/index.json")"
[[ "$status" == "200" ]] || fail "HEAD /index.json returned HTTP $status"
grep -qi '^etag:' "$work/head" || fail "HEAD /index.json did not expose ETag"
grep -qi '^cache-control:.*max-age=300' "$work/head" || fail "short Cache-Control contract missing"
grep -Eqi '^vary:.*origin' "$work/head" || fail "HEAD /index.json did not vary by Origin"

for origin in https://wotbtools.com https://www.wotbtools.com; do
  curl "${curl_common[@]}" --fail -o /dev/null -D "$work/cors" -H "Origin: $origin" "$base/index.json"
  grep -Fqi "access-control-allow-origin: $origin" "$work/cors" || \
    fail "CORS did not reflect allowed origin $origin"
  grep -Eqi '^vary:.*origin' "$work/cors" || fail "allowed Origin response did not vary by Origin"
done

curl "${curl_common[@]}" --fail -o /dev/null -D "$work/untrusted" \
  -H 'Origin: https://example.invalid' "$base/index.json"
if grep -qi '^access-control-allow-origin:' "$work/untrusted"; then
  fail "untrusted Origin received Access-Control-Allow-Origin"
fi
grep -Eqi '^vary:.*origin' "$work/untrusted" || fail "untrusted Origin response did not vary by Origin"

preflight_status="$(curl "${curl_common[@]}" -o /dev/null -D "$work/preflight" -w '%{http_code}' \
  -X OPTIONS -H 'Origin: https://wotbtools.com' \
  -H 'Access-Control-Request-Method: GET' "$base/index.json")"
[[ "$preflight_status" == "204" ]] || fail "allowed CORS preflight returned HTTP $preflight_status"
grep -Fqi 'access-control-allow-origin: https://wotbtools.com' "$work/preflight" || \
  fail "allowed preflight did not expose Access-Control-Allow-Origin"

range_status="$(curl "${curl_common[@]}" -o /dev/null -D "$work/range" -w '%{http_code}' \
  -H 'Range: bytes=0-0' "$base/index.json")"
[[ "$range_status" == "206" ]] || fail "Range request returned HTTP $range_status instead of 206"
grep -qi '^content-range: bytes 0-0/' "$work/range" || fail "Range response did not expose Content-Range"

# POSIX/mawk-compatible case-insensitive header-name match. Keep the original
# header value byte-for-byte so weak/quoted ETags survive the conditional request.
etag="$(awk 'tolower($0) ~ /^etag:/ {sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}' "$work/head")"
[[ -n "$etag" ]] || fail "could not parse ETag"
conditional_status="$(curl "${curl_common[@]}" -o /dev/null -w '%{http_code}' \
  -H "If-None-Match: $etag" "$base/index.json")"
[[ "$conditional_status" == "304" ]] || fail "If-None-Match returned HTTP $conditional_status instead of 304"

echo "asset-origin verification: PASS ($base)"
