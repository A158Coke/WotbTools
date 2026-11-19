import type { UpgradeAttribute, UpgradeDefinition, UpgradeMode, UpgradeNode, UpgradeSelection } from './tankUpgradeTypes'
import { finite, record } from './tankUpgradeData'

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

/** Cost from stock to full research. The validated selection owns node identities and group membership. */
export function fullResearchXp(selection: UpgradeSelection): number | null {
  if (!selection.available || !selection.supported) return null
  const required = new Map(selection.nodes.map(node => [node.techName, node]))
  if (required.size !== selection.nodes.length) return null

  const paid = new Set<string>()
  const visiting = new Set<string>()
  let total = 0
  function charge(cost: unknown): boolean {
    if (typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 0) return false
    total += cost
    return Number.isSafeInteger(total)
  }
  function prerequisitesValid(refs: unknown): boolean {
    return refs === undefined || (Array.isArray(refs) && refs.every(name => {
      const node = required.get(name)
      return node && node.type !== 'NODETYPE_ALTERNATIVE_MECHANIC' && visit(node)
    }))
  }
  function visit(node: UpgradeNode): boolean {
    if (paid.has(node.techName)) return true
    if (visiting.has(node.techName)) return false
    visiting.add(node.techName)
    if (!prerequisitesValid(node.requiredNodes)) return false
    if (node.type === 'NODETYPE_ALTERNATIVE_MECHANIC') {
      if ('xpCost' in node) return false
    } else if (!charge(node.xpCost)) return false
    visiting.delete(node.techName)
    paid.add(node.techName)
    return true
  }

  if (!selection.nodes.every(visit)) return null
  for (const group of selection.groups) {
    if (!prerequisitesValid(group.requiredNodes) || !charge(group.xpCost)) return null
  }
  return total
}
