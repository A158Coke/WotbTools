/** XI 客户端升级节点的选择与静态投影；普通车计算公式仍由 characteristics 负责。 */
export type UpgradeMode = 'stock' | 'top' | 'custom'
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

/**
 * XI 缺省 top（产品口径：坦克卡片/详情/装甲查看器默认顶级）；显式 stock 仍可回退，
 * 非法值按 stock 处理（旧链接兼容）。满级只选择每个备选组的一项，绝不叠加互斥技能。
 */
export function resolveUpgradeSelection(modules: unknown, mode?: unknown, inputChoices?: unknown): UpgradeSelection {
  const absent = mode == null || mode === ''
  const explicit = mode === 'top' ? 'top' : mode === 'stock' ? 'stock' : mode === 'custom' ? 'custom' : null
  const defaultMode = absent && record(modules) && modules.tier === 11 ? 'top' : 'stock'
  const result = emptySelection(explicit ?? defaultMode)
  if (!record(modules) || modules.tier !== 11 || !('upgradeProgression' in modules)) return result
  result.available = true
  const progression = modules.upgradeProgression
  const fail = (message: string) => { result.unsupported.push(message); result.supported = false }
  if (!record(progression) || !Array.isArray(progression.nodes) || !progression.nodes.length
    || !Array.isArray(progression.alternativeGroups) || !record(progression.attributeDefinitions)) {
    fail('Invalid upgradeProgression'); return result
  }
  if (typeof modules.gameVersion !== 'string' || !modules.gameVersion
    || !record(progression.provenance) || progression.provenance.gameVersion !== modules.gameVersion) {
    fail('Upgrade data version does not match vehicle modules'); return result
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
    requested = /^\d+(?:,\d+){0,63}$/.test(requested) ? requested.split(',').map(Number) : []
  }
  const custom = result.mode === 'custom'
  // custom：abilities = 已研发节点 id 表，投影边界统一规范化为两类不变量：
  // 1) 前置闭包——客户端不存在“节点已研发但前置未研发”的状态。深链/手写 URL 只给
  //    部分节点时，前置由“已研发”这一事实蕴含，按同一规则补齐（不是逐例判断）；
  //    前置不可解析（数据缺失）的节点整颗拒绝（fail-closed），不做部分接受。
  // 2) 组互斥——每组只保留组定义顺序的首个已研发备选，其余同组备选不写入结果、
  //    不参与聚合；手工构造的 URL（如 abilities=22,23,24）不能叠出互斥效果。
  let researched: Set<number> | null = null
  if (custom) {
    const nodesByTech = new Map(result.nodes.map(node => [node.techName, node]))
    const nodesById = new Map(result.nodes.map(node => [node.id, node]))
    /** 该节点 + 全部直接/间接前置；任一前置不可解析返回 null（整颗拒绝）。 */
    const prerequisiteClosure = (id: number): Set<number> | null => {
      const start = nodesById.get(id)
      if (!start) return null
      const out = new Set<number>()
      const seen = new Set<string>()
      const stack = [start]
      while (stack.length) {
        const node = stack.pop()!
        if (seen.has(node.techName)) continue
        seen.add(node.techName)
        out.add(node.id)
        for (const req of Array.isArray(node.requiredNodes) ? (node.requiredNodes as string[]) : []) {
          const up = nodesByTech.get(req)
          if (!up) return null
          stack.push(up)
        }
      }
      return out
    }
    const set = new Set<number>()
    for (const id of Array.isArray(requested) ? requested : []) {
      if (!ids.has(id)) continue
      prerequisiteClosure(id)?.forEach(nodeId => set.add(nodeId))
    }
    for (const group of result.groups) {
      if (!group.choices.some(id => set.has(id))) continue
      // 组级 requiredNodes 同样属于闭包；不可解析时整组不激活（清掉该组备选）
      let resolvable = true
      for (const req of Array.isArray(group.requiredNodes) ? (group.requiredNodes as string[]) : []) {
        const up = nodesByTech.get(req)
        const closure = up ? prerequisiteClosure(up.id) : null
        if (!closure) { resolvable = false; break }
        closure.forEach(nodeId => set.add(nodeId))
      }
      if (!resolvable) group.choices.forEach(id => set.delete(id))
    }
    for (const group of result.groups) {
      group.choices.filter(id => set.has(id)).slice(1).forEach(id => set.delete(id))
    }
    researched = set
  }
  for (const group of result.groups) {
    if (custom) {
      // 组内已研发的备选即选中（可未选）：未研发/未选时不写 choices/abilities
      // （机制不生效，面板显示基础值）
      const candidate = group.choices.find(id => researched!.has(id))
      if (candidate != null) { result.choices[group.id] = candidate; result.abilities.push(candidate) }
      continue
    }
    // custom→top/stock 切换时 abilities 是完整已研发表（至多 64 项），备选可能排在
    // 前置节点之后；按全表找已选备选，避免晚于第 8 位的选择被重置成默认项。
    const candidate = Array.isArray(requested)
      ? requested.find(id => group.choices.includes(id))
      : record(requested) ? requested[group.id] : undefined
    const chosen = typeof candidate === 'number' && group.choices.includes(candidate) ? candidate : group.choices[0]!
    result.choices[group.id] = chosen; result.abilities.push(chosen)
  }
  if (custom) {
    // custom（部分研发）：abilities 携带归一化后的完整已研发表——resolveSetup 往返、
    // 配置栏/研发树联动都依赖它（互斥归一化在上面完成，写回的 URL 不含同组多选）
    result.abilities = researched ? [...researched] : []
  }
  if (!result.supported || result.mode === 'stock') return result
  const active = custom && researched ? researched : new Set(result.abilities)
  for (const node of result.nodes) {
    // custom（部分研发）：只聚合已研发节点；top：全部普通/机制节点 + 已选备选
    if (custom ? !active.has(node.id)
      : node.type === 'NODETYPE_ALTERNATIVE_MECHANIC' && !active.has(node.id)) continue
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

export const HIT_TRIGGER_ATTRIBUTES = new Set([
  'SAS_ALLOW_ACTIVATE_ON_HIT',
  'EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS',
])

function shotInterval(clip: unknown): number | null {
  if (!record(clip) || !finite(clip.count) || !Number.isInteger(clip.count) || clip.count < 2
    || !finite(clip.rate) || clip.rate <= 0) return null
  const seconds = 60 / clip.rate
  return finite(seconds) ? seconds : null
}

function mainGunClipInterval(_item: Data, modules: Data): number | null {
  const guns = records(modules.turrets).flatMap(turret => records(turret.guns))
  // 车辆级机制只展示唯一主炮的参数，多炮时不能猜正在使用哪一门。
  return guns.length === 1 ? shotInterval(child(guns[0], 'stats')?.clip) : null
}

type MechanicParameter = string | ((item: Data, modules: Data) => number | null)

function auxiliaryValue(field: 'reloadTime' | 'clip' | 'burst' | 'damage' | 'speed' | 'acceleration'): MechanicParameter {
  return item => {
    const reference = child(child(item, 'script'), 'params')?.gun
    const gun = child(item, 'auxiliaryGun')
    if (typeof reference !== 'string' || !reference.trim() || !gun || gun.reference !== reference) return null
    if (field === 'clip' || field === 'burst') return shotInterval(gun[field])
    if (field === 'reloadTime') return finite(gun.reloadTime) ? gun.reloadTime : null
    // 当前两门副武器各有一发明确引用的弹种。若将来有多弹种，需要选择上下文。
    if (!Array.isArray(gun.shots) || gun.shots.length !== 1) return null
    const shot = gun.shots[0]
    if (!record(shot) || typeof shot.stem !== 'string' || !shot.stem.trim()) return null
    return finite(shot[field]) ? shot[field] : null
  }
}

/** 客户端属性与内建机制来源的已核对映射；不按车辆名称或等级猜绑定。 */
const MECHANIC_PARAMETERS: Record<string, [string, string, MechanicParameter]> = {
  EXTERNAL_AMMO_MODULE_GUN_IN_CLIP_RELOAD_TIME: ['provisions', 'externalAmmoModule', mainGunClipInterval],
  EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS: ['provisions', 'externalAmmoModule', 'allowNonDamagingHits'],
  SHELL_OVERHEAT_ACTIVATION_DELAY: ['provisions', 'shellOverheat', 'chargeActivationDelay'],
  SHELL_OVERHEAT_CHARGE_TIME: ['provisions', 'shellOverheat', 'maxChargeAccumulationTimeFromStart'],
  SHELL_OVERHEAT_MAX_TANK_SPEED: ['provisions', 'shellOverheat', 'maxSpeedForChargeAccumulation'],
  SHELL_OVERHEAT_MIN_ALPHA_BOOST: ['provisions', 'shellOverheat', 'maxBoostToMinimumAlpha'],
  AUXILLIARY_WEAPONS_GUN_BURST_INTERVAL: ['consumables', 'auxilliaryWeapons', auxiliaryValue('burst')],
  AUXILLIARY_WEAPONS_GUN_DAMAGE: ['consumables', 'auxilliaryWeapons', auxiliaryValue('damage')],
  AUXILLIARY_WEAPONS_GUN_RELOAD_TIME: ['consumables', 'auxilliaryWeapons', auxiliaryValue('reloadTime')],
  UNGUIDED_ROCKET_ACCELERATION: ['consumables', 'unguidedRocket', auxiliaryValue('acceleration')],
  UNGUIDED_ROCKET_CONTAINER_RELOAD: ['consumables', 'unguidedRocket', auxiliaryValue('reloadTime')],
  UNGUIDED_ROCKET_DAMAGE: ['consumables', 'unguidedRocket', auxiliaryValue('damage')],
  UNGUIDED_ROCKET_INITIAL_SPEED: ['consumables', 'unguidedRocket', auxiliaryValue('speed')],
  UNGUIDED_ROCKET_INTERCLIP_RELOAD: ['consumables', 'unguidedRocket', auxiliaryValue('clip')],
  BURST_MODE_REQUIRED_PENETRATIONS: ['provisions', 'burstMode', 'requiredDamagingPenetrations'],
  BURST_MODE_INTERVAL: ['provisions', 'burstMode', 'burstInterval'],
  BURST_MODE_TARGET_ORDER: ['provisions', 'burstMode', 'targetOrder'],
  COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK: ['provisions', 'combatFrenzy', 'reloadSpeedBonusPerStack'],
  COMBAT_FRENZY_MAX_STACKS: ['provisions', 'combatFrenzy', 'maxStacks'],
  COMBAT_FRENZY_ALLOW_SWITCH_AFTER_KILL: ['provisions', 'combatFrenzy', 'allowSwitchAfterKill'],
  RAMMING_CONFIGURATION_RAMMING_DAMAGE_BONUS: ['provisions', 'rammingConfiguration', 'rammingDamageBonus'],
  RAMMING_CONFIGURATION_RAMMING_TRACK_DAMAGE_BONUS: ['provisions', 'rammingConfiguration', 'rammingTrackDamageBonus'],
  RAMMING_CONFIGURATION_RAMMING_DAMAGE_REDUCTION: ['provisions', 'rammingConfiguration', 'rammingDamageReduction'],
  SAS_DURATION: ['provisions', 'steadyAimSystem', 'duration'],
  SAS_AIMING_SPEED: ['provisions', 'steadyAimSystem', 'aimingSpeed'],
  SAS_GUN_DISPERSION: ['provisions', 'steadyAimSystem', 'gunDispersionModifier'],
  SAS_ALLOW_ACTIVATE_ON_HIT: ['provisions', 'steadyAimSystem', 'activateWithoutDamage'],
  RECHARGEABLE_NITRO_COOLING_DURATION: ['consumables', 'rechargeableNitro', 'coolingDuration'],
  RECHARGEABLE_NITRO_HEATING_DURATION: ['consumables', 'rechargeableNitro', 'duration'],
  RECHARGEABLE_NITRO_FWD_SPEED_LIMIT_FACTOR: ['consumables', 'rechargeableNitro', 'fwdSpeedLimitFactor'],
  RECHARGEABLE_NITRO_ROTATION_SPEED_FACTOR: ['consumables', 'rechargeableNitro', 'rotationSpeedFactor'],
  // t11r3 四个新机制：只登记物品 `<script>` 里确有同义参数的属性（副炮/火箭的伤害、
  // 装填来自各自 gun 定义，物品脚本无此参数 → 不登记，面板只显示升级改变量）。
  SHELL_OVERHEAT_MAX_TANK_SPEED: ['provisions', 'shellOverheat', 'maxSpeedForChargeAccumulation'],
  SHELL_OVERHEAT_ACTIVATION_DELAY: ['provisions', 'shellOverheat', 'chargeActivationDelay'],
  SHELL_OVERHEAT_CHARGE_TIME: ['provisions', 'shellOverheat', 'maxChargeAccumulationTimeFromStart'],
  SHELL_OVERHEAT_MIN_ALPHA_BOOST: ['provisions', 'shellOverheat', 'maxBoostToMinimumAlpha'],
  EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS: ['provisions', 'externalAmmoModule', 'allowNonDamagingHits'],
}

function mechanicInitial(name: string, modifier: UpgradeDefinition['modifier'], modules: unknown, catalog: unknown): UpgradeValue | null {
  const mapping = MECHANIC_PARAMETERS[name]
  if (!mapping || !record(modules) || !record(catalog)) return null
  const [kind, ability, parameter] = mapping
  if (typeof modules.gameVersion !== 'string' || !modules.gameVersion
    || catalog[`${kind}GameVersion`] !== modules.gameVersion
    || !Array.isArray(modules.vehicleAbilities) || !modules.vehicleAbilities.includes(ability)) return null
  const item = records(catalog[kind]).find(item => item.stem === ability && item.isAbility === true)
  if (!item) return null
  const raw = typeof parameter === 'function' ? parameter(item, modules) : child(child(item, 'script'), 'params')?.[parameter]
  if (modifier === 'MODIFIER_BOOLEAN') {
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'string' && /^(true|false)$/i.test(raw.trim())) return raw.trim().toLowerCase() === 'true'
    return null
  }
  if (finite(raw)) return raw
  return typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null
}

/** 同版机制基础值 + 升级变化；无来源的基值返回 null，仍可展示已知改变量。 */
export function upgradeMechanicEffects(selection: UpgradeSelection, modules?: unknown, catalog?: unknown): Array<{
  name: string; modifier: UpgradeDefinition['modifier']; current: UpgradeValue | null
  initial: UpgradeValue | null; value: UpgradeValue | null
}> {
  if (!selection.available || !selection.supported) return []
  const names = new Set(selection.nodes.flatMap(node => node.attributes
    .filter(attr => !selection.attributeDefinitions[attr.name]?.script).map(attr => attr.name)))
  return [...names].map(name => {
    const modifier = selection.attributeDefinitions[name]!.modifier
    const current = selection.mechanicsAttributes[name] ?? null
    const initial = mechanicInitial(name, modifier, modules, catalog)
    const value = initial == null ? null : current == null ? initial
      : modifier === 'MODIFIER_BOOLEAN' ? current
        : modifier === 'MODIFIER_MULTIPLY' ? Number(initial) * Number(current) : Number(initial) + Number(current)
    return { name, modifier, current, initial, value }
  })
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
  // 弹种伤害/装填被节点改过之后，`dpm` 与 `standard_damage` 必须同一次重算——否则
  // 同一页会出现“伤害 600 / 装填 11.5 / DPM 2732”这种三量互不成立的组合（2732 是
  // stock 的 560×60/12.3）。口径与包内 `dump-tank-data` 完全一致：标准弹 = 优先 ap、
  // 否则首个非金币弹、再否则最大伤害；DPM = 标准弹伤害 × 60 / 装填（连发炮恒为 null）。
  if (configs.length) {
    configs.forEach(cfg => {
      if (!record(cfg) || !Array.isArray(cfg.shells)) return
      const standard = standardDamageOf(cfg.shells)
      if (standard != null) change(cfg, 'standard_damage', () => standard)
      // 连发炮（包内 `is_burst`）的 dpm 恒为 null——投影同样置空，不保留可能过期的数字。
      if (cfg.is_burst === true) { cfg.dpm = null; return }
      const reload = cfg.reload_time
      if (!finite(reload) || reload <= 0) return
      if (standard != null) change(cfg, 'dpm', () => Math.round(standard * 60 / reload))
    })
  }
  return { detail: projectedDetail, modules: projectedModules, selection }
}

/**
 * 配置的“标准弹”伤害（DPM/Alpha 基准）：与 Rust `dump-tank-data` 同序——优先 `ap`、
 * 否则首个非金币弹（type 含 premium 不算）、再否则最大伤害；整表不可解析返回 null。
 */
function standardDamageOf(shells: unknown[]): number | null {
  const rows = shells.filter(record)
  if (!rows.length) return null
  const damage = (row: Data): number | null => (typeof row.type === 'string' && finite(row.damage) ? row.damage : null)
  const ap = rows.find(row => row.type === 'ap')
  if (ap) { const d = damage(ap); if (d != null) return d }
  const nonPremium = rows.find(row => typeof row.type === 'string' && !row.type.includes('premium'))
  if (nonPremium) { const d = damage(nonPremium); if (d != null) return d }
  const values = rows.map(damage).filter((v): v is number => v != null)
  return values.length ? Math.max(...values) : null
}
