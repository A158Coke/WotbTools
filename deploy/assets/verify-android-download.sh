#!/usr/bin/env bash
# Verify direct replicas, the current release route, or an explicit cutover rehearsal.
set -Eeuo pipefail
export LC_ALL=C
fail() { echo "verify Android download: $*" >&2; exit 1; }
redirects=()
replica=direct
if [[ $# == 5 && $1 == --replica ]]; then
  name=$3 size=$4 sha=$5
  [[ $name =~ ^wotbtools-android-(v[0-9]+\.[0-9]+\.[0-9]+\.apk|delta-[0-9]+-[0-9]+-[0-9a-f]{64}\.vcdiff)$ ]] || fail "invalid release filename"
  replica=$2
  aliyun="https://assets.wotbtools.com/android/$name"
  share="https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/$name&dl=1"
  case $replica in
    aliyun) url=$aliyun ;;
    stable|stable-aliyun)
      url="https://wotbtools.com/download/android/$name"
      redirects=(--location --max-redirs 2 --proto '=https' --proto-redir '=https')
      ;;
    tsinghua)
      url=$share
      redirects=(--location --max-redirs 1 --proto '=https' --proto-redir '=https')
      ;;
    *) fail "unknown replica" ;;
  esac
else
  [[ $# == 3 ]] || fail "usage: $0 DIRECT_URL SIZE SHA256 | --replica aliyun|tsinghua|stable|stable-aliyun NAME SIZE SHA256"
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
  if (( ${#redirects[@]} )); then
    # Never log temporary share URLs. Validate the chain for each request.
    local -a hops
    mapfile -t hops < <(awk '/^HTTP\// {sub(/\r$/, ""); status=$2} tolower($1) == "location:" {sub(/\r$/, ""); print status " " $2}' "$work/headers")
    case $replica in
      stable-aliyun)
        [[ ${#hops[@]} == 1 && ${hops[0]} == "302 $aliyun" ]] || fail "unexpected Aliyun cutover target"
        # Read the 302's policy separately from the final immutable response.
        local redirect_cache
        redirect_cache=$(awk '/^HTTP\// {redirect=($2+0 == 302)} redirect && tolower($1) == "cache-control:" {sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print tolower($0)}' "$work/headers")
        [[ $redirect_cache == no-store ]] || fail "cutover redirect must be no-store"
        ;;
      stable)
        [[ ${#hops[@]} -ge 1 && ${hops[0]} == "302 $share" ]] || fail "unexpected stable offload target"
        hops=("${hops[@]:1}")
        ;;
    esac
    if [[ $replica != stable-aliyun ]] && (( ${#hops[@]} )); then
      [[ ${#hops[@]} == 1 && ${hops[0]} == *" https://cloud.tsinghua.edu.cn/seafhttp/files/"*/"$name" ]] || fail "unexpected share download target"
    fi
  fi
}
header_value() {
  awk -v key="$1" '/^HTTP\// {value=""} tolower($1) == key ":" { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); value=(value == "" ? $0 : value "\n" $0) } END {print value}' "$work/headers"
}
check_immutable() {
  if [[ $replica == stable || $replica == tsinghua ]]; then return 0; fi
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
