/**
 * 名人堂的 URL 状态（审计 PG-08）：Tab、筛选、页码写进 query，返回 / 分享 / 刷新都能恢复。
 * 纯函数：只做校验与序列化，读写路由由 HoFPage 负责。默认值不写进 URL，保持链接干净。
 *
 * 键：tab（single|hundred|mark3）· page · tank（车辆 id）· nation · type · tier
 *     · bt（RANDOM|RATING，仅单场）· nick（仅单场）· limit（20|50|100，仅单场）
 */
export const HOF_TABS = Object.freeze(['single', 'hundred', 'mark3'])
export const HOF_LIMITS = Object.freeze([20, 50, 100])
const BATTLE_TYPES = new Set(['RANDOM', 'RATING'])
const DEFAULT_LIMIT = 50

function positiveInt(value) {
  const n = Number(Array.isArray(value) ? value[0] : value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function text(value) {
  const s = Array.isArray(value) ? value[0] : value
  return typeof s === 'string' ? s.trim() : ''
}

/** route.query → 已校验的状态；非法值回落到默认值。 */
export function parseHofQuery(query = {}) {
  const tab = HOF_TABS.includes(text(query.tab)) ? text(query.tab) : 'single'
  const limit = positiveInt(query.limit)
  const bt = text(query.bt).toUpperCase()
  return {
    tab,
    page: positiveInt(query.page) || 1,
    tank: positiveInt(query.tank),
    nation: text(query.nation),
    type: text(query.type),
    tier: text(query.tier),
    bt: BATTLE_TYPES.has(bt) ? bt : '',
    nick: tab === 'single' ? text(query.nick) : '',
    limit: HOF_LIMITS.includes(limit) ? limit : DEFAULT_LIMIT,
  }
}

/** 状态 → query（只含非默认值；单场专属键在其他 Tab 下不写）。 */
export function serializeHofQuery(state) {
  const query = {}
  if (state.tab && state.tab !== 'single') query.tab = state.tab
  if (state.page > 1) query.page = String(state.page)
  if (state.tank) query.tank = String(state.tank)
  if (state.nation) query.nation = state.nation
  if (state.type) query.type = state.type
  if (state.tier) query.tier = String(state.tier)
  if (state.tab === 'single' || !state.tab) {
    if (state.bt) query.bt = state.bt
    if (state.nick) query.nick = state.nick
    if (state.limit && state.limit !== DEFAULT_LIMIT) query.limit = String(state.limit)
  }
  return query
}

/** 比较两个 query 的名人堂部分是否相同（忽略 view 等其他键与键顺序）。 */
export function sameHofQuery(a, b) {
  const left = serializeHofQuery(parseHofQuery(a))
  const right = serializeHofQuery(parseHofQuery(b))
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => left[key] === right[key])
}
