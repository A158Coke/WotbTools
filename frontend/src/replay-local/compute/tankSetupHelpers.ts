export const DEVICE_SLOT_COUNT = 9
const EMPTY_DEVICE = '-'

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

export function findTurretIndex(modules: any, localId: number | null) {
  if (localId == null) return -1
  return (modules?.turrets || []).findIndex((t: { localId?: unknown }) => Number(t?.localId) === Number(localId))
}

export function findGunIndex(turret: any, localId: number | null) {
  if (localId == null) return -1
  return (turret?.guns || []).findIndex((g: { localId?: unknown }) => Number(g?.localId) === Number(localId))
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
    ? config.burst_reloads.map(Number).filter((value: number) => Number.isFinite(value) && value > 0)
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
  const clip = configs.some((config: { is_drum?: boolean; is_burst?: boolean } | null) => config?.is_drum || config?.is_burst)
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

type PitchPresetSlot = { left?: string | null; right?: string | null }
type PitchPresetCatalog = { devicePresets?: Record<string, PitchPresetSlot[]> }
type PitchModules = { optDevicePreset?: string }
type PitchDeviceCatalog = {
  devices?: Array<{
    id?: number
    script?: { params?: { bonusValues?: { upperPitchLimitIncrease?: unknown; lowerPitchLimitIncrease?: unknown } } }
  }>
}

/**
 * 该车预设是否提供 122「改进型垂直稳定器」（装甲查看器勾选可用性）。
 * 预设两侧是 stem（不是 id）；按 stem 对号，目录缺该车/预设时返回 false。
 */
export function presetProvidesPitchDevice(
  modules: PitchModules | null | undefined,
  catalog: PitchPresetCatalog | null | undefined,
) {
  return presetSlots(modules, catalog).some(
    (slot: PitchPresetSlot) => slot?.left === 'improvedPitchLimitsSystem' || slot?.right === 'improvedPitchLimitsSystem',
  )
}

/**
 * 122 是否真实生效（装甲查看器拖炮钳制 / HUD 的同一裁决）：
 * 可用性 fail-closed → 手动/URL 覆盖 → 当前目标录制真值 → 原生勾选回退。
 * `recorded === null` 表示无适用真值（非射击页或目标身份不符）。
 */
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

/**
 * 原生 `eq-pitch-device` 勾选回退态：覆盖优先，其次当前目标录制真值，
 * 否则默认关闭——不得保留上一辆车/已清 URL 的旧勾选（否则 effective 会
 * 从残留 checkbox 重新启用 122，与已清 URL 的 HUD 不一致）。
 */
export function resolvePitchCheckboxChecked(input: {
  override: boolean | null | undefined
  recorded: boolean | null | undefined
}) {
  if (input.override != null) return !!input.override
  return input.recorded != null ? !!input.recorded : false
}

/**
 * 装备 122 的俯仰加成（度）：`up` 加仰角上限、`down` 加俯角下限。
 * 数值来自客户端 `devices.json` 的 `bonusValues`（upperPitchLimitIncrease /
 * lowerPitchLimitIncrease）；未装/目录缺值 → null（fail-closed，不猜默认值）。
 */
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

/**
 * 回放装备真值只属于该枪记录的目标车：当前目标必须与 `target_tank_id` 一致。
 * 记录/当前目标缺失或非正整数时返回 false（fail-closed，不继承旧目标的装备真值）。
 */
export function recordedTargetMatchesShot(
  shot: { target_tank_id?: unknown } | null | undefined,
  targetId: unknown,
) {
  const shotTarget = Number(shot?.target_tank_id)
  const selected = Number(targetId)
  return Number.isInteger(shotTarget) && shotTarget > 0 && shotTarget === selected
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
