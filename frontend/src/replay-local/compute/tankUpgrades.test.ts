import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import TANKS from './__fixtures__/upgrades/tanks.json'
import MECHANICS from './__fixtures__/upgrades/mechanics.json'
import { computeCharacteristics } from './characteristics'
import { baseSelection, buildComputeInput } from './tankSetup'
import { parseTankopediaQuery } from '../../utils/tankopediaQuery.js'
import { parseAugmentProgression, researchGroupChoice } from './tankAugmentTree'
import { projectTankUpgrades, resolveUpgradeSelection, upgradeMechanicEffects } from './tankUpgrades'

const bz = TANKS.find(t => t.modules.tankId === 15153)!
const object432 = TANKS.find(t => t.modules.tankId === 27905)!
const kr = TANKS.find(t => t.modules.tankId === 28161)!
const black = TANKS.find(t => t.modules.tankId === 30241)!
const hacker = TANKS.find(t => t.modules.tankId === 30497)!

describe('XI 研发树 custom 模式（部分研发 ↔ 面板/配置栏联动）', () => {
  const bz = TANKS.find(t => t.modules.tankId === 15153)!
  const progression = bz.modules.upgradeProgression
  const techToId = new Map(progression.nodes.map(n => [n.techName, n.id]))
  const root = progression.nodes.find(n => n.gridPosition && !(n.requiredNodes ?? []).length)!

  it('custom：abilities 为已研发 id 表，只聚合已安装节点', () => {
    const rootId = techToId.get(root.techName)!
    const sel = resolveUpgradeSelection(bz.modules, 'custom', [rootId])
    expect(sel.available).toBe(true)
    expect(sel.mode).toBe('custom')
    const names = Object.keys(sel.attributes)
    expect(names.length).toBeGreaterThan(0)
    expect(sel.abilities).toEqual([rootId])
    expect(Object.values(sel.choices).flat()).toEqual([])
  })

  it('custom：安装组 + 备选后机制属性生效，前置闭包自动补齐', () => {
    const group = progression.alternativeGroups[0]
    const altId = group.choices[0]
    const sel = resolveUpgradeSelection(bz.modules, 'custom', [altId])
    expect(sel.choices[group.id]).toBe(altId)
    expect(sel.abilities).toContain(altId)
    for (const req of group.requiredNodes!) expect(sel.abilities).toContain(techToId.get(req)!)
    expect(sel.attributes.RECHARGEABLE_NITRO_HEATING_DURATION).toBe(5)
  })

  it('custom：未知 id 被忽略，不产生部分聚合', () => {
    const sel = resolveUpgradeSelection(bz.modules, 'custom', [999999, techToId.get(root.techName)!])
    expect(sel.supported).toBe(true)
    expect(sel.abilities).toEqual([techToId.get(root.techName)!])
  })

  it('custom：手工多选同组备选被归一化为每组一项，互斥效果不叠加', () => {
    const group = progression.alternativeGroups[0]!
    const sel = resolveUpgradeSelection(bz.modules, 'custom', [22, 23, 24])
    expect(sel.supported).toBe(true)
    expect(sel.choices[group.id]).toBe(group.choices[0])
    expect(sel.abilities).toContain(group.choices[0])
    expect(sel.abilities).not.toContain(group.choices[1])
    expect(sel.abilities).not.toContain(group.choices[2])
    for (const req of group.requiredNodes!) expect(sel.abilities).toContain(techToId.get(req)!)
    expect(sel.attributes.RECHARGEABLE_NITRO_HEATING_DURATION).toBe(5)
    expect(sel.attributes.RECHARGEABLE_NITRO_FWD_SPEED_LIMIT_FACTOR).not.toBe(0.15)
    expect(sel.attributes.RECHARGEABLE_NITRO_ROTATION_SPEED_FACTOR).toBeUndefined()
  })

  it('custom：真实 URL（parseTankopediaQuery）到投影全程保持互斥', () => {
    const parsed = parseTankopediaQuery({ tank: '15153', upgrade: 'custom', abilities: '22,23,24' })
    expect(parsed.abilities).toEqual([22, 23, 24])
    const sel = resolveUpgradeSelection(bz.modules, parsed.upgrade, parsed.abilities)
    expect(sel.abilities).toContain(22)
    expect(sel.abilities).not.toContain(23)
    expect(sel.abilities).not.toContain(24)
    const projected = projectTankUpgrades(bz.detail, bz.modules, sel.mode, sel.abilities)
    expect(projected.selection.choices[progression.alternativeGroups[0]!.id]).toBe(22)
    expect(projected.selection.attributes.RECHARGEABLE_NITRO_FWD_SPEED_LIMIT_FACTOR).not.toBe(0.15)
    expect(projected.selection.attributes.RECHARGEABLE_NITRO_ROTATION_SPEED_FACTOR).toBeUndefined()
  })

  it('custom 深链缺前置：投影边界补前置闭包（含组级 requiredNodes）', () => {
    const group = progression.alternativeGroups[0]!
    const sel = resolveUpgradeSelection(bz.modules, 'custom', '1,22')
    expect(sel.supported).toBe(true)
    expect(sel.choices[group.id]).toBe(22)
    for (const req of group.requiredNodes!) {
      expect(sel.abilities).toContain(techToId.get(req)!)
    }
    const engine = resolveUpgradeSelection(bz.modules, 'custom', [12])
    const engineNode = progression.nodes.find(node => node.id === 12)!
    const nodeByTech = new Map(progression.nodes.map(node => [node.techName, node]))
    for (const req of engineNode.requiredNodes ?? []) {
      expect(engine.abilities).toContain(nodeByTech.get(req)!.id)
    }
    expect(engine.attributes.ATTRIBUTE_NAME_ENGINE_POWER).toBe(50)
  })

  it('researchWithPrerequisites 能修复已存在的孤立节点（已装入也继续补祖先）', () => {
    const parsed = parseAugmentProgression(bz.modules)!
    const group = parsed.alternativeGroups[0]!
    const byTech = new Map(parsed.nodes.map(node => [node.techName, node]))
    const orphans = new Set<number>(group.requiredNodes!.map(req => byTech.get(req)!.id))
    const next = researchGroupChoice(parsed, group.id, group.choices[0]!, orphans)
    for (const id of orphans) {
      const node = parsed.nodes.find(item => item.id === id)!
      for (const req of node.requiredNodes ?? []) expect(next.has(byTech.get(req)!.id)).toBe(true)
    }
    expect(next.has(group.choices[0]!)).toBe(true)
  })

  it('custom→top/stock 切换时保留已选备选（备选位于长表后段也不丢）', () => {
    const group = progression.alternativeGroups[0]!
    const chosen = group.choices[2]!
    const longList = [...progression.nodes.filter(n => n.gridPosition).slice(0, 8).map(n => n.id), chosen]
    expect(longList.indexOf(chosen)).toBeGreaterThanOrEqual(8)
    const top = resolveUpgradeSelection(bz.modules, 'top', longList)
    expect(top.choices[group.id]).toBe(chosen)
    expect(top.abilities).toEqual([chosen])
    const stock = resolveUpgradeSelection(bz.modules, 'stock', longList)
    expect(stock.choices[group.id]).toBe(chosen)
  })

  it('custom 部分研发的引擎功率升级计入车体转向（stock 功率仍是基准）', () => {
    const sel = resolveUpgradeSelection(bz.modules, 'custom', [3, 7, 11, 12])
    expect(sel.supported).toBe(true)
    const withBaseline = buildComputeInput({
      detail: bz.detail, modules: bz.modules, selection: { ...baseSelection(bz)!, upgrade: 'custom' as const, abilities: [3, 7, 11, 12] },
      catalog: { devices: [], devicePresets: {} },
    })
    expect(withBaseline.stockEnginePower).toBe(Number(bz.modules.engines[0].stats.power))
    expect(withBaseline.stockEnginePower).toBeLessThan(Number(withBaseline.modules.engines[0].stats.power))
    expect(computeCharacteristics(withBaseline)._mobility.power).toBe(Number(withBaseline.modules.engines[0].stats.power))
  })
})

describe('XI 技能升级变化展示', () => {
  const catalog = { ...MECHANICS, consumablesGameVersion: MECHANICS.gameVersion, provisionsGameVersion: MECHANICS.gameVersion }
  const boundModules = (modules: typeof black.modules) => ({ ...modules,
    vehicleAbilities: MECHANICS.vehicles.find(vehicle => vehicle.tankId === modules.tankId)!.vehicleAbilities })
  it('Black Rock 同版 XML：3 次变 2 次；连发间隔 2.5 → 1.6，另选间隔技能后 0.7 秒', () => {
    const modules = boundModules(black.modules)
    const rows = upgradeMechanicEffects(resolveUpgradeSelection(modules, 'top'), modules, catalog)
    expect(rows.find(row => row.name === 'BURST_MODE_REQUIRED_PENETRATIONS')).toMatchObject({ initial: 3, value: 2 })
    expect(rows.find(row => row.name === 'BURST_MODE_INTERVAL')).toMatchObject({ initial: 2.5, value: 1.6 })
    const node = modules.upgradeProgression.nodes.find(node => node.type === 'NODETYPE_ALTERNATIVE_MECHANIC'
      && node.attributes.some(a => a.name === 'BURST_MODE_INTERVAL'))!
    const alternative = upgradeMechanicEffects(resolveUpgradeSelection(modules, 'top', [node.id]), modules, catalog)
    expect(alternative.find(row => row.name === 'BURST_MODE_INTERVAL')?.value).toBeCloseTo(.7)
  })
  it('初始值需明确绑定与目录版本；缺失、跨版和无证实字段绝不补造', () => {
    const modules = boundModules(black.modules)
    for (const [inputModules, inputCatalog] of [[black.modules, catalog], [modules, { ...catalog, provisionsGameVersion: 'other' }]]) {
      const rows = upgradeMechanicEffects(resolveUpgradeSelection(inputModules, 'top'), inputModules, inputCatalog)
      expect(rows.every(row => row.initial === null && row.value === null)).toBe(true)
    }
    const nitro = boundModules(bz.modules)
    const rows = upgradeMechanicEffects(resolveUpgradeSelection(nitro, 'top'), nitro, catalog)
    expect(rows.find(row => row.name === 'RECHARGEABLE_NITRO_HEATING_DURATION')).toMatchObject({ initial: 8, value: 13 })
    expect(rows.find(row => row.name === 'RECHARGEABLE_NITRO_COOLING_DURATION')).toMatchObject({ initial: 45, value: 43 })
  })
  it.each([
    { tank: hacker, name: 'SAS_ALLOW_ACTIVATE_ON_HIT', choice: 23, initial: false, upgraded: true, other: [22, 24], kind: 'provisions' },
    { tank: bz, name: 'RECHARGEABLE_NITRO_HEATING_DURATION', choice: 22, initial: 8, upgraded: 13, other: [23, 24], kind: 'consumables' },
  ])('$name：同版执行代码核对的基础值、互斥切换及失败保护', ({ tank, name, choice, initial, upgraded, other, kind }) => {
    const modules = boundModules(tank.modules)
    const row = (mode: string, ability: number, source = catalog, vehicle = modules) =>
      upgradeMechanicEffects(resolveUpgradeSelection(vehicle, mode, [ability]), vehicle, source).find(row => row.name === name)!
    expect(row('stock', choice)).toMatchObject({ initial, value: initial, current: null })
    expect(row('top', choice)).toMatchObject({ initial, value: upgraded, current: initial === false ? true : 5 })
    for (const id of other) {
      expect(row('top', id)).toMatchObject({ initial, value: initial, current: null })
      expect(row('top', choice).value).toBe(upgraded)
    }
    expect(row('stock', choice).value).toBe(initial)
    const wrongVersion = { ...catalog, [`${kind}GameVersion`]: 'other' }
    expect(row('top', choice, wrongVersion)).toMatchObject({ initial: null, value: null })
    expect(row('top', choice, catalog, { ...modules, vehicleAbilities: [] })).toMatchObject({ initial: null, value: null })
    const selected = projectTankUpgrades(tank.detail, modules, 'top', [choice])
    const alternative = projectTankUpgrades(tank.detail, modules, 'top', [other[0]])
    expect(selected.detail).toEqual(alternative.detail)
    expect(selected.modules).toEqual(alternative.modules)
  })
  it('布尔原始 true 与升级 false 正确覆盖，初始态保持 true', () => {
    const modules = boundModules(black.modules)
    const node = modules.upgradeProgression.nodes.find(node => node.attributes.some(a => a.name === 'BURST_MODE_TARGET_ORDER'))!
    for (const mode of ['stock', 'top']) {
      const row = upgradeMechanicEffects(resolveUpgradeSelection(modules, mode, [node.id]), modules, catalog)
        .find(row => row.name === 'BURST_MODE_TARGET_ORDER')!
      expect(row.initial).toBe(true)
      expect(row.value).toBe(mode === 'stock')
    }
  })
  it('Black Rock 连发间隔显示累计 -0.9 / -1.8 与所选 -0.9，绝不当作最终间隔', () => {
    const defaultRows = upgradeMechanicEffects(resolveUpgradeSelection(black.modules, 'top'))
    expect(defaultRows.find(row => row.name === 'BURST_MODE_INTERVAL')).toMatchObject({ current: -.9, initial: null, value: null })
    const node = black.modules.upgradeProgression.nodes.find(node => node.type === 'NODETYPE_ALTERNATIVE_MECHANIC'
      && node.attributes.some(a => a.name === 'BURST_MODE_INTERVAL'))!
    const rows = upgradeMechanicEffects(resolveUpgradeSelection(black.modules, 'top', [node.id]))
    expect(rows.find(row => row.name === 'BURST_MODE_INTERVAL')).toMatchObject({ current: -1.8 })
    expect(rows.find(row => row.name === 'BURST_MODE_REQUIRED_PENETRATIONS')).toMatchObject({ current: null })
  })
  it('初始状态仍展示所选加成但不宣称生效；缺失基值和显式 false 必须区分', () => {
    const node = black.modules.upgradeProgression.nodes.find(node => node.attributes.some(a => a.name === 'BURST_MODE_TARGET_ORDER'))!
    const stock = upgradeMechanicEffects(resolveUpgradeSelection(black.modules, 'stock', [node.id]))
    expect(stock.every(row => row.current === null)).toBe(true)
    const top = upgradeMechanicEffects(resolveUpgradeSelection(black.modules, 'top', [node.id]))
    expect(top.find(row => row.name === 'BURST_MODE_TARGET_ORDER')?.current).toBe(false)
  })
  it.each(TANKS)('$modules.name 仅展示真实机制属性，不混入生命值/模块耐久', ({ modules }) => {
    const rows = upgradeMechanicEffects(resolveUpgradeSelection(modules, 'top'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => !row.name.startsWith('ATTRIBUTE_NAME_'))).toBe(true)
  })
})

const expected = [
  { id: 15153, hp: 2250, power: 880, speed: 41, reload: 19.2, pitch: [-17, 6], dispersion: .4464, damage: [430, 410, 630], velocity: [980, 930, 880] },
  { id: 27905, hp: 1800, power: 930, speed: 53, reload: 7.5, pitch: [-20, 8], dispersion: .3525, damage: [410, 390, 610], velocity: [950, 900, 850] },
  { id: 28161, hp: 2500, power: 1100, speed: 44, reload: 12.5, pitch: [-12, 6], dispersion: .3906, damage: [450, 405, 665], velocity: [980, 950, 860] },
  { id: 30241, hp: 2400, power: 862, speed: 38, reload: 11, pitch: [-18, 10], dispersion: .379998, damage: [440, 410, 650], velocity: [980, 920, 860] },
  { id: 30497, hp: 1700, power: 1000, speed: 50, reload: 8.6, pitch: [-20, 10], dispersion: .384, damage: [420, 400, 625], velocity: [950, 900, 850] },
]

describe('真实客户端 XI 节点选择', () => {
  it('升级规则必须与车辆模块的客户端版本一致；缺失或不匹配时拒绝投影', () => {
    for (const modules of [
      { ...bz.modules, gameVersion: undefined },
      { ...bz.modules, gameVersion: 'release/11.22' },
      { ...bz.modules, upgradeProgression: { ...bz.modules.upgradeProgression, provenance: undefined } },
    ]) {
      const selection = resolveUpgradeSelection(modules, 'top')
      expect(selection.available).toBe(true)
      expect(selection.supported).toBe(false)
      expect(selection.unsupported).toContain('Upgrade data version does not match vehicle modules')
      expect(projectTankUpgrades(bz.detail, modules, 'top').detail).toBe(bz.detail)
    }
  })

  it.each(TANKS)('$modules.name 缺省 top，选项保留并应用', ({ modules, detail }) => {
    const selection = resolveUpgradeSelection(modules)
    expect(selection.available).toBe(true)
    expect(selection.supported).toBe(true)
    expect(selection.mode).toBe('top')
    expect(selection.attributes).not.toEqual({})
    expect(selection.abilities).toEqual(modules.upgradeProgression.alternativeGroups.map(g => g.choices[0]))
    const projected = projectTankUpgrades(detail, modules)
    expect(projected.detail).not.toBe(detail)
    expect(projected.modules).not.toBe(modules)
  })

  it.each(TANKS)('$modules.name 显式 stock 仍保留但不应用', ({ modules, detail }) => {
    const selection = resolveUpgradeSelection(modules, 'stock')
    expect(selection.available).toBe(true)
    expect(selection.supported).toBe(true)
    expect(selection.mode).toBe('stock')
    expect(selection.attributes).toEqual({})
    expect(selection.abilities).toEqual(modules.upgradeProgression.alternativeGroups.map(g => g.choices[0]))
    const projected = projectTankUpgrades(detail, modules, 'stock')
    expect(projected.detail).toBe(detail)
    expect(projected.modules).toBe(modules)
  })

  it('数组、CSV、group映射均按每组合法节点规范；垃圾参数回落默认', () => {
    const group = bz.modules.upgradeProgression.alternativeGroups[0]!
    for (const input of [[24], '24', { [group.id]: 24 }]) {
      const selection = resolveUpgradeSelection(bz.modules, 'top', input)
      expect(selection.choices).toEqual({ [group.id]: 24 })
      expect(selection.abilities).toEqual([24])
    }
    for (const input of [[999, 2], '999,2', '24.0', '-24', '24,,22', '901,902,903,904,905,906,907,908,909', { [group.id]: 2 }]) {
      expect(resolveUpgradeSelection(bz.modules, 'top', input).abilities).toEqual([22])
    }
    expect(resolveUpgradeSelection(bz.modules, 'invalid', [24]).mode).toBe('stock')
  })

  it('每次只应用一个互斥技能；动态技能不改变静态满级数值', () => {
    const defaults = resolveUpgradeSelection(object432.modules, 'top')
    expect(defaults.attributes.COMBAT_FRENZY_ALLOW_SWITCH_AFTER_KILL).toBe(true)
    expect(defaults.attributes.COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK).toBeCloseTo(.04)
    expect(defaults.attributes.COMBAT_FRENZY_MAX_STACKS).toBeUndefined()
    const choice = resolveUpgradeSelection(object432.modules, 'top', [23])
    expect(choice.attributes.COMBAT_FRENZY_ALLOW_SWITCH_AFTER_KILL).toBeUndefined()
    expect(choice.attributes.COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK).toBeCloseTo(.06)
    expect(choice.mechanicsAttributes.COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK).toBeCloseTo(.06)
    expect(projectTankUpgrades(object432.detail, object432.modules, 'top', [22]).modules)
      .toEqual(projectTankUpgrades(object432.detail, object432.modules, 'top', [23]).modules)
    const falseAbility = resolveUpgradeSelection(black.modules, 'top', [27])
    expect(falseAbility.attributes.BURST_MODE_TARGET_ORDER).toBe(false)
    expect(falseAbility.attributes.BURST_MODE_REQUIRED_PENETRATIONS).toBeUndefined()
    expect(falseAbility.attributes.BURST_MODE_INTERVAL).toBeCloseTo(-.9)
  })
})

describe('真实五车静态升级投影', () => {
  it.each(expected)('$id 保留源数据，投影客户端累积奖励', values => {
    const { detail, modules } = TANKS.find(t => t.modules.tankId === values.id)!
    const before = JSON.stringify({ detail, modules })
    const projected = projectTankUpgrades(detail, modules, 'top')
    expect(projected.selection.unsupported).toEqual([])
    expect(projected.selection.supported).toBe(true)
    expect(projected.detail).not.toBe(detail)
    expect(projected.modules).not.toBe(modules)
    expect(JSON.stringify({ detail, modules })).toBe(before)
    expect(projected.modules.hull.hp).toBe(values.hp)
    expect(projected.detail.hp).toBe(values.hp)
    expect(projected.modules.engines[0]!.stats.power).toBe(values.power)
    expect(projected.modules.speedLimits.forward).toBe(values.speed)
    const gun = projected.modules.turrets[0]!.guns[0]!.stats
    expect(gun.reloadTime).toBeCloseTo(values.reload)
    expect(gun.shotDispersionRadius).toBeCloseTo(values.dispersion)
    expect([gun.pitchLimits.min, gun.pitchLimits.max]).toEqual(values.pitch)
    const cfg = projected.detail.configs[0]!
    expect(cfg.reload_time).toBeCloseTo(values.reload)
    expect([cfg.pitch_limits.min, cfg.pitch_limits.max]).toEqual(values.pitch)
    expect(cfg.shells.map(s => s.damage)).toEqual(values.damage)
    expect(cfg.shells.map(s => s.velocity)).toEqual(values.velocity)
    expect(cfg.shells.map(s => s.module_damage)).toEqual([150, 150, 150])
  })

  it('MULTIPLY节点连乘，ADD奖励求和后乘原值；火灾概率不会变负', () => {
    const p = projectTankUpgrades(black.detail, black.modules, 'top')
    expect(p.modules.chassis[0]!.stats.dispersionFactors.vehicleMovement).toBeCloseTo(
      black.modules.chassis[0]!.stats.dispersionFactors.vehicleMovement * .9409)
    expect(p.modules.engines[0]!.stats.fireStartingChance).toBeCloseTo(.15012)
    expect(p.modules.turrets[0]!.stats.maxHealth).toBe(black.modules.turrets[0]!.stats.maxHealth)
    expect(p.selection.mechanicsAttributes.ATTRIBUTE_NAME_MODULES_TURRET_ROTATOR_MAX_HEALTH_FACTOR).toBeCloseTo(1.32)
  })

  it('装甲、板厚与炮管/履带一致，俯角扇区边界与模型引用保持原值', () => {
    const p = projectTankUpgrades(black.detail, black.modules, 'top')
    expect(p.detail.armor.hull.front).toBeCloseTo(106)
    expect(p.detail.armor.turret.front).toBeCloseTo(159)
    expect(p.detail.armor_model.hull.plates['1']).toBeCloseTo(106)
    expect(p.detail.armor_model.chassis.left_track).toBeCloseTo(21.2)
    expect(p.detail.configs[0]!.turret_plates['2']).toBeCloseTo(159)
    expect(p.detail.configs[0]!.gun_plates['1']).toBeCloseTo(53)
    expect(p.detail.configs[0]!.gun_thickness).toBeCloseTo(26.5)
    expect(p.detail).toHaveProperty('configs.0.pitch_limits.back', { min: -18, max: 7, range: 22 })
    expect(p.detail.model).toBe(black.detail.model)
    expect(p.detail.armor_model.hull.spaced).toEqual(['3'])
    const k = projectTankUpgrades(kr.detail, kr.modules, 'top')
    expect(k.detail).toHaveProperty('configs.0.pitch_limits.back', { min: -12, max: 3.7, range: 19 })
  })

  it('支持Vue响应式资产，top/stock来回切换不会污染源缓存', () => {
    const detail = reactive(bz.detail)
    const modules = reactive(bz.modules)
    const top1 = projectTankUpgrades(detail, modules, 'top')
    const stock = projectTankUpgrades(detail, modules, 'stock', [24])
    const top2 = projectTankUpgrades(detail, modules, 'top', [24])
    expect(stock.detail).toBe(detail)
    expect(stock.modules).toBe(modules)
    expect(stock.selection.abilities).toEqual([24])
    expect(top1.modules.hull.hp).toBe(top2.modules.hull.hp)
    expect(modules.hull.hp).toBe(2020)
  })

  it('真实XI经buildComputeInput使用初始动力基准，保留普通装备计算链', () => {
    const selection = baseSelection(bz)!
    const stock = buildComputeInput({ ...bz, selection, catalog: {} })
    const top = buildComputeInput({ ...bz, selection: { ...selection, upgrade: 'top' }, catalog: {} })
    const stockStats = computeCharacteristics(stock)
    const topStats = computeCharacteristics(top)
    expect(top.stockEnginePower).toBe(830)
    expect(stock.stockEnginePower).toBeUndefined()
    expect(topStats.enginePower).toBe(880)
    expect(topStats._mobility.power).toBe(880)
    expect(topStats._mobility.power).toBeGreaterThan(stockStats._mobility.power)
    expect(topStats.chassiRotationSpeed / stockStats.chassiRotationSpeed).toBeCloseTo(1.11 * 880 / 830, 4)
    expect(topStats.chassiRotationSpeed).toBeCloseTo(30.683, 3)
    expect(topStats.maxHealth - stockStats.maxHealth).toBe(230)
    expect(topStats.baseShellAvgDamage - stockStats.baseShellAvgDamage).toBe(30)
  })
})
