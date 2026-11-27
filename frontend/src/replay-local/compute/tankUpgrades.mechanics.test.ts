import { describe, expect, it } from 'vitest'
import TANKS from './__fixtures__/upgrades/tanks.json'
import T11R3 from './__fixtures__/upgrades/t11r3.json'
import ORDINARY from './__fixtures__/modules/ussr.json'
import { parseTankopediaQuery } from '../../utils/tankopediaQuery.js'
import { parseAugmentProgression, researchGroupChoice } from './tankAugmentTree'
import { fullResearchXp, mechanicParameterGroups, projectTankUpgrades, resolveUpgradeSelection, upgradeMechanicEffects, type UpgradeDefinition, type UpgradeNode } from './tankUpgrades'

const bz = TANKS.find(t => t.modules.tankId === 15153)!
const hacker = TANKS.find(t => t.modules.tankId === 30497)!
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


describe('t11r3 的四种内建机制', () => {
  const catalog = { ...T11R3, consumablesGameVersion: T11R3.gameVersion, provisionsGameVersion: T11R3.gameVersion }
  const values: Record<number, Record<string, Array<number | boolean>>> = {
    23361: {
      EXTERNAL_AMMO_MODULE_GUN_IN_CLIP_RELOAD_TIME: [3, 2, 3, 3],
      EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS: [false, false, false, true],
    },
    30737: {
      AUXILLIARY_WEAPONS_GUN_RELOAD_TIME: [19, 16.8, 14, 16.8],
      AUXILLIARY_WEAPONS_GUN_BURST_INTERVAL: [1.5, .48, 1, 1],
      AUXILLIARY_WEAPONS_GUN_DAMAGE: [150, 170, 170, 190],
    },
    30993: {
      SHELL_OVERHEAT_ACTIVATION_DELAY: [2, 1, 1, 1],
      SHELL_OVERHEAT_CHARGE_TIME: [9, 7, 7, 3],
      SHELL_OVERHEAT_MAX_TANK_SPEED: [25, 30, 60, 30],
      SHELL_OVERHEAT_MIN_ALPHA_BOOST: [.25, .35, .25, .25],
    },
    10593: {
      UNGUIDED_ROCKET_ACCELERATION: [20, 40, 40, 40],
      UNGUIDED_ROCKET_INITIAL_SPEED: [40, 70, 70, 70],
      UNGUIDED_ROCKET_CONTAINER_RELOAD: [37, 37, 37, 27],
      UNGUIDED_ROCKET_INTERCLIP_RELOAD: [15, 15, 10, 15],
      UNGUIDED_ROCKET_DAMAGE: [320, 360, 320, 320],
    },
  }

  it.each(T11R3.tanks)('$modules.tankId 的 3 种备选读取同版实装值并在深链中往返', ({ modules, detail }) => {
    const progression = parseAugmentProgression(modules)!
    const group = progression.alternativeGroups[0]!
    const expected = values[modules.tankId]!
    const stock = resolveUpgradeSelection(modules, 'stock')
    const stockRows = upgradeMechanicEffects(stock, modules, catalog)
    expect(Object.fromEntries(stockRows.map(row => [row.name, row.initial]))).toEqual(
      Object.fromEntries(Object.entries(expected).map(([name, stages]) => [name, stages[0]])))
    for (const [index, choice] of group.choices.entries()) {
      const projected = projectTankUpgrades(detail, modules, 'top', [choice])
      expect(projected.selection.unsupported).toEqual([])
      const rows = upgradeMechanicEffects(projected.selection, modules, catalog)
      for (const row of rows) {
        const value = expected[row.name]![index + 1]
        if (typeof value === 'number') expect(row.value, row.name).toBeCloseTo(value)
        else expect(row.value, row.name).toBe(value)
      }
      const installed = researchGroupChoice(progression, group.id, choice, new Set())
      const query = parseTankopediaQuery({ tank: String(modules.tankId), upgrade: 'custom', abilities: [...installed].join(',') })
      const partial = resolveUpgradeSelection(modules, query.upgrade, query.abilities)
      expect(partial.unsupported).toEqual([])
      expect(new Set(partial.abilities)).toEqual(installed)
      expect(upgradeMechanicEffects(partial, modules, catalog).every(row => row.initial != null)).toBe(true)
      if (modules.tankId !== 23361) {
        expect(projected.detail).toEqual(projectTankUpgrades(detail, modules, 'top', [group.choices[0]]).detail)
      }
    }
  })

  it('keeps each auxiliary shot with its own ballistics and refuses ambiguous upgrade attribution', () => {
    const modules = T11R3.tanks.find(tank => tank.modules.tankId === 10593)!.modules
    const selection = resolveUpgradeSelection(modules, 'top')
    const item = catalog.consumables.find(i => i.stem === 'unguidedRocket')!
    const first = item.auxiliaryGun.shots[0]!
    const second = { ...first, stem: 'other', type_id: 0, penetration: 210, penetration_far: 190, damage: 155 }
    const groups = mechanicParameterGroups(selection, modules, { ...catalog, consumables: [
      { ...item, auxiliaryGun: { ...item.auxiliaryGun, shots: [first, second] } },
    ] })
    expect(groups[0]?.index).toBe(1)
    expect(groups[1]?.index).toBe(2)
    const lookup = (i: number, name: string) => groups[i]?.rows.find(row => row.name === name)
    expect(lookup(0, 'AUX_SHELL_TYPE')?.value).toBe(2)
    expect(lookup(1, 'AUX_PENETRATION_FAR')?.value).toBe(190)
    expect(lookup(1, 'UNGUIDED_ROCKET_DAMAGE')?.value).toBe(155)
    expect(lookup(3, 'UNGUIDED_ROCKET_DAMAGE')).toMatchObject({ initial: null, value: null, current: 40 })
    const old = mechanicParameterGroups(selection, modules, { ...catalog, consumablesGameVersion: 'older' })
    expect(old.flatMap(g => g.rows).some(row => row.name === 'AUX_PENETRATION')).toBe(false)
  })

  it('拒绝跨版、缺绑定、错炮引用、多弹种、非法射速和不明确的主炮', () => {
    const rocket = T11R3.tanks.find(tank => tank.modules.tankId === 10593)!.modules
    const rows = (modules: unknown, source: unknown) =>
      upgradeMechanicEffects(resolveUpgradeSelection(modules, 'stock'), modules, source)
    expect(rows(rocket, { ...catalog, consumablesGameVersion: 'old' }).every(row => row.initial == null)).toBe(true)
    expect(rows({ ...rocket, vehicleAbilities: [] }, catalog).every(row => row.initial == null)).toBe(true)
    const item = catalog.consumables.find(i => i.stem === 'unguidedRocket')!
    for (const auxiliaryGun of [undefined, { ...item.auxiliaryGun, reference: 'wrong' }]) {
      expect(rows(rocket, { ...catalog, consumables: [{ ...item, auxiliaryGun }] }).every(row => row.initial == null)).toBe(true)
    }
    const invalid = { ...item.auxiliaryGun, shots: [...item.auxiliaryGun.shots, ...item.auxiliaryGun.shots],
      clip: { count: 2, rate: 0 } }
    const result = rows(rocket, { ...catalog, consumables: [{ ...item, auxiliaryGun: invalid }] })
    expect(result.filter(row => row.name !== 'UNGUIDED_ROCKET_CONTAINER_RELOAD').every(row => row.initial == null)).toBe(true)
    const external = T11R3.tanks.find(tank => tank.modules.tankId === 23361)!.modules
    const ambiguous = { ...external, turrets: [...external.turrets, ...external.turrets] }
    expect(rows(ambiguous, catalog).find(row => row.name === 'EXTERNAL_AMMO_MODULE_GUN_IN_CLIP_RELOAD_TIME')?.initial).toBeNull()
  })
})

describe('XI 投影后的 DPM 与伤害/装填自洽', () => {
  it('ShellDamageUpgrade 与装填加成落地后，dpm/standard_damage 同步重算', () => {
    const modules = {
      tankId: 90001, tier: 11, gameVersion: 'v1',
      turrets: [{ guns: [{ stats: { reloadTime: 12.3 } }] }],
      upgradeProgression: {
        matrix: { rows: 1, columns: 2 },
        nodes: [
          { id: 1, techName: 'dmg', type: 'NODETYPE_COMMON', gridPosition: [1, 1], xpCost: 1,
            attributes: [{ name: 'SHELL_DAMAGE_SLOT_1', value: 40 }] },
          { id: 2, techName: 'reload', type: 'NODETYPE_COMMON', gridPosition: [1, 2], xpCost: 1,
            attributes: [{ name: 'GUN_RELOAD', value: -0.8 }] },
        ],
        alternativeGroups: [],
        attributeDefinitions: {
          SHELL_DAMAGE_SLOT_1: { modifier: 'MODIFIER_ADD', params: { slotIndex: '0' }, script: 'ShellDamageUpgrade' },
          GUN_RELOAD: { modifier: 'MODIFIER_ADD', script: 'VehicleDataMiscAttrAdditiveBonus', params: { attrName: 'gunReloadTimeAdditiveBonus' } },
        },
        provenance: { gameVersion: 'v1' },
      },
    } as any
    const detail = {
      tier: 11, hp: 2000,
      configs: [{
        id: 0, shells: [
          { type: 'ap', damage: 560, penetration: 298 },
          { type: 'ap_premium', damage: 540, penetration: 363 },
        ],
        standard_damage: 560, dpm: 2732, reload_time: 12.3, is_burst: false,
      }],
    } as any
    const { detail: projected } = projectTankUpgrades(detail, modules, 'top', [])
    const cfg = projected.configs[0]
    expect(cfg.shells[0].damage).toBe(600)
    expect(cfg.reload_time).toBeCloseTo(11.5, 5)
    expect(cfg.standard_damage).toBe(600)
    expect(cfg.dpm).toBe(3130)
    const stock = projectTankUpgrades(detail, modules, 'stock', []).detail.configs[0]
    expect(stock.dpm).toBe(2732)
    expect(stock.standard_damage).toBe(560)
    const burstDetail = { ...detail, configs: [{ ...detail.configs[0], is_burst: true }] }
    expect(projectTankUpgrades(burstDetail, modules, 'top', []).detail.configs[0].dpm).toBeNull()
  })
})

describe('full XI research cost', () => {
  const price = (modules: unknown) => fullResearchXp(resolveUpgradeSelection(modules, 'stock'))
  it.each([[23361, 414000], [30993, 414000], [30737, 320000], [10593, 320000]])('counts shared prerequisites and each group once for %i', (id, expected) => {
    const modules = T11R3.tanks.find(tank => tank.modules.tankId === id)!.modules
    expect(price(modules)).toBe(expected)
    for (const mode of ['stock', 'custom', 'top']) {
      for (const choice of modules.upgradeProgression.alternativeGroups[0]!.choices)
        expect(fullResearchXp(resolveUpgradeSelection(modules, mode, [choice]))).toBe(expected)
    }
  })
  const sample = () => resolveUpgradeSelection(T11R3.tanks[0]!.modules, 'top')
  it('distinguishes free research from missing or invalid prices', () => {
    const s = sample()
    const paid = [...s.nodes.filter(n => n.type !== 'NODETYPE_ALTERNATIVE_MECHANIC'), ...s.groups]
    for (const entry of paid) entry.xpCost = 0
    expect(fullResearchXp(s)).toBe(0)
    for (const invalid of [undefined, null, -1, Infinity, NaN, '100']) {
      paid[0]!.xpCost = invalid
      expect(fullResearchXp(s)).toBeNull()
    }
    paid[0]!.xpCost = 0
    delete s.groups[0]!.xpCost
    expect(fullResearchXp(s)).toBeNull()
  })
  it('rejects unknown contracts, broken dependencies, and mismatched versions', () => {
    const s = sample()
    const choice = s.nodes.find(n => n.type === 'NODETYPE_ALTERNATIVE_MECHANIC')!
    choice.xpCost = 0
    expect(fullResearchXp(s)).toBeNull()
    delete choice.xpCost
    const node = s.nodes[0]!
    for (const req of [[node.techName], ['missing'], [choice.techName], 'broken']) {
      node.requiredNodes = req
      expect(fullResearchXp(s)).toBeNull()
    }
    const modules = T11R3.tanks[0]!.modules
    expect(price({ ...modules, gameVersion: 'other' })).toBeNull()
    expect(price({ tier: 11 })).toBeNull()
  })
})
