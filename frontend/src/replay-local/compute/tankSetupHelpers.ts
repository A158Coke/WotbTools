export const DEVICE_SLOT_COUNT = 9
const EMPTY_DEVICE = '-'

export function findTankModules(nationData: any, tankId: number) {
  const tanks = nationData?.tanks
  if (!tanks) return null
  for (const key of Object.keys(tanks)) {
    if (Number(tanks[key]?.tankId) === Number(tankId)) return { ...tanks[key], stem: key }
  }
  return null
}

export function configIndexFor(configs: any[], turretLocal: number | null, gunLocal: number | null) {
  if (!Array.isArray(configs) || turretLocal == null || gunLocal == null) return -1
  return configs.findIndex(c => Number(c?.turret_local) === Number(turretLocal)
    && Number(c?.gun_local) === Number(gunLocal))
}

export function findTurretIndex(modules: any, localId: number | null) {
  if (localId == null) return -1
  return (modules?.turrets || []).findIndex((t: { localId?: unknown }) => Number(t?.localId) === Number(localId))
}

export function findGunIndex(turret: any, localId: number | null) {
  if (localId == null) return -1
  return (turret?.guns || []).findIndex((g: { localId?: unknown }) => Number(g?.localId) === Number(localId))
}

export function decodeDevices(raw: string | null | undefined): Array<0 | 1 | null> {
  const text = typeof raw === 'string' ? raw : ''
  return Array.from({ length: DEVICE_SLOT_COUNT }, (_, i) => {
    const ch = text[i]
    return ch === '0' ? 0 : ch === '1' ? 1 : null
  })
}

export function encodeDevices(devices: Array<0 | 1 | null>): string {
  const chars = Array.from({ length: DEVICE_SLOT_COUNT }, (_, i) => {
    const v = devices?.[i]
    return v === 0 ? '0' : v === 1 ? '1' : EMPTY_DEVICE
  })
  return chars.join('').replace(/-+$/, '')
}

export function gunCycleOf(config: any) {
  if (!config) return null
  const reload = Number(config.reload_time) || 0
  const intraClip = Number(config.burst_interval) || 0
  const shellCount = Number(config.burst_size) || 0
  const shellReloads = Array.isArray(config.burst_reloads)
    ? config.burst_reloads.map(Number).filter((value: number) => Number.isFinite(value) && value > 0)
    : []
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

export function defaultShellIndex(config: any) {
  const shells = config?.shells
  if (!Array.isArray(shells) || shells.length === 0) return 0
  const index = shells.findIndex(s => s?.type === 'ap' || s?.type === 'ap_cr')
  if (index >= 0) return index
  const apFamily = shells.findIndex(s => /^ap/.test(String(s?.type || '')))
  return apFamily >= 0 ? apFamily : 0
}

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

export function tankRef(detail: any, modules?: any) {
  const configs = Array.isArray(detail?.configs) ? detail.configs : []
  const clip = configs.some((config: { is_drum?: boolean; is_burst?: boolean } | null) => config?.is_drum || config?.is_burst)
  return {
    nation: detail?.nation || 'unknown',
    stem: modules?.stem || detail?.stem || null,
    tankId: detail?.tank_id ?? detail?.tankId ?? modules?.tankId ?? null,
    tier: Number(detail?.tier) || 0,
    tags: [...(Array.isArray(detail?.tags) ? detail.tags : []), ...(clip ? ['clip'] : [])],
  }
}

export function presetSlots(modules: any, catalog: any) {
  const presets = catalog?.devicePresets || {}
  return presets[modules?.optDevicePreset] || presets.defaultPreset || []
}

type PitchPresetSlot = { left?: string | null; right?: string | null }
type PitchPresetCatalog = { devicePresets?: Record<string, PitchPresetSlot[]> }
type PitchModules = { optDevicePreset?: string }
type PitchDeviceCatalog = {
  devices?: Array<{
    id?: number
    script?: { params?: { bonusValues?: { upperPitchLimitIncrease?: unknown; lowerPitchLimitIncrease?: unknown } } }
  }>
}

export function presetProvidesPitchDevice(
  modules: PitchModules | null | undefined,
  catalog: PitchPresetCatalog | null | undefined,
) {
  return presetSlots(modules, catalog).some(
    (slot: PitchPresetSlot) => slot?.left === 'improvedPitchLimitsSystem' || slot?.right === 'improvedPitchLimitsSystem',
  )
}

export function resolvePitchDeviceEffective(input: {
  available: unknown
  override: boolean | null | undefined
  recorded: boolean | null | undefined
  checkboxChecked?: unknown
}) {
  if (!input.available) return false
  if (input.override != null) return !!input.override
  if (input.recorded != null) return !!input.recorded
  return !!input.checkboxChecked
}

export function resolvePitchCheckboxChecked(input: {
  override: boolean | null | undefined
  recorded: boolean | null | undefined
}) {
  if (input.override != null) return !!input.override
  return input.recorded != null ? !!input.recorded : false
}

export function pitchDeviceBonus(deviceIds: Iterable<number>, catalog: PitchDeviceCatalog | null | undefined) {
  const ids = new Set(deviceIds)
  if (!ids.has(122)) return null
  const item = catalog?.devices?.find((device) => device.id === 122)
  const params = item?.script?.params?.bonusValues
  const up = Number(params?.upperPitchLimitIncrease)
  const down = Number(params?.lowerPitchLimitIncrease)
  if (!Number.isFinite(up) || !Number.isFinite(down)) return null
  return { up, down }
}

export function recordedTargetMatchesShot(
  shot: { target_tank_id?: unknown } | null | undefined,
  targetId: unknown,
) {
  const shotTarget = Number(shot?.target_tank_id)
  const selected = Number(targetId)
  return Number.isInteger(shotTarget) && shotTarget > 0 && shotTarget === selected
}

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
