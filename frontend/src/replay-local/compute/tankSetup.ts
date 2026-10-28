/**
 * 配置器状态解析（纯函数）：客户端导出数据 + URL 状态 → characteristics 引擎输入 / 参数行。
 *
 * 选择模型（单一 owner）：
 * - 炮塔+炮由 `?config=`（tank/{id}.json configs 下标）唯一决定；两个下拉只做“同一对 (turret, gun)
 *   在哪一档配置里”的投影，改动即写回 config，不保存第二份炮塔/炮状态。
 * - 发动机/履带是模块级选择（`?engine=` / `?track=`），默认顶级（末位）。
 * - 装备 9 槽 `?dev=`（`0`=左 / `1`=右 / `-`=空），默认全空（BK 语义，见上游方案 §5.1）。
 * - 消耗品/补给 `?cons=` / `?prov=`：**键缺省 = 客户端默认表**，键存在但为空 = 用户清空。
 * - 涂装 `?camo=1`，默认关。
 *
 * 数据面：资产包 research/modules/{nation}.json（客户端原值）+ tank/{id}.json（装甲/弹种）。
 * 任何映射缺失（无模块、config 无 turret_local/gun_local 对号）都返回 canConfigure=false，
 * 调用方保留静态百科展示，不猜默认值（fail-closed）。
 */
import { computeCharacteristics, type ComputeInput } from './characteristics'
import { availableItems, resolveDeviceIds, scriptMap } from '../../utils/researchCatalog'

export const DEVICE_SLOT_COUNT = 9
const EMPTY_DEVICE = '-'

export interface SetupSelection {
  config: number
  turret: number
  gun: number
  /** 当前 config 的弹种下标（0..shells-1；默认 AP/首个非金币） */
  shell: number
  engine: number
  track: number
  devices: Array<0 | 1 | null>
  consumables: string[]
  provisions: string[]
  /** 已训练技能 → 等级（1–7；缺省 = 未训练，效果全局） */
  skills: Record<string, number>
  camouflage: boolean
}

export interface SetupResolved extends SetupSelection {
  canConfigure: boolean
}

export interface SetupSources {
  /** tank/{id}.json 详情 */
  detail: any
  /** 该车模块数据（国别文件的 tanks 条目）；null = 无数据 */
  modules: any
  /** parseTankopediaQuery 输出的 URL 状态 */
  url: any
  /** 资产包 research 全局目录（物品目录/预设/过滤器/技能） */
  catalog?: any
}

/**
 * 按 tankId 在国别文件里找单车模块（导出的 key 是 stem，不按名称匹配）。
 * 结果补 `stem`：物品 vehicleFilter 的 ids 规则写的是 `nation:stem`，而 tank/{id}.json
 * 没有 stem 字段——模块键是唯一可用的权威 stem 来源。
 */
export function findTankModules(nationData: any, tankId: number) {
  const tanks = nationData?.tanks
  if (!tanks) return null
  for (const key of Object.keys(tanks)) {
    if (Number(tanks[key]?.tankId) === Number(tankId)) return { ...tanks[key], stem: key }
  }
  return null
}

/** (turret_local, gun_local) → configs 下标；无匹配 -1（fail-closed）。 */
export function configIndexFor(configs: any[], turretLocal: number | null, gunLocal: number | null) {
  if (!Array.isArray(configs) || turretLocal == null || gunLocal == null) return -1
  return configs.findIndex(c => Number(c?.turret_local) === Number(turretLocal)
    && Number(c?.gun_local) === Number(gunLocal))
}

function findTurretIndex(modules: any, localId: number | null) {
  if (localId == null) return -1
  return (modules?.turrets || []).findIndex(t => Number(t?.localId) === Number(localId))
}

function findGunIndex(turret: any, localId: number | null) {
  if (localId == null) return -1
  return (turret?.guns || []).findIndex(g => Number(g?.localId) === Number(localId))
}

/** 解码 `?dev=`（0/1/-，右补 - 到 9 槽）。 */
export function decodeDevices(raw: string | null | undefined): Array<0 | 1 | null> {
  const text = typeof raw === 'string' ? raw : ''
  return Array.from({ length: DEVICE_SLOT_COUNT }, (_, i) => {
    const ch = text[i]
    return ch === '0' ? 0 : ch === '1' ? 1 : null
  })
}

/** 编码 9 槽（去尾随空槽；全空 = ''）。 */
export function encodeDevices(devices: Array<0 | 1 | null>): string {
  const chars = Array.from({ length: DEVICE_SLOT_COUNT }, (_, i) => {
    const v = devices?.[i]
    return v === 0 ? '0' : v === 1 ? '1' : EMPTY_DEVICE
  })
  return chars.join('').replace(/-+$/, '')
}

/** 火炮循环类型（客户端 config 的 is_drum / is_burst 语义，见 extract_vehicles.extract_gun）。 */
export function gunCycleOf(config: any) {
  if (!config) return null
  const reload = Number(config.reload_time) || 0
  const intraClip = Number(config.burst_interval) || 0
  const shellCount = Number(config.burst_size) || 0
  const shellReloads = Array.isArray(config.burst_reloads)
    ? config.burst_reloads.map(Number).filter(value => Number.isFinite(value) && value > 0)
    : []
  // 连发组（PomPom 类）：tank/{id}.json 的 burst_group_*（上游 pb 的 GunDefinition.burst）。
  // 一次扳机连发 N 发、组内间隔秒；**不是** is_burst 判定依据（那只看车辆内联 clip/pump）。
  const burstGroupRaw = Number(config.burst_group_count) || 0
  const burstGroupCount = burstGroupRaw > 1 ? Math.round(burstGroupRaw) : 0
  const burstGroupInterval = burstGroupCount
    ? Math.max(0, Number(config.burst_group_interval) || 0)
    : 0
  if (config.is_drum && shellReloads.length > 0) {
    return {
      type: 'autoreloader' as const,
      reload, intraClip, shellCount: shellCount || shellReloads.length, shellReloads,
      burstGroupCount, burstGroupInterval,
    }
  }
  if (config.is_burst && shellCount > 0) {
    return {
      type: 'autoloader' as const,
      reload, intraClip, shellCount, shellReloads: [],
      burstGroupCount, burstGroupInterval,
    }
  }
  return {
    type: 'regular' as const,
    reload, intraClip: 0, shellCount: 0, shellReloads: [],
    burstGroupCount: 0, burstGroupInterval: 0,
  }
}

/** 默认弹种下标：优先非金币 AP/APCR，其次任意 AP 族，最后首项。 */
export function defaultShellIndex(config: any) {
  const shells = config?.shells
  if (!Array.isArray(shells) || shells.length === 0) return 0
  const index = shells.findIndex(s => s?.type === 'ap' || s?.type === 'ap_cr')
  if (index >= 0) return index
  const apFamily = shells.findIndex(s => /^ap/.test(String(s?.type || '')))
  return apFamily >= 0 ? apFamily : 0
}

/** 当前配置的弹种；`shellIndex` 越界时回落到默认弹。 */
export function standardShellOf(config: any, shellIndex: number | null = null) {
  const shells = config?.shells
  if (!Array.isArray(shells) || shells.length === 0) return null
  const requested = typeof shellIndex === 'number' && Number.isInteger(shellIndex) ? shellIndex : -1
  const index = requested >= 0 && requested < shells.length ? requested : defaultShellIndex(config)
  const pick = shells[index]
  return {
    damage: Number(pick?.damage) || 0,
    penetration: Number(pick?.penetration) || 0,
    type: String(pick?.type || ''),
    velocity: pick?.velocity == null ? null : Number(pick.velocity),
  }
}

/**
 * vehicleFilter 求值需要的车辆引用。
 * tank/{id}.json 没有 list.xml 的 `<tags>`；当前物品过滤器只用到 `clip`
 * （berserk/pretendDead 的 exclude），由配置的 is_drum/is_burst **语义标记**补出——
 * 不是从数值统计推断：弹夹/连发车不享受肾上腺素，与引擎 `isBurstGun` 守卫同一口径。
 */
export function tankRef(detail: any, modules?: any) {
  const configs = Array.isArray(detail?.configs) ? detail.configs : []
  const clip = configs.some(config => config?.is_drum || config?.is_burst)
  return {
    nation: detail?.nation || 'unknown',
    // ids 规则需要 `nation:stem`；tank/{id}.json 无 stem，用模块键（findTankModules 补出）
    stem: modules?.stem || detail?.stem || null,
    tankId: detail?.tank_id ?? detail?.tankId ?? modules?.tankId ?? null,
    tier: Number(detail?.tier) || 0,
    tags: [...(Array.isArray(detail?.tags) ? detail.tags : []), ...(clip ? ['clip'] : [])],
  }
}

/** 装备预设槽位（devices.json presets[optDevicePreset]，缺省 defaultPreset）。 */
export function presetSlots(modules: any, catalog: any) {
  const presets = catalog?.devicePresets || {}
  return presets[modules?.optDevicePreset] || presets.defaultPreset || []
}

/**
 * 回放装配 id 集合（`shooter_equipment.raw`，Type5 九字节、0=空槽）→ 装备槽位选择
 * （0=左候选 / 1=右候选 / null=空）。线上串**变长且空槽省略**，槽位信息不存在——
 * 反解只能按 id 对号预设两侧候选：id 命中一侧 → 该侧；两侧同 id 或都未命中 → null。
 * 回放真值超出该车预设（活动装备等）时对应槽位保持空，不伪造可选性（fail-closed）。
 */
export function devicesFromEquipmentIds(ids: number[] | null | undefined, modules: any, catalog: any): Array<0 | 1 | null> {
  const slots = presetSlots(modules, catalog)
  if (!Array.isArray(ids) || !Array.isArray(slots)) return slots.map(() => null)
  const present = new Set(ids.filter(id => Number.isInteger(id) && id > 0))
  const byStem = new Map<string, number>(
    (catalog?.devices || []).map((device: any): [string, number] => [device.stem, Number(device.id)]),
  )
  const idOf = (stem: any) => (stem ? byStem.get(stem) ?? null : null)
  return slots.map((slot: any) => {
    const leftId = idOf(slot?.left)
    const rightId = idOf(slot?.right)
    const leftHit = leftId != null && present.has(leftId)
    const rightHit = rightId != null && present.has(rightId)
    if (leftHit && rightHit) return null
    if (leftHit) return 0
    if (rightHit) return 1
    return null
  })
}

function clampIndex(value: number | null | undefined, length: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= length) return fallback
  return value
}

/**
 * URL + 数据 → 选择态。config 是炮塔/炮的唯一来源；无模块或 config 无对号时 canConfigure=false。
 * 消耗品键缺省时按客户端 tier 默认表预填；键存在但为空 = 用户清空（不再回填）。
 */
export function resolveSetup({ detail, modules, url, catalog }: SetupSources): SetupResolved {
  const configs = detail?.configs || []
  const empty: SetupResolved = {
    canConfigure: false,
    config: 0,
    turret: 0,
    gun: 0,
    shell: 0,
    engine: 0,
    track: 0,
    devices: decodeDevices(''),
    consumables: [],
    provisions: [],
    skills: {},
    camouflage: false,
  }
  if (!modules || configs.length === 0) return empty

  const requested = url?.config
  const config = clampIndex(requested == null ? null : Number(requested), configs.length, configs.length - 1)
  const cur = configs[config]
  const turret = findTurretIndex(modules, cur?.turret_local)
  const gun = findGunIndex(modules.turrets?.[turret], cur?.gun_local)
  if (turret < 0 || gun < 0) return { ...empty, config }

  const engines = modules.engines || []
  const tracks = modules.chassis || []
  const skillIds = new Set(Object.keys(catalog?.skills || {}))
  const selection: SetupResolved = {
    canConfigure: true,
    config,
    turret,
    gun,
    shell: clampIndex(url?.shell, cur?.shells?.length || 0, defaultShellIndex(cur)),
    engine: clampIndex(url?.engine, engines.length, engines.length - 1),
    track: clampIndex(url?.track, tracks.length, tracks.length - 1),
    devices: decodeDevices(url?.dev),
    // 默认空（与 BlitzInfo 的中性基线一致；客户端默认表仍导出，可按需改用/加按钮）
    consumables: url?.cons == null ? [] : url.cons,
    provisions: url?.prov == null ? [] : url.prov,
    skills: Object.fromEntries(Object.entries(url?.skills || {}).filter(([id, level]) => skillIds.has(id) && Number.isFinite(Number(level)) && Number(level) > 0).map(([id, level]) => [id, Math.min(7, Math.max(1, Math.round(Number(level))))])),
    camouflage: url?.camo === true,
  }
  return { ...selection, ...normalizeSetup(selection, detail, modules, catalog) }
}

/** 把选择态夹到该车数据范围内（URL 里可能有别的车留下的 stem/下标）。 */
export function normalizeSetup(
  selection: SetupSelection,
  detail: any,
  modules: any,
  catalog: any,
): SetupSelection {
  if (!catalog) return selection
  const slots = Number(modules?.provisionSlots) || 0
  const consSlots = Number(modules?.consumableSlots) || 0
  const availableCons = availableItems(catalog.consumables, tankRef(detail, modules))
  const availableProv = availableItems(catalog.provisions, tankRef(detail, modules))
  const consStems = new Set(availableCons.map(item => item.stem))
  const provStems = new Set(availableProv.map(item => item.stem))
  const skillIds = new Set(Object.keys(catalog.skills || {}))
  return {
    ...selection,
    consumables: selection.consumables.filter(stem => consStems.has(stem)).slice(0, consSlots),
    provisions: selection.provisions.filter(stem => provStems.has(stem)).slice(0, slots),
    skills: Object.fromEntries(Object.entries(selection.skills || {}).filter(([id]) => skillIds.has(id))),
  }
}

/**
 * 所选炮塔的 front/side/rear 装甲：每个炮塔有自己的 `primaryArmor`（plate id 映射），
 * 厚度取当前 config 的 `turret_plates`。顶层 `detail.armor.turret` 是顶级炮塔摘要，
 * 不能用于 stock 配置；映射缺失时回退到它（fail-closed 到已知值）。
 */
export function resolveArmor(detail: any, modules: any, selection: SetupSelection) {
  const fallback = detail?.armor || null
  const primary = modules?.turrets?.[selection.turret]?.primaryArmor || null
  const plates = detail?.configs?.[selection.config]?.turret_plates || null
  const value = (key: string | undefined) => {
    if (!key || !plates) return null
    const plateId = key.startsWith('armor_') ? key.slice('armor_'.length) : key
    const thickness = Number(plates[plateId])
    return Number.isFinite(thickness) ? thickness : null
  }
  const resolved = primary && plates
    ? { front: value(primary.front), sides: value(primary.sides), rear: value(primary.rear) }
    : null
  // 无炮塔 TD（config.model_turret_count === 0）：不展示炮塔列（BlitzInfo 同口径）
  const hasTurret = Number(detail?.configs?.[selection.config]?.model_turret_count ?? 1) > 0
  const turretArmor = !hasTurret
    ? null
    : resolved && [resolved.front, resolved.sides, resolved.rear].some(item => item != null)
      ? resolved
      : (fallback?.turret || null)
  return {
    hull: fallback?.hull || null,
    turret: turretArmor,
  }
}

/** 炮塔方位角归一化到 [−180, 180)。 */
function normBearing(deg: number) {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

/**
 * 给定炮塔方位角的俯仰极限（与 3D 瞄准/回放 `applyPitchYawLimits` 同口径）：
 * 默认取 `min/max`；`back`/`front` 扇区在 `range/2` 内生效，向外 `transition`
 * 度线性过渡回默认值；`front` 后应用（优先级更高）。
 * `bonus` = 装备加成（度）：`up` 加仰角上限、`down` 加俯角（下限再减去该值）。
 */
export function pitchAtBearing(pitch: any, bearing: number, bonus?: { up?: number; down?: number } | null) {
  let lower = -Number(pitch.max)
  let upper = -Number(pitch.min)
  const transition = Number(pitch.transition) || 20
  const applySector = (sector: any, distance: number) => {
    const half = Number(sector.range) / 2
    if (distance <= half) {
      lower = -Number(sector.max)
      upper = -Number(sector.min)
      return
    }
    if (distance > half + transition) return
    const tp = (distance - half) / transition
    lower = -((1 - tp) * Number(sector.max) + tp * Number(pitch.max))
    upper = -((1 - tp) * Number(sector.min) + tp * Number(pitch.min))
  }
  if (pitch.back) applySector(pitch.back, Math.abs(normBearing(bearing - 180)))
  if (pitch.front) applySector(pitch.front, Math.abs(normBearing(bearing)))
  const upBonus = Number(bonus?.up) || 0
  const downBonus = Number(bonus?.down) || 0
  return {
    up: Math.round((upper + upBonus) * 10) / 10,
    down: Math.round((lower - downBonus) * 10) / 10,
  }
}

/**
 * 强化装甲（multiLayerArmor 110）：客户端 script 的 `armorHomogenizationFactor`
 * 百分比 → 车体/炮塔装甲系数（未装 = 1）。
 */
export function armorFactorFor(deviceIds: number[], catalog: any) {
  if (!deviceIds.includes(110)) return 1
  const device = catalog?.devices?.find(item => item.id === 110)
  const percent = Number(device?.script?.params?.bonusValues?.percent)
  return Number.isFinite(percent) && percent > 0 ? 1 + percent / 100 : 1
}

/**
 * 消耗品计时（客户端 script 原值）：装备 101 高端消耗品 +33% 持续时间、
 * 118 消耗品配送系统 +17% **冷却速度**（冷却时间 ÷1.17；描述原文 “cooldown speed”）。
 * 补给为整场被动、无计时；只有带 `cooldown`/`duration` 的消耗品走此函数。
 * 值从客户端装备 script 读取（不硬编码百分比），缺失/非数时保持原值（fail-closed）。
 */
export function consumableTiming(script: any, deviceIds: Iterable<number>, catalog: any) {
  const params = script?.params || {}
  const ids = deviceIds instanceof Set ? deviceIds : new Set(deviceIds)
  const deviceParams = (id: number) => catalog?.devices?.find((device: any) => device.id === id)?.script?.params
  let durationFactor = 1
  let cooldownFactor = 1
  if (ids.has(101)) {
    const percent = Number(deviceParams(101)?.bonusValues?.percent)
    if (Number.isFinite(percent) && percent > 0) durationFactor *= 1 + percent / 100
  }
  if (ids.has(118)) {
    const boost = Number(deviceParams(118)?.bonusValues?.value)
    if (Number.isFinite(boost) && boost > 0) cooldownFactor /= 1 + boost
  }
  const cooldown = Number(params.cooldown)
  const duration = Number(params.duration)
  return {
    cooldown: Number.isFinite(cooldown) && cooldown > 0 ? cooldown * cooldownFactor : null,
    duration: Number.isFinite(duration) && duration > 0 ? duration * durationFactor : null,
  }
}

/** 配置器 → 引擎输入（含客户端 script 摘要与装备预设解析）。 */
export function buildComputeInput({ detail, modules, selection, catalog }: {
  detail: any
  modules: any
  selection: SetupSelection
  catalog: any
}): ComputeInput {
  const config = detail?.configs?.[selection.config] || null
  const slots = presetSlots(modules, catalog)
  const netScript = catalog?.devices?.find(device => device.stem === 'camouflageNet')?.script?.params || null
  const paint = catalog?.camouflage?.categories?.[catalog.camouflage.defaultCategory] || null
  const deviceIds = resolveDeviceIds(slots, selection.devices, catalog?.devices)
  return {
    modules,
    turretIdx: selection.turret,
    gunIdx: selection.gun,
    engineIdx: selection.engine,
    trackIdx: selection.track,
    standardShell: standardShellOf(config, selection.shell),
    isBurstGun: !!config?.is_burst,
    gunCycle: gunCycleOf(config),
    armor: resolveArmor(detail, modules, selection),
    armorFactor: armorFactorFor(deviceIds, catalog),
    deviceIds,
    provisionStems: selection.provisions,
    consumableStems: selection.consumables,
    provisionScripts: catalog?.provisions ? scriptMap(catalog.provisions, selection.provisions) : {},
    consumableScripts: catalog?.consumables ? scriptMap(catalog.consumables, selection.consumables) : {},
    skillLevels: { ...(selection.skills || {}) },
    skillEffects: catalog?.skills || null,
    camouflage: selection.camouflage,
    camouflageNet: netScript,
    paintInvisibility: paint,
    vehicleClass: detail?.type || 'unknown',
    crewRoles: modules?.crewRoles || [],
  }
}

/**
 * 基准态（delta 参照）：初始配置 config 0 + 首档发动机/履带 + 空装备 + 空物品 + 关涂装。
 * 无可比较基（config 0 无对号模块）时返回 null。
 */
export function baseSelection({ detail, modules }: { detail: any; modules: any }): SetupSelection | null {
  const configs = detail?.configs || []
  if (!modules || configs.length === 0) return null
  const cur = configs[0]
  const turret = findTurretIndex(modules, cur?.turret_local)
  const gun = findGunIndex(modules.turrets?.[turret], cur?.gun_local)
  if (turret < 0 || gun < 0) return null
  return {
    config: 0,
    turret,
    gun,
    shell: defaultShellIndex(cur),
    engine: 0,
    track: 0,
    devices: decodeDevices(''),
    consumables: [],
    provisions: [],
    skills: {},
    camouflage: false,
  }
}

/** 切炮塔：保留同 stem 的炮（存在时），否则该炮塔首炮 → 写回对应 config。 */
export function pickTurret(selection: SetupSelection, modules: any, detail: any, turretIndex: number): SetupSelection {
  const turret = modules?.turrets?.[turretIndex]
  if (!turret) return selection
  const currentGun = modules?.turrets?.[selection.turret]?.guns?.[selection.gun]
  const guns = turret.guns || []
  const sameGun = guns.findIndex(g => g?.stem === currentGun?.stem)
  const gunIndex = sameGun >= 0 ? sameGun : 0
  const config = configIndexFor(detail?.configs || [], turret?.localId, guns[gunIndex]?.localId)
  if (config < 0) return selection
  return {
    ...selection,
    config,
    turret: turretIndex,
    gun: gunIndex,
    shell: defaultShellIndex(detail?.configs?.[config]),
  }
}

/** 切炮：写回该 (turret, gun) 对应的 config；无对号（客户端数据缺失）时保持原选择。 */
export function pickGun(selection: SetupSelection, modules: any, detail: any, gunIndex: number): SetupSelection {
  const turret = modules?.turrets?.[selection.turret]
  const gun = turret?.guns?.[gunIndex]
  if (!gun) return selection
  const config = configIndexFor(detail?.configs || [], turret?.localId, gun?.localId)
  if (config < 0) return selection
  return { ...selection, config, gun: gunIndex, shell: defaultShellIndex(detail?.configs?.[config]) }
}

// ---------------------------------------------------------------- 参数区行

export interface ParamRow {
  key: string
  value: number | null
  base: number | null
  delta: number | null
  /** biggerIsBetter=false 时 delta<0 视为有利（客户端 NumberValue 契约） */
  good: boolean | null
  digits: number
  unit: string | null
}

export interface ParamGroup {
  group: string
  rows: ParamRow[]
}

/** 客户端 hangarParams 结构的主分组顺序（protectability / gun / mobility）。 */
/** 客户端 params/format 未收录的动态扩圈**系数**：3 位、越小越好（无量纲）。 */
const PARAM_FORMAT_OVERRIDES: Record<string, any> = {
  dispersionMoving: { digits: 3, biggerIsBetter: false },
  dispersionHullTraversing: { digits: 3, biggerIsBetter: false },
  dispersionTurretTraversing: { digits: 3, biggerIsBetter: false },
  dispersionShooting: { digits: 3, biggerIsBetter: false },
  dispersionGunDamaged: { digits: 3, biggerIsBetter: false },
  // 客户端只给 still/moving/shot 三个隐蔽键；移动开火/起火沿用 PERCENT 格式（1 位）
  movingShotInvisibility: { units: 'PERCENT', biggerIsBetter: true },
  fireInvisibility: { units: 'PERCENT', biggerIsBetter: true },
  // BK/BI 都展示、客户端 params/format 未收录的行（引擎派生）
  gunClipDamage: { digits: 0, biggerIsBetter: true },
  gunEffectiveDamagePerMin: { digits: 0, biggerIsBetter: true },
  gunTraverseSpeed: { digits: 2, units: 'DEGREE_PER_SECOND', biggerIsBetter: true },
  tankWidth: { digits: 2, units: 'METER', biggerIsBetter: false },
  tankLength: { digits: 2, units: 'METER', biggerIsBetter: false },
  tankHeight: { digits: 2, units: 'METER', biggerIsBetter: false },
  tankVolume: { digits: 2, units: 'CUBIC_METER', biggerIsBetter: false },
  // 客户端 hangarParams format 对这些键只给 digits/biggerIsBetter，单位由 UI 层
  // 按参数语义补；否则参数区会显示“2.5”而没有秒/米。
  gunAimingTime: { units: 'SECOND' },
  gunShellReloadTime: { units: 'SECOND' },
  gunClipReloadTime: { units: 'SECOND' },
  gunClipShellReloadTime: { units: 'SECOND' },
  gunClipBurstReloadTime: { units: 'SECOND' },
  gunCommonReloadTime: { units: 'SECOND' },
  timeBetweenPumpShots: { units: 'SECOND' },
  reloadingShellTime0: { units: 'SECOND' },
  reloadingShellTime1: { units: 'SECOND' },
  reloadingShellTime2: { units: 'SECOND' },
  reloadingShellTime3: { units: 'SECOND' },
  reloadingShellTime4: { units: 'SECOND' },
  reloadingShellTime5: { units: 'SECOND' },
  circularVisionRadius: { units: 'METER' },
  gunShotDispersionRadius: { units: 'METER' },
}

const PARAM_GROUP_ORDER = ['protectability', 'mobility', 'gun']

const PARAM_ROWS: Array<{ group: string; key: string }> = [
  { group: 'protectability', key: 'maxHealth' },
  { group: 'protectability', key: 'engineFireStartingChance' },
  { group: 'protectability', key: 'chassisRepairTime' },
  { group: 'protectability', key: 'circularVisionRadius' },
  { group: 'protectability', key: 'stillInvisibility' },
  { group: 'protectability', key: 'movingInvisibility' },
  { group: 'protectability', key: 'shotInvisibility' },
  { group: 'protectability', key: 'movingShotInvisibility' },
  { group: 'protectability', key: 'fireInvisibility' },
  { group: 'protectability', key: 'tankLength' },
  { group: 'protectability', key: 'tankWidth' },
  { group: 'protectability', key: 'tankHeight' },
  { group: 'protectability', key: 'tankVolume' },
  { group: 'gun', key: 'gunCommonDamagePerMin' },
  { group: 'gun', key: 'gunEffectiveDamagePerMin' },
  { group: 'gun', key: 'gunShellReloadTime' },
  { group: 'gun', key: 'gunClipReloadTime' },
  { group: 'gun', key: 'gunClipShellCount' },
  { group: 'gun', key: 'gunClipShellReloadTime' },
  { group: 'gun', key: 'timeBetweenPumpShots' },
  { group: 'gun', key: 'reloadingShellTime0' },
  { group: 'gun', key: 'reloadingShellTime1' },
  { group: 'gun', key: 'reloadingShellTime2' },
  { group: 'gun', key: 'reloadingShellTime3' },
  { group: 'gun', key: 'reloadingShellTime4' },
  { group: 'gun', key: 'reloadingShellTime5' },
  { group: 'gun', key: 'gunClipDamage' },
  { group: 'gun', key: 'gunAimingTime' },
  { group: 'gun', key: 'gunShotDispersionRadius' },
  { group: 'gun', key: 'dispersionMoving' },
  { group: 'gun', key: 'dispersionHullTraversing' },
  { group: 'gun', key: 'dispersionTurretTraversing' },
  { group: 'gun', key: 'dispersionShooting' },
  { group: 'gun', key: 'dispersionGunDamaged' },
  { group: 'gun', key: 'gunPitchUpLimit' },
  { group: 'gun', key: 'gunPitchDownLimit' },
  { group: 'gun', key: 'turretYawLeftLimit' },
  { group: 'gun', key: 'turretYawRightLimit' },
  { group: 'mobility', key: 'maxFrontSpeed' },
  { group: 'mobility', key: 'maxBackSpeed' },
  { group: 'mobility', key: 'weight' },
  { group: 'mobility', key: 'thrustToWeightRatio' },
  { group: 'mobility', key: 'enginePower' },
  { group: 'mobility', key: 'turretRotationSpeed' },
  { group: 'mobility', key: 'gunTraverseSpeed' },
  { group: 'mobility', key: 'chassiRotationSpeed' },
  { group: 'mobility', key: 'terrainPermeabilityFirm' },
  { group: 'mobility', key: 'terrainPermeabilityMedium' },
  { group: 'mobility', key: 'terrainPermeabilitySoft' },
]

/** 装甲表行（客户端 turretArmor / primaryArmor 二维表）。 */
export const ARMOR_ROWS = ['front', 'side', 'rear'] as const

function roundDigits(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 当前值 vs 上一次渲染值 → 分组行（BK useDelta 同逻辑；初次加载 base 为空 → 无 delta）。
 * format 来自 params/format.json（units/digits/biggerIsBetter）；数值为 null 的行不出现。
 * delta 以 format.digits 取整，0 不显示。
 */
export function paramGroups(current: Record<string, any>, base: Record<string, any>, format: any): ParamGroup[] {
  const groups: ParamGroup[] = []
  const byGroup = new Map<string, ParamRow[]>()
  // 无炮塔车：客户端 hasTurret=false 的“炮塔转速”实际是火炮转向速度，
  // 参数区用 gunTraverseSpeed 替换 turretRotationSpeed（数据缺失时保留旧行，fail-open）。
  const swapTraverse = current?.hasTurret === false && typeof current?.gunTraverseSpeed === 'number'
  for (const spec of PARAM_ROWS) {
    if (spec.key === 'turretRotationSpeed' && swapTraverse) continue
    if (spec.key === 'gunTraverseSpeed' && !swapTraverse) continue
    const value = current?.[spec.key]
    if (value == null || typeof value !== 'number') continue
    const override = PARAM_FORMAT_OVERRIDES[spec.key] || {}
    const fmt = format?.[spec.key] ? { ...override, ...format[spec.key] } : override
    // 客户端 format 对百分数不给 digits：统一按 1 位（隐蔽/起火几率的真实差值在 0.1 级）
    const digits = Number.isInteger(fmt.digits) ? fmt.digits : (fmt.units === 'PERCENT' ? 1 : 0)
    const baseValue = base?.[spec.key]
    const delta = typeof baseValue === 'number' ? roundDigits(value - baseValue, digits) : null
    const biggerIsBetter = fmt.biggerIsBetter !== false
    const good = delta == null || delta === 0 ? null : biggerIsBetter ? delta > 0 : delta < 0
    const row: ParamRow = {
      key: spec.key,
      value,
      base: typeof baseValue === 'number' ? baseValue : null,
      delta,
      good,
      digits,
      unit: fmt.units || null,
    }
    if (!byGroup.has(spec.group)) {
      byGroup.set(spec.group, [])
      groups.push({ group: spec.group, rows: byGroup.get(spec.group)! })
    }
    byGroup.get(spec.group)!.push(row)
  }
  return groups.sort((a, b) => PARAM_GROUP_ORDER.indexOf(a.group) - PARAM_GROUP_ORDER.indexOf(b.group))
}

/** 计算当前 + 基准两套参数（两处调用同源公式，delta 才有意义）。 */
export function computeSetupPair({ detail, modules, selection, catalog }: {
  detail: any
  modules: any
  selection: SetupSelection
  catalog: any
}) {
  const current = computeCharacteristics(buildComputeInput({ detail, modules, selection, catalog }))
  const baseSel = baseSelection({ detail, modules })
  const base = baseSel
    ? computeCharacteristics(buildComputeInput({ detail, modules, selection: baseSel, catalog }))
    : {}
  return { current, base }
}

export interface ArmorCell {
  value: number | null
  delta: number | null
  good: boolean | null
}

/** 装甲表（front/side/rear × turret/hull）：数值来自引擎（含 110 系数）；delta = 当前 − 上一次。 */
export function armorRows(current: Record<string, any>, base: Record<string, any>) {
  const cell = (key: string): ArmorCell => {
    const value = current?.[key]
    if (value == null || typeof value !== 'number') return { value: null, delta: null, good: null }
    const baseValue = base?.[key]
    const delta = typeof baseValue === 'number' ? Math.round((value - baseValue) * 100) / 100 : null
    return { value, delta, good: delta == null || delta === 0 ? null : delta > 0 }
  }
  const cap = (part: string) => part[0].toUpperCase() + part.slice(1)
  return (['front', 'side', 'rear'] as const).map(part => ({
    part,
    turret: cell(`turretArmor${cap(part)}`),
    hull: cell(`hullArmor${cap(part)}`),
  }))
}
