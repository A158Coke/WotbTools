set -euo pipefail
DEST="$DEST_DIR/$APK_NAME"
rm -f "$DEST".partial.*          # 清上次中断留下的半截文件
TMP="$DEST.partial.$$"
curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 10 --max-time 300 -o "$TMP" -w "replica pull: %{size_download} bytes in %{time_total}s (%{speed_download} B/s)" "$SHARE_DIRECT"
echo
echo "$EXPECT_SHA  $TMP" | sha256sum -c - || { rm -f "$TMP"; echo "replica bytes mismatch; refused to seed origin" >&2; exit 1; }
# 原子 no-clobber 落位（同目录 hard link）：DEST 不存在 → 完整文件瞬间出现；
# DEST 已被并发写入 → link 原子失败，绝不覆盖 immutable 字节（classify 的
# apk_absent 是快照，此窗口内可能有 manual SSH / 恢复脚本等第三方写入）。
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
