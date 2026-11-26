#!/usr/bin/env bash
# Phase two verifies the immutable candidate and the existing public offload independently.
set -Eeuo pipefail
export LC_ALL=C
fail() { echo "verify Android download: $*" >&2; exit 1; }
redirects=()
stable=false
if [[ $# == 5 && $1 == --replica ]]; then
  name=$3 size=$4 sha=$5
  [[ $name =~ ^wotbtools-android-(v[0-9]+\.[0-9]+\.[0-9]+\.apk|delta-[0-9]+-[0-9]+-[0-9a-f]{64}\.vcdiff)$ ]] || fail "invalid release filename"
  case $2 in
    aliyun) url="https://assets.wotbtools.com/android/$name" ;;
    stable)
      url="https://wotbtools.com/download/android/$name"
      share="https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/$name&dl=1"
      stable=true
      redirects=(--location --max-redirs 2 --proto '=https' --proto-redir '=https')
      ;;
    *) fail "unknown replica" ;;
  esac
else
  [[ $# == 3 ]] || fail "usage: $0 DIRECT_URL SIZE SHA256 | --replica aliyun|stable NAME SIZE SHA256"
  url=$1 size=$2 sha=$3
fi
[[ $size =~ ^[1-9][0-9]*$ && $sha =~ ^[0-9a-f]{64}$ ]] || fail "invalid expected size or SHA-256"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
request() {
  local expected=$1 actual
  shift
  actual=$(curl --disable --globoff --silent --show-error --connect-timeout 5 --max-time 900 \
    "${redirects[@]}" -D "$work/headers" -w '%{http_code}' "$@" -- "$url")
  [[ $actual == "$expected" ]] || fail "expected HTTP $expected actual=$actual"
  if $stable; then
    # Check the real object's redirects on HEAD, full GET and Range. Do not
    # print the provider's temporary file URL in job logs.
    local -a hops
    mapfile -t hops < <(awk '/^HTTP\// {sub(/\r$/, ""); status=$2} tolower($1) == "location:" {sub(/\r$/, ""); print status " " $2}' "$work/headers")
    [[ ${#hops[@]} -ge 1 && ${#hops[@]} -le 2 && ${hops[0]} == "302 $share" ]] || fail "unexpected stable offload target"
    if [[ ${#hops[@]} == 2 ]]; then
      [[ ${hops[1]} == *" https://cloud.tsinghua.edu.cn/seafhttp/files/"*/"$name" ]] || fail "unexpected share download target"
    fi
  fi
}
header_value() {
  awk -v key="$1" '/^HTTP\// {value=""} tolower($1) == key ":" { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); value=(value == "" ? $0 : value "\n" $0) } END {print value}' "$work/headers"
}
check_immutable() {
  if $stable; then return 0; fi
  [[ $(header_value cache-control) == "public, max-age=31536000, immutable" ]] || fail "unexpected Cache-Control"
}

request 200 --max-time 30 --head -o /dev/null
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
request 206 --max-time 60 --range "$start-" --max-filesize "$length" -o "$work/range"
check_immutable
range=$(header_value content-range)
[[ $range == "bytes $start-$((size - 1))/$size" ]] || fail "unexpected Content-Range: $range"
tail -c "$length" "$work/full" | cmp - "$work/range" || fail "range bytes differ from verified download"
echo "verified download: HTTP 206 $range"
