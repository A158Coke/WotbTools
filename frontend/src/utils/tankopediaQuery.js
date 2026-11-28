import { tankFuzzyScore } from '../scene/tankMeta.js'
import TANK_ALIASES from '../../../common/tank_aliases.json'
import { TANKOPEDIA_QUERY_KEYS } from '../shared/tankopediaQueryKeys.js'

export { TANKOPEDIA_QUERY_KEYS }
export const TANKOPEDIA_SORTS = Object.freeze(['name', 'tier', 'hp', 'pen'])
export const TANKOPEDIA_CATEGORIES = Object.freeze(['regular', 'premium', 'collector'])
const DEFAULT_SORT = 'tier'
const MAX_QUERY_LENGTH = 64
const DEVICE_SLOTS = 9
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

function stemList(value) {
  const raw = first(value)
  if (raw === undefined) return null
  if (typeof raw !== 'string' || raw.trim() === '') return []
  const unique = [...new Set(raw.split(',').map(s => s.trim()).filter(s => STEM_RE.test(s)))]
  return unique.slice(0, MAX_ITEM_STEMS)
}

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

function equipmentIds(value) {
  const raw = first(value)
  if (raw == null || raw === '') return null
  const out = String(raw).split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0 && n <= 255)
  return out.length ? [...new Set(out)].slice(0, DEVICE_SLOTS) : null
}

function abilityIds(value) {
  const raw = first(value)
  if (typeof raw !== 'string') return []
  return [...new Set(raw.split(',').map(s => Number(s.trim()))
    .filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 64)
}

function deviceSlots(value) {
  const raw = first(value)
  if (typeof raw !== 'string') return ''
  const chars = raw.slice(0, DEVICE_SLOTS).split('').map(ch => (ch === '0' || ch === '1' ? ch : '-'))
  return chars.join('').replace(/-+$/, '')
}

export function parseTankopediaQuery(query = {}) {
  const sort = text(query.sort)
  const category = text(query.category)
  const tier = positiveInt(query.tier)
  const tank = positiveInt(query.tank)
  const upgrade = tank ? first(query.upgrade) : undefined
  return {
    q: text(query.q).slice(0, MAX_QUERY_LENGTH),
    tier: tier ? String(tier) : '',
    nation: text(query.nation),
    type: text(query.type),
    category: TANKOPEDIA_CATEGORIES.includes(category) ? category : '',
    sort: TANKOPEDIA_SORTS.includes(sort) ? sort : DEFAULT_SORT,
    tank,
    config: tank ? nonNegativeInt(query.config) : null,
    engine: tank ? nonNegativeInt(query.engine) : null,
    track: tank ? nonNegativeInt(query.track) : null,
    shell: tank ? nonNegativeInt(query.shell) : null,
    dev: tank ? deviceSlots(query.dev) : '',
    eq: tank ? equipmentIds(query.eq) : null,
    cons: tank ? stemList(query.cons) : null,
    prov: tank ? stemList(query.prov) : null,
    skills: tank ? skillLevels(query.skills) : {},
    conditionalSkills: !!tank && first(query.skillTriggers) === '1',
    camo: tank ? first(query.camo) === '1' : false,
    upgrade: upgrade === 'top' || upgrade === 'stock' || upgrade === 'custom' ? upgrade : null,
    abilities: tank ? abilityIds(query.abilities) : [],
  }
}

export function serializeTankopediaQuery(state = {}) {
  const query = {}
  const q = typeof state.q === 'string' ? state.q.trim().slice(0, MAX_QUERY_LENGTH) : ''
  if (q) query.q = q
  if (state.tier) query.tier = String(state.tier)
  if (state.nation) query.nation = state.nation
  if (state.type) query.type = state.type
  if (TANKOPEDIA_CATEGORIES.includes(state.category)) query.category = state.category
  if (state.sort && state.sort !== DEFAULT_SORT && TANKOPEDIA_SORTS.includes(state.sort)) query.sort = state.sort
  if (state.tank) {
    query.tank = String(state.tank)
    if (Number.isInteger(state.config) && state.config >= 0) query.config = String(state.config)
    if (Number.isInteger(state.engine) && state.engine >= 0) query.engine = String(state.engine)
    if (Number.isInteger(state.track) && state.track >= 0) query.track = String(state.track)
    if (Number.isInteger(state.shell) && state.shell >= 0) query.shell = String(state.shell)
    if (typeof state.dev === 'string' && state.dev !== '') query.dev = state.dev
    if (Array.isArray(state.eq) && state.eq.length) query.eq = state.eq.join(',')
    if (Array.isArray(state.cons)) query.cons = state.cons.join(',')
    if (Array.isArray(state.prov)) query.prov = state.prov.join(',')
    if (state.skills && typeof state.skills === 'object' && !Array.isArray(state.skills)) {
      const pairs = Object.entries(state.skills)
        .filter(([id, level]) => STEM_RE.test(id) && Number.isInteger(level) && level >= 1 && level <= 7)
        .map(([id, level]) => `${id}:${level}`)
      if (pairs.length) query.skills = pairs.join(',')
    }
    if (state.conditionalSkills === true) query.skillTriggers = '1'
    if (state.camo === true) query.camo = '1'
    if (state.upgrade === 'top' || state.upgrade === 'stock' || state.upgrade === 'custom') query.upgrade = state.upgrade
    if (Array.isArray(state.abilities)) {
      const ids = [...new Set(state.abilities.filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 64)
      if (ids.length) query.abilities = ids.join(',')
    }
  }
  return query
}

export function sameTankopediaQuery(a, b) {
  const left = serializeTankopediaQuery(parseTankopediaQuery(a))
  const right = serializeTankopediaQuery(parseTankopediaQuery(b))
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => left[key] === right[key])
}

export function withTankopediaState(query = {}, state = {}) {
  const rest = { ...query }
  for (const key of TANKOPEDIA_QUERY_KEYS) delete rest[key]
  return { ...rest, ...serializeTankopediaQuery(state) }
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
const byNumberDesc = key => (a, b) => (b[key] ?? -1) - (a[key] ?? -1) || byName(a, b)
const COMPARATORS = {
  speed: byNumberDesc('speed'),
  name: byName,
  tier: (a, b) => (b.tier ?? 0) - (a.tier ?? 0) || byName(a, b),
  hp: byNumberDesc('hp'),
  pen: byNumberDesc('pen_max'),
}

function tankSearchScore(tank, query) {
  const starredQuery = query.includes('*')
  const name = tank.name || ''
  const canonicalScore = !starredQuery || name.includes('*') ? tankFuzzyScore(name, query) : 0
  let score = canonicalScore
  for (const value of tank.aliases || []) {
    const alias = String(value || '').trim()
    const starredAlias = alias.includes('*')
    if (starredQuery && !starredAlias) continue
    if (!starredQuery && starredAlias && canonicalScore > 0) continue
    const aliasScore = tankFuzzyScore(alias, query)
    if (aliasScore > score) score = aliasScore
  }
  return score
}

export function selectTanks(tanks, state = {}) {
  const category = TANKOPEDIA_CATEGORIES.includes(state.category) ? state.category : ''
  const base = tanks.filter(tank =>
    (!state.tier || String(tank.tier) === String(state.tier))
    && (!state.nation || tank.nation === state.nation)
    && (!state.type || tank.type === state.type)
    && (!category || tank.category === category),
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
  return base.slice().sort(COMPARATORS[state.sort] || COMPARATORS[DEFAULT_SORT] || byName)
}

export function tankCategory(value) {
  const premium = value.is_premium
  const collector = value.is_collector
  if (premium === true || premium === 1) return 'premium'
  const premiumFalse = premium === false || premium === 0
  if ((premiumFalse || premium === undefined) && (collector === true || collector === 1)) return 'collector'
  if (premiumFalse && (collector === false || collector === 0)) return 'regular'
  return 'unknown'
}

export function normalizeTankCache(cache, aliasMap = TANK_ALIASES) {
  const entries = Array.isArray(cache)
    ? cache.map(tank => [tank?.id, tank])
    : Object.entries(cache || {})
  return entries
    .filter(([id, value]) => Number.isFinite(Number(id)) && value)
    .map(([id, value]) => {
      const pens = Array.isArray(value.shells)
        ? value.shells.map(shell => shell?.penetration_top ?? shell?.penetration ?? 0)
        : []
      const penMax = pens.length ? Math.max(0, ...pens) : 0
      return {
        id: Number(id),
        name: value.name || '',
        aliases: aliasMap?.[String(Number(id))] ?? [],
        tier: value.tier ?? 0,
        nation: value.nation || 'unknown',
        type: value.type || 'unknown',
        category: tankCategory(value),
        is_premium: !!value.is_premium,
        is_collector: !!value.is_collector,
        speed: value.speed_forward ?? value.speed ?? null,
        hp: value.hp_top ?? value.hp ?? null,
        pen_max: penMax || null,
      }
    })
}
