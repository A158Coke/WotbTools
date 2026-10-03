/**
 * 坦克百科的 URL 状态（与 utils/hofQuery.js 同一模式）：搜索、筛选、排序、详情写进 query，
 * 返回 / 分享 / 刷新都能恢复。纯函数：只做校验、序列化与列表筛选，读写路由由 AgentTankopedia 负责。
 * 默认值不写进 URL，保持链接干净。
 *
 * 键：q（搜索词）· tier · nation · type · sort（name|tier|hp|pen）· tank（详情车辆 id）· config（配置下标）
 */
import { tankFuzzyScore } from '../scene/tankMeta.js'

export const TANKOPEDIA_SORTS = Object.freeze(['name', 'tier', 'hp', 'pen'])
/** 只属于坦克百科的 query 键：离开百科时由 navigation.locationForView 丢掉 */
export const TANKOPEDIA_QUERY_KEYS = Object.freeze(['q', 'tier', 'nation', 'type', 'sort', 'tank', 'config'])
const DEFAULT_SORT = 'name'
/** 搜索词上限：防止超长 query 拖慢模糊匹配 */
const MAX_QUERY_LENGTH = 64

function first(value) {
  return Array.isArray(value) ? value[0] : value
}

function text(value) {
  const s = first(value)
  return typeof s === 'string' ? s.trim() : ''
}

function positiveInt(value) {
  const n = Number(first(value))
  return Number.isInteger(n) && n > 0 ? n : null
}

function nonNegativeInt(value) {
  const raw = first(value)
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** route.query → 已校验的状态；非法值回落到默认值。 */
export function parseTankopediaQuery(query = {}) {
  const sort = text(query.sort)
  const tier = positiveInt(query.tier)
  const tank = positiveInt(query.tank)
  return {
    q: text(query.q).slice(0, MAX_QUERY_LENGTH),
    tier: tier ? String(tier) : '',
    nation: text(query.nation),
    type: text(query.type),
    sort: TANKOPEDIA_SORTS.includes(sort) ? sort : DEFAULT_SORT,
    tank,
    // config 只在详情态有意义
    config: tank ? nonNegativeInt(query.config) : null,
  }
}

/** 状态 → query（只含非默认值）。 */
export function serializeTankopediaQuery(state = {}) {
  const query = {}
  const q = typeof state.q === 'string' ? state.q.trim().slice(0, MAX_QUERY_LENGTH) : ''
  if (q) query.q = q
  if (state.tier) query.tier = String(state.tier)
  if (state.nation) query.nation = state.nation
  if (state.type) query.type = state.type
  if (state.sort && state.sort !== DEFAULT_SORT && TANKOPEDIA_SORTS.includes(state.sort)) query.sort = state.sort
  if (state.tank) {
    query.tank = String(state.tank)
    if (Number.isInteger(state.config) && state.config >= 0) query.config = String(state.config)
  }
  return query
}

/** 比较两个 query 的百科部分是否相同（忽略 view 等其他键与键顺序）。 */
export function sameTankopediaQuery(a, b) {
  const left = serializeTankopediaQuery(parseTankopediaQuery(a))
  const right = serializeTankopediaQuery(parseTankopediaQuery(b))
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => left[key] === right[key])
}

/** 当前 query 中非百科键（view、lang 等）原样保留，再叠加百科状态。 */
export function withTankopediaState(query = {}, state = {}) {
  const rest = { ...query }
  for (const key of TANKOPEDIA_QUERY_KEYS) delete rest[key]
  return { ...rest, ...serializeTankopediaQuery(state) }
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
const byNumberDesc = key => (a, b) => (b[key] ?? -1) - (a[key] ?? -1) || byName(a, b)
const COMPARATORS = {
  name: byName,
  tier: (a, b) => (b.tier ?? 0) - (a.tier ?? 0) || byName(a, b),
  hp: byNumberDesc('hp'),
  pen: byNumberDesc('pen_max'),
}

/**
 * 列表筛选 + 排序：tier / nation / type 精确匹配，q 走模糊打分。
 * 有搜索词时按相关度排序（与旧实现一致），否则按 sort。
 */
export function selectTanks(tanks, state = {}) {
  const base = tanks.filter(tank =>
    (!state.tier || String(tank.tier) === String(state.tier))
    && (!state.nation || tank.nation === state.nation)
    && (!state.type || tank.type === state.type),
  )
  const query = (state.q || '').trim().toLowerCase()
  if (query) {
    return base
      .map(tank => ({ tank, score: tankFuzzyScore(tank.name || '', query) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || byName(a.tank, b.tank))
      .map(entry => entry.tank)
  }
  return base.slice().sort(COMPARATORS[state.sort] || byName)
}

/** tank_cache.json（对象或数组）→ 列表视图模型。 */
export function normalizeTankCache(cache) {
  const entries = Array.isArray(cache)
    ? cache.map(tank => [tank?.id, tank])
    : Object.entries(cache || {})
  return entries
    .filter(([id, value]) => Number.isFinite(Number(id)) && value)
    .map(([id, value]) => {
      const pens = Array.isArray(value.shells) ? value.shells.map(shell => shell?.penetration || 0) : []
      const penMax = pens.length ? Math.max(0, ...pens) : 0
      return {
        id: Number(id),
        name: value.name || '',
        tier: value.tier ?? 0,
        nation: value.nation || 'unknown',
        type: value.type || 'unknown',
        is_premium: !!value.is_premium,
        // 收藏车（tanks.pb field13 == 2；与 is_premium == 1 在上游数据里互斥）。
        // projection 只做布尔归一化，**不**替上游强制互斥；异常双 true 原样透传，
        // 视觉 precedence 由样式层确定（AgentTankopedia：premium > collector）。
        is_collector: !!value.is_collector,
        hp: value.hp ?? null,
        pen_max: penMax || null,
      }
    })
}
