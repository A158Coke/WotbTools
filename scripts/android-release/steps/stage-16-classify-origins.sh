#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 21: Classify origin APK on TX1/TX2 (SSH; public URL is the drive replica)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
. scripts/android-release/check-release-guards.sh
APK_NAME="$STEP_ARTIFACT_APKNAME"
BUILD_SHA="$STEP_ARTIFACT_SHA256"

origin_sha() {
  local label="$1" host="$2" user="$3" port="$4" key="$5" dir="$6"
  local keyfile="$RUNNER_TEMP/${label}-origin-key.pem"
  printf '%s\n' "$key" > "$keyfile"
  chmod 600 "$keyfile"
  local out rc=0
  out="$(ssh -i "$keyfile" -p "$port" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
    "$user@$host" "if [ -f '$dir/$APK_NAME' ]; then sha256sum '$dir/$APK_NAME' | awk '{print \$1}'; else echo __ABSENT__; fi")" || rc=$?
  rm -f "$keyfile"
  if [ "$rc" -ne 0 ]; then
    echo "::error::$label origin probe ssh failed (rc=$rc); refusing to classify as absent/SHA." >&2
    exit 1
  fi
  out="$(printf '%s' "$out" | tail -n 1 | tr -d '[:space:]')"
  if [ "$out" = "__ABSENT__" ]; then
    echo ""
  elif [ "${#out}" -eq 64 ] && printf '%s' "$out" | grep -Eq '^[0-9a-f]+$'; then
    echo "$out"
  else
    echo "::error::$label origin probe returned unexpected output: ${out:-<empty>}" >&2
    exit 1
  fi
}

TX1_SHA="$(origin_sha tx1 "$TX1_SSH_HOST" "$TX1_SSH_USER" "$TX1_SSH_PORT" "$TX1_SSH_KEY" /opt/wotb-tx/android-release)"
classify_prod_apk "$TX1_SHA" "$BUILD_SHA"
TX1_STATE="$APK_STATE"
if [ "$TX1_STATE" = "apk_conflict" ]; then
  echo "::error::TX1 origin APK immutable conflict: sha=$TX1_SHA expected=$BUILD_SHA" >&2
  exit 1
fi

TX2_SHA="$(origin_sha tx2 "$TX2_SSH_HOST" "$TX2_SSH_USER" "$TX2_SSH_PORT" "$TX2_SSH_KEY" /opt/wotb-tx2/runtime-content/android-release)"
classify_prod_apk "$TX2_SHA" "$BUILD_SHA"
TX2_STATE="$APK_STATE"
if [ "$TX2_STATE" = "apk_conflict" ]; then
  echo "::error::TX2 origin APK immutable conflict: sha=$TX2_SHA expected=$BUILD_SHA" >&2
  exit 1
fi

echo "TX1 origin: $TX1_STATE; TX2 origin: $TX2_STATE"
echo "tx1State=$TX1_STATE" >> "$GITHUB_OUTPUT"
echo "tx2State=$TX2_STATE" >> "$GITHUB_OUTPUT"
