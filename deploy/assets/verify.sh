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

# ---- dataset version catalog / versioned paths --------------------------------

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

command -v python3 >/dev/null 2>&1 || fail "python3 is required for versions.json checks"

versions_status="$(curl "${curl_common[@]}" -o "$work/versions.json" -D "$work/versions.head" \
  -w '%{http_code}' "$base/versions.json")"
[[ "$versions_status" == "200" ]] || fail "GET /versions.json returned HTTP $versions_status"
grep -Eqi '^cache-control:.*max-age=60' "$work/versions.head" || \
  fail "/versions.json must use the short revalidation TTL (max-age=60)"
grep -Eqi '^vary:.*origin' "$work/versions.head" || fail "/versions.json did not vary by Origin"

curl "${curl_common[@]}" --fail -o /dev/null -D "$work/versions.cors" \
  -H 'Origin: https://wotbtools.com' "$base/versions.json"
grep -Fqi 'access-control-allow-origin: https://wotbtools.com' "$work/versions.cors" || \
  fail "/versions.json did not reflect the allowed web origin"

default_id="$(python3 - "$work/versions.json" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
assert doc.get("schema") == 1, "versions.json schema must be 1"
items = doc.get("datasets")
assert isinstance(items, list) and items, "versions.json must list datasets"
ids = [item.get("id") for item in items]
assert doc.get("default") in ids, "versions.json default must be one of the datasets"
print(doc["default"])
PY
)" || fail "/versions.json is not a valid dataset catalog"

for dataset_id in $(python3 - "$work/versions.json" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
for item in doc.get("datasets", []):
    print(item["id"])
PY
); do
  status="$(curl "${curl_common[@]}" -o /dev/null -w '%{http_code}' "$base/v/$dataset_id/version.json")"
  [[ "$status" == "200" ]] || fail "/v/$dataset_id/version.json returned HTTP $status"
done

status="$(curl "${curl_common[@]}" -o /dev/null -w '%{http_code}' "$base/v/$default_id/index.json")"
[[ "$status" == "200" ]] || fail "/v/$default_id/index.json returned HTTP $status"

curl "${curl_common[@]}" --fail -o "$work/default.version.json" "$base/v/$default_id/version.json"
curl "${curl_common[@]}" --fail -o "$work/default.manifest.json" "$base/v/$default_id/manifest.json"
curl "${curl_common[@]}" --fail -o "$work/root.manifest.json" "$base/manifest.json"

expected_manifest_sha="$(python3 - "$work/default.version.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["manifest_sha256"])
PY
)"
actual_manifest_sha="$(sha256_file "$work/default.manifest.json")"
[[ "$expected_manifest_sha" == "$actual_manifest_sha" ]] || \
  fail "version.json manifest_sha256 does not match /v/$default_id/manifest.json"

cmp -s "$work/root.manifest.json" "$work/default.manifest.json" || \
  fail "legacy /manifest.json differs from /v/$default_id/manifest.json"

echo "asset-origin verification: PASS ($base)"
