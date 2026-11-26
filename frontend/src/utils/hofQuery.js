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

export function sameHofQuery(a, b) {
  const left = serializeHofQuery(parseHofQuery(a))
  const right = serializeHofQuery(parseHofQuery(b))
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => left[key] === right[key])
}
