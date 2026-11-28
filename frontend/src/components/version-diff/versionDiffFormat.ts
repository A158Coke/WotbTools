/**
 * 版本变更页的纯展示辅助：路径 → 本地化标签、值格式化、筛选。
 * 不依赖 Vue / 网络，便于单测。
 */

import { PITCH_LEAF } from './versionDiffStatValues.js'

export { deltaDiffValue, diffStatValues, fmtDiffValue } from './versionDiffStatValues.js'
export { diffConfigIdentity, isPitchChange, matchingTopConfig, needsTopConfig, onlyPairedConfig, parameterRows, tankRows } from './versionDiffParameterRows.js'

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