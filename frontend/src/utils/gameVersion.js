/**
 * 游戏版本显示（审计 BZ-17）：回放 meta.json 的 version 形如 `10.6.0_apple`、`11.20.0_china`、`12.0.0_eu`，
 * 下划线后是客户端 / 区服版本标识。界面不直接显示内部值（design-language §11），
 * 而是格式化为 `10.6.0 · Apple`、`11.20.0 · 中国服`。纯函数：标识的显示名由调用方（i18n）提供。
 */
const VERSION_PATTERN = /^(\d+(?:\.\d+)*)(?:[_\s-]+([A-Za-z][\w-]*))?$/

/** 原始版本 → { number, edition }；无法识别的格式原样作为 number 返回，空值返回 null。 */
export function parseGameVersion(raw) {
  const text = raw == null ? '' : String(raw).trim()
  if (!text) return null
  const match = VERSION_PATTERN.exec(text)
  if (!match) return { number: text, edition: '' }
  return { number: match[1], edition: (match[2] || '').toLowerCase() }
}

/** 没有翻译的标识兜底：短代号全大写（eu → EU），其余首字母大写（steam → Steam）。 */
function fallbackEditionLabel(edition) {
  if (edition.length <= 3) return edition.toUpperCase()
  return edition.charAt(0).toUpperCase() + edition.slice(1)
}

/**
 * @param {unknown} raw 原始版本字符串
 * @param {(edition: string) => string} [editionLabel] 标识 → 显示名；返回空串时使用兜底规则
 * @returns {string} 格式化后的版本；空值返回空串（由调用方决定占位符）
 */
export function formatGameVersion(raw, editionLabel = () => '') {
  const parsed = parseGameVersion(raw)
  if (!parsed) return ''
  if (!parsed.edition) return parsed.number
  const label = editionLabel(parsed.edition) || fallbackEditionLabel(parsed.edition)
  return `${parsed.number} · ${label}`
}
