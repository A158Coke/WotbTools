/**
 * 名人堂车辆显示名（审计 BZ-17）：后端在 tankopedia 查不到车名时回退为 `#4657` 这样的占位名。
 * 界面优先使用任何可解析的真实车名（选项本身 → 其他已知来源，如 Tier X 车表、榜单行），都没有时才由调用方显示占位文案。
 * 纯函数，不依赖 i18n。
 */

/** `#4657`、空串、null 都视为「没有真实车名」。 */
export function isPlaceholderVehicleName(name) {
  const text = name == null ? '' : String(name).trim()
  return !text || /^#\d+$/.test(text)
}

/**
 * 依次尝试候选名，返回第一个真实车名；全部是占位名时返回空串。
 * @param {Array<string | null | undefined>} candidates
 */
export function resolveVehicleName(...candidates) {
  for (const candidate of candidates) {
    if (!isPlaceholderVehicleName(candidate)) return String(candidate).trim()
  }
  return ''
}

/** 从带 id / name 的列表建 id → 真实车名索引（占位名不入索引）。 */
export function vehicleNameIndex(items, idKey = 'id', nameKey = 'name') {
  const index = new Map()
  for (const item of items || []) {
    const id = Number(item?.[idKey])
    const name = item?.[nameKey]
    if (Number.isInteger(id) && !index.has(id) && !isPlaceholderVehicleName(name)) index.set(id, String(name).trim())
  }
  return index
}
