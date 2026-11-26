
const MISSING = Symbol('missing')

/**
 * 归一化缺失值：null/undefined/''/NaN/'--' → MISSING；否则原样返回。
 * @param {*} value
 * @returns {*} 原始值或 MISSING
 */
export function normalizeMissing(value) {
  if (value === null || value === undefined || value === '') return MISSING
  if (typeof value === 'number' && !Number.isFinite(value)) return MISSING
  if (value === '--') return MISSING
  return value
}

function isMissing(value) {
  return normalizeMissing(value) === MISSING
}

/**
 * 数值比较：把可转数字的值转为 number；NaN 视为缺失。
 * @param {*} a
 * @param {*} b
 * @returns {number} 负数/0/正数
 */
function compareNumeric(a, b) {
  const na = normalizeMissing(a)
  const nb = normalizeMissing(b)
  if (na === MISSING || nb === MISSING) {
    return 0
  }
  const x = Number(na)
  const y = Number(nb)
  if (!Number.isFinite(x) && !Number.isFinite(y)) return 0
  if (!Number.isFinite(x)) return -1
  if (!Number.isFinite(y)) return 1
  return x - y
}

/**
 * 字符串自然比较（locale-aware）。
 * @param {*} a
 * @param {*} b
 * @param {string} [locale='zh']
 * @returns {number}
 */
function compareString(a, b, locale = 'zh') {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  return new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare(sa, sb)
}

/**
 * 统一比较入口：先处理缺失（缺失永远放最后，与方向无关），再按类型比较。
 * @param {*} a
 * @param {*} b
 * @param {Object} options { num?: boolean, locale?: string }
 * @returns {number} 正数 = a 在 b 之后（升序视角）
 */
export function compareValues(a, b, options = {}) {
  const na = normalizeMissing(a)
  const nb = normalizeMissing(b)
  const aMissing = na === MISSING
  const bMissing = nb === MISSING
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  if (options.num) return compareNumeric(na, nb)
  return compareString(na, nb, options.locale)
}

/**
 * 稳定排序行：missing-last + numeric/string + stable。
 * @param {Array} rows 行数组（不修改原数组）
 * @param {Object} spec {
 *   key: string,                // 排序列 key（给 valueGetter 用）
 *   direction: 1 | -1,          // 1 = ASC ▲，-1 = DESC ▼
 *   num?: boolean,              // true = numeric，false = string
 *   locale?: string,            // compareString 用
 *   valueGetter?: (row) => *,   // 返回该行的 raw 排序值（缺省取 row.cells[key]）
 *   tiebreakGetter?: (row) => * // 同值稳定兜底（缺省无）
 * }
 * @returns {Array} 新排序数组
 */
export function stableSortRows(rows, spec) {
  const get = spec.valueGetter || (row => (row && row.cells ? row.cells[spec.key] : row?.[spec.key]))
  const tieGet = spec.tiebreakGetter
  const indexed = rows.map((row, index) => ({ row, index }))
  indexed.sort((x, y) => {
    const ax = normalizeMissing(get(x.row))
    const by = normalizeMissing(get(y.row))
    const xMissing = ax === MISSING
    const yMissing = by === MISSING
    if (xMissing && yMissing) return x.index - y.index
    if (xMissing) return 1
    if (yMissing) return -1
    let c = spec.num
      ? compareNumeric(ax, by)
      : compareString(ax, by, spec.locale)
    if (c === 0 && tieGet) {
      const tx = normalizeMissing(tieGet(x.row))
      const ty = normalizeMissing(tieGet(y.row))
      const txMissing = tx === MISSING
      const tyMissing = ty === MISSING
      if (txMissing && tyMissing) return x.index - y.index
      if (txMissing) return 1
      if (tyMissing) return -1
      c = spec.num ? compareNumeric(tx, ty) : compareString(tx, ty, spec.locale)
    }
    if (c === 0) return x.index - y.index
    return spec.direction * c
  })
  return indexed.map(e => e.row)
}

export function nextDirection(currentKey, nextKey, currentDirection) {
  if (currentKey !== nextKey) return 1
  return currentDirection === 1 ? -1 : 1
}