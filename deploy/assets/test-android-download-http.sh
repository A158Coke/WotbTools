#!/usr/bin/env bash
# Exercise the real Caddy configuration against a disposable, writable fixture root.
set -Eeuo pipefail
base=${1:?fixture origin URL}
export ANDROID_DOWNLOAD_ROOT=${2:?fixture downloads root}
scripts=$(dirname "$0")
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir "$ANDROID_DOWNLOAD_ROOT/incoming"
touch "$ANDROID_DOWNLOAD_ROOT/.install.lock"
apk=wotbtools-android-v1.2.3.apk
head -c 32768 /dev/urandom > "$work/apk"
head -c 8192 /dev/urandom > "$work/patch"
patch_sha=$(sha256sum < "$work/patch" | cut -d' ' -f1)
for kind in apk patch; do
  name=$apk
  if [[ $kind == patch ]]; then name="wotbtools-android-delta-1002002-1002003-$patch_sha.vcdiff"; fi
  size=$(stat -c %s "$work/$kind")
  sha=$(sha256sum < "$work/$kind" | cut -d' ' -f1)
  bash "$scripts/install-android-download.sh" "$work/$kind" "$name" "$size" "$sha"
  bash "$scripts/verify-android-download.sh" "$base/android/$name" "$size" "$sha"
done

url="$base/android/$apk"
http() {
  local expected=$1 actual
  shift
  actual=$(curl --silent --show-error --connect-timeout 2 --max-time 10 -o "$work/body" -D "$work/headers" -w '%{http_code}' "$@")
  [[ $actual == "$expected" ]] || { echo "expected HTTP $expected actual=$actual: $*" >&2; exit 1; }
}
http 200 -H 'Origin: https://wotbtools.com' "$url"
grep -Fqi 'Access-Control-Allow-Origin: https://wotbtools.com' "$work/headers"
grep -Eqi '^Vary:.*Origin' "$work/headers"
etag=$(awk 'tolower($1) == "etag:" { sub(/\r$/, ""); print $2 }' "$work/headers")
[[ -n $etag ]]
http 304 -H "If-None-Match: $etag" "$url"
grep -Eqi '^Cache-Control: public, max-age=31536000, immutable\s*$' "$work/headers"
http 206 --range 0-1023 "$url"
cp "$work/body" "$work/joined"
http 206 --range 1024- "$url"
cat "$work/body" >> "$work/joined"
cmp "$work/apk" "$work/joined"
http 206 --range -200 "$url"
tail -c 200 "$work/apk" | cmp - "$work/body"
no_store() {
  grep -Eqi '^Cache-Control: no-store\s*$' "$work/headers"
  ! grep -qi 'immutable' "$work/headers" || return 1
}
http 416 --range 999999- "$url"
no_store
touch "$ANDROID_DOWNLOAD_ROOT/android/private.staging.json" "$ANDROID_DOWNLOAD_ROOT/android/$apk.partial"
mkdir "$ANDROID_DOWNLOAD_ROOT/android/wotbtools-android-v1.2.9.apk"
for path in /android /android/ /android/private.staging.json "/android/$apk.partial" \
    /android/wotbtools-android-v1.2.8.apk /android/wotbtools-android-v1.2.9.apk; do
  http 404 "$base$path"
  no_store
done
http 404 -X POST "$url"
no_store
if bash "$scripts/verify-android-download.sh" "$url" 32768 "$patch_sha"; then
  echo "accepted the wrong APK identity" >&2; exit 1
fi
echo 'Android origin HTTP contract: PASS'
