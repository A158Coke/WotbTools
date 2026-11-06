import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import TANKS from './__fixtures__/upgrades/tanks.json'
import MECHANICS from './__fixtures__/upgrades/mechanics.json'
import ORDINARY from './__fixtures__/modules/ussr.json'
import { computeCharacteristics } from './characteristics'
import { baseSelection, buildComputeInput } from './tankSetup'
import { projectTankUpgrades, resolveUpgradeSelection, upgradeMechanicEffects, type UpgradeDefinition, type UpgradeNode } from './tankUpgrades'

const bz = TANKS.find(t => t.modules.tankId === 15153)!
const object432 = TANKS.find(t => t.modules.tankId === 27905)!
const kr = TANKS.find(t => t.modules.tankId === 28161)!
const black = TANKS.find(t => t.modules.tankId === 30241)!
const hacker = TANKS.find(t => t.modules.tankId === 30497)!

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
    expect(rows.find(row => row.name === 'RECHARGEABLE_NITRO_HEATING_DURATION')?.initial).toBe(null)
    expect(rows.find(row => row.name === 'RECHARGEABLE_NITRO_COOLING_DURATION')).toMatchObject({ initial: 45, value: 43 })
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

// 来自同版客户端 XML 的手工核对总量。detail 的炮弹、装甲值是映射测试输入，见 fixture manifest。
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

  it.each(TANKS)('$modules.name 旧链接缺省 stock，选项保留但不应用', ({ modules, detail }) => {
    const selection = resolveUpgradeSelection(modules)
    expect(selection.available).toBe(true)
    expect(selection.supported).toBe(true)
    expect(selection.mode).toBe('stock')
    expect(selection.attributes).toEqual({})
    expect(selection.abilities).toEqual(modules.upgradeProgression.alternativeGroups.map(g => g.choices[0]))
    const projected = projectTankUpgrades(detail, modules)
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
    for (const input of [[999, 2], '999,2', '24.0', '-24', '24,,22', '24,22,23,24,22,23,24,22,23', { [group.id]: 2 }]) {
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
    // BlitzInfo当前公开core.wasm独立对照：.27 * (1 - .444) = .15012。
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
    // 保留现有乘员系数；升级相对初始的独立变化为 1.11 × 880/830。
    expect(topStats.chassiRotationSpeed / stockStats.chassiRotationSpeed).toBeCloseTo(1.11 * 880 / 830, 4)
    expect(topStats.chassiRotationSpeed).toBeCloseTo(30.683, 3)
    expect(topStats.maxHealth - stockStats.maxHealth).toBe(230)
    expect(topStats.baseShellAvgDamage - stockStats.baseShellAvgDamage).toBe(30)
  })
})

function scenario(attributes: Array<{ name: string; value: number | boolean; definition: UpgradeDefinition }>) {
  return {
    ...bz.modules,
    upgradeProgression: {
      ...bz.modules.upgradeProgression,
      nodes: [{ id: 1, techName: 'test', type: 'NODETYPE_COMMON',
        attributes: attributes.map(({ name, value }) => ({ name, value })) }] as UpgradeNode[],
      alternativeGroups: [],
      attributeDefinitions: Object.fromEntries(attributes.map(({ name, definition }) => [name, definition])),
    },
  }
}

describe('定义驱动扩展与错误边界', () => {
  it('客户端已有但五车未使用的瞄准、倒车、穿深和自装填脚本映射', () => {
    const modules = scenario([
      { name: 'aim', value: -.1, definition: { modifier: 'MODIFIER_ADD', script: 'VehicleDataMiscAttrMultiplicativeBonus', params: { attrName: 'gunAimingTimeFactor' } } },
      { name: 'reverse', value: 3, definition: { modifier: 'MODIFIER_ADD', script: 'SpeedLimitUpgrade', params: { type: 'backward' } } },
      { name: 'pen100', value: 10, definition: { modifier: 'MODIFIER_ADD', script: 'ShellPiercingPowerUpgrade', params: { slotIndex: '0', distance: '100' } } },
      { name: 'pen500', value: 20, definition: { modifier: 'MODIFIER_ADD', script: 'ShellPiercingPowerUpgrade', params: { slotIndex: '0', distance: '500' } } },
      { name: 'pump', value: -.5, definition: { modifier: 'MODIFIER_ADD', script: 'PumpGunReloadUpgrade' } },
    ])
    const detail = { ...structuredClone(bz.detail),
      configs: bz.detail.configs.map(cfg => ({ ...structuredClone(cfg), burst_reloads: [10, 12, 14] })) }
    const p = projectTankUpgrades(detail, modules, 'top')
    expect(p.selection.supported).toBe(true)
    expect(p.detail.configs[0]!.aim_time).toBeCloseTo(1.98)
    expect(p.detail.speed_reverse).toBe(15)
    expect(p.modules.speedLimits.backward).toBe(15)
    expect(p.detail.configs[0]!.shells[0]!.penetration).toBe(260)
    expect(p.detail.configs[0]!.shells[0]!.penetration_far).toBe(250)
    expect(p.detail.configs[0]!.shells[1]!.penetration).toBe(300)
    expect(p.detail.configs[0]!.burst_reloads).toEqual([9.5, 11.5, 13.5])
  })

  it('普通车、缺升级元数据、错误详情等级均不投影、不修改引用', () => {
    const ordinary = ORDINARY.tanks['T-34']
    expect(resolveUpgradeSelection(ordinary, 'top', [22]).available).toBe(false)
    const noData = { ...bz.modules, upgradeProgression: undefined }
    const { upgradeProgression: _removed, ...missing } = bz.modules
    void _removed
    for (const modules of [ordinary, missing, noData]) {
      const p = projectTankUpgrades(bz.detail, modules, 'top')
      expect(p.detail).toBe(bz.detail)
      expect(p.modules).toBe(modules)
    }
    const ordinaryDetail = { ...bz.detail, tier: 10 }
    expect(projectTankUpgrades(ordinaryDetail, bz.modules, 'top').detail).toBe(ordinaryDetail)
  })

  it('未知静态脚本与缺少静态来源拒绝top，保持全部原引用', () => {
    const modules = scenario([{ name: 'future', value: 20, definition: { modifier: 'MODIFIER_ADD', script: 'FutureUnknownScript' } }])
    const p = projectTankUpgrades(bz.detail, modules, 'top')
    expect(p.selection.supported).toBe(false)
    expect(p.selection.unsupported[0]).toContain('FutureUnknownScript')
    expect(p.detail).toBe(bz.detail)
    expect(p.modules).toBe(modules)
    const detail = { ...bz.detail, configs: [] }
    const missing = projectTankUpgrades(detail, bz.modules, 'top')
    expect(missing.selection.supported).toBe(false)
    expect(missing.selection.unsupported.join()).toContain('Missing upgrade projection source')
    expect(missing.detail).toBe(detail)
    expect(missing.modules).toBe(bz.modules)
  })

  it('坏节点、分组、定义、非有限值均拒绝；stock不应用坏数据', () => {
    const cases = [
      { ...bz.modules.upgradeProgression, nodes: [...bz.modules.upgradeProgression.nodes, bz.modules.upgradeProgression.nodes[0]] },
      { ...bz.modules.upgradeProgression, alternativeGroups: [{ id: 'bad', choices: [2] }] },
      { ...bz.modules.upgradeProgression, attributeDefinitions: {} },
      { ...bz.modules.upgradeProgression, nodes: [{ id: 1, techName: 'bad', type: 'NODETYPE_COMMON', attributes: [{ name: 'bad', value: Infinity }] }] },
    ]
    for (const upgradeProgression of cases) {
      const modules = { ...bz.modules, upgradeProgression }
      expect(resolveUpgradeSelection(modules, 'top').supported).toBe(false)
      expect(projectTankUpgrades(bz.detail, modules, 'stock').detail).toBe(bz.detail)
    }
    expect(resolveUpgradeSelection(hacker.modules, 'top', [24]).mechanicsAttributes.SAS_GUN_DISPERSION).toBe(.25)
  })
})
