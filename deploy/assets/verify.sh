#!/usr/bin/env bash
set -Eeuo pipefail

base="${1:-https://assets.wotbtools.com}"
base="${base%/}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() {
  echo "asset-origin verification failed: $*" >&2
  exit 1
}

status="$(curl -sS -o /dev/null -D "$work/head" -w '%{http_code}' -I "$base/index.json")"
[[ "$status" == "200" ]] || fail "HEAD /index.json returned HTTP $status"
grep -qi '^etag:' "$work/head" || fail "HEAD /index.json did not expose ETag"
grep -qi '^cache-control:.*max-age=300' "$work/head" || fail "short Cache-Control contract missing"

for origin in https://wotbtools.com https://www.wotbtools.com; do
  curl -fsS -o /dev/null -D "$work/cors" -H "Origin: $origin" "$base/index.json"
  grep -Fqi "access-control-allow-origin: $origin" "$work/cors" || \
    fail "CORS did not reflect allowed origin $origin"
done

curl -fsS -o /dev/null -D "$work/untrusted" -H 'Origin: https://example.invalid' "$base/index.json"
if grep -qi '^access-control-allow-origin:' "$work/untrusted"; then
  fail "untrusted Origin received Access-Control-Allow-Origin"
fi

range_status="$(curl -sS -o /dev/null -D "$work/range" -w '%{http_code}' -H 'Range: bytes=0-0' "$base/index.json")"
[[ "$range_status" == "206" ]] || fail "Range request returned HTTP $range_status instead of 206"
grep -qi '^content-range: bytes 0-0/' "$work/range" || fail "Range response did not expose Content-Range"

echo "asset-origin verification: PASS ($base)"
