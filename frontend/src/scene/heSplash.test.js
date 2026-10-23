// Armor Inspector HE 溅射采样（wasm func7695）纯函数测试。
// 数值锚点来自 Agent 仓 tmp_analysis/armor-inspector/HE_MECHANISM_EXACT_DECOMPILED.md。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import * as THREE from 'three'
import { computeHeSplash, heLayersFromHits, heSampleFromHits, sampleHeSplash, HE_SAMPLE_DIRECTIONS } from './heSplash.js'

const splashSource = fs.readFileSync(new URL('./heSplash.js', import.meta.url), 'utf8')

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

  it('热力图方向子集仍走同一网格 DDA；没有网格同样 fail-closed', () => {
    expect(splashSource).toContain('Array.isArray(opts.directions)')
    expect(splashSource).toContain('result.inwardLayers = rays[rays.length - 1] || []')
    // 射线截到爆炸半径：超过 R 的层 falloff ≤ 0，不可能抬高 min/max。
    expect(splashSource).toContain('const tMax = explosionRadius + 1e-4')
    expect(splashSource).toContain(
      'raycastGridAll(opts.grid, ro, dirs[i], RC.MIN_CONTINUATION_T, tMax, twoSidedSpaced)')
    const r = sampleHeSplash({ ok: true }, new THREE.Vector3(0, 0, 0), {
      damage: 500,
      explosionRadius: 2.4,
      directions: HE_SAMPLE_DIRECTIONS.slice(0, 4),
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

  it('爆炸半径之外的层对 min/max 没有贡献（DDA 截断到 R 的依据）', () => {
    const r = splash([[L(50, true, 1.5)]], 200, 1.0)
    expect(r).not.toBeNull()
    expect(r.min).toBe(0)
    expect(r.max).toBe(0)
    expect(r.avg).toBe(0)
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

  it('没有主装层的射线被跳过；零有效样本返回 samples:0 的权威零结果（不是 null）', () => {
    // null 只表示“采样器跑不了”（pack/grid/入参），调用方要报错；
    // “跑了但所有射线都没遇到主装”是确定性的零伤害（func7695 skip 所有样本）。
    for (const r of [splash([[L(20, false, 0.1)]]), splash([])]) {
      expect(r).not.toBeNull()
      expect(r).toMatchObject({ min: 0, max: 0, avg: 0, samples: 0, best: null, bestLower: null })
    }
    expect(splash([]).sampleStats).toEqual([])
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
    expect(splash([layers])).toMatchObject({ min: 0, max: 0, avg: 0, samples: 0 })
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

  it('lean 单射线积分与层链口径逐值一致（热力图快路径）', () => {
    const cases = [
      // 模块 + 主装
      [{ t: 0.1, section: 'chassis', thickness: 20 }, { t: 0.25, section: 'hull', thickness: 50 }],
      // 重合三角形去重 + 多模块累加 + 主装截断
      [
        { t: 0.1, section: 'chassis', thickness: 20 },
        { t: 0.1, section: 'chassis', thickness: 20 },
        { t: 0.2, section: 'chassis', thickness: 20 },
        { t: 0.3, section: 'hull', thickness: 50 },
        { t: 0.4, section: 'turret', thickness: 60 },
      ],
      // 仅模块 → 无效
      [{ t: 0.1, section: 'chassis', thickness: 20 }],
      // 主装超出爆炸半径 → 有效但 negative（热点不会选它）
      [{ t: 1.5, section: 'hull', thickness: 50 }],
      // 半径边界：模块在 R 内、主装刚越过 R
      [{ t: 0.99, section: 'spaced', thickness: 20 }, { t: 1.2, section: 'hull', thickness: 50 }],
    ]
    const opts = { damage: 200, explosionRadius: 1.09, liningFactor: 1.04 }
    for (const hits of cases) {
      const ref = computeHeSplash([heLayersFromHits(hits)], opts)
      const got = heSampleFromHits(hits, opts)
      if (!ref || ref.samples === 0) {
        expect(got.valid).toBe(false)
        continue
      }
      const stat = ref.sampleStats[0]
      expect(got.valid).toBe(true)
      expect(got.armor).toBeCloseTo(stat.armor, 10)
      expect(got.distance).toBeCloseTo(stat.distance, 10)
      expect(got.upper).toBeCloseTo(stat.upper, 10)
      expect(got.lower).toBeCloseTo(stat.lower, 10)
    }
  })
})
