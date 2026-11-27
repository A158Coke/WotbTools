import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, LineSegments, Mesh } from 'three'
import { armorComparisonChoices, armorCompareWidth } from './armorComparisonModel.js'
import { createArmorThicknessScene } from './armorComparisonScene.js'

const cfg = { turret_local: 11, gun_local: 22, turret_index: 0, gun_index: 0, label: 'Gun' }

describe('armor version comparison', () => {
  it('matches local configurations and isolates new, removed, and changed plate IDs by side', () => {
    const other = { ...cfg, gun_local: 24 }
    const old = { configs: [cfg, other] }
    const next = { configs: [other, cfg] }
    const choices = armorComparisonChoices(old, next, {
      armor: { model: {
        plates: [{ module: 'hull', plate: '3', old: 20, new: 30 }],
        addedPlates: [{ module: 'hull', plate: '9' }],
        removedPlates: [{ module: 'hull', plate: '8' }],
        primary: [{ module: 'hull', old: 'armor_1', new: 'armor_15' }],
      } },
      configs: { configs: [{
        key: { turretLocal: 11, gunLocal: 22 },
        changes: [
          { category: 'armor', path: 'gun_plates', old: { '3': 4, '5': 50 }, new: { '3': 4, '5': 60, '6': 90 } },
          { category: 'armor', path: 'gun_spaced', old: ['5'], new: ['6'] },
        ],
      }] },
    })
    expect(choices.map(choice => choice.key)).toEqual(['11/22', '11/24'])
    expect(choices[0].highlights[0]).toEqual(new Set(['hull:3', 'hull:8', 'hull:1', 'gun:5', 'gun:6']))
    expect(choices[0].highlights[1]).toEqual(new Set(['hull:3', 'hull:9', 'hull:15', 'gun:5', 'gun:6']))
    expect(choices[1].highlights[1].has('gun:5')).toBe(false)
    // 标注口径：改动板件在每一侧的厚度值（供画内旁注与文字版共用）。
    expect(choices[0].changes.get('hull:3'))
      .toEqual({ module: 'hull', plate: '3', left: 20, right: 30, kind: 'thickness' })
    expect(choices[0].changes.get('gun:5'))
      .toEqual({ module: 'gun', plate: '5', left: 50, right: 60, kind: 'thickness' })
    expect(choices[0].changes.get('gun:6'))
      .toEqual({ module: 'gun', plate: '6', left: null, right: 90, kind: 'thickness' })
    expect(armorComparisonChoices({ configs: [cfg, cfg] }, { configs: [cfg] }, {})).toEqual([])
  })

  it('registers spaced membership changes without thickness values', () => {
    const tank = { configs: [cfg] }
    const choices = armorComparisonChoices(tank, tank, {
      armor: { model: { spaced: [{ module: 'turret', old: ['5'], new: ['6'] }] } },
    })
    expect(choices[0].highlights[0]).toEqual(new Set(['turret:5', 'turret:6']))
    expect(choices[0].highlights[1]).toEqual(new Set(['turret:5', 'turret:6']))
    expect(choices[0].changes.get('turret:5'))
      .toEqual({ module: 'turret', plate: '5', left: null, right: null, kind: 'spaced' })
    expect(choices[0].changes.get('turret:6'))
      .toEqual({ module: 'turret', plate: '6', left: null, right: null, kind: 'spaced' })
  })

  it('outlines only matched collision meshes and preserves both end stops', () => {
    const tank = {
      armor_model: { hull: { plates: { '1': 90, '2': 100 } } },
      model_origins: { track: [0, 0, 0], turret: [0, 0, 1] },
      configs: [cfg],
    }
    const choice = armorComparisonChoices(tank, tank, {
      armor: { model: { plates: [{ module: 'hull', plate: '2', old: 90, new: 100 }] } },
    })[0]
    const collision = new Group()
    for (const name of ['hull_armor_1', 'hull_armor_2', 'hull_armor_99']) {
      const mesh = new Mesh(new BoxGeometry())
      mesh.name = name
      collision.add(mesh)
    }
    const model = createArmorThicknessScene({ tank, collision: '', chassis: null }, { collision, chassis: null }, choice, 1)
    expect(model.matched).toBe(1)
    // 新版侧的改动板件带标注锚点（板件几何中心 + 该侧厚度）。
    expect(model.anchors).toHaveLength(1)
    expect(model.anchors[0].key).toBe('hull:2')
    expect(model.anchors[0].left).toBe(90)
    expect(model.anchors[0].right).toBe(100)
    expect(model.anchors[0].kind).toBe('thickness')
    expect(model.anchors[0].plate).toBe('2')
    expect(model.scene.children[0].children).toHaveLength(2)
    // 每块板一条查看器同款 45° 勾线；改动板额外一条白色 0° 轮廓（只标改动板）。
    const lines = model.scene.children[0].children
      .flatMap(mesh => mesh.children)
      .filter(child => (child as LineSegments).isLineSegments) as LineSegments[]
    expect(lines).toHaveLength(3)
    const white = lines.filter(line => ((line.material as { color?: { getHex(): number } }).color?.getHex()) === 0xffffff)
    expect(white).toHaveLength(1)
    model.dispose()
    expect([0, 50, 100].map(percent => armorCompareWidth(401, percent))).toEqual([0, 201, 401])
  })
})
