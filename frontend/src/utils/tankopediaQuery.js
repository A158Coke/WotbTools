/**
 * 坦克百科的 URL 状态（与 utils/hofQuery.js 同一模式）：搜索、筛选、排序、详情写进 query，
 * 返回 / 分享 / 刷新都能恢复。纯函数：只做校验、序列化与列表筛选，读写路由由 AgentTankopedia 负责。
 * 默认值不写进 URL，保持链接干净。
 *
 * 键：q（搜索词）· tier · nation · type · sort（name|tier|hp|pen）· tank（详情车辆 id）· config（配置下标）
 * · engine / track（发动机/履带下标）· shell（弹种下标）· dev（装备 9 槽 0/1/-）· cons / prov（物品 stem 逗号表）
 * · skills（已训练技能 id:等级 逗号表，兼容裸 id=7）· camo（涂装 0/1）
 */
import { tankFuzzyScore } from '../scene/tankMeta.js'
// 搜索别名（开发者审校维护的 WotBTools 搜索 metadata，**不是**游戏事实数据）：稀疏存储，
// 没配 alias 的车辆直接不出现在文件里（缺 key == aliases []）。与 map_names.json 同一机制：
// 构建期相对路径 import，无后端接口、无第二资产源，Web 与 Android 内置前端同一份。
// 契约与维护流程见 common/AGENTS.md 与 docs/architecture/tankopedia-reference-data.md。
import TANK_ALIASES from '../../../common/tank_aliases.json'
import { TANKOPEDIA_QUERY_KEYS } from '../shared/tankopediaQueryKeys.js'

export { TANKOPEDIA_QUERY_KEYS }
export const TANKOPEDIA_SORTS = Object.freeze(['name', 'tier', 'hp', 'pen'])
const DEFAULT_SORT = 'name'
/** 搜索词上限：防止超长 query 拖慢模糊匹配 */
const MAX_QUERY_LENGTH = 64
/** 装备槽位数（与客户端 3 组 × 3 级一致） */
const DEVICE_SLOTS = 9
/** 单个物品表上限（槽位数由车辆数据再夹一次） */
const MAX_ITEM_STEMS = 8
const STEM_RE = /^[A-Za-z0-9_]+$/

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

/** 物品 stem 列表：键缺省 → null（用客户端默认表）；键存在但空 → []（用户清空）。 */
function stemList(value) {
  const raw = first(value)
  if (raw === undefined) return null
  if (typeof raw !== 'string' || raw.trim() === '') return []
  const unique = [...new Set(raw.split(',').map(s => s.trim()).filter(s => STEM_RE.test(s)))]
  return unique.slice(0, MAX_ITEM_STEMS)
}

/** 装备槽串：只取前 9 位，非 0/1 的字符按空槽处理（保持槽位对齐），去尾随空槽。 */
function skillLevels(value) {
  const raw = first(value)
  if (raw === undefined) return {}
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  const out = {}
  for (const entry of raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 24)) {
    const [id, levelText] = entry.split(':', 2)
    if (!STEM_RE.test(id)) continue
    const level = levelText == null ? 7 : Number(levelText)
    if (!Number.isInteger(level) || level < 1 || level > 7) continue
    out[id] = level
  }
  return out
}

function deviceSlots(value) {
  const raw = first(value)
  if (typeof raw !== 'string') return ''
  const chars = raw.slice(0, DEVICE_SLOTS).split('').map(ch => (ch === '0' || ch === '1' ? ch : '-'))
  return chars.join('').replace(/-+$/, '')
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
    // 以下只在详情态有意义
    config: tank ? nonNegativeInt(query.config) : null,
    engine: tank ? nonNegativeInt(query.engine) : null,
    track: tank ? nonNegativeInt(query.track) : null,
    shell: tank ? nonNegativeInt(query.shell) : null,
    dev: tank ? deviceSlots(query.dev) : '',
    cons: tank ? stemList(query.cons) : null,
    prov: tank ? stemList(query.prov) : null,
    skills: tank ? skillLevels(query.skills) : {},
    camo: tank ? first(query.camo) === '1' : false,
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
    if (Number.isInteger(state.engine) && state.engine >= 0) query.engine = String(state.engine)
    if (Number.isInteger(state.track) && state.track >= 0) query.track = String(state.track)
    if (Number.isInteger(state.shell) && state.shell >= 0) query.shell = String(state.shell)
    if (typeof state.dev === 'string' && state.dev !== '') query.dev = state.dev
    if (Array.isArray(state.cons)) query.cons = state.cons.join(',')
    if (Array.isArray(state.prov)) query.prov = state.prov.join(',')
    if (state.skills && typeof state.skills === 'object' && !Array.isArray(state.skills)) {
      const pairs = Object.entries(state.skills)
        .filter(([id, level]) => STEM_RE.test(id) && Number.isInteger(level) && level >= 1 && level <= 7)
        .map(([id, level]) => `${id}:${level}`)
      if (pairs.length) query.skills = pairs.join(',')
    }
    if (state.camo === true) query.camo = '1'
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
 * 单车命中分 = max(正式车名, 各 alias)：alias 只扩搜索召回，命中后展示与排序仍走正式车名
 * （同分回落既有 byName）。不做 exact-alias / 语言 / 热度 boost。
 */
function tankSearchScore(tank, query) {
  // 国服 T-34* 是 Type T-34 的正式名称，星号是车型限定，不能作为标点丢掉。
  const starredQuery = query.includes('*')
  const name = tank.name || ''
  const canonicalScore = !starredQuery || name.includes('*') ? tankFuzzyScore(name, query) : 0
  let score = canonicalScore
  for (const value of tank.aliases || []) {
    const alias = String(value || '').trim()
    const starredAlias = alias.includes('*')
    if (starredQuery && !starredAlias) continue
    // 无星查询已命中正式名时保持其相关度；未命中时仍让 Mk I*重型坦克等别名补召回。
    if (!starredQuery && starredAlias && canonicalScore > 0) continue
    const aliasScore = tankFuzzyScore(alias, query)
    if (aliasScore > score) score = aliasScore
  }
  return score
}

/**
 * 列表筛选 + 排序：tier / nation / type 精确匹配，q 走模糊打分（正式车名 + alias）。
 * 有搜索词时精确正式车名优先，其后按相关度及正式车名排序；否则按 sort。
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
      .map(tank => ({
        tank,
        score: tankSearchScore(tank, query),
        exactCanonical: (tank.name || '').trim().toLowerCase() === query,
      }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => Number(b.exactCanonical) - Number(a.exactCanonical)
        || b.score - a.score || byName(a.tank, b.tank))
      .map(entry => entry.tank)
  }
  return base.slice().sort(COMPARATORS[state.sort] || byName)
}

/**
 * tank_cache.json（对象或数组）→ 列表视图模型。车辆身份与显示名只来自 tank_cache
 * 事实数据；`aliases` 是独立的搜索 metadata（缺 key 的车辆得到 `[]`，新车进 tank_cache
 * 不需要同步改 alias 文件）。aliasMap 参数只为测试注入稀疏数据集。
 */
export function normalizeTankCache(cache, aliasMap = TANK_ALIASES) {
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
        aliases: aliasMap?.[String(Number(id))] ?? [],
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
