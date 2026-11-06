/** XI 客户端升级节点的选择与静态投影；普通车计算公式仍由 characteristics 负责。 */
export type UpgradeMode = 'stock' | 'top'
export type UpgradeValue = number | boolean
export interface UpgradeAttribute { name: string; value: UpgradeValue }
export interface UpgradeNode {
  id: number
  techName: string
  type: 'NODETYPE_COMMON' | 'NODETYPE_MECHANIC' | 'NODETYPE_ALTERNATIVE_MECHANIC'
  attributes: UpgradeAttribute[]
  [key: string]: unknown
}
export interface UpgradeGroup { id: string; choices: number[]; [key: string]: unknown }
export interface UpgradeDefinition {
  modifier: 'MODIFIER_ADD' | 'MODIFIER_MULTIPLY' | 'MODIFIER_BOOLEAN'
  script?: string
  params?: Record<string, string>
  [key: string]: unknown
}
export interface UpgradeSelection {
  available: boolean
  supported: boolean
  mode: UpgradeMode
  choices: Record<string, number>
  abilities: number[]
  attributes: Record<string, UpgradeValue>
  /** 动态技能及未进入现有静态面板的内部模块属性，不假定技能已触发。 */
  mechanicsAttributes: Record<string, UpgradeValue>
  unsupported: string[]
  nodes: UpgradeNode[]
  groups: UpgradeGroup[]
  attributeDefinitions: Record<string, UpgradeDefinition>
}

type Data = Record<string, unknown>
function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function records(value: unknown): Data[] { return Array.isArray(value) ? value.filter(record) : [] }
function child(value: unknown, key: string): Data | undefined {
  return record(value) && record(value[key]) ? value[key] : undefined
}
function cloneData<T>(value: T): T {
  // 资产是 JSON；递归读取同时支持 Vue reactive proxy（structuredClone 不接受 proxy）。
  if (Array.isArray(value)) return value.map(item => cloneData(item)) as T
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)])) as T
  return value
}

function emptySelection(mode: UpgradeMode): UpgradeSelection {
  return { available: false, supported: true, mode, choices: {}, abilities: [], attributes: {},
    mechanicsAttributes: {}, unsupported: [], nodes: [], groups: [], attributeDefinitions: {} }
}

/** 只接受客户端定义过的静态脚本及参数；新增未知脚本须显式适配。 */
function supports(def: UpgradeDefinition): boolean {
  if (!def.script) return true // 客户端无静态 script 的字段属于战斗机械技能。
  const p = def.params || {}
  switch (def.script) {
    case 'MaxHealthUpgrade': case 'EnginePowerUpgrade': case 'FireStartChangeUpgrade':
    case 'UpperPitchLimitsUpgrade': case 'LowerPitchLimitsUpgrade':
    case 'PumpGunReloadUpgrade': return def.modifier === 'MODIFIER_ADD'
    case 'SpeedLimitUpgrade': return def.modifier === 'MODIFIER_ADD' && ['forward', 'backward'].includes(p.type || '')
    case 'VehicleDataMiscAttrAdditiveBonus':
      return def.modifier === 'MODIFIER_ADD' && p.attrName === 'gunReloadTimeAdditiveBonus'
    case 'VehicleDataPhysicsMultiplicativeBonus':
      return def.modifier === 'MODIFIER_ADD' && p.attrName === 'rotationSpeedFactor'
    case 'VehicleDataMiscAttrMultiplicativeBonus':
      return def.modifier === 'MODIFIER_ADD' && ['armorHomogenizationFactor', 'shotDispersionAngleFactor',
        'gunAimingTimeFactor', 'turret/rotationSpeed'].includes(p.attrName || '')
    case 'TankFactorsUpgrade':
      return def.modifier === 'MODIFIER_MULTIPLY' && ['gun/shotDispersionFactors/turretRotation',
        'chassis/shotDispersion/movement/multFactor', 'chassis/shotDispersion/rotation/multFactor'].includes(p.factorName || '')
    case 'ShellDamageUpgrade': case 'ShellSpeedUpgrade':
      return def.modifier === 'MODIFIER_ADD' && /^[012]$/.test(p.slotIndex || '')
    case 'ShellPiercingPowerUpgrade':
      return def.modifier === 'MODIFIER_ADD' && /^[012]$/.test(p.slotIndex || '') && ['100', '500'].includes(p.distance || '')
    case 'DeviceAttributeUpgrade':
      // 模块耐久属于内部设备，不是炮塔承载的整车生命值 stats.maxHealth。
      return def.modifier === 'MODIFIER_MULTIPLY' && p.attrName === 'modulesMaxHpFactors'
        && ['engineHealth', 'ammoBayHealth', 'fuelTankHealth', 'gunHealth', 'surveyingDeviceHealth',
          'leftTrackHealth rightTrackHealth', 'turretRotatorHealth'].includes(p.devicesExtra || '')
    default: return false
  }
}

/** 缺省 stock 兼容旧链接；满级只选择每个备选组的一项，绝不叠加互斥技能。 */
export function resolveUpgradeSelection(modules: unknown, mode?: unknown, inputChoices?: unknown): UpgradeSelection {
  const result = emptySelection(mode === 'top' ? 'top' : 'stock')
  if (!record(modules) || modules.tier !== 11 || !('upgradeProgression' in modules)) return result
  result.available = true
  const progression = modules.upgradeProgression
  const fail = (message: string) => { result.unsupported.push(message); result.supported = false }
  if (!record(progression) || !Array.isArray(progression.nodes) || !progression.nodes.length
    || !Array.isArray(progression.alternativeGroups) || !record(progression.attributeDefinitions)) {
    fail('Invalid upgradeProgression'); return result
  }
  for (const [name, raw] of Object.entries(progression.attributeDefinitions)) {
    if (!record(raw) || !['MODIFIER_ADD', 'MODIFIER_MULTIPLY', 'MODIFIER_BOOLEAN'].includes(String(raw.modifier))
      || (raw.script != null && typeof raw.script !== 'string')
      || (raw.params != null && (!record(raw.params) || !Object.values(raw.params).every(v => typeof v === 'string')))) {
      fail(`Invalid attribute definition: ${name}`); continue
    }
    result.attributeDefinitions[name] = { ...raw, modifier: raw.modifier as UpgradeDefinition['modifier'],
      script: raw.script as string | undefined, params: raw.params as Record<string, string> | undefined }
  }
  const ids = new Set<number>()
  for (const raw of progression.nodes) {
    if (!record(raw) || !Number.isInteger(raw.id) || typeof raw.id !== 'number' || raw.id < 0 || ids.has(raw.id)
      || typeof raw.techName !== 'string' || !raw.techName
      || !['NODETYPE_COMMON', 'NODETYPE_MECHANIC', 'NODETYPE_ALTERNATIVE_MECHANIC'].includes(String(raw.type))
      || !Array.isArray(raw.attributes)) { fail('Invalid upgrade node'); continue }
    const attributes: UpgradeAttribute[] = []
    for (const attr of raw.attributes) {
      if (!record(attr) || typeof attr.name !== 'string' || (!finite(attr.value) && typeof attr.value !== 'boolean')) {
        fail(`Invalid attribute in node ${raw.id}`); continue
      }
      const def = result.attributeDefinitions[attr.name]
      if (!def || (def.modifier === 'MODIFIER_BOOLEAN') !== (typeof attr.value === 'boolean')) {
        fail(`Missing or incompatible definition: ${attr.name}`); continue
      }
      if (!supports(def)) fail(`Unsupported upgrade script: ${attr.name} (${def.script || ''})`)
      if (!def.script && attr.name.startsWith('ATTRIBUTE_NAME_')) fail(`Missing static upgrade script: ${attr.name}`)
      attributes.push({ name: attr.name, value: attr.value })
    }
    ids.add(raw.id)
    result.nodes.push({ ...raw, id: raw.id, techName: raw.techName, type: raw.type as UpgradeNode['type'], attributes })
  }
  const assigned = new Set<number>()
  const groupIds = new Set<string>()
  for (const raw of progression.alternativeGroups) {
    if (!record(raw) || typeof raw.id !== 'string' || !raw.id || groupIds.has(raw.id)
      || !Array.isArray(raw.choices) || !raw.choices.length || !raw.choices.every(id => typeof id === 'number'
        && Number.isInteger(id) && !assigned.has(id) && result.nodes.some(node => node.id === id
          && node.type === 'NODETYPE_ALTERNATIVE_MECHANIC')) || new Set(raw.choices).size !== raw.choices.length) {
      fail('Invalid alternative group'); continue
    }
    const choices: number[] = raw.choices
    choices.forEach(id => assigned.add(id)); groupIds.add(raw.id)
    result.groups.push({ ...raw, id: raw.id, choices: choices.slice() })
  }
  if (result.nodes.some(node => node.type === 'NODETYPE_ALTERNATIVE_MECHANIC' && !assigned.has(node.id))) {
    fail('Ungrouped alternative node')
  }
  let requested: unknown = inputChoices
  if (typeof requested === 'string') {
    requested = /^\d+(?:,\d+){0,7}$/.test(requested) ? requested.split(',').map(Number) : []
  }
  for (const group of result.groups) {
    const candidate = Array.isArray(requested)
      ? requested.slice(0, 8).find(id => group.choices.includes(id))
      : record(requested) ? requested[group.id] : undefined
    const chosen = typeof candidate === 'number' && group.choices.includes(candidate) ? candidate : group.choices[0]!
    result.choices[group.id] = chosen; result.abilities.push(chosen)
  }
  if (!result.supported || result.mode === 'stock') return result
  const active = new Set(result.abilities)
  for (const node of result.nodes) {
    if (node.type === 'NODETYPE_ALTERNATIVE_MECHANIC' && !active.has(node.id)) continue
    for (const { name, value } of node.attributes) {
      const def = result.attributeDefinitions[name]!
      const previous = result.attributes[name]
      result.attributes[name] = def.modifier === 'MODIFIER_BOOLEAN' ? Boolean(previous) || value === true
        : def.modifier === 'MODIFIER_ADD' ? (typeof previous === 'number' ? previous : 0) + Number(value)
          : (typeof previous === 'number' ? previous : 1) * Number(value)
      if (!def.script || def.script === 'DeviceAttributeUpgrade') result.mechanicsAttributes[name] = result.attributes[name]!
    }
  }
  if (Object.values(result.attributes).some(value => typeof value === 'number' && !Number.isFinite(value))) {
    fail('Non-finite upgrade aggregate')
  }
  return result
}

function change(target: Data | undefined, key: string, transform: (value: number) => number): void {
  if (target && finite(target[key])) target[key] = transform(target[key])
}
function changeAll(target: Data | undefined, transform: (value: number) => number): void {
  if (target) for (const key of Object.keys(target)) change(target, key, transform)
}
function changePitch(pitch: Data | undefined, up: number, down: number): void {
  if (!pitch) return
  change(pitch, 'min', value => value - up); change(pitch, 'max', value => value + down)
  // front/back 等扇区只有角度端点变化；yaw/from/to 等扇区边界保持原值。
  for (const [key, value] of Object.entries(pitch)) {
    if (key !== 'min' && key !== 'max' && record(value)) changePitch(value, up, down)
  }
}
function scaleArmor(detail: Data, factor: number): void {
  for (const section of ['hull', 'turret']) changeAll(child(detail.armor, section), value => value * factor)
  changeAll(child(child(detail, 'armor_model')?.hull, 'plates'), value => value * factor)
  for (const side of ['left_track', 'right_track']) change(child(detail.armor_model, 'chassis'), side, value => value * factor)
  for (const cfg of records(detail.configs)) {
    changeAll(child(cfg, 'turret_plates'), value => value * factor)
    changeAll(child(cfg, 'gun_plates'), value => value * factor)
    change(cfg, 'gun_thickness', value => value * factor)
  }
}

/**
 * 只在 detail 和 modules 均为 XI 且具可靠升级元数据时投影。
 * 未知脚本/坏数据不产生部分结果；调用方据 supported 显示不可用。
 */
export function projectTankUpgrades<D, M>(detail: D, modules: M, mode?: unknown, choices?: unknown): {
  detail: D; modules: M; selection: UpgradeSelection
} {
  const selection = resolveUpgradeSelection(modules, mode, choices)
  if (!record(detail) || detail.tier !== 11 || !selection.available || !selection.supported || selection.mode === 'stock') {
    return { detail, modules, selection }
  }
  const projectedDetail = cloneData(detail)
  const projectedModules = cloneData(modules)
  if (!record(projectedDetail) || !record(projectedModules)) return { detail, modules, selection }
  const configs = records(projectedDetail.configs)
  const engines = records(projectedModules.engines)
  const tracks = records(projectedModules.chassis)
  const turrets = records(projectedModules.turrets)
  const guns = turrets.flatMap(t => records(t.guns))
  const hasStats = (items: Data[], key: string) => items.length > 0 && items.every(item => finite(child(item, 'stats')?.[key]))
  const missing: string[] = []
  for (const name of Object.keys(selection.attributes)) {
    const def = selection.attributeDefinitions[name]!
    const p = def.params || {}
    let valid = true
    switch (def.script) {
      case 'MaxHealthUpgrade': valid = finite(child(projectedModules, 'hull')?.hp); break
      case 'EnginePowerUpgrade': valid = hasStats(engines, 'power'); break
      case 'FireStartChangeUpgrade': valid = hasStats(engines, 'fireStartingChance'); break
      case 'SpeedLimitUpgrade': valid = finite(child(projectedModules, 'speedLimits')?.[p.type!]); break
      case 'VehicleDataPhysicsMultiplicativeBonus': valid = hasStats(tracks, 'rotationSpeed'); break
      case 'VehicleDataMiscAttrAdditiveBonus': valid = hasStats(guns, 'reloadTime')
        && configs.length > 0 && configs.every(cfg => finite(cfg.reload_time)); break
      case 'PumpGunReloadUpgrade': valid = configs.length > 0 && configs.every(cfg => Array.isArray(cfg.burst_reloads)
        && cfg.burst_reloads.length > 0 && cfg.burst_reloads.every(finite)); break
      case 'UpperPitchLimitsUpgrade': case 'LowerPitchLimitsUpgrade':
        valid = guns.length > 0 && guns.every(gun => {
          const pitch = child(child(gun, 'stats'), 'pitchLimits'); return finite(pitch?.min) && finite(pitch?.max)
        }) && configs.length > 0 && configs.every(cfg => {
          const pitch = child(cfg, 'pitch_limits'); return finite(pitch?.min) && finite(pitch?.max)
        }); break
      case 'VehicleDataMiscAttrMultiplicativeBonus':
        if (p.attrName === 'shotDispersionAngleFactor') valid = hasStats(guns, 'shotDispersionRadius')
        if (p.attrName === 'gunAimingTimeFactor') valid = hasStats(guns, 'aimingTime')
        if (p.attrName === 'turret/rotationSpeed') valid = hasStats(turrets, 'rotationSpeed')
        if (p.attrName === 'armorHomogenizationFactor') valid = !!child(projectedDetail.armor, 'hull')
          || !!child(child(projectedDetail, 'armor_model')?.hull, 'plates')
        break
      case 'TankFactorsUpgrade': {
        const items = p.factorName?.startsWith('gun/') ? guns : tracks
        const key = p.factorName === 'gun/shotDispersionFactors/turretRotation' ? 'turretRotation'
          : p.factorName?.includes('/movement/') ? 'vehicleMovement' : 'vehicleRotation'
        valid = items.length > 0 && items.every(item => finite(child(child(item, 'stats'), 'dispersionFactors')?.[key])); break
      }
      case 'ShellDamageUpgrade': case 'ShellSpeedUpgrade': case 'ShellPiercingPowerUpgrade': {
        const key = def.script === 'ShellDamageUpgrade' ? 'damage' : def.script === 'ShellSpeedUpgrade' ? 'velocity'
          : p.distance === '500' ? 'penetration_far' : 'penetration'
        valid = configs.length > 0 && configs.every(cfg => {
          const shell: unknown = Array.isArray(cfg.shells) ? cfg.shells[Number(p.slotIndex)] : undefined
          return record(shell) && finite(shell[key])
        }); break
      }
    }
    if (!valid) missing.push(`Missing upgrade projection source: ${name}`)
  }
  if (missing.length) {
    selection.supported = false; selection.unsupported.push(...missing)
    return { detail, modules, selection }
  }
  const statChange = (items: Data[], key: string, fn: (n: number) => number) => items.forEach(item => change(child(item, 'stats'), key, fn))
  for (const [name, rawValue] of Object.entries(selection.attributes)) {
    const def = selection.attributeDefinitions[name]!
    if (!def.script || def.script === 'DeviceAttributeUpgrade' || typeof rawValue !== 'number') continue
    const value = rawValue
    const add = (n: number) => n + value
    const multiply = (n: number) => n * (1 + value)
    const p = def.params || {}
    switch (def.script) {
      case 'MaxHealthUpgrade': change(child(projectedModules, 'hull'), 'hp', add); change(projectedDetail, 'hp', add); break
      case 'EnginePowerUpgrade': statChange(engines, 'power', add); change(projectedDetail, 'engine_power', add); break
      // ADD 指节点奖励相加；FireStartChangeUpgrade 把总奖励乘到原始概率。
      case 'FireStartChangeUpgrade': statChange(engines, 'fireStartingChance', multiply); break
      case 'SpeedLimitUpgrade':
        change(child(projectedModules, 'speedLimits'), p.type!, add)
        change(projectedDetail, p.type === 'forward' ? 'speed_forward' : 'speed_reverse', add); break
      case 'VehicleDataPhysicsMultiplicativeBonus': statChange(tracks, 'rotationSpeed', multiply); break
      case 'VehicleDataMiscAttrAdditiveBonus':
        statChange(guns, 'reloadTime', add)
        configs.forEach(cfg => change(cfg, 'reload_time', add)); change(projectedDetail, 'reload_time', add); break
      case 'PumpGunReloadUpgrade':
        configs.forEach(cfg => { if (Array.isArray(cfg.burst_reloads)) cfg.burst_reloads = cfg.burst_reloads.map(v => finite(v) ? add(v) : v) }); break
      case 'UpperPitchLimitsUpgrade': case 'LowerPitchLimitsUpgrade': {
        const up = def.script === 'UpperPitchLimitsUpgrade' ? value : 0
        const down = def.script === 'LowerPitchLimitsUpgrade' ? value : 0
        guns.forEach(gun => changePitch(child(child(gun, 'stats'), 'pitchLimits'), up, down))
        configs.forEach(cfg => changePitch(child(cfg, 'pitch_limits'), up, down))
        change(projectedDetail, 'gun_elevation', n => n + up); change(projectedDetail, 'gun_depression', n => n + down)
        break
      }
      case 'VehicleDataMiscAttrMultiplicativeBonus':
        if (p.attrName === 'armorHomogenizationFactor') scaleArmor(projectedDetail, 1 + value)
        if (p.attrName === 'shotDispersionAngleFactor') {
          statChange(guns, 'shotDispersionRadius', multiply)
          configs.forEach(cfg => change(cfg, 'dispersion', multiply)); change(projectedDetail, 'dispersion', multiply)
        }
        if (p.attrName === 'gunAimingTimeFactor') {
          statChange(guns, 'aimingTime', multiply)
          configs.forEach(cfg => change(cfg, 'aim_time', multiply)); change(projectedDetail, 'aim_time', multiply)
        }
        if (p.attrName === 'turret/rotationSpeed') statChange(turrets, 'rotationSpeed', multiply)
        break
      case 'TankFactorsUpgrade': {
        const items = p.factorName?.startsWith('gun/') ? guns : tracks
        const key = p.factorName === 'gun/shotDispersionFactors/turretRotation' ? 'turretRotation'
          : p.factorName?.includes('/movement/') ? 'vehicleMovement' : 'vehicleRotation'
        items.forEach(item => change(child(child(item, 'stats'), 'dispersionFactors'), key, n => n * value))
        break
      }
      case 'ShellDamageUpgrade': case 'ShellSpeedUpgrade': case 'ShellPiercingPowerUpgrade': {
        const key = def.script === 'ShellDamageUpgrade' ? 'damage' : def.script === 'ShellSpeedUpgrade' ? 'velocity'
          : p.distance === '500' ? 'penetration_far' : 'penetration'
        configs.forEach(cfg => { if (Array.isArray(cfg.shells)) {
          const shell: unknown = cfg.shells[Number(p.slotIndex)]
          if (record(shell)) change(shell, key, add)
        } })
        break
      }
    }
  }
  return { detail: projectedDetail, modules: projectedModules, selection }
}
