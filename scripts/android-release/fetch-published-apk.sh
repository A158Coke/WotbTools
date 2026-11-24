#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${TX_HOST:?}" "${TX_USER:?}" "${TX_KEY:?}" "${TX_HOST_KEY:?}"
[[ "$TX_PORT" =~ ^[0-9]+$ ]]
[[ "$TX_HOST_KEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*$ ]]
[[ "$APK_NAME" =~ ^wotbtools-android-v[0-9]+\.[0-9]+\.[0-9]+\.apk$ ]]

tmp="$(mktemp -d "${RUNNER_TEMP:?}/apk-source.XXXXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
printf '%s\n' "$TX_KEY" > "$tmp/key"
unset TX_KEY
printf 'tx1-apk-origin %s\n' "$TX_HOST_KEY" > "$tmp/known_hosts"
mkdir -p release-staging
scp -B -P "$TX_PORT" -i "$tmp/key" -o IdentitiesOnly=yes -o ForwardAgent=no \
  -o StrictHostKeyChecking=yes -o HostKeyAlias=tx1-apk-origin \
  -o "UserKnownHostsFile=$tmp/known_hosts" -o ConnectTimeout=15 \
  "$TX_USER@$TX_HOST:/opt/wotb-tx/android-release/$APK_NAME" "$tmp/source.apk"
[[ "$(stat -c '%s' "$tmp/source.apk")" == "$APK_SIZE" ]]
printf '%s  %s\n' "$APK_SHA" "$tmp/source.apk" | sha256sum -c -
mv -- "$tmp/source.apk" "release-staging/$APK_NAME"
