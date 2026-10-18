import { describe, it, expect } from 'vitest'
import {
  ARMOR_INSPECTOR_BLITZ_RANDOMIZATION,
  ARMOR_INSPECTOR_PC_RANDOMIZATION,
  normalCdf,
  penetrationChanceForLayer,
  penetrationChance,
} from './armorInspectorChance.js'

describe('normalCdf（高斯 CDF）', () => {
  it('标准点与对称性', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 5)
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 5)
    expect(normalCdf(3)).toBeCloseTo(0.9986501, 5)
    expect(normalCdf(-3)).toBeCloseTo(0.0013499, 5)
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 6)
  })

  it('单调递增', () => {
    let prev = -1
    for (let z = -4; z <= 4; z += 0.25) {
      const v = normalCdf(z)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})

describe('Armor Inspector 单层概率（±range = ±3σ）', () => {
  it('Blitz ±5%：中点 50%，0.99P/1.01P 约 72.6%/27.4%', () => {
    const p = 145
    expect(penetrationChanceForLayer(p, p)).toBeCloseTo(0.5, 6)
    expect(penetrationChanceForLayer(p, 0.99 * p)).toBeCloseTo(normalCdf(0.6), 6)
    expect(penetrationChanceForLayer(p, 1.01 * p)).toBeCloseTo(normalCdf(-0.6), 6)
    expect(penetrationChanceForLayer(p, 0.99 * p)).toBeCloseTo(0.7257469, 5)
    expect(penetrationChanceForLayer(p, 1.01 * p)).toBeCloseTo(0.2742531, 5)
  })

  it('Blitz ±5%：区间外夹到 1/0', () => {
    const p = 145
    expect(penetrationChanceForLayer(p, 0.95 * p)).toBe(1)
    expect(penetrationChanceForLayer(p, 0.949 * p)).toBe(1)
    expect(penetrationChanceForLayer(p, 1.05 * p)).toBe(0)
    expect(penetrationChanceForLayer(p, 1.051 * p)).toBe(0)
  })

  it('PC ±25%：σ=P/12，0.90P 约 88.5%', () => {
    const p = 145
    expect(penetrationChanceForLayer(p, p, ARMOR_INSPECTOR_PC_RANDOMIZATION)).toBeCloseTo(0.5, 6)
    expect(penetrationChanceForLayer(p, 0.9 * p, ARMOR_INSPECTOR_PC_RANDOMIZATION)).toBeCloseTo(normalCdf(1.2), 5)
    expect(penetrationChanceForLayer(p, 1.1 * p, ARMOR_INSPECTOR_PC_RANDOMIZATION)).toBeCloseTo(normalCdf(-1.2), 5)
  })

  it('非正穿深/无效厚度 fail-closed', () => {
    expect(penetrationChanceForLayer(0, 10)).toBe(0)
    expect(penetrationChanceForLayer(-1, 10)).toBe(0)
    expect(penetrationChanceForLayer(100, NaN)).toBe(0)
  })

  it('默认随机化是 Blitz ±5%', () => {
    expect(ARMOR_INSPECTOR_BLITZ_RANDOMIZATION).toBe(0.05)
    expect(penetrationChanceForLayer(100, 100)).toBe(
      penetrationChanceForLayer(100, 100, ARMOR_INSPECTOR_BLITZ_RANDOMIZATION),
    )
  })
})

describe('Armor Inspector 逐层概率', () => {
  it('两层 25mm @ P=100：第一层 100%，第二层 50%（3× 消耗后区间 25）', () => {
    const layers = [
      { section: 'hull', name: 'hull', thickness: 25, effective: 25, remaining_before: 100 },
      { section: 'hull', name: 'hull', thickness: 25, effective: 25, remaining_before: 25 },
    ]
    expect(penetrationChance(100, layers)).toBeCloseTo(0.5, 5)
  })

  it('外部模块 flat 消耗：10mm 模块 + 90mm 装甲 @ P=100 → 50%', () => {
    const layers = [
      { section: 'chassis', name: 'chassis', thickness: 10, effective: 10, remaining_before: 100 },
      { section: 'hull', name: 'hull', thickness: 90, effective: 90, remaining_before: 90 },
    ]
    expect(penetrationChance(100, layers)).toBeCloseTo(0.5, 5)
  })

  it('没有外部模块时 90mm 装甲 @ P=100 → 约 100%', () => {
    const layers = [
      { section: 'hull', name: 'hull', thickness: 90, effective: 90, remaining_before: 100 },
    ]
    expect(penetrationChance(100, layers)).toBeGreaterThan(0.999)
  })

  it('HEAT Gap 层不参与 CDF，区间继续按当前值推进', () => {
    const layers = [
      { section: 'hull', name: 'hull', thickness: 20, effective: 20, remaining_before: 100 },
      { name: 'Gap 0.50m', thickness: 0, remaining_before: 80 },
      { section: 'hull', name: 'hull', thickness: 30, effective: 30, remaining_before: 60 },
    ]
    // 第一层后区间 100-60=40；gap 不参与 CDF；第二层用 40 → Φ(10/(40/60)) ≈ 1。
    expect(penetrationChance(100, layers)).toBeGreaterThan(0.999)
  })

  it('单层 integration：与 Armor Inspector 公式一致', () => {
    const p = 145
    const layer = (t) => [{ section: 'hull', name: 'hull', thickness: t, effective: t, remaining_before: p }]
    expect(penetrationChance(p, layer(p))).toBeCloseTo(0.5, 5)
    expect(penetrationChance(p, layer(0.99 * p))).toBeCloseTo(0.7257469, 5)
    expect(penetrationChance(p, layer(1.01 * p))).toBeCloseTo(0.2742531, 5)
  })

  it('跳弹 → 0', () => {
    expect(penetrationChance(100, [{ ricochet: true, thickness: 50 }])).toBe(0)
  })

  it('跳弹 → 续飞：概率按续飞段（seg=1）计算', () => {
    const layers = [
      { name: 'hull', thickness: 50, eff: 50, remainBefore: 100, ricochet: true, seg: 0 },
      { name: 'hull', thickness: 25, eff: 25, remainBefore: 75, seg: 1 },
    ]
    expect(penetrationChance(100, layers)).toBeGreaterThan(0.999)
  })

  it('camelCase 字段（tankViewer trajLayers）同样可用', () => {
    const layers = [
      { name: 'hull', thickness: 25, eff: 25, remainBefore: 100, angle: 0 },
      { name: 'hull', thickness: 25, eff: 25, remainBefore: 25, angle: 0 },
    ]
    expect(penetrationChance(100, layers)).toBeCloseTo(0.5, 5)
  })
})
