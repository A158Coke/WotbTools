#!/usr/bin/env bash
# Verify the candidate origin directly. Redirects are unexpected at this endpoint.
set -Eeuo pipefail
export LC_ALL=C
fail() { echo "verify Android download: $*" >&2; exit 1; }
[[ $# == 3 ]] || fail "usage: $0 DIRECT_URL EXPECTED_SIZE EXPECTED_SHA256"
url=$1 size=$2 sha=$3
[[ $size =~ ^[1-9][0-9]*$ && $sha =~ ^[0-9a-f]{64}$ ]] || fail "invalid expected size or SHA-256"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
request() {
  local expected=$1 actual
  shift
  actual=$(curl --disable --globoff --silent --show-error --connect-timeout 5 --max-time 900 \
    -D "$work/headers" -w '%{http_code}' "$@" -- "$url")
  [[ $actual == "$expected" ]] || fail "expected HTTP $expected actual=$actual"
}
header_value() {
  awk -v key="$1" 'tolower($1) == key ":" { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print }' "$work/headers"
}
check_immutable() {
  [[ $(header_value cache-control) == "public, max-age=31536000, immutable" ]] || fail "unexpected Cache-Control"
}

request 200 --head -o /dev/null
check_immutable
[[ $(header_value content-length) == "$size" ]] || fail "HEAD length differs from $size"
request 200 --max-filesize "$size" -o "$work/full"
check_immutable
actual_size=$(stat -c %s "$work/full")
actual_sha=$(sha256sum < "$work/full")
actual_sha=${actual_sha%% *}
echo "GET $url expected_size=$size actual_size=$actual_size expected_sha256=$sha actual_sha256=$actual_sha"
[[ $actual_size == "$size" && $actual_sha == "$sha" ]] || fail "download identity mismatch"

# Read a non-initial range through EOF, then compare it to the verified full GET.
length=$((size < 4096 ? (size + 1) / 2 : 4096))
start=$((size - length))
request 206 --range "$start-" --max-filesize "$length" -o "$work/range"
check_immutable
range=$(header_value content-range)
[[ $range == "bytes $start-$((size - 1))/$size" ]] || fail "unexpected Content-Range: $range"
tail -c "$length" "$work/full" | cmp - "$work/range" || fail "range bytes differ from verified download"
echo "verified direct origin: HTTP 206 $range"
