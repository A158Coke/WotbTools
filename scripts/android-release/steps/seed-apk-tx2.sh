set -euo pipefail
DEST="$DEST_DIR/$APK_NAME"
rm -f "$DEST".partial.*
TMP="$DEST.partial.$$"
curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 10 --max-time 300 -o "$TMP" -w "replica pull: %{size_download} bytes in %{time_total}s (%{speed_download} B/s)" "$SHARE_DIRECT"
echo
echo "$EXPECT_SHA  $TMP" | sha256sum -c - || { rm -f "$TMP"; echo "replica bytes mismatch; refused to seed origin" >&2; exit 1; }
if ln "$TMP" "$DEST"; then
  rm -f "$TMP"
  chmod 644 "$DEST"
else
  EXISTING_SHA="$(sha256sum "$DEST" 2>/dev/null | awk '{print $1}' || true)"
  rm -f "$TMP"
  if [ "$EXISTING_SHA" = "$EXPECT_SHA" ]; then
    echo "origin appeared concurrently but holds the expected immutable bytes: $DEST"
    chmod 644 "$DEST"
  else
    echo "immutable origin conflict at $DEST (existing=${EXISTING_SHA:-<unreadable>} expected=$EXPECT_SHA); refusing to overwrite" >&2
    exit 1
  fi
fi
sha256sum "$DEST"
