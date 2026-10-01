/**
 * 游戏版本显示（审计 BZ-17）：回放 meta.json 的 version 可能带渠道/发行后缀，
 * 例如 `10.6.0_apple`、`11.20.0_china`。业务层只关心游戏版本号，
 * iOS / Android / 国服渠道差异不作为榜单维度展示。
 */
const VERSION_PATTERN = /^(\d+(?:\.\d+)*)(?:[_\s-]+[A-Za-z][\w-]*)?$/

/** 原始版本 → 纯版本号；无法识别的格式原样返回，空值返回空串。 */
export function formatGameVersion(raw) {
  const text = raw == null ? '' : String(raw).trim()
  if (!text) return ''
  const match = VERSION_PATTERN.exec(text)
  return match ? match[1] : text
}
