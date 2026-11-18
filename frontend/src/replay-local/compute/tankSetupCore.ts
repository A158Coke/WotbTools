import type { ComputeInput } from './characteristics'
import { availableItems, resolveDeviceIds, scriptMap } from '../../utils/researchCatalog'
import { projectTankUpgrades, resolveUpgradeSelection } from './tankUpgrades'
import {
  configIndexFor, decodeDevices, defaultShellIndex, findGunIndex, findTurretIndex,
  gunCycleOf, presetSlots, standardShellOf, tankRef,
} from './tankSetupHelpers'
import type { SetupResolved, SetupSelection, SetupSources } from './tankSetupTypes'

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
    conditionalSkills: false,
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
    conditionalSkills: url?.conditionalSkills === true,
    camouflage: url?.camo === true,
  }
  const upgrades = resolveUpgradeSelection(modules, url?.upgrade, url?.abilities)
  if (Number(detail?.tier) === 11 && upgrades.available) {
    selection.upgrade = upgrades.mode
    selection.abilities = upgrades.abilities
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
  const consStems = new Set(availableCons.map((item: { stem: string }) => item.stem))
  const provStems = new Set(availableProv.map((item: { stem: string }) => item.stem))
  const skillIds = new Set(Object.keys(catalog.skills || {}))
  return {
    ...selection,
    consumables: [...new Set(selection.consumables)].filter(stem => consStems.has(stem)).slice(0, consSlots),
    provisions: [...new Set(selection.provisions)].filter(stem => provStems.has(stem)).slice(0, slots),
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
  const device = catalog?.devices?.find((item: { id: number }) => item.id === 110)
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
  const stockEnginePower = Number(modules?.engines?.[0]?.stats?.power)
  const projected = projectTankUpgrades(detail, modules, selection.upgrade, selection.abilities)
  // 升级数据不可用必须 fail-closed：top 与 custom 都不能把 stock 数值冒充成已研发后的投影。
  if (projected.selection.available && !projected.selection.supported
    && (selection.upgrade === 'top' || selection.upgrade === 'custom')) {
    throw new Error(`XI upgrade data unavailable: ${projected.selection.unsupported.join(', ')}`)
  }
  detail = projected.detail
  modules = projected.modules
  const config = detail?.configs?.[selection.config] || null
  const slots = presetSlots(modules, catalog)
  const netScript = catalog?.devices?.find((device: { stem: string }) => device.stem === 'camouflageNet')?.script?.params || null
  const paint = catalog?.camouflage?.categories?.[catalog.camouflage.defaultCategory] || null
  const deviceIds = resolveDeviceIds(slots, selection.devices, catalog?.devices)
  return {
    modules,
    turretIdx: selection.turret,
    gunIdx: selection.gun,
    engineIdx: selection.engine,
    trackIdx: selection.track,
    // 车体转速公式的功率比基准始终取初始发动机：custom 部分研发同样要传，否则投影后
    // 的发动机功率会被当成基准、抵消掉转向加成（top 与 custom 同口径）。
    ...(projected.selection.available && projected.selection.supported
      && (projected.selection.mode === 'top' || projected.selection.mode === 'custom')
      && Number.isFinite(stockEnginePower) ? { stockEnginePower } : {}),
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
    conditionalSkills: selection.conditionalSkills === true,
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
    // delta 基准始终是 stock：XI 的缺省模式已改为 top，这里必须显式钉住
    // （否则 baseSelection 会被 resolveUpgradeSelection 的缺省值带成 top）。
    ...(modules.tier === 11 ? { upgrade: 'stock' as const } : {}),
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
    conditionalSkills: false,
    camouflage: false,
  }
}

/** 切炮塔：保留同 stem 的炮（存在时），否则该炮塔首炮 → 写回对应 config。 */
export function pickTurret(selection: SetupSelection, modules: any, detail: any, turretIndex: number): SetupSelection {
  const turret = modules?.turrets?.[turretIndex]
  if (!turret) return selection
  const currentGun = modules?.turrets?.[selection.turret]?.guns?.[selection.gun]
  const guns = turret.guns || []
  const sameGun = guns.findIndex((g: { stem?: string } | null) => g?.stem === currentGun?.stem)
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
