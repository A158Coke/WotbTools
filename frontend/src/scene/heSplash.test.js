// Armor Inspector HE 溅射采样（wasm func7695）纯函数测试。
// 数值锚点来自 Agent 仓 tmp_analysis/armor-inspector/HE_MECHANISM_EXACT_DECOMPILED.md。
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computeHeSplash, heLayersFromHits, sampleHeSplash, HE_SAMPLE_DIRECTIONS } from './heSplash.js'

const L = (armor, primary, distance) => ({ armor, primary, distance })
const splash = (rays, damage = 200, R = 1.09) => computeHeSplash(rays, { damage, explosionRadius: R })

describe('HE 溅射采样（Armor Inspector func7695）', () => {
  it('固定 800 条世界空间方向，全部单位向量', () => {
    expect(HE_SAMPLE_DIRECTIONS).toHaveLength(800)
    for (const d of HE_SAMPLE_DIRECTIONS) {
      expect(d.length()).toBeCloseTo(1, 6)
    }
  })

  it('没有空间网格时 fail-closed（不回落 800×triTotal 暴力全扫）', () => {
    const r = sampleHeSplash({ ok: true }, new THREE.Vector3(0, 0, 0), {
      damage: 500,
      explosionRadius: 2.4,
    })
    expect(r).toBeNull()
  })

  it('sampleStats 按射线顺序暴露 armor/upper/valid，供方向化热力图', () => {
    const r = splash([
      [L(20, false, 0.1), L(50, true, 0.2)],
      [L(20, false, 0.1)],
    ])
    expect(r.sampleStats).toHaveLength(2)
    expect(r.sampleStats[0]).toMatchObject({ armor: 70, distance: 0.2, valid: true })
    expect(r.sampleStats[1]).toMatchObject({ valid: false })
    expect(r.best.index).toBe(0)
    expect(r.bestLower.index).toBe(0)
  })

  it('T-34 单层 50mm 主装 @0.0495m → 21.59 / 69.32', () => {
    const r = splash([[L(50, true, 0.0495)]])
    expect(r).not.toBeNull()
    expect(r.min).toBeCloseTo(21.59, 2)
    expect(r.max).toBeCloseTo(69.32, 2)
    expect(r.avg).toBeCloseTo((21.59 + 69.32) / 2, 2)
    expect(r.samples).toBe(1)
  })

  it('liningFactor 乘到每层装甲（强化装甲 1.04 与判定链同口径）', () => {
    const r = computeHeSplash([[L(50, true, 0.1)]], {
      damage: 200, explosionRadius: 1.09, liningFactor: 1.04,
    })
    expect(r.best.armor).toBeCloseTo(52, 6)
    const falloff = 1 - 0.1 / 1.09
    expect(r.max).toBeCloseTo(0.5 * 200 * 1.25 * falloff - 52, 6)
    expect(r.min).toBeCloseTo(0.5 * 200 * 0.75 * falloff - 52, 6)
  })

  it('履带+主装 20+20 @0.3542m → 10.63 / 44.38（层装甲直接相加）', () => {
    const r = splash([[L(20, false, 0.1072), L(20, true, 0.3542)]])
    expect(r.min).toBeCloseTo(10.63, 2)
    expect(r.max).toBeCloseTo(44.38, 2)
  })

  it('he_min/max 是两个 roll 界各自的最大值（可来自不同射线）', () => {
    // A: k=50 d=0.05 → upper 69.266 / lower 21.596
    // B: k=10 d=0.50 → upper 57.661 / lower 30.596
    const r = splash([
      [L(50, true, 0.05)],
      [L(10, true, 0.5)],
    ])
    expect(r.max).toBeCloseTo(69.266, 2)   // A 的 upper
    expect(r.min).toBeCloseTo(30.596, 2)   // B 的 lower（不是 A 的 lower）
    expect(r.avg).toBeCloseTo((69.266 + 30.596) / 2, 2)
    expect(r.best.distance).toBeCloseTo(0.05, 6)
    expect(r.bestLower.distance).toBeCloseTo(0.5, 6)
  })

  it('没有主装层的射线被跳过；没有有效样本返回 null', () => {
    expect(splash([[L(20, false, 0.1)]])).toBeNull()
    expect(splash([])).toBeNull()
  })

  it('主装之后的层不再计入（遇到 primary 即停）', () => {
    const a = splash([[L(20, false, 0.1), L(50, true, 0.2), L(100, false, 0.3)]])
    const b = splash([[L(20, false, 0.1), L(50, true, 0.2)]])
    expect(a.min).toBeCloseTo(b.min, 6)
    expect(a.max).toBeCloseTo(b.max, 6)
  })

  it('履带/外部模块永远不是主装；仅模块的射线被跳过', () => {
    const layers = heLayersFromHits([
      { t: 0.1, section: 'chassis', thickness: 20, variant: 'track' },
    ])
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({ armor: 20, primary: false, section: 'chassis' })
    expect(splash([layers])).toBeNull()
  })

  it('heLayersFromHits：同一模块的不同层全部累加、同位置同 section 去重、主装后截断', () => {
    const layers = heLayersFromHits([
      { t: 0.1, section: 'chassis', thickness: 20, variant: 'track' },
      { t: 0.1, section: 'chassis', thickness: 20, variant: 'track' },
      // 同一 variant 的下一层（轮组/履带板）不是重复命中，保留——游戏 2240 层表
      // 会把这些层逐个交给 7695 累加（AI 实测履带射线出现 17×20mm）。
      { t: 0.2, section: 'chassis', thickness: 20, variant: 'track' },
      { t: 0.3, section: 'hull', thickness: 50, variant: null },
      { t: 0.4, section: 'turret', thickness: 60, variant: null },
    ])
    expect(layers).toEqual([
      { armor: 20, primary: false, distance: 0.1, section: 'chassis' },
      { armor: 20, primary: false, distance: 0.2, section: 'chassis' },
      { armor: 50, primary: true, distance: 0.3, section: 'hull' },
    ])
  })
})
