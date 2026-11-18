import { describe, it, expect } from 'vitest'
import { hit, req } from '../test/penetrationTestHelpers.js'
import { calculate, ArmorSection, parseShellType, withGapOrigin, SHELL_TOKEN_KIND } from './penetration.js'
import { shellTypeOf } from './viewer/armorPlateModel.ts'
import { evaluateProbabilityChain } from './armorInspectorChance.ts'



// HE 白色遮罩（击穿视图）的权威侧：判定链对「击穿」的定义必须可复现——
// 首层非主装（履带/炮管/间隙甲）时 HE 一律 penetrated=false（卡片走 SPLASH/BLOCKED），
// 首层主装时卡片只在概率链 CDF 夹到 100%（厚度 <= 0.95×穿深）才写 PENETRATION。
describe('HE「击穿」权威口径（白色遮罩与点击卡片同源）', () => {
  it('HE 首层外部模块/间隙甲：必定 blocked（被前置层提前挡下，不计击穿）', () => {
    for (const section of [ArmorSection.CHASSIS, ArmorSection.GUN_BARREL, ArmorSection.SPACED]) {
      const r = calculate(req('he', 300.0, 150.0, [
        hit(section, 20.0, [0, 0, 0]),
        hit(ArmorSection.HULL, 10.0, [0, 0, 1.0]),
      ], { explosion_radius: 5.0, he_splash: { min: 0, max: 0, avg: 0, samples: 0 } }))
      expect(r.layers[0].penetrated).toBe(false)
      expect(r.result).not.toBe('PENETRATION')
    }
  })

  it('HE 首层主装：penetrated 取决于剩余穿深 vs 等效厚度', () => {
    const thin = calculate(req('he', 300.0, 150.0, [hit(ArmorSection.HULL, 10.0, [0, 0, 0])],
      { explosion_radius: 5.0, he_splash: { min: 0, max: 0, avg: 0, samples: 0 } }))
    const thick = calculate(req('he', 300.0, 150.0, [hit(ArmorSection.HULL, 400.0, [0, 0, 0])],
      { explosion_radius: 5.0, he_splash: { min: 0, max: 0, avg: 0, samples: 0 } }))
    expect(thin.layers[0].penetrated).toBe(true)
    expect(thick.layers[0].penetrated).toBe(false)
  })

  it('卡片「击穿」= 概率链 CDF 100%：厚度 <= 0.95×穿深 才夹到 1', () => {
    // 层必须带 section（否则 isExternalLayer 按“无角度模块”扁平消耗，不参与 CDF）。
    const chance = (pen, effective) => evaluateProbabilityChain(pen, [{
      section: ArmorSection.HULL, thickness: effective, effective, angle_deg: 0,
    }]).chance
    expect(chance(100, 95)).toBe(1)
    expect(chance(100, 96)).toBeLessThan(1)
    expect(chance(100, 104)).toBeGreaterThan(0)
    expect(chance(100, 105)).toBe(0)
  })
})



// —— 弹种词表 SSOT（2026-11-06）：parseShellType ↔ shellTypeOf 共用 SHELL_TOKEN_KIND ——
// 两处解析器的已知 token 必须逐条一致；未知 token 的默认值差异是契约（判定链兜底
// 'he' = 上游行为，查看器 fail-closed null），分别锁定。
describe('弹种词表 SSOT（判定链 ↔ 查看器）', () => {
  it('词表内每个 token 两个解析器口径一致', () => {
    const tokens = Object.keys(SHELL_TOKEN_KIND)
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) {
      const kind = SHELL_TOKEN_KIND[token]
      expect(parseShellType(token)).toBe(kind)
      expect(shellTypeOf({ type: token })).toBe(kind)
      // 大小写不敏感（两处都 lower-case 后查表）
      expect(parseShellType(token.toUpperCase())).toBe(kind)
      expect(shellTypeOf({ type: token.toUpperCase() })).toBe(kind)
    }
  })

  it('type_id 枚举优先于词表（两处一致）', () => {
    const byId = [[0, 'ap'], [1, 'apcr'], [2, 'heat'], [3, 'he']]
    for (const [id, kind] of byId) {
      expect(parseShellType('he', id)).toBe(kind)
      expect(shellTypeOf({ type: 'he', type_id: id })).toBe(kind)
    }
  })

  it('未知 token：判定链保持上游 he 兜底；查看器 fail-closed null', () => {
    expect(parseShellType('unknown_kind')).toBe('he')
    expect(shellTypeOf({ type: 'unknown_kind' })).toBe(null)
    expect(shellTypeOf(null)).toBe(null)
  })

  it('原型属性 token 不命中（无原型对象）：constructor/__proto__/toString/hasOwnProperty', () => {
    // review P2（2026-11-06）：普通对象查表会把原型属性当命中，绕过未知值兜底
    //（constructor → Object 函数、__proto__ → 原型对象，均为真值）。
    expect(Object.getPrototypeOf(SHELL_TOKEN_KIND)).toBe(null)
    for (const token of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(parseShellType(token)).toBe('he')
      expect(shellTypeOf({ type: token })).toBe(null)
    }
  })
})



// 收集链语义：确定性判定与概率链共享同一层集合——保留首个 Primary 之前的全部
// 间隔层（外部模块 + 间隙甲），停在首个 Primary（含）；其后的命中不进入任一链。
// 差异只发生在判定循环：确定性链在某层未穿透时截断，概率链仍评估到首个 Primary。
describe('收集链：deterministic 与 probability 在首个 Primary 处得到同一层集合', () => {
  // chassis(外部模块) → spaced(间隙甲) → hull(首个 Primary) → chassis/spaced(其后的命中)
  const chainHits = () => [
    hit(ArmorSection.CHASSIS, 30.0, [0, 0, 0]),
    hit(ArmorSection.SPACED, 200.0, [0, 0, 1]),
    hit(ArmorSection.HULL, 40.0, [0, 0, 2]),
    hit(ArmorSection.CHASSIS, 30.0, [0, 0, 3]),
    hit(ArmorSection.SPACED, 10.0, [0, 0, 4]),
  ]
  const calc = (pen) => calculate(req('ap', pen, 100.0, chainHits()))
  const names = (layers) => layers.map((layer) => layer.part_name)

  it('pen=100：确定性链在未穿透的间隙层截断，概率链仍含到首个 Primary 的全部前置层', () => {
    const r = calc(100.0)
    // 200mm 间隙甲未穿透：确定性判定在此截断，其后的层不评估。
    expect(names(r.layers)).toEqual(['chassis', 'spaced'])
    // 概率链不因未穿透截断：同一收集链上的 hull（首个 Primary）仍在。
    expect(names(r.probability_layers)).toEqual(['chassis', 'spaced', 'hull'])
  })

  it('pen=400：两链都含前置的模块/间隙层并停在首个 Primary，其后的命中不进入任一链', () => {
    const r = calc(400.0)
    expect(names(r.layers)).toEqual(['chassis', 'spaced', 'hull'])
    expect(names(r.probability_layers)).toEqual(['chassis', 'spaced', 'hull'])
    // 判别：收集若越过首个 Primary，其后的 spaced(10mm) 会作为第 4 层出现。
    expect(r.layers).toHaveLength(3)
    expect(r.probability_layers).toHaveLength(3)
  })
})



describe('withGapOrigin（HEAT 间隙原点）', () => {
  const h = (distance, point) => ({ distance, point })

  it('被去重删掉的接触面在首层之前：首层间距原点前移到它（不改输入）', () => {
    const hits = [h(1.0, [0, 0, -1]), h(1.1, [0, 0, -1.1])]
    const contact = h(0, [0, 0, 0])
    const out = withGapOrigin(hits, contact)
    expect(out[0].point).toEqual([0, 0, 0])
    expect(out[0].distance).toBe(1.0)
    expect(out[1]).toBe(hits[1])
    expect(hits[0].point).toEqual([0, 0, -1])
  })

  it('首层就是接触面 / 无接触面 / 空链：原样返回', () => {
    const hits = [h(1.0, [0, 0, -1])]
    expect(withGapOrigin(hits, h(1.0, [0, 0, -1]))).toBe(hits)
    expect(withGapOrigin(hits, null)).toBe(hits)
    expect(withGapOrigin([], h(0, [0, 0, 0]))).toEqual([])
  })

  it('与首层重合的命中一起搬（共享边/对角线的两个三角形命中保持重合）', () => {
    const hits = [h(1.0, [0, 0, -1]), h(1.0, [0, 0, -1]), h(1.1, [0, 0, -1.1])]
    const out = withGapOrigin(hits, h(0, [0, 0, 0]))
    expect(out[0].point).toEqual([0, 0, 0])
    expect(out[1].point).toEqual([0, 0, 0])
    expect(out[2].point).toEqual([0, 0, -1.1])
  })
})



describe('HEAT 间隙衰减（首触面在前 vs 被去重）', () => {
  const heatReq = (hits, penetration = 250) => ({
    shell_type: 'heat', penetration, caliber: 75, view_dir: [0, 1, 0],
    hits, damage: 400, explosion_radius: 0,
    calibrated_shells: false, enhanced_armor: false, allow_ricochet: true,
  })
  const screen = (point, distance) => ({
    section: ArmorSection.SPACED, plate_id: '2', thickness: 20,
    normal: [0, 1, 0], point, distance, part_name: 'spaced-2',
  })
  const hull = (point, distance, thickness = 150) => ({
    section: ArmorSection.HULL, plate_id: '1', thickness,
    normal: [0, 1, 0], point, distance, part_name: 'hull-1',
  })

  it('近侧背面被同板去重删掉后，若只按保留点算 gap 会低估衰减（PENETRATION）', () => {
    // 保留链 = [front@-1, primary@-1.1] → 只看到 0.1m 间隙。
    const r = calculate(heatReq([screen([0, 0, -1], 1.0), hull([0, 0, -1.1], 1.1)]))
    expect(r.result).toBe('PENETRATION')
  })

  it('首层间距原点取首触面（-1 → 0）后按真实 1.1m 间隙衰减（BLOCKED）', () => {
    const shifted = withGapOrigin(
      [screen([0, 0, -1], 1.0), hull([0, 0, -1.1], 1.1)],
      { distance: 0, point: [0, 0, 0] },
    )
    const r = calculate(heatReq([...shifted]))
    expect(r.result).toBe('BLOCKED')
  })

  it('共享边的重合三角形与首层一起前移：多一条重合命中不改变结果（400 / 20@1m / 165@1.1m）', () => {
    const contact = { distance: 0, point: [0, 0, 0] }
    const single = [screen([0, 0, -1], 1.0), hull([0, 0, -1.1], 1.1, 165)]
    const dup = [screen([0, 0, -1], 1.0), screen([0, 0, -1], 1.0), hull([0, 0, -1.1], 1.1, 165)]
    const baseline = calculate(heatReq([...withGapOrigin(single, contact)], 400)).result
    const withDup = calculate(heatReq([...withGapOrigin(dup, contact)], 400)).result
    // 重合三角形仍被 collectFilteredHits 合并 → 与单条命中的结论一致（真实 1.1m 间隙）。
    expect(baseline).toBe('PENETRATION')
    expect(withDup).toBe(baseline)
    // 负向对照：只搬首层（finding 复现）→ 重合关系被破坏、屏计两层 → 结论翻转。
    const onlyFirst = [{ ...dup[0], point: contact.point }, dup[1], dup[2]]
    expect(calculate(heatReq(onlyFirst, 400)).result).toBe('BLOCKED')
  })
})
