/**
 * 版本变更页的纯展示辅助：路径 → 本地化标签、值格式化、筛选。
 * 不依赖 Vue / 网络，便于单测。
 */

import { paramDeltaGood } from '../../replay-local/compute/tankSetupParameters.js'

import { tankNationLabel, tankTypeLabel } from '../../scene/tankMeta.js'
import { tankCategory } from '../../utils/tankopediaQuery.js'
import { romanLevel } from '../../utils/tierFormat.js'

export type Translate = (key: string, params?: Record<string, unknown>) => string
export type Exists = (key: string) => boolean

export interface DiffChange {
  path?: string
  old?: unknown
  new?: unknown
  category?: string
  scope?: string
  config?: DiffConfigKey
  configLabel?: string
  displayPath?: string
  changePath?: string
  [key: string]: unknown
}

export interface DiffConfigKey {
  turret?: string
  gun?: string
  turretLocal?: number
  gunLocal?: number
  [key: string]: unknown
}

export interface ArmorRow {
  kind?: string
  module?: string
  plate?: string
  added?: boolean
  old?: unknown
  new?: unknown
  path?: string
  field?: string
  side?: string
  section?: string
  thickness?: number | null
  configLabel?: string
  configKey?: string
  [key: string]: unknown
}

function has(t: Translate, te: Exists, key?: string): key is string {
  return typeof key === 'string' && typeof t === 'function' && typeof te === 'function' && te(key)
}

function label(t: Translate, te: Exists, key: string | undefined, fallback: string): string {
  return has(t, te, key) ? t(key) : fallback
}

export function fmtDiffValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    if (Number.isInteger(value)) return String(value)
    const rounded = Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2)
    return rounded.replace(/\.?0+$/, '')
  }
  if (typeof value === 'boolean') return value ? '✓' : '—'
  if (Array.isArray(value) || typeof value === 'object') {
    const text = JSON.stringify(value)
    return text.length > 140 ? `${text.slice(0, 137)}…` : text
  }
  return String(value)
}

export function deltaDiffValue(oldValue: unknown, newValue: unknown): string {
  if (typeof oldValue !== 'number' || typeof newValue !== 'number') return ''
  const delta = newValue - oldValue
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return ''
  const text = Number.isInteger(delta) ? String(delta) : delta.toFixed(2).replace(/\.?0+$/, '')
  return delta > 0 ? `+${text}` : text
}


type DiffMeasurement = { unit: string; scale?: number; digits?: number }

const hitPoints = { unit: 'HIT_POINTS' }
const millimeters = { unit: 'MILLIMETER' }
const seconds = { unit: 'SECOND', digits: 3 }
const degrees = { unit: 'DEGREE' }
const traverse = { unit: 'DEGREE_PER_SECOND' }
const speed = { unit: 'KILOMETER_PER_HOUR' }
const length = { unit: 'METER', digits: 3 }
const power = { unit: 'HORSE_POWER' }
const mass = { unit: 'TON', scale: 1 / 1000, digits: 3 }
const fraction = { unit: 'PERCENT', scale: 100, digits: 3 }

const TANK_MEASUREMENTS: Record<string, DiffMeasurement> = {
  hp: hitPoints, hull_hp: hitPoints, turret_health: hitPoints, standard_damage: hitPoints,
  speed_forward: speed, speed_reverse: speed,
  hull_traverse: traverse, turret_traverse_speed: traverse,
  view_range: length, dispersion: length,
  gun_depression: degrees, gun_elevation: degrees,
  reload_time: seconds, aim_time: seconds, burst_interval: seconds, burst_group_interval: seconds,
  caliber: millimeters, gun_thickness: millimeters,
  weight: mass, turret_weight: mass,
}

const SHELL_MEASUREMENTS: Record<string, DiffMeasurement> = {
  penetration: millimeters, penetration_top: millimeters, penetration_far: millimeters,
  damage: hitPoints, damage_top: hitPoints, module_damage: hitPoints,
  caliber: millimeters, normalization: degrees, ricochet: degrees,
  velocity: { unit: 'METER_PER_SECOND' }, explosion_radius: length, range: length,
}

const RESEARCH_MEASUREMENTS: Record<string, DiffMeasurement> = {
  reloadTime: seconds, aimingTime: seconds, power, maxHealth: hitPoints, rotationSpeed: traverse,
  weight: mass, fireStartingChance: fraction, circularVisionRadius: length,
}

const PITCH_LEAF = /^(?:(front|back)\.)?(min|max|range)$/

function pitchField(field: string) {
  return PITCH_LEAF.exec(field)?.[2]
}

function pitchPathField(path: string) {
  if (path.startsWith('pitch_limits.')) return path.slice('pitch_limits.'.length)
  return /^research\.gun:.+?\.stats\.pitchLimits\.(.+)$/.exec(path)?.[1]
}

function pitchLabel(field: string, t: Translate, te: Exists): string | undefined {
  if (field === 'transition') return label(t, te, 'versionDiff.fields.pitchTransition', field)
  const match = PITCH_LEAF.exec(field)
  if (!match || (!match[1] && match[2] === 'range')) return undefined
  const [, sector, edge] = match
  const key = edge === 'min' ? 'agentTanks.params.gunPitchUpLimit'
    : edge === 'max' ? 'agentTanks.params.gunPitchDownLimit'
      : 'versionDiff.fields.pitchSectorSpan'
  const name = label(t, te, key, edge)
  return sector ? [faceLabel(sector === 'back' ? 'rear' : 'front', t, te), name].join(' · ') : name
}

function measurementForPath(path: string): DiffMeasurement | undefined {
  const pitch = pitchPathField(path)
  if (pitch) {
    const edge = pitchField(pitch)
    if (edge === 'min') return { ...degrees, scale: -1 }
    if (edge === 'max' || pitch === 'front.range' || pitch === 'back.range' || pitch === 'transition') return degrees
  }
  if (/^armor\.(hull|turret)\.(front|sides|rear)$/.test(path)) return millimeters
  const shell = /^shells\.[^.]+\.([^.]+)$/.exec(path)
  if (shell) return Object.hasOwn(SHELL_MEASUREMENTS, shell[1]) ? SHELL_MEASUREMENTS[shell[1]] : undefined
  const engine = /^engines\..+\.(power|fire_chance)$/.exec(path)
  if (engine) return engine[1] === 'power' ? power : fraction
  const research = /^research\.(?:module|gun|turret):.+\.stats\.([^.]+)$/.exec(path)
  if (research) return Object.hasOwn(RESEARCH_MEASUREMENTS, research[1]) ? RESEARCH_MEASUREMENTS[research[1]] : undefined
  if (path === 'research.hull.weight') return mass
  if (path === 'research.hull.hp') return hitPoints
  if (/^research\.invisibility\.(still|moving|firePenalty)$/.test(path)) return fraction
  if (/^research\.speedLimits\.(forward|backward)$/.test(path)) return speed
  return Object.hasOwn(TANK_MEASUREMENTS, path) ? TANK_MEASUREMENTS[path] : undefined
}

const TANK_PARAM_KEYS: Readonly<Record<string, string>> = {
  hp: 'maxHealth', hull_hp: 'maxHealth', turret_health: 'maxHealth',
  speed_forward: 'maxFrontSpeed', speed_reverse: 'maxBackSpeed',
  hull_traverse: 'chassiRotationSpeed', turret_traverse_speed: 'turretRotationSpeed',
  view_range: 'circularVisionRadius', weight: 'weight', turret_weight: 'weight',
  gun_depression: 'gunPitchDownLimit', gun_elevation: 'gunPitchUpLimit',
  reload_time: 'gunShellReloadTime', aim_time: 'gunAimingTime',
  dispersion: 'gunShotDispersionRadius', dpm: 'gunCommonDamagePerMin',
  standard_damage: 'baseShellAvgDamage', burst_interval: 'gunClipBurstReloadTime',
  burst_group_interval: 'gunClipShellReloadTime', burst_size: 'gunBurstShellCount',
  burst_group_count: 'gunClipBurstCount', clip: 'gunClipShellCount',
  'research.hull.hp': 'maxHealth', 'research.hull.weight': 'weight',
  'research.invisibility.still': 'stillInvisibility', 'research.invisibility.moving': 'movingInvisibility',
  'research.speedLimits.forward': 'maxFrontSpeed', 'research.speedLimits.backward': 'maxBackSpeed',
}

const SHELL_PARAM_KEYS: Readonly<Record<string, string>> = {
  penetration: 'baseShellAvgPiercingPower', penetration_far: 'baseShellAvgPiercingPower',
  penetration_top: 'baseShellAvgPiercingPower', damage: 'baseShellAvgDamage',
  damage_top: 'baseShellAvgDamage', velocity: 'baseShellAvgSpeed',
}

const RESEARCH_PARAM_KEYS: Readonly<Record<string, string>> = {
  reloadTime: 'gunShellReloadTime', aimingTime: 'gunAimingTime', power: 'enginePower',
  maxHealth: 'maxHealth', rotationSpeed: 'turretRotationSpeed', weight: 'weight',
  fireStartingChance: 'engineFireStartingChance', circularVisionRadius: 'circularVisionRadius',
}

function encyclopediaParamKey(path: string) {
  if (Object.hasOwn(TANK_PARAM_KEYS, path)) return TANK_PARAM_KEYS[path]
  const pitch = pitchPathField(path)
  if (pitchField(pitch ?? '') === 'min') return 'gunPitchUpLimit'
  if (pitchField(pitch ?? '') === 'max') return 'gunPitchDownLimit'
  const shell = /^shells\.[^.]+\.([^.]+)$/.exec(path)
  if (shell && Object.hasOwn(SHELL_PARAM_KEYS, shell[1])) return SHELL_PARAM_KEYS[shell[1]]
  if (/^engines\..+\.power$/.test(path)) return 'enginePower'
  if (/^engines\..+\.fire_chance$/.test(path)) return 'engineFireStartingChance'
  const research = /^research\.(?:module|gun|turret):.+\.stats\.([^.]+)$/.exec(path)
  if (research && Object.hasOwn(RESEARCH_PARAM_KEYS, research[1])) return RESEARCH_PARAM_KEYS[research[1]]
  return undefined
}

function diffDeltaGood(path: string, amount: number | null, format: Record<string, unknown> | null) {
  const key = encyclopediaParamKey(path)
  const entry = key && format && Object.hasOwn(format, key) ? format[key] : null
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const direction = 'biggerIsBetter' in entry ? entry.biggerIsBetter : undefined
  if (direction !== undefined && typeof direction !== 'boolean') return null
  return paramDeltaGood(amount, direction)
}

const VEHICLE_CATEGORY_LABELS = {
  premium: 'versionDiff.fields.isPremium',
  collector: 'versionDiff.fields.isCollector',
  regular: 'versionDiff.fields.regularVehicle',
} as const

function vehicleValue(path: string, value: unknown, t: Translate, te: Exists) {
  if (path === 'tier' && typeof value === 'number') return romanLevel(value) || fmtDiffValue(value)
  if (typeof value !== 'string') return fmtDiffValue(value)
  if (path === 'type') return tankTypeLabel(t, te, value)
  if (path === 'nation') return tankNationLabel(t, te, value)
  if (path === 'vehicle_category' && Object.hasOwn(VEHICLE_CATEGORY_LABELS, value)) {
    return t(VEHICLE_CATEGORY_LABELS[value as keyof typeof VEHICLE_CATEGORY_LABELS])
  }
  return value
}

export function diffStatValues(path: string, oldValue: unknown, newValue: unknown, t: Translate, paramFormat: Record<string, unknown> | null = null, te: Exists = () => false) {
  if (['vehicle_category', 'tier', 'type', 'nation'].includes(path)) {
    return { old: vehicleValue(path, oldValue, t, te), new: vehicleValue(path, newValue, t, te), delta: '', unit: '', good: null }
  }
  const spec = measurementForPath(path)
  const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  const rawDelta = numeric(oldValue) && numeric(newValue) ? newValue - oldValue : null
  if (!spec || !(numeric(oldValue) || numeric(newValue))) {
    const delta = deltaDiffValue(oldValue, newValue)
    const good = delta ? diffDeltaGood(path, rawDelta, paramFormat) : null
    return { old: fmtDiffValue(oldValue), new: fmtDiffValue(newValue), delta, unit: '', good }
  }
  const scale = spec.scale ?? 1
  const digits = spec.digits ?? 2
  const format = (value: number) => String(Number(value.toFixed(digits)))
  const display = (value: unknown) => numeric(value) ? format(value * scale) : fmtDiffValue(value)
  const amount = rawDelta === null ? null : Number((rawDelta * scale).toFixed(digits))
  let delta = amount ? (amount > 0 ? '+' : '') + format(amount) : ''
  if (delta && spec.unit === 'PERCENT') delta = t('agentTanks.configurator.upgrade_percentage_points', { value: delta })
  const good = diffDeltaGood(path, amount, paramFormat)
  return { old: display(oldValue), new: display(newValue), delta, unit: t('agentTanks.units.' + spec.unit), good }
}

export function fieldLabel(field: string, t: Translate, te: Exists): string {
  // 条目名与坦克百科参数面板（agentTanks.params.*）一致；无百科对应项的保持专有标签。
  const keys: Record<string, string> = {
    reload_time: 'agentTanks.params.gunShellReloadTime',
    aim_time: 'agentTanks.params.gunAimingTime',
    dispersion: 'agentTanks.params.gunShotDispersionRadius',
    dpm: 'agentTanks.params.gunCommonDamagePerMin',
    standard_damage: 'agentTanks.params.baseShellAvgDamage',
    penetration: 'agentTanks.params.baseShellAvgPiercingPower',
    damage: 'agentTanks.params.baseShellAvgDamage',
    velocity: 'agentTanks.velocity',
    module_damage: 'agentTanks.module_dmg',
    penetration_far: 'agentTanks.pen_far',
    explosion_radius: 'versionDiff.fields.explosionRadius',
    normalization: 'agentTanks.normalization',
    ricochet: 'agentTanks.ricochet',
    caliber: 'versionDiff.fields.caliber',
    turret_traverse_speed: 'agentTanks.params.turretRotationSpeed',
    weight: 'agentTanks.params.weight',
    hull_hp: 'versionDiff.fields.hullHealth',
    turret_health: 'versionDiff.fields.turretHealth',
    turret_weight: 'versionDiff.fields.turretWeight',
    power: 'agentTanks.params.enginePower',
    fire_chance: 'agentTanks.params.engineFireStartingChance',
    gun_plates: 'versionDiff.fields.gunPlates',
    turret_plates: 'versionDiff.fields.turretPlates',
    gun_spaced: 'versionDiff.fields.gunSpaced',
    turret_spaced: 'versionDiff.fields.turretSpaced',
    pitch_limits: 'versionDiff.fields.pitchLimits',
    yaw_limits: 'versionDiff.fields.yawLimits',
    tracks: 'versionDiff.fields.tracks',
    clip: 'agentTanks.params.gunClipShellCount',
    is_drum: 'versionDiff.fields.isDrum',
    is_burst: 'versionDiff.fields.isBurst',
    burst_size: 'agentTanks.params.gunBurstShellCount',
    burst_interval: 'agentTanks.params.gunClipBurstReloadTime',
    burst_group_interval: 'versionDiff.fields.burstGroupInterval',
    burst_reloads: 'agentTanks.params.gunClipShellReloadTime',
    price: 'versionDiff.fields.price',
    primaryArmor: 'versionDiff.fields.primaryArmor',
    stats: 'versionDiff.fields.stats',
    unlocks: 'versionDiff.fields.unlocks',
    tags: 'versionDiff.fields.tags',
    consumableSlots: 'versionDiff.fields.consumableSlots',
    provisionSlots: 'versionDiff.fields.provisionSlots',
    crewRoles: 'versionDiff.fields.crewRoles',
    speedLimits: 'versionDiff.fields.speedLimits',
    invisibility: 'agentTanks.params.stillInvisibility',
    hasTurret: 'versionDiff.fields.hasTurret',
    vehicleAbilities: 'versionDiff.fields.vehicleAbilities',
    bbox: 'versionDiff.fields.bbox',
    turretOrigin: 'versionDiff.fields.turretOrigin',
  }
  return keys[field] ? label(t, te, keys[field], field) : field
}

const ARMOR_FACES: Record<string, string> = {
  'hull.front': 'versionDiff.armor.hullFront',
  'hull.sides': 'versionDiff.armor.hullSides',
  'hull.rear': 'versionDiff.armor.hullRear',
  'turret.front': 'versionDiff.armor.turretFront',
  'turret.sides': 'versionDiff.armor.turretSides',
  'turret.rear': 'versionDiff.armor.turretRear',
}

const MODULE_KEYS: Record<string, string> = {
  hull: 'versionDiff.modules.hull',
  turret: 'versionDiff.modules.turret',
  gun: 'versionDiff.modules.gun',
  chassis: 'versionDiff.modules.chassis',
}

const FACE_KEYS: Record<string, string> = {
  front: 'versionDiff.faces.front',
  sides: 'versionDiff.faces.sides',
  rear: 'versionDiff.faces.rear',
}

export function moduleLabel(module: string, t: Translate, te: Exists): string {
  return label(t, te, MODULE_KEYS[module], module)
}

export function faceLabel(face: string, t: Translate, te: Exists): string {
  return label(t, te, FACE_KEYS[face], face)
}

export function armorFaceLabel(path: string, t: Translate, te: Exists): string {
  return label(t, te, ARMOR_FACES[path], path)
}

// 研究子树的模块统计：`<kind>:<identity>[:<moduleId>].stats.<field>`，以及 `hull.hp`、
// `bbox.chassis.max`、`tags`、`invisibility.moving` 这类扁平路径。字段名与百科参数同源。
const RESEARCH_MODULE_PREFIX = /^(gun|turret|module):(.+?)(?::\d+)?$/

const RESEARCH_FIELD_KEYS: Record<string, string> = {
  reloadTime: 'agentTanks.params.gunShellReloadTime',
  aimingTime: 'agentTanks.params.gunAimingTime',
  power: 'agentTanks.params.enginePower',
  maxHealth: 'agentTanks.params.maxHealth',
  rotationSpeed: 'agentTanks.params.turretRotationSpeed',
  hp: 'agentTanks.params.maxHealth',
  weight: 'agentTanks.params.weight',
  tags: 'versionDiff.fields.tags',
  turretOrigin: 'versionDiff.fields.turretOrigin',
}

function researchFieldLabel(field: string, t: Translate, te: Exists): string {
  // 同一模块的多段字段（pitchLimits.back.max、bbox.max…）保留叶子限定词，避免表格里出现同名行。
  const qualifier = (prefix: string) => {
    const rest = field.slice(prefix.length)
    return rest ? ` (${rest.replace(/^\./, '')})` : ''
  }
  if (field.startsWith('pitchLimits')) {
    const pitch = pitchLabel(field.slice('pitchLimits.'.length), t, te)
    if (pitch) return pitch
    return label(t, te, 'versionDiff.fields.pitchLimits', field) + qualifier('pitchLimits')
  }
  if (field.startsWith('bbox')) {
    return label(t, te, 'versionDiff.fields.bbox', field) + qualifier('bbox')
  }
  if (field.startsWith('invisibility.')) {
    return label(t, te, field.endsWith('moving')
      ? 'agentTanks.params.movingInvisibility'
      : 'agentTanks.params.stillInvisibility', field)
  }
  const key = RESEARCH_FIELD_KEYS[field]
  return key ? label(t, te, key, field) : field
}

function researchModuleName(prefix: string, t: Translate, te: Exists): string {
  const match = RESEARCH_MODULE_PREFIX.exec(prefix)
  if (!match) return prefix
  const [, kind, rawIdentity] = match
  let identity = rawIdentity
  let kindKey = MODULE_KEYS[kind]
  if (kind === 'module') {
    // module:engines/<name> → 发动机 <name>
    const slash = identity.indexOf('/')
    if (slash > 0) {
      const category = identity.slice(0, slash)
      identity = identity.slice(slash + 1)
      kindKey = category === 'engines' ? 'versionDiff.fields.engine' : MODULE_KEYS[category]
    }
  }
  return kindKey ? `${label(t, te, kindKey, kind)} ${identity}` : identity
}

function researchPathLabel(body: string, t: Translate, te: Exists): string {
  const stats = body.match(/^(.+?)\.stats\.(.+)$/)
  if (stats) return `${researchModuleName(stats[1], t, te)} · ${researchFieldLabel(stats[2], t, te)}`
  const [head, ...rest] = body.split('.')
  if (head === 'hull' && rest.length) {
    return `${moduleLabel('hull', t, te)} · ${researchFieldLabel(rest.join('.'), t, te)}`
  }
  if (head === 'bbox' && rest.length) {
    const qualifier = rest.length > 1 ? ` (${rest.slice(1).join('.')})` : ''
    return `${moduleLabel(rest[0], t, te)} · ${label(t, te, 'versionDiff.fields.bbox', rest.join('.'))}${qualifier}`
  }
  return researchFieldLabel(body, t, te)
}

export function diffPathLabel(path: string, t: Translate, te: Exists, shellLabelFn?: (type: string) => string): string {
  const exact: Record<string, string> = {
    hp: 'agentTanks.params.maxHealth',
    speed_forward: 'agentTanks.params.maxFrontSpeed',
    speed_reverse: 'agentTanks.params.maxBackSpeed',
    view_range: 'agentTanks.params.circularVisionRadius',
    hull_traverse: 'agentTanks.params.chassiRotationSpeed',
    turret_traverse_speed: 'agentTanks.params.turretRotationSpeed',
    gun_depression: 'agentTanks.params.gunPitchDownLimit',
    gun_elevation: 'agentTanks.params.gunPitchUpLimit',
    vehicle_category: 'versionDiff.fields.vehicleCategory',
    is_premium: 'versionDiff.fields.isPremium',
    is_collector: 'versionDiff.fields.isCollector',
    tier: 'agentTanks.tier',
    type: 'agentTanks.type',
    nation: 'agentTanks.nation',
    name: 'versionDiff.fields.name',
    collision_boxes: 'versionDiff.fields.collisionBoxes',
    gun_collision: 'versionDiff.fields.gunCollision',
    model_origins: 'versionDiff.fields.modelOrigins',
    hull_spaced: 'versionDiff.fields.hullSpaced',
    initial_turret_rotation: 'versionDiff.fields.initialTurretRotation',
    turret_traverse_left: 'versionDiff.fields.turretTraverseLeft',
    turret_traverse_right: 'versionDiff.fields.turretTraverseRight',
    mechanics: 'versionDiff.fields.mechanics',
    configs: 'versionDiff.tank.configs',
    research: 'versionDiff.categories.research',
  }
  if (exact[path]) return label(t, te, exact[path], path)
  if (path.startsWith('pitch_limits.')) return pitchLabel(path.slice('pitch_limits.'.length), t, te) ?? path
  if (path.startsWith('armor.') && ARMOR_FACES[path.slice(6)]) return armorFaceLabel(path.slice(6), t, te)
  let match = path.match(/^shells\.([^.]+)\.(.+)$/)
  if (match) {
    const shell = typeof shellLabelFn === 'function' ? shellLabelFn(match[1]) : match[1]
    return `${shell} · ${fieldLabel(match[2], t, te)}`
  }
  if (path.startsWith('configs.')) {
    // 旧格式：炮名编进路径时会与 `shells.ap.damage` 这类多段字段冲突。
    // 新数据请用 row.configLabel 单独渲染配置名，displayPath 只保留字段路径。
    const body = path.slice('configs.'.length)
    return fieldLabel(body, t, te)
  }
  match = path.match(/^armorModel\.([^.]+)\.([^.]+)(?:\.(added|removed))?$/)
  if (match) {
    const module = moduleLabel(match[1], t, te)
    const base = label(t, te, 'versionDiff.fields.armorPlate', 'Plate')
    const suffix = match[3] === 'added' ? ` (${label(t, te, 'versionDiff.added', 'added')})`
      : match[3] === 'removed' ? ` (${label(t, te, 'versionDiff.removed', 'removed')})` : ''
    return `${module} · ${base} #${match[2]}${suffix}`
  }
  match = path.match(/^engines\.([^.]+)\.(.+)$/)
  if (match) {
    return `${label(t, te, 'versionDiff.fields.engine', 'Engine')} ${match[1]} · ${fieldLabel(match[2], t, te)}`
  }
  if (path.startsWith('research.')) {
    return `${label(t, te, 'versionDiff.categories.research', 'Research')} · ${researchPathLabel(path.slice('research.'.length), t, te)}`
  }
  // 裸字段（配置级 reload_time / dpm / aim_time / weight 等）与百科参数面板同源命名；
  // fieldLabel 未知字段原样返回，等价于旧 fallback。
  return fieldLabel(path, t, te)
}

export function categoryLabel(category: string, t: Translate, te: Exists): string {
  const keys: Record<string, string> = {
    firepower: 'versionDiff.categories.firepower',
    mobility: 'versionDiff.categories.mobility',
    survivability: 'versionDiff.categories.survivability',
    armor: 'versionDiff.categories.armor',
    research: 'versionDiff.categories.research',
    geometry: 'versionDiff.categories.geometry',
    identity: 'versionDiff.categories.identity',
    other: 'versionDiff.categories.other',
    model: 'versionDiff.categories.model',
  }
  return label(t, te, keys[category], category)
}

export function statusLabel(status: string, t: Translate, te: Exists): string {
  const keys: Record<string, string> = {
    added: 'versionDiff.status.added',
    removed: 'versionDiff.status.removed',
    changed: 'versionDiff.status.changed',
    modelOnly: 'versionDiff.status.modelOnly',
  }
  return label(t, te, keys[status], status)
}

interface VehicleFlags {
  premium?: boolean
  collector?: boolean
}

type DiffSchema = { added: Record<string, unknown>; removed: Record<string, unknown> }

function categoryChanges(changes: DiffChange[], schema?: DiffSchema, flags?: VehicleFlags) {
  const premium = changes.find(change => change.path === 'is_premium')
  const collector = changes.find(change => change.path === 'is_collector')
  const first = changes.find(change => change === premium || change === collector)
  if (!first) return changes
  function flagAt(path: string, row: DiffChange | undefined, side: 'old' | 'new', fallback: boolean | undefined) {
    if (row) return typeof row[side] === 'boolean' ? row[side] : undefined
    // A field present on only one side is recorded in the schema, not in the numeric/identity diff.
    if (schema?.added && schema.removed && !Object.hasOwn(schema.added, path) && !Object.hasOwn(schema.removed, path)) return fallback
    return undefined
  }
  const categoryAt = (side: 'old' | 'new') => {
    const is_premium = flagAt('is_premium', premium, side, flags?.premium)
    const is_collector = flagAt('is_collector', collector, side, flags?.collector)
    // The encyclopedia gives premium precedence and requires both flags for the regular category.
    if (is_premium === undefined && is_collector === true) return 'unknown'
    return tankCategory({ is_premium, is_collector })
  }
  const old = categoryAt('old')
  const next = categoryAt('new')
  if (old === 'unknown' || next === 'unknown') return changes
  return changes.flatMap(change => {
    if (change === first && old !== next) return [{ path: 'vehicle_category', category: 'identity', old, new: next }]
    return change === premium || change === collector ? [] : [change]
  })
}

export function tankRows(detail: unknown, flags?: VehicleFlags): DiffChange[] {
  const rows: DiffChange[] = []
  const source = (detail ?? {}) as { changes?: DiffChange[]; schema?: DiffSchema; configs?: { configs?: Array<{ key?: DiffConfigKey; changes?: DiffChange[] }> }; research?: { changes?: DiffChange[] } }
  for (const change of categoryChanges(source.changes || [], source.schema, flags)) {
    rows.push({ ...change, scope: 'summary', displayPath: change.path })
  }
  const detailSource = (detail ?? {}) as { configs?: { configs?: Array<{ key?: DiffConfigKey; changes?: DiffChange[] }> } }
  for (const config of detailSource.configs?.configs || []) {
    const configName = config.key?.gun || config.key?.turret || ''
    for (const change of config.changes || []) {
      rows.push({
        ...change,
        scope: 'config',
        config: config.key,
        configLabel: configName,
        displayPath: change.path,
      })
    }
  }
  for (const change of source.research?.changes || []) {
    rows.push({ ...change, scope: 'research', displayPath: `research.${change.path}` })
  }
  return rows
}

// Both sides must resolve to the same exported turret/gun pair before replacing a summary projection.
function configIdentity(turret: unknown, gun: unknown): string | undefined {
  if (Number.isInteger(turret) && Number.isInteger(gun)) return String(turret) + '/' + String(gun)
  return undefined
}

export function diffConfigIdentity(key?: DiffConfigKey) {
  return configIdentity(key?.turretLocal, key?.gunLocal)
}

type ExportedConfig = { turret_local?: number; gun_local?: number }

function exportedTopConfig(configs?: ExportedConfig[]) {
  if (!Array.isArray(configs)) return
  // dump-tank-data enumerates turrets and guns in the same order as the summary resolver.
  const top = configs.at(-1)
  const identity = configIdentity(top?.turret_local, top?.gun_local)
  if (identity && configs.filter(item => configIdentity(item?.turret_local, item?.gun_local) === identity).length === 1) {
    return identity
  }
  return undefined
}

export function matchingTopConfig(oldConfigs?: ExportedConfig[], newConfigs?: ExportedConfig[]) {
  const oldTop = exportedTopConfig(oldConfigs)
  return oldTop === exportedTopConfig(newConfigs) ? oldTop : undefined
}

type ConfigDiff = {
  configs?: { key?: DiffConfigKey; changes?: DiffChange[] }[]
  added?: unknown[]
  removed?: unknown[]
  unpairedOld?: unknown[]
  unpairedNew?: unknown[]
}

export function onlyPairedConfig(configs?: ConfigDiff) {
  if (configs?.configs?.length !== 1 || configs.added?.length || configs.removed?.length
    || configs.unpairedOld?.length || configs.unpairedNew?.length) return
  return diffConfigIdentity(configs.configs[0].key)
}

function summaryConfigPath(path?: string): string | undefined {
  if (path === 'gun_depression') return 'pitch_limits.max'
  if (path === 'gun_elevation') return 'pitch_limits.min'
  if (path === 'turret_traverse_speed' || path === 'view_range') return path
  // Upgraded *_top fields have their own bonuses. This only matches base shell data.
  if (/^shells\.[^.]+\.(damage|penetration|module_damage|explosion_radius|caliber|normalization|ricochet)$/.test(path || '')) return path
  return undefined
}

export function needsTopConfig(detail: { changes?: DiffChange[]; configs?: ConfigDiff }) {
  if (onlyPairedConfig(detail.configs)) return false
  const paths = new Set(detail.configs?.configs?.flatMap(config => config.changes?.map(row => row.path) || []))
  return detail.changes?.some(row => {
    const source = summaryConfigPath(row.path)
    return source !== undefined && paths.has(source.startsWith('pitch_limits.') ? 'pitch_limits' : source)
  }) ?? false
}

function pitchRecord(value: unknown): Record<string, unknown> | undefined {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

function pitchRows(row: DiffChange): DiffChange[] {
  const path = row.displayPath || row.changePath || row.path || ''
  if (path !== 'pitch_limits') return [row]
  const before = pitchRecord(row.old)
  const after = pitchRecord(row.new)
  if (!before || !after) return [row]
  const rows: DiffChange[] = []
  const push = (field: string, old: unknown, next: unknown) => {
    if (Object.is(old, next)) return
    rows.push({ ...row, old, new: next, displayPath: path + '.' + field })
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'front' || key === 'back') {
      const oldSector = pitchRecord(before[key])
      const newSector = pitchRecord(after[key])
      if ((oldSector || before[key] == null) && (newSector || after[key] == null)) {
        for (const edge of new Set([...Object.keys(oldSector || {}), ...Object.keys(newSector || {})])) {
          push(key + '.' + edge, oldSector?.[edge], newSector?.[edge])
        }
        continue
      }
    }
    push(key, before[key], after[key])
  }
  return rows
}

export function parameterRows(rows: DiffChange[], topConfig?: string): DiffChange[] {
  const expanded = rows.flatMap(pitchRows)
  const topRows = new Map<string, DiffChange>()
  const apDamageConfigs = new Set<DiffConfigKey>()
  for (const row of expanded) {
    if (row.scope !== 'config' || !row.config) continue
    if (row.displayPath && topConfig && diffConfigIdentity(row.config) === topConfig) topRows.set(row.displayPath, row)
    if (row.path === 'shells.ap.damage') apDamageConfigs.add(row.config)
  }
  const configRowsUsed = new Set<DiffChange>()
  const vehicleFieldsUsed = new Set<string>()
  // Prefer the configuration's precision, while keeping summary fields in their original order.
  return expanded.flatMap(change => {
    const alias = change.scope === 'summary' ? summaryConfigPath(change.path) : undefined
    const row = (alias ? topRows.get(alias) : undefined) ?? change
    if (row.scope !== 'config') return [row]
    if (configRowsUsed.has(row)) return []
    configRowsUsed.add(row)
    if (row.path === 'standard_damage' && row.config && apDamageConfigs.has(row.config)) return []
    // The exporter copies vehicle-wide fields into every turret/gun configuration.
    const field = row.path || ''
    if (['hull_hp', 'weight', 'tracks'].includes(field) || field.startsWith('engines.')) {
      if (vehicleFieldsUsed.has(field)) return []
      vehicleFieldsUsed.add(field)
      return [{ ...row, scope: 'vehicle', config: undefined, configLabel: undefined }]
    }
    return [row !== change && row.category !== change.category ? { ...row, category: change.category } : row]
  })
}

export function isPitchChange(row: DiffChange) {
  const path = row.displayPath || row.changePath || row.path || ''
  return path === 'gun_depression' || path === 'gun_elevation' || path.startsWith('pitch_limits.')
}

const CONFIG_ARMOR_PATH = /^(gun|turret)_(plates|spaced)$/

function spacedIdSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.map(item => String(item).replace(/^armor_/, '')) : [])
}

// 间隙变化（进出间隙表）没有厚度语义，统一展开成"逐板 新增/移除"行。
function spacedChangeRows(
  module: string,
  previous: unknown,
  current: unknown,
  kind: string,
  config?: { key: string; label: string },
): ArmorRow[] {
  const oldIds = spacedIdSet(previous)
  const newIds = spacedIdSet(current)
  const rows: ArmorRow[] = []
  for (const plate of new Set([...oldIds, ...newIds])) {
    if (oldIds.has(plate) === newIds.has(plate)) continue
    rows.push({
      kind, module, plate, added: newIds.has(plate),
      ...(config ? { configKey: config.key, ...(config.label ? { configLabel: config.label } : {}) } : {}),
    })
  }
  return rows
}

export function armorRows(armor: unknown, detail: unknown = null): ArmorRow[] {
  const rows: ArmorRow[] = []
  const source = (armor ?? {}) as { summary?: Record<string, { old?: unknown; new?: unknown }>; model?: { plates?: ArmorRow[]; addedPlates?: ArmorRow[]; removedPlates?: ArmorRow[]; primary?: ArmorRow[]; spaced?: Array<{ module: string; old?: unknown; new?: unknown }>; chassis?: ArmorRow[] } }
  for (const [path, value] of Object.entries(source.summary || {})) {
    rows.push({ kind: 'direction', path: `armor.${path}`, old: value.old, new: value.new })
  }
  const model = source.model || {}
  for (const plate of model.plates || []) {
    rows.push({ kind: 'plate', ...plate })
  }
  for (const plate of model.addedPlates || []) {
    rows.push({ kind: 'addedPlate', ...plate })
  }
  for (const plate of model.removedPlates || []) {
    rows.push({ kind: 'removedPlate', ...plate })
  }
  for (const item of model.primary || []) rows.push({ kind: 'primary', ...item })
  // model 级 spaced 的 old/new 是板件 id 列表（非厚度），按逐板 新增/移除 展示。
  for (const item of model.spaced || []) {
    rows.push(...spacedChangeRows(item.module, item.old, item.new, 'configSpaced'))
  }
  for (const item of model.chassis || []) rows.push({ kind: 'chassis', ...item })
  // 配置级装甲（gun_plates/turret_plates/*_spaced）：多炮车的炮塔/火炮板件变化只在配置 diff
  // 里出现。model 级行只代表装甲模型自身的那一次变化，且多配置 3D 不能用 model 炮/塔行定位配置：
  // - 单配置车：配置行与 model 行「同板同值」时并到 model 行，避免文字版重复；
  // - 多配置车：配置身份不能丢——配置行全部保留；与之完全同值的 model 炮/塔行移除（否则同一条
  //   改动既有一条无配置行、又有配置行，且 model 行无法点选到具体配置）。
  const armorSignature = (oldValue: unknown, newValue: unknown): string => {
    const value = (input: unknown): string => (input === null || input === undefined ? '' : String(input))
    return `${value(oldValue)}|${value(newValue)}`
  }
  const modelSignature = (row: ArmorRow): string => {
    if (row.kind === 'addedPlate') return armorSignature(null, row.thickness)
    if (row.kind === 'removedPlate') return armorSignature(row.thickness, null)
    return armorSignature(row.old, row.new)
  }
  const coverageKeys = (row: ArmorRow): string =>
    `${row.module}:${row.plate}:${modelSignature(row)}`
  const covered = new Set(rows
    .filter(row => row.kind != null && ['plate', 'addedPlate', 'removedPlate'].includes(row.kind))
    .map(coverageKeys))
  const detailSource = (detail ?? {}) as { configs?: { configs?: Array<{ key?: DiffConfigKey; changes?: DiffChange[] }> } }
  const configEntries = detailSource.configs?.configs || []
  const multiConfig = configEntries.length > 1
  const configModelRows: ArmorRow[] = []
  const configArmorRows: ArmorRow[] = []
  for (const config of configEntries) {
    for (const change of config.changes || []) {
      const match = CONFIG_ARMOR_PATH.exec(change.path || '')
      if (!match) continue
      const module = match[1] ?? ''
      const kind = match[2] ?? ''
      // 多配置车同一块板可能在多个配置里变化：把配置身份带进行，避免表格出现无法区分的重复行。
      // 标签同时展示炮塔 + 火炮（缺名称时用 local id），同炮不同炮塔也能区分。
      const key = config.key ?? {}
      const turretLabel = key.turret || (key.turretLocal != null ? `#${key.turretLocal}` : '')
      const gunLabel = key.gun || (key.gunLocal != null ? `#${key.gunLocal}` : '')
      const configIdentity = {
        key: Number.isInteger(key.turretLocal) && Number.isInteger(key.gunLocal)
          ? `${key.turretLocal}/${key.gunLocal}` : '',
        label: [turretLabel, gunLabel].filter(Boolean).join(' / '),
      }
      if (kind === 'plates') {
        const oldPlates = (change.old && typeof change.old === 'object') ? change.old as Record<string, unknown> : {}
        const newPlates = (change.new && typeof change.new === 'object') ? change.new as Record<string, unknown> : {}
        for (const plate of new Set([...Object.keys(oldPlates), ...Object.keys(newPlates)])) {
          const oldValue = oldPlates[plate] ?? null
          const newValue = newPlates[plate] ?? null
          if (oldValue === newValue) continue
          const row: ArmorRow = {
            kind: 'configPlate', module, plate,
            configKey: configIdentity.key,
            ...(configIdentity.label ? { configLabel: configIdentity.label } : {}),
            old: oldValue, new: newValue,
          }
          if (!multiConfig && covered.has(coverageKeys(row))) continue
          configModelRows.push(row)
        }
      } else {
        configArmorRows.push(...spacedChangeRows(module, change.old, change.new, 'configSpaced', configIdentity))
      }
    }
  }
  if (multiConfig) {
    // model 行只在与其完全同值的配置行已存在时移除；保留 hull/chassis 等配置无关行。
    const configSignatures = new Set(configModelRows.map(coverageKeys))
    return [
      ...rows.filter(row => !(row.kind != null
        && ['plate', 'addedPlate', 'removedPlate'].includes(row.kind)
        && ['gun', 'turret'].includes(String(row.module))
        && configSignatures.has(coverageKeys(row)))),
      ...configModelRows,
      ...configArmorRows,
    ]
  }
  return [...rows, ...configModelRows, ...configArmorRows]
}

export function tankMatchesFilter(row: { status?: string; categories?: string[] }, filter?: string | null): boolean {
  if (!filter || filter === 'all') return true
  if (filter === 'modelOnly') return row.status === 'modelOnly'
  if (['added', 'removed', 'changed'].includes(filter)) return row.status === filter
  return (row.categories || []).includes(filter)
}

export function mapMatchesFilter(row: { categories?: string[] }, filter?: string | null): boolean {
  if (!filter || filter === 'all') return true
  return (row.categories || []).includes(filter)
}

export function pairLabel(pair?: { from?: { dataset?: string }; to?: { dataset?: string } } | null): string {
  if (!pair) return ''
  return `${pair.from?.dataset || '?'} → ${pair.to?.dataset || '?'}`
}