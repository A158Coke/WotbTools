import { describe, it, expect } from 'vitest'
import { hit, req } from '../test/penetrationTestHelpers.js'
import { calculate, isPrimary, ArmorSection, hasPrimaryLayer, matchHitsByOccurrence } from './penetration.js'
import { penetrationChance, resolveCardChance } from './armorInspectorChance.ts'



describe('probability_layers（到首个 Primary 为止的完整概率链，供 Armor Inspector 概率模型）', () => {
  it('确定性在间隙甲处截断时，概率链仍保留其后的主装甲', () => {
    const hits = [
      hit(ArmorSection.SPACED, 100.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0, 1]),
    ]
    const r = calculate(req('ap', 100.0, 100.0, hits))
    // 确定性：100mm 间隙甲等厚不穿透 → 只留下间隙甲层。
    expect(r.result).toBe('BLOCKED')
    expect(r.layers.map(l => l.part_name)).toEqual(['spaced'])
    // 概率：完整路径含间隙甲 + 主装甲；1× 消耗后剩余 0，主装甲 0%。
    expect(r.probability_layers.map(l => l.section)).toEqual(['spaced', 'hull'])
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBe(0)
  })

  it('外部模块耗尽时概率链仍含其后主装甲，概率为 0（P10 遇 20mm 履带）', () => {
    const hits = [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0, 1]),
    ]
    const r = calculate(req('ap', 10.0, 100.0, hits))
    expect(r.result).toBe('BLOCKED')
    expect(r.layers.map(l => l.part_name)).toEqual(['chassis'])
    expect(r.probability_layers.map(l => l.section)).toEqual(['chassis', 'hull'])
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBe(0)
  })

  it('概率链停在首个 Primary：其后的车体/履带命中不参与', () => {
    const hits = [
      hit(ArmorSection.HULL, 30.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0, 1]),
    ]
    const r = calculate(req('ap', 100.0, 100.0, hits))
    expect(r.result).toBe('PENETRATION')
    expect(r.layers).toHaveLength(1)
    expect(r.probability_layers.map(l => l.section)).toEqual(['hull'])
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBe(1)
  })

  it('Super Conqueror 炮塔相邻点击：首个 Primary 后的车体底板/履带不参与概率', () => {
    // 用户 2026-10-18 调试快照：板10(20) + 板9(225) 确定性击穿；其后的
    // Hull Plate 8(5) 与右侧履带(25) 曾把概率从 19% 压到 0（相邻点击 19% vs 0%）。
    const hits = [
      hit(ArmorSection.SPACED, 20.0, [-0.7413889015023738, 2.2819733858516886, -1.653710476213479], {
        plate_id: '10',
        normal: [-0.6347682297419488, 0.4539353516594762, -0.6253095161790361],
        part_name: 'Turret Plate 10',
      }),
      hit(ArmorSection.TURRET, 225.0, [-0.6509577896549565, 2.2321983421923504, -1.5360089235660648], {
        plate_id: '9',
        normal: [-0.4742724340731611, 0.5729971269861682, -0.6683860791069156],
        part_name: 'Turret Plate 9',
      }),
      hit(ArmorSection.HULL, 5.0, [0.09604195528521053, 1.821035146713257, -0.5637436488115966], {
        plate_id: '8', normal: [0, 1, 0], part_name: 'Hull Plate 8',
      }),
      hit(ArmorSection.CHASSIS, 25.0, [1.1176708936691284, 1.32302562660276, 0.6897291210208113], {
        plate_id: 'rightTrack', normal: [-1, 0, 0], part_name: 'Track (Right)',
      }),
    ]
    const r = calculate(req('ap', 252.0, 120.0, hits, {
      view_dir: [-0.5776371359476701, 0.3179427198635244, -0.7518296123856505],
      normalization_deg: 5,
    }))
    expect(r.result).toBe('PENETRATION')
    expect(r.layers).toHaveLength(2)
    expect(r.probability_layers.map(l => l.section)).toEqual(['spaced', 'turret'])
    // 1× 区间：[239.4,264.6] −20 → [219.4,244.6]；板9 eff≈229.64 →
    // Φ((232−229.64)/4.2) ≈ 0.713（不再被后方车体/履带耗尽）。
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBeCloseTo(0.713, 2)
  })

  it('外部模块在间隙甲之前：模块 flat 先平移间隙甲 CDF（chassis20→spaced80→hull1）', () => {
    const hits = [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.SPACED, 80.0, [0, 0, 1]),
      hit(ArmorSection.HULL, 1.0, [0, 0, 2]),
    ]
    const r = calculate(req('ap', 100.0, 100.0, hits))
    expect(r.probability_layers.map(l => l.section)).toEqual(['chassis', 'spaced', 'hull'])
    // [95,105] −20 → [75,85]；spaced80 → 50%；再平移 [−5,5]；hull1 → Φ(−0.6)=0.274253。
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBeCloseTo(0.1371265, 6)
  })

  it('前置模块厚于穿深但区间仍有正向尾部：保留负均值（P199/chassis200/spaced1/hull1）', () => {
    const hits = [
      hit(ArmorSection.CHASSIS, 200.0, [0, 0, 0]),
      hit(ArmorSection.SPACED, 1.0, [0, 0, 1]),
      hit(ArmorSection.HULL, 1.0, [0, 0, 2]),
    ]
    const r = calculate(req('ap', 199.0, 100.0, hits))
    expect(r.result).toBe('BLOCKED')
    expect(r.probability_layers.map(l => l.section)).toEqual(['chassis', 'spaced', 'hull'])
    // [189.05,208.95] −200 = [−10.95,8.95]（均值−1，区间未耗尽）；spaced1 →
    // Φ(−0.6030)≈0.2732；hull1 → Φ(−0.9045)≈0.1829；乘积≈4.9966%。
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBeCloseTo(0.049966, 5)
  })

  it('HE 命中首个 Primary 仍有击穿浮动（100 HE vs 102mm → 约 11.5%）', () => {
    const r = calculate(req('he', 100.0, 100.0, [hit(ArmorSection.HULL, 102.0, [0, 0, 0])], {
      explosion_radius: 3.0,
    }))
    // 名义溅射结果仍由 SPLASH/BLOCKED 分支持有；概率链单独给出击穿机会。
    expect(r.result).toBe('SPLASH')
    expect(r.probability_layers.map(l => l.section)).toEqual(['hull'])
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBeCloseTo(0.1150697, 5)
  })

  it('HEAT 名义耗尽但区间仍有正尾：gap 衰减后继续概率链（spaced100→0.1m→hull1）', () => {
    const hits = [
      hit(ArmorSection.SPACED, 100.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 1.0, [0, 0, 0.1]),
    ]
    const r = calculate(req('heat', 100.0, 100.0, hits))
    expect(r.result).toBe('BLOCKED')
    expect(r.probability_layers.map(l => l.section)).toContain('gap')
    expect(r.probability_layers.map(l => l.section)).toContain('hull')
    // [95,105] → spaced100 CDF 0.5 → [−5,5]；gap 0.1m ×0.95 → [−4.75,4.75]；
    // hull1 → Φ(−1/(9.5/6)) ≈ 0.2638；乘积 ≈ 13.1915483%。
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBeCloseTo(0.131915, 4)
  })

  it('同一块板的重合三角形命中只算一层（射线掠过四边形对角线）', () => {
    const hits = [
      hit(ArmorSection.SPACED, 30.0, [0, 0, 0]),
      hit(ArmorSection.SPACED, 30.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0, 1]),
    ]
    const r = calculate(req('ap', 100.0, 100.0, hits))
    expect(r.probability_layers.map(l => l.section)).toEqual(['spaced', 'hull'])
  })

  it('Super Conqueror 首上：20mm 间隙板 + 155mm 主甲 @42°，252AP 等效厚度足够 → 穿透', () => {
    // 用户实车截图：layer13 eff≈21.5（20mm 首层 2×口径增强转正）+ layer1
    // eff≈194（155mm 第二层仍独立套 5° 转正），252 − 21.5 > 194 → 穿透。
    const a = 42 * Math.PI / 180
    const normal = [Math.sin(a), Math.cos(a), 0]
    const hits = [
      hit(ArmorSection.SPACED, 20.0, [0, 0, 0], { normal }),
      hit(ArmorSection.HULL, 155.0, [0, 0, 1], { normal }),
    ]
    const r = calculate(req('ap', 252.0, 120.0, hits, { normalization_deg: 5 }))
    expect(r.result).toBe('PENETRATION')
    expect(r.layers).toHaveLength(2)
    expect(r.layers.every(l => l.penetrated)).toBe(true)
    expect(r.damage).toBe(400.0)
    expect(Math.abs(r.layers[0].effective - 21.5)).toBeLessThan(0.2)
    // 155mm @42° 是第二层，但 BlitzKit 仍对它独立套用 5° 转正：155/cos37° ≈ 194.1mm。
    expect(Math.abs(r.layers[1].effective - 194.1)).toBeLessThan(2.0)
    // 1× 概率区间也必须给出穿透，不能是 0%：252−21.5=230.5 >194。
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBeGreaterThan(0.999)
  })

  it('Super Conqueror 截图角度：20mm@49° + 155mm@48°，252AP 每层独立转正后穿透', () => {
    const a1 = 49 * Math.PI / 180
    const a2 = 48 * Math.PI / 180
    const hits = [
      hit(ArmorSection.SPACED, 20.0, [0, 0, 0], { normal: [Math.sin(a1), Math.cos(a1), 0] }),
      hit(ArmorSection.HULL, 155.0, [0, 0, 1], { normal: [Math.sin(a2), Math.cos(a2), 0] }),
    ]
    const r = calculate(req('ap', 252.0, 120.0, hits, { normalization_deg: 5 }))
    // 层0：20mm 首层 2× 增强转正 21° → 22.65；层1：155mm 独立 5° → 155/cos43°≈211.9。
    expect(Math.abs(r.layers[0].effective - 22.65)).toBeLessThan(0.2)
    expect(Math.abs(r.layers[1].effective - 211.9)).toBeLessThan(0.5)
    expect(r.result).toBe('PENETRATION')
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBeGreaterThan(0.999)
  })
})



// 点击判定的触发面（查看器相机点击路径依赖）：射线未触达 Primary 时，末层就是间隙甲/外部模块
// 自身 —— 末层规则照样给出 PENETRATION + 全额伤害，所以这种栈必须由查看器拦下
//（BlitzKit 的 shoot() 也只挂在 Primary 网格上，不由它们触发）。
describe('isPrimary（Primary = 击穿判定的触发面；spaced/外部模块不是）', () => {
  it('主装甲三类为 Primary，间隙甲与外部模块不是', () => {
    expect(isPrimary(ArmorSection.HULL)).toBe(true)
    expect(isPrimary(ArmorSection.TURRET)).toBe(true)
    expect(isPrimary(ArmorSection.GUN)).toBe(true)
    expect(isPrimary(ArmorSection.SPACED)).toBe(false)
    expect(isPrimary(ArmorSection.CHASSIS)).toBe(false)
    expect(isPrimary(ArmorSection.GUN_BARREL)).toBe(false)
  })

  it('spaced-only 栈按末层规则给出 PENETRATION——正是查看器要拦下的形态', () => {
    const r = calculate(req('ap', 300.0, 100.0, [hit(ArmorSection.SPACED, 10.0, [0, 0, 0])]))
    expect(r.result).toBe('PENETRATION')
    expect(r.damage).toBe(400.0)
  })
})



describe('hasPrimaryLayer（概率卡前置条件）', () => {
  it('链上存在正厚度 Primary 才允许概率模式', () => {
    expect(hasPrimaryLayer([
      { section: ArmorSection.CHASSIS, thickness: 30 },
      { section: ArmorSection.HULL, thickness: 100 },
    ])).toBe(true)
  })

  it('纯外部模块或 0mm Primary 链不得进入概率模式', () => {
    expect(hasPrimaryLayer([
      { section: ArmorSection.CHASSIS, thickness: 100 },
      { section: ArmorSection.GUN_BARREL, thickness: 60 },
    ])).toBe(false)
    expect(hasPrimaryLayer([{ section: ArmorSection.HULL, thickness: 0 }])).toBe(true)
    expect(hasPrimaryLayer([])).toBe(false)
  })
})



describe('matchHitsByOccurrence（同名装甲板按命中次序匹配）', () => {
  it('重复同名板各匹配各自的命中点；gap 层无对应 hit', () => {
    const hits = [
      { partName: 'screen', point: [1, 0, 0] },
      { partName: 'screen', point: [2, 0, 0] },
      { partName: 'hull', point: [3, 0, 0] },
    ]
    const layers = [
      { part_name: 'screen' },
      { part_name: 'Gap 0.50m' },
      { part_name: 'screen' },
      { part_name: 'hull' },
    ]
    const matched = matchHitsByOccurrence(layers, hits)
    expect(matched[0]).toBe(hits[0])
    expect(matched[1]).toBeNull()
    expect(matched[2]).toBe(hits[1])
    expect(matched[3]).toBe(hits[2])
  })

  it('无匹配时返回 null，不重复消费同一命中', () => {
    const hits = [{ partName: 'screen', point: [1, 0, 0] }]
    const layers = [{ part_name: 'screen' }, { part_name: 'screen' }, { part_name: 'unknown' }]
    const matched = matchHitsByOccurrence(layers, hits)
    expect(matched[0]).toBe(hits[0])
    expect(matched[1]).toBeNull()
    expect(matched[2]).toBeNull()
  })

  it('先按判定规则过滤重合三角形，再做 occurrence 匹配', () => {
    const hits = [
      { section: ArmorSection.SPACED, plate_id: '2', partName: 'screen', point: [0, 0, 0] },
      { section: ArmorSection.SPACED, plate_id: '2', partName: 'screen', point: [0, 0, 0] },
      { section: ArmorSection.SPACED, plate_id: '2', partName: 'screen', point: [1, 0, 0] },
      { section: ArmorSection.HULL, plate_id: '1', partName: 'hull', point: [2, 0, 0] },
    ]
    const layers = [{ part_name: 'screen' }, { part_name: 'screen' }, { part_name: 'hull' }]
    const matched = matchHitsByOccurrence(layers, hits)
    expect(matched[0]).toBe(hits[0])
    expect(matched[1]).toBe(hits[2])
    expect(matched[2]).toBe(hits[3])
  })
})



describe('require_primary（射击复现无主装甲链门禁）', () => {
  const track = [hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0])]

  it('纯外部模块：默认仍按 BlitzKit 末层给 PEN；射击复现门禁为 BLOCKED/0 伤', () => {
    const base = calculate(req('ap', 100.0, 100.0, track))
    expect(base.result).toBe('PENETRATION')
    expect(base.damage).toBe(400.0)
    expect(base.blocked_no_primary).toBe(false)
    const gated = calculate(req('ap', 100.0, 100.0, track, { require_primary: true }))
    expect(gated.result).toBe('BLOCKED')
    expect(gated.damage).toBe(0)
    expect(gated.blocked_no_primary).toBe(true)
    expect(gated.layers).toHaveLength(1)
    // 卡片不能用概率链把 BLOCKED/0 回填成「可能击穿 + 满伤」。
    expect(resolveCardChance({
      heInfo: null, heChance: 0, probabilityMode: false,
      overallChance: null, rawChance: 0.73, allowChance: false,
    })).toEqual({ chance: 0, unavailable: true })
  })

  it('无主装甲阻断覆盖原结果已 BLOCKED 的临界厚度（99/100/101mm）', () => {
    for (const thickness of [99, 100, 101]) {
      const r = calculate(req('ap', 100, 100, [hit(ArmorSection.SPACED, thickness, [0, 0, 0])], {
        require_primary: true,
      }))
      expect(r.blocked_no_primary, `spaced ${thickness}mm`).toBe(true)
      expect(r.result).toBe('BLOCKED')
      expect(r.damage).toBe(0)
    }
  })

  it('纯间隙甲：同样被门禁拦下；有主装甲的链不受影响', () => {
    const spaced = calculate(req('ap', 300.0, 100.0, [hit(ArmorSection.SPACED, 10.0, [0, 0, 0])], { require_primary: true }))
    expect(spaced.result).toBe('BLOCKED')
    expect(spaced.damage).toBe(0)
    expect(spaced.blocked_no_primary).toBe(true)

    const withPrimary = calculate(req('ap', 200.0, 100.0, [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0.6, 0]),
    ], { require_primary: true }))
    expect(withPrimary.result).toBe('PENETRATION')
    expect(withPrimary.damage).toBe(400.0)
    expect(withPrimary.blocked_no_primary).toBe(false)
  })

  it('间隙甲跳弹保留 RICOCHET（门禁只拦“无主装甲的击穿”）', () => {
    const a = 75 * Math.PI / 180
    const h = hit(ArmorSection.SPACED, 100.0, [0, 0, 0], {
      normal: [0.0, Math.cos(a), Math.sin(a)],
    })
    const r = calculate(req('ap', 300.0, 100.0, [h], { require_primary: true }))
    expect(r.result).toBe('RICOCHET')
    expect(r.blocked_no_primary).toBe(false)
  })

  it('HE 不受门禁影响（溅射仍按 800 射线/单射线语义）', () => {
    const r = calculate(req('he', 80.0, 100.0, track, {
      require_primary: true,
      damage: 400.0,
      explosion_radius: 3.0,
    }))
    expect(r.result).not.toBe('BLOCKED')
    expect(r.blocked_no_primary).toBe(false)
  })

  it('0mm Primary 是合法主装甲，不触发门禁', () => {
    const r = calculate(req('ap', 100.0, 100.0, [hit(ArmorSection.HULL, 0.0, [0, 0, 0])], {
      require_primary: true,
    }))
    expect(r.result).toBe('PENETRATION')
    expect(r.blocked_no_primary).toBe(false)
  })
})
