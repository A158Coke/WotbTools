#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 28: Upload Android delta to Tsinghua Cloud).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
name="$STEP_DELTA_PATCHNAME"
expected="$(jq -r '.patches[0].sha256' "$RUNNER_TEMP/delta-metadata.json")"
repo="a757b2fa-9bc9-42f9-bc90-d6a2c0a94ed0"
dir="/wotbtools-android"
public="https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/$name&dl=1"
probe="$(curl -sSL --connect-timeout 10 --max-time 300 -o "$RUNNER_TEMP/thu-delta-existing" -w '%{http_code} %{content_type}' "$public")" || exit 1
code="${probe%% *}"; content_type="${probe#* }"
if [ "$code" = 200 ] && [ "$(sha256sum "$RUNNER_TEMP/thu-delta-existing" | awk '{print $1}')" = "$expected" ]; then exit 0; fi
case "$code:$content_type" in
  404:*|200:text/html*) ;;
  *) echo "::error::Existing delta is unreadable or conflicts with its immutable name" >&2; exit 1 ;;
esac
link="$(curl -fsS -H "Authorization: Token $TSINGHUA_CLOUD_TOKEN" "https://cloud.tsinghua.edu.cn/api2/repos/$repo/upload-link/?p=$dir&reuse=1" | jq -r '.')"
case "$link" in https://*) ;; *) exit 1 ;; esac
curl -sS --connect-timeout 10 --max-time 2700 -o "$RUNNER_TEMP/thu-delta-upload.txt" -H "Authorization: Token $TSINGHUA_CLOUD_TOKEN" -F "parent_dir=$dir" -F "replace=0" -F "file=@release-staging/$name" "$link" || true
for attempt in 1 2 3 4 5; do
  sleep 3
  if curl -fsSL --connect-timeout 5 --max-time 900 -o "$RUNNER_TEMP/thu-delta.vcdiff" "$public" && [ "$(sha256sum "$RUNNER_TEMP/thu-delta.vcdiff" | awk '{print $1}')" = "$expected" ]; then exit 0; fi
done
echo "::error::Tsinghua delta offload verification failed" >&2
exit 1
