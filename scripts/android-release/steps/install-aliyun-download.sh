#!/usr/bin/env bash
# Stage and Repair upload the already verified release-staging bytes.
# The dedicated SSH key is limited to the host installer's --receive command.
set -Eeuo pipefail
umask 077
: "${ALI_HOST:?}" "${ALI_USER:?}" "${ALI_KEY:?}" "${ALI_HOST_KEY:?}"
[[ $ALI_HOST_KEY =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*$ ]]
[[ $ALI_PORT =~ ^[0-9]+$ ]]
name=${DOWNLOAD_NAME:?}
sha=${DOWNLOAD_SHA:?}
[[ $name =~ ^wotbtools-android-(v[0-9]+\.[0-9]+\.[0-9]+\.apk|delta-[0-9]+-[0-9]+-[0-9a-f]{64}\.vcdiff)$ ]]
[[ $sha =~ ^[a-f0-9]{64}$ ]]
file="release-staging/$name"
size=$(stat -c %s "$file")
[[ $size -gt 0 && ! -L $file && -f $file ]]
tmp=$(mktemp -d "${RUNNER_TEMP:?}/aliyun-upload.XXXXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
printf '%s\n' "$ALI_KEY" > "$tmp/key"
unset ALI_KEY
printf 'android-download-origin %s\n' "$ALI_HOST_KEY" > "$tmp/known_hosts"
timeout 25m ssh -F /dev/null -T -p "$ALI_PORT" -l "$ALI_USER" -i "$tmp/key" \
  -o IdentitiesOnly=yes -o BatchMode=yes -o ForwardAgent=no -o StrictHostKeyChecking=yes \
  -o HostKeyAlias=android-download-origin -o "UserKnownHostsFile=$tmp/known_hosts" \
  -o GlobalKnownHostsFile=/dev/null -o ConnectTimeout=15 -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 -- "$ALI_HOST" "install $name $size $sha" < "$file"
bash deploy/assets/verify-android-download.sh --replica aliyun "$name" "$size" "$sha"
