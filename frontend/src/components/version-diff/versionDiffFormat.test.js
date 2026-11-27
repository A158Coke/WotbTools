import { describe, expect, it } from 'vitest'
import {
  armorFaceLabel, armorRows, categoryLabel, deltaDiffValue, diffPathLabel, faceLabel,
  fieldLabel, fmtDiffValue, mapMatchesFilter, moduleLabel, pairLabel, statusLabel,
  tankMatchesFilter, tankRows,
} from './versionDiffFormat.js'

const MESSAGES = {
  // 条目名与坦克百科参数面板（agentTanks.params.*）一致
  'agentTanks.params.gunShotDispersionRadius': 'Dispersion (100m)',
  'agentTanks.params.gunShellReloadTime': 'Reload time',
  'agentTanks.params.gunCommonDamagePerMin': 'Damage per minute',
  'agentTanks.params.baseShellAvgDamage': 'Avg damage',
  'agentTanks.params.baseShellAvgPiercingPower': 'Avg piercing power',
  'agentTanks.params.gunAimingTime': 'Aiming time',
  'agentTanks.params.enginePower': 'Engine power',
  'agentTanks.params.turretRotationSpeed': 'Turret traverse speed',
  'agentTanks.params.maxHealth': 'Hit points',
  'agentTanks.params.gunClipShellCount': 'Clip capacity',
  'agentTanks.params.gunClipBurstReloadTime': 'Burst reload time',
  'agentTanks.params.gunClipShellReloadTime': 'Shell reload time',
  'agentTanks.params.gunBurstShellCount': 'Shells per burst',
  'agentTanks.params.stillInvisibility': 'Stationary concealment',
  'agentTanks.params.maxFrontSpeed': 'Forward speed',
  'agentTanks.params.maxBackSpeed': 'Reverse speed',
  'agentTanks.params.chassiRotationSpeed': 'Hull traverse speed',
  'agentTanks.params.circularVisionRadius': 'View range',
  'agentTanks.params.engineFireStartingChance': 'Engine fire chance',
  'agentTanks.params.movingInvisibility': 'Moving concealment',
  'agentTanks.params.weight': 'Weight',
  'versionDiff.fields.bbox': 'Bounding box',
  'versionDiff.fields.pitchLimits': 'Pitch limits',
  'versionDiff.fields.tags': 'Tags',
  'versionDiff.modules.hull': 'Hull',
  'versionDiff.modules.chassis': 'Chassis',
  'agentTanks.pen_far': 'Far-range penetration',
  'agentTanks.velocity': 'Shell speed',
  'agentTanks.module_dmg': 'Module damage',
  'agentTanks.normalization': 'Normalization angle',
  'agentTanks.ricochet': 'Ricochet angle',
  'versionDiff.fields.clip': 'Clip',
  'versionDiff.fields.engine': 'Engine',
  'versionDiff.fields.armorPlate': 'Plate',
  'versionDiff.fields.mechanics': 'Mechanics',
  'versionDiff.armor.hullFront': 'Hull front',
  'versionDiff.categories.research': 'Research',
  'versionDiff.categories.armor': 'Armor',
  'versionDiff.status.changed': 'Changed',
  'versionDiff.status.added': 'Added',
  'versionDiff.modules.gun': 'Gun',
  'versionDiff.faces.front': 'Front',
  'versionDiff.added': 'added',
  'agentTanks.dmg': 'Damage',
}
const t = key => MESSAGES[key] ?? key
const te = key => key in MESSAGES

const shellLabelFn = type => ({ ap: 'AP', ap_cr_premium: 'APCR', he: 'HE' }[type] || type)

describe('versionDiffFormat values', () => {
  it('formats numbers, booleans, nulls and objects for display', () => {
    expect(fmtDiffValue(null)).toBe('—')
    expect(fmtDiffValue(undefined)).toBe('—')
    expect(fmtDiffValue(12)).toBe('12')
    expect(fmtDiffValue(1.234)).toBe('1.23')
    expect(fmtDiffValue(12.5)).toBe('12.5')
    expect(fmtDiffValue(150.25)).toBe('150.3')
    expect(fmtDiffValue(true)).toBe('✓')
    expect(fmtDiffValue(false)).toBe('—')
    expect(fmtDiffValue({ a: 1 })).toBe('{"a":1}')
    expect(fmtDiffValue({ text: 'x'.repeat(200) })).toHaveLength(138)
    expect(fmtDiffValue({ text: 'x'.repeat(200) }).endsWith('…')).toBe(true)
  })

  it('only reports a numeric delta with a sign', () => {
    expect(deltaDiffValue(100, 110)).toBe('+10')
    expect(deltaDiffValue(110, 100)).toBe('-10')
    expect(deltaDiffValue(1.5, 1.25)).toBe('-0.25')
    expect(deltaDiffValue(5, 5)).toBe('')
    expect(deltaDiffValue('5', 6)).toBe('')
  })

  it('labels fields, modules, faces and categories with fallbacks', () => {
    expect(fieldLabel('dispersion', t, te)).toBe('Dispersion (100m)')
    expect(fieldLabel('reload_time', t, te)).toBe('Reload time')
    expect(fieldLabel('unknown_field', t, te)).toBe('unknown_field')
    expect(moduleLabel('gun', t, te)).toBe('Gun')
    expect(faceLabel('front', t, te)).toBe('Front')
    expect(armorFaceLabel('hull.front', t, te)).toBe('Hull front')
    expect(categoryLabel('armor', t, te)).toBe('Armor')
    expect(statusLabel('changed', t, te)).toBe('Changed')
    expect(pairLabel({ from: { dataset: 'a' }, to: { dataset: 'b' } })).toBe('a → b')
  })
})

describe('versionDiffFormat change paths', () => {
  it('labels shell fields through the shell-name callback', () => {
    expect(diffPathLabel('shells.ap.penetration', t, te, shellLabelFn))
      .toBe('AP · Avg piercing power')
    expect(diffPathLabel('shells.he.damage', t, te, shellLabelFn))
      .toBe('HE · Avg damage')
  })

  it('labels armor plates and engine changes', () => {
    expect(diffPathLabel('armorModel.gun.2.added', t, te, shellLabelFn))
      .toBe('Gun · Plate #2 (added)')
    expect(diffPathLabel('engines.V-12-6B.power', t, te, shellLabelFn))
      .toBe('Engine V-12-6B · Engine power')
    expect(diffPathLabel('hp', t, te, shellLabelFn)).toBe('Hit points')
    expect(diffPathLabel('mechanics', t, te, shellLabelFn)).toBe('Mechanics')
  })

  it('routes bare configuration fields through the encyclopedia param names', () => {
    // 配置级 change.path 是裸字段：必须走 fieldLabel，不能原样回显。
    expect(diffPathLabel('reload_time', t, te, shellLabelFn)).toBe('Reload time')
    expect(diffPathLabel('dpm', t, te, shellLabelFn)).toBe('Damage per minute')
    expect(diffPathLabel('standard_damage', t, te, shellLabelFn)).toBe('Avg damage')
    expect(diffPathLabel('aim_time', t, te, shellLabelFn)).toBe('Aiming time')
    expect(diffPathLabel('weight', t, te, shellLabelFn)).toBe('Weight')
    expect(diffPathLabel('turret_traverse_speed', t, te, shellLabelFn)).toBe('Turret traverse speed')
  })

  it('labels research module stats with the encyclopedia names', () => {
    expect(diffPathLabel('research.gun:Panther II/8,8 cm Kw.K. 36 L/56:7.stats.reloadTime', t, te, shellLabelFn))
      .toBe('Research · Gun Panther II/8,8 cm Kw.K. 36 L/56 · Reload time')
    expect(diffPathLabel('research.hull.hp', t, te, shellLabelFn)).toBe('Research · Hull · Hit points')
    expect(diffPathLabel('research.bbox.chassis.max', t, te, shellLabelFn)).toBe('Research · Chassis · Bounding box (max)')
    expect(diffPathLabel('research.gun:Lorraine 120/105 mm 105F:9.stats.pitchLimits.back.max', t, te, shellLabelFn))
      .toBe('Research · Gun Lorraine 120/105 mm 105F · Pitch limits (back.max)')
    expect(diffPathLabel('research.invisibility.moving', t, te, shellLabelFn))
      .toBe('Research · Moving concealment')
    expect(diffPathLabel('research.tags', t, te, shellLabelFn)).toBe('Research · Tags')
  })
})

describe('versionDiffFormat rows', () => {
  const detail = {
    changes: [{ path: 'hp', category: 'survivability', old: 1500, new: 1600 }],
    configs: {
      configs: [
        {
          key: { gun: '85 mm Škoda 29', gunLocal: 106, turretLocal: 94 },
          changes: [
            { path: 'shells.ap.penetration', category: 'firepower', old: 200, new: 210 },
            { path: 'reload_time', category: 'firepower', old: 7, new: 6.5 },
          ],
        },
      ],
    },
    research: {
      changes: [{ path: 'modules.gun_2.research_cost', old: 10000, new: 9000 }],
    },
  }

  it('merges summary, config and research changes without decoding the gun name into the path', () => {
    const rows = tankRows(detail)
    expect(rows.map(row => row.scope)).toEqual(['summary', 'config', 'config', 'research'])
    expect(rows[1].displayPath).toBe('shells.ap.penetration')
    expect(rows[1].configLabel).toBe('85 mm Škoda 29')
    expect(diffPathLabel(rows[1].displayPath, t, te, shellLabelFn))
      .toBe('AP · Avg piercing power')
  })

  it('flattens directional, plate and structure armor rows', () => {
    const rows = armorRows({
      summary: { 'hull.front': { old: 100, new: 120 } },
      model: {
        plates: [{ module: 'gun', plate: '1', old: 100, new: 110 }],
        addedPlates: [{ module: 'gun', plate: '2', thickness: 144 }],
        removedPlates: [{ module: 'hull', plate: '3', thickness: 40 }],
        primary: [{ module: 'hull', side: 'front', old: 100, new: 120 }],
        // model 级 spaced 的 old/new 是板件 id 列表 → 展开成逐板 新增/移除 行。
        spaced: [{ module: 'turret', old: ['5'], new: ['6'] }],
        chassis: [{ field: 'left_track', old: 30, new: 40 }],
      },
    })
    expect(rows.map(row => row.kind)).toEqual([
      'direction', 'plate', 'addedPlate', 'removedPlate', 'primary', 'configSpaced', 'configSpaced', 'chassis',
    ])
    const spacedRows = rows.filter(row => row.kind === 'configSpaced')
    expect(spacedRows).toEqual([
      { kind: 'configSpaced', module: 'turret', plate: '5', added: false },
      { kind: 'configSpaced', module: 'turret', plate: '6', added: true },
    ])
  })

  it('adds configuration-level plate and spaced rows from the config diff', () => {
    const rows = armorRows({ summary: {} }, { configs: { configs: [{
      key: { turret: 'Turret A', gun: 'Gun X', turretLocal: 1, gunLocal: 11 },
      changes: [
        { path: 'gun_plates', category: 'armor', old: { '5': 50 }, new: { '5': 60, '6': 90 } },
        { path: 'turret_spaced', category: 'armor', old: ['1'], new: ['2'] },
      ],
    }] } })
    expect(rows).toEqual([
      { kind: 'configPlate', module: 'gun', plate: '5', configKey: '1/11', configLabel: 'Turret A / Gun X', old: 50, new: 60 },
      { kind: 'configPlate', module: 'gun', plate: '6', configKey: '1/11', configLabel: 'Turret A / Gun X', old: null, new: 90 },
      { kind: 'configSpaced', module: 'turret', plate: '1', configKey: '1/11', configLabel: 'Turret A / Gun X', added: false },
      { kind: 'configSpaced', module: 'turret', plate: '2', configKey: '1/11', configLabel: 'Turret A / Gun X', added: true },
    ])
  })

  it('keeps configuration identity when multiple configs change the same plate', () => {
    const rows = armorRows({ summary: {} }, { configs: { configs: [
      {
        // 同一门炮装在两个炮塔：只显示炮名无法区分，必须带炮塔（缺名回退 local id）。
        key: { turret: 'Turret A', gun: 'Gun X', turretLocal: 1, gunLocal: 9 },
        changes: [{ path: 'gun_plates', category: 'armor', old: { '5': 50 }, new: { '5': 60 } }],
      },
      {
        key: { gun: 'Gun X', turretLocal: 2, gunLocal: 9 },
        changes: [{ path: 'gun_plates', category: 'armor', old: { '5': 70 }, new: { '5': 80 } }],
      },
    ] } })
    expect(rows).toEqual([
      { kind: 'configPlate', module: 'gun', plate: '5', configKey: '1/9', configLabel: 'Turret A / Gun X', old: 50, new: 60 },
      { kind: 'configPlate', module: 'gun', plate: '5', configKey: '2/9', configLabel: '#2 / Gun X', old: 70, new: 80 },
    ])
    expect(new Set(rows.map(row => `${row.configKey}-${row.module}-${row.plate}`)).size).toBe(2)
  })

  it('skips configuration rows already covered by model-level rows (no duplicates)', () => {
    const rows = armorRows(
      {
        summary: {},
        model: {
          plates: [{ module: 'gun', plate: '5', old: 50, new: 60 }],
          addedPlates: [{ module: 'gun', plate: '6', thickness: 90 }],
          removedPlates: [], primary: [], spaced: [], chassis: [], changed: true,
        },
      },
      { configs: { configs: [{
        key: { gun: 'X' },
        changes: [
          { path: 'gun_plates', category: 'armor', old: { '5': 50, '7': 30 }, new: { '5': 60, '6': 90, '7': 35 } },
        ],
      }] } },
    )
    expect(rows.filter(row => row.kind === 'configPlate').map(row => row.plate)).toEqual(['7'])
    expect(rows.some(row => row.plate === '5' && row.kind === 'configPlate')).toBe(false)
    expect(rows.some(row => row.plate === '6' && row.kind === 'configPlate')).toBe(false)
  })

  it('keeps every configuration row and drops the duplicate model row in multi-config tanks', () => {
    // 多配置车的 model 炮/塔行没有配置身份（3D 也不能用它定位配置）：同值的配置行必须保留，
    // model 行移除；数值不同的配置行同样保留。
    const model = {
      plates: [{ module: 'gun', plate: '5', old: 50, new: 60 }],
      addedPlates: [], removedPlates: [], primary: [], spaced: [], chassis: [], changed: true,
    }
    const config = (turretLocal, oldValue, newValue) => ({
      key: { gun: 'Gun X', turretLocal, gunLocal: 9 },
      changes: [{ path: 'gun_plates', category: 'armor', old: { '5': oldValue }, new: { '5': newValue } }],
    })
    const rows = armorRows({ summary: {}, model }, { configs: { configs: [config(1, 50, 60), config(2, 70, 80)] } })
    expect(rows.filter(row => row.kind === 'plate')).toEqual([])
    expect(rows.filter(row => row.kind === 'configPlate')).toEqual([
      { kind: 'configPlate', module: 'gun', plate: '5', configKey: '1/9', configLabel: '#1 / Gun X', old: 50, new: 60 },
      { kind: 'configPlate', module: 'gun', plate: '5', configKey: '2/9', configLabel: '#2 / Gun X', old: 70, new: 80 },
    ])
    // 同数值、不同配置：两条配置行都要保留，不能只剩一条无配置的 model 行。
    const same = armorRows({ summary: {}, model }, { configs: { configs: [config(1, 50, 60), config(2, 50, 60)] } })
    expect(same.filter(row => row.kind === 'plate')).toEqual([])
    expect(same.filter(row => row.kind === 'configPlate').map(row => row.configKey)).toEqual(['1/9', '2/9'])
  })

  it('filters tanks by status, category and model-only rows', () => {
    expect(tankMatchesFilter({ status: 'added', categories: ['added'] }, 'all')).toBe(true)
    expect(tankMatchesFilter({ status: 'changed', categories: ['armor'] }, 'armor')).toBe(true)
    expect(tankMatchesFilter({ status: 'changed', categories: ['armor'] }, 'research')).toBe(false)
    expect(tankMatchesFilter({ status: 'modelOnly', categories: ['model'] }, 'modelOnly')).toBe(true)
    expect(mapMatchesFilter({ categories: ['scenery'] }, 'scenery')).toBe(true)
    expect(mapMatchesFilter({ categories: ['scenery'] }, 'lighting')).toBe(false)
  })
})