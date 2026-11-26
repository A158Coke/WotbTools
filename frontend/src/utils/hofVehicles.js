
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

export function vehicleNameIndex(items, idKey = 'id', nameKey = 'name') {
  const index = new Map()
  for (const item of items || []) {
    const id = Number(item?.[idKey])
    const name = item?.[nameKey]
    if (Number.isInteger(id) && !index.has(id) && !isPlaceholderVehicleName(name)) index.set(id, String(name).trim())
  }
  return index
}
