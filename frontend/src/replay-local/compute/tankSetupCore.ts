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

function normBearing(deg: number) {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

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

export function armorFactorFor(deviceIds: number[], catalog: any) {
  if (!deviceIds.includes(110)) return 1
  const device = catalog?.devices?.find((item: { id: number }) => item.id === 110)
  const percent = Number(device?.script?.params?.bonusValues?.percent)
  return Number.isFinite(percent) && percent > 0 ? 1 + percent / 100 : 1
}

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

export function buildComputeInput({ detail, modules, selection, catalog }: {
  detail: any
  modules: any
  selection: SetupSelection
  catalog: any
}): ComputeInput {
  const stockEnginePower = Number(modules?.engines?.[0]?.stats?.power)
  const projected = projectTankUpgrades(detail, modules, selection.upgrade, selection.abilities)
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

export function baseSelection({ detail, modules }: { detail: any; modules: any }): SetupSelection | null {
  const configs = detail?.configs || []
  if (!modules || configs.length === 0) return null
  const cur = configs[0]
  const turret = findTurretIndex(modules, cur?.turret_local)
  const gun = findGunIndex(modules.turrets?.[turret], cur?.gun_local)
  if (turret < 0 || gun < 0) return null
  return {
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

export function pickGun(selection: SetupSelection, modules: any, detail: any, gunIndex: number): SetupSelection {
  const turret = modules?.turrets?.[selection.turret]
  const gun = turret?.guns?.[gunIndex]
  if (!gun) return selection
  const config = configIndexFor(detail?.configs || [], turret?.localId, gun?.localId)
  if (config < 0) return selection
  return { ...selection, config, gun: gunIndex, shell: defaultShellIndex(detail?.configs?.[config]) }
}
