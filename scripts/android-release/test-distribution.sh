#!/usr/bin/env bash
# Exercise the real release steps and host receiver with isolated SSH/HTTP transports.
set -Eeuo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
export RUNNER_TEMP="$tmp" ANDROID_DOWNLOAD_ROOT="$tmp/origin"
mkdir -p "$tmp/bin" "$tmp/release-staging" "$ANDROID_DOWNLOAD_ROOT"/{incoming,android}
touch "$ANDROID_DOWNLOAD_ROOT/.install.lock"
ln -s "$root/deploy" "$tmp/deploy"
cd "$tmp"
export PATH="$tmp/bin:$PATH" ALI_HOST=fixture ALI_PORT=22 ALI_USER=writer ALI_KEY=test ALI_HOST_KEY='ssh-ed25519 AAAA'
cat > bin/ssh <<'SH'
#!/usr/bin/env bash
set -eu
export SSH_ORIGINAL_COMMAND="${!#}"
exec bash deploy/assets/install-android-download.sh --receive
SH
cat > bin/curl <<'SH'
#!/usr/bin/env bash
set -eu
method=GET range=''
while (( $# )); do
  case $1 in
    --head) method=HEAD; shift ;;
    --range) range=${2%-}; shift 2 ;;
    -D) headers=$2; shift 2 ;;
    -o) out=$2; shift 2 ;;
    --) url=$2; break ;;
    *) shift ;;
  esac
done
name=${url##*/}
file="$ANDROID_DOWNLOAD_ROOT/android/$name"
: > "$headers"
case "$url" in
  https://wotbtools.com/download/android/*)
    if [[ ${FIXTURE_ROUTE:-} == aliyun ]]; then
      printf 'HTTP/2 302\r\nlocation: https://assets.wotbtools.com/android/%s\r\nCache-Control: %s\r\n\r\n' "$name" "${REDIRECT_CACHE:-no-store}" >> "$headers"
    else
      file="release-staging/$name"
      dest="https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/$name&dl=1"
      if [[ ${BAD_ROUTE:-} == "$name" ]]; then dest=https://other.invalid/file; fi
      printf 'HTTP/2 302\r\nlocation: %s\r\ncontent-length: 0\r\n\r\n' "$dest" >> "$headers"
      printf 'HTTP/1.1 302 Found\r\nLocation: https://cloud.tsinghua.edu.cn/seafhttp/files/fixture/%s\r\n\r\n' "$name" >> "$headers"
    fi
    ;;
  https://cloud.tsinghua.edu.cn/d/*)
    name=${name%&dl=1}
    file="release-staging/$name"
    printf 'HTTP/2 302\r\nLocation: https://%s/seafhttp/files/fixture/%s\r\n\r\n' "${SHARE_HOST:-cloud.tsinghua.edu.cn}" "$name" >> "$headers"
    ;;
  https://assets.wotbtools.com/android/*) ;;
  *) exit 1 ;;
esac
if [[ ! -f $file ]]; then printf '404'; exit; fi
size=$(stat -c %s "$file")
if [[ -n $range ]]; then
  printf 'HTTP/2 206\r\nContent-Range: bytes %d-%d/%d\r\n' "$range" "$((size-1))" "$size" >> "$headers"
  tail -c "+$((range+1))" "$file" > "$out"
  printf 206
else
  printf 'HTTP/2 200\r\nContent-Length: %d\r\n' "$size" >> "$headers"
  if [[ $method == GET ]]; then cp "$file" "$out"; fi
  printf 200
fi
printf 'Cache-Control: public, max-age=31536000, immutable\r\n\r\n' >> "$headers"
SH
chmod +x bin/{ssh,curl}
reject() { if "$@"; then echo "unexpected success: $*" >&2; exit 1; fi; }
apk=wotbtools-android-v1.2.3.apk
printf 'staged bytes for the signed APK fixture' > "release-staging/$apk"
sha=$(sha256sum < "release-staging/$apk" | cut -d' ' -f1)
cp "release-staging/$apk" staged.apk
printf 'patch' > patch
patch_sha=$(sha256sum < patch | cut -d' ' -f1)
patch="wotbtools-android-delta-1002002-1002003-$patch_sha.vcdiff"
cp patch "release-staging/$patch"
install="$root/scripts/android-release/steps/install-aliyun-download.sh"
publish="$root/scripts/android-release/steps/publish-verify-distribution.sh"
export STEP_STAGEDREF_APKNAME=$apk STEP_STAGED_APKSHA=$sha
printf '{"patches":[]}\n' > delta-publish.json
reject bash "$publish"
DOWNLOAD_NAME=$apk DOWNLOAD_SHA=$sha bash "$install"
bash "$publish"
jq -n --arg url "https://wotbtools.com/download/android/$patch" --arg sha "$patch_sha" \
  '{patches:[{url:$url,sha256:$sha,size:5}]}' > delta-publish.json
reject bash "$publish"
DOWNLOAD_NAME=$patch DOWNLOAD_SHA=$patch_sha bash "$install"
bash "$publish"
verify=deploy/assets/verify-android-download.sh
bash "$verify" --replica tsinghua "$patch" 5 "$patch_sha"
SHARE_HOST=other.invalid reject bash "$verify" --replica tsinghua "$patch" 5 "$patch_sha"
FIXTURE_ROUTE=aliyun bash "$verify" --replica stable-aliyun "$patch" 5 "$patch_sha"
FIXTURE_ROUTE=aliyun REDIRECT_CACHE=immutable reject bash "$verify" --replica stable-aliyun "$patch" 5 "$patch_sha"
reject bash "$verify" --replica stable-aliyun "$patch" 5 "$patch_sha"
FIXTURE_ROUTE=aliyun reject bash "$verify" --replica stable "$patch" 5 "$patch_sha"
BAD_ROUTE=$patch reject bash "$publish"
printf 'wrong' > "release-staging/$patch"
reject bash "$publish"
reject env DOWNLOAD_NAME=$patch DOWNLOAD_SHA=$patch_sha bash "$install"
cmp patch "$ANDROID_DOWNLOAD_ROOT/android/$patch"
reject env SSH_ORIGINAL_COMMAND="install $apk 1 $sha extra" bash deploy/assets/install-android-download.sh --receive
echo 'Android dual-write distribution: PASS'
