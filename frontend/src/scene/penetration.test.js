// 击穿判定移植测试：上游 src/wargaming/penetration.rs 单测逐例对齐。
// 上游 Rust 判定语义变更时，本文件与 penetration.js 同版本跟随——两仓不变量保持同源。
import { describe, it, expect } from 'vitest'
import { calculate, isPrimary, ArmorSection } from './penetration.js'
import { penetrationChance } from './armorInspectorChance.js'

function hit(section, thickness, point, extra = {}) {
  return {
    section,
    plate_id: '1',
    thickness,
    normal: [0.0, 1.0, 0.0],
    point,
    part_name: section,
    ...extra,
  }
}

function req(shellType, pen, caliber, hits, overrides = {}) {
  return {
    shell_type: shellType,
    penetration: pen,
    caliber,
    view_dir: [0.0, 1.0, 0.0],
    hits,
    damage: 400.0,
    explosion_radius: 0.0,
    calibrated_shells: false,
    enhanced_armor: false,
    normalization_deg: undefined,
    ricochet_deg: undefined,
    allow_ricochet: true,
    ...overrides,
  }
}

describe('penetration（上游 penetration.rs 单测移植）', () => {
  it('track_only_penetration_gives_full_damage', () => {
    // blitzkit：末层穿透即 penetration + 全额 armor_damage
    const r = calculate(req('ap', 100.0, 100.0, [hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0])]))
    expect(r.result).toBe('PENETRATION')
    expect(r.damage).toBe(400.0)
  })

  it('gun_armor_is_primary_angled_not_flat', () => {
    // 炮盾 = Primary 角度等效：20/cos60° = 40mm 挡住 35 穿深（若按外部模块 flat 处理则 35 > 20 会穿透）
    const h = hit(ArmorSection.GUN, 20.0, [0, 0, 0], {
      normal: [0.0, Math.cos(60 * Math.PI / 180), Math.sin(60 * Math.PI / 180)],
    })
    const r = calculate(req('ap', 35.0, 60.0, [h]))
    expect(r.result).toBe('BLOCKED')
    expect(Math.abs(r.layers[0].effective - 40.0)).toBeLessThan(0.1)
    const r2 = calculate(req('ap', 35.0, 60.0, [hit(ArmorSection.GUN, 20.0, [0, 0, 0])]))
    expect(r2.result).toBe('PENETRATION')
  })

  it('gun_barrel_and_gun_armor_are_separate_layers', () => {
    // 炮管(External, flat) → 炮盾(Primary, angled)：两层都消耗（blitzkit 不合并去重）
    const h = hit(ArmorSection.GUN, 20.0, [0, 0, 1.0], { normal: [0.0, 1.0, 0.0] })
    const hits = [hit(ArmorSection.GUN_BARREL, 30.0, [0, 0, 0]), h]
    const r = calculate(req('ap', 100.0, 50.0, hits))
    expect(r.layers).toHaveLength(2)
    expect(r.result).toBe('PENETRATION')
  })

  it('boundary_equal_thickness_is_blocked', () => {
    // blitzkit：remaining_after <= 0 即 blocked（等厚不穿透）
    const r = calculate(req('ap', 100.0, 50.0, [hit(ArmorSection.HULL, 100.0, [0, 0, 0])]))
    expect(r.result).toBe('BLOCKED')
    const r2 = calculate(req('ap', 100.01, 50.0, [hit(ArmorSection.HULL, 100.0, [0, 0, 0])]))
    expect(r2.result).toBe('PENETRATION')
  })

  it('ricochet_at_70_deg_and_overmatch_suppression', () => {
    const h = hit(ArmorSection.HULL, 100.0, [0, 0, 0], {
      normal: [0.0, Math.cos(75 * Math.PI / 180), Math.sin(75 * Math.PI / 180)],
    })
    const r = calculate(req('ap', 300.0, 100.0, [h]))
    expect(r.result).toBe('RICOCHET')
    expect(Math.abs(r.ricochet_remaining_pen - 225.0)).toBeLessThan(1e-3)
    // 3× 口径 overmatch：310 > 50×3 → 强制不跳弹；等效 50/cos75° ≈ 193 < 300 → 穿透
    const h50 = { ...h, thickness: 50.0 }
    const r2 = calculate(req('ap', 300.0, 310.0, [h50]))
    expect(r2.result).toBe('PENETRATION')
  })

  it('two_caliber_enhanced_normalization', () => {
    // 2× 口径：转正 = 1.4·5°·150/(2·50) = 10.5°；60° 入射 → 等效 50/cos(49.5°) ≈ 76.97
    const h = hit(ArmorSection.HULL, 50.0, [0, 0, 0], {
      normal: [0.0, Math.cos(60 * Math.PI / 180), Math.sin(60 * Math.PI / 180)],
    })
    const r = calculate(req('ap', 80.0, 150.0, [h], { normalization_deg: 5.0 }))
    expect(Math.abs(r.layers[0].effective - 76.97)).toBeLessThan(0.1)
    const r2 = calculate(req('ap', 80.0, 60.0, [h], { normalization_deg: 5.0 }))
    expect(Math.abs(r2.layers[0].effective - 87.18)).toBeLessThan(0.1)
  })

  it('外部模块在前的层链：模块不参与转正，其后每层仍独立转正', () => {
    // 20mm 履带（flat）→ 40mm 间隙甲@75°（自身 2× 增强转正）
    // → 100mm 主装甲@0°（第二层也独立转正；角度0，等效仍100），AP 100/200/5°。
    // 模块 20 + 间隙甲 40/cos(75−8.75)°≈99.32 + 主装甲 100 = 219.32 > 200 → BLOCKED。
    // 旧规则把模块计入首层 → 间隙甲裸 LOS 154.55、总 274.55（同样 BLOCKED，但数值不同）。
    const a = 75 * Math.PI / 180
    const hits = [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.SPACED, 40.0, [0, 0.3, 0], { normal: [Math.sin(a), Math.cos(a), 0] }),
      hit(ArmorSection.HULL, 100.0, [0, 0.6, 0]),
    ]
    const r = calculate(req('ap', 200.0, 100.0, hits, { normalization_deg: 5 }))
    const twoCalNormDeg = (1.4 * 5 * 100) / (2 * 40)
    expect(Math.abs(r.layers[0].effective - 20)).toBeLessThan(0.02)
    expect(Math.abs(r.layers[1].effective - 40 / Math.cos((75 - twoCalNormDeg) * Math.PI / 180))).toBeLessThan(0.05)
    expect(Math.abs(r.layers[1].effective - 154.548)).toBeGreaterThan(1)   // 判别：旧规则裸 LOS
    expect(Math.abs(r.layers[2].effective - 100)).toBeLessThan(0.02)
    expect(r.result).toBe('BLOCKED')
  })

  it('多块重叠间隙板：每块都按自身厚度重新转正——两块 20mm@60° + 100mm 主装甲（BlitzKit）', () => {
    // AP 口径 100、穿深 164、转正 5°：两块间隙板各自 2× 增强转正 17.5° →
    // eff = 27.1268 + 27.1268，主装甲 100 @0° = 100；总 154.25 < 164 → PENETRATION。
    const a = 60 * Math.PI / 180
    const normal = [Math.sin(a), Math.cos(a), 0]
    const hits = [
      hit(ArmorSection.SPACED, 20.0, [0, 0, 0], { normal }),
      hit(ArmorSection.SPACED, 20.0, [0, 0.4, 0], { normal }),
      hit(ArmorSection.HULL, 100.0, [0, 0.8, 0]),
    ]
    const r = calculate(req('ap', 164.0, 100.0, hits, { normalization_deg: 5 }))
    expect(Math.abs(r.layers[0].effective - 27.1268)).toBeLessThan(0.02)
    expect(Math.abs(r.layers[1].effective - 27.1268)).toBeLessThan(0.02)
    expect(Math.abs(r.layers[2].effective - 100)).toBeLessThan(0.02)
    expect(r.result).toBe('PENETRATION')
  })

  it('normalization_per_layer', () => {
    // BlitzKit：每个非外部层都独立转正。层0 间隙 20mm@30°（2× 增强 17.5°）→ eff0=20/cos12.5°；
    // 层1 主装甲 100mm@30° 也用自身 5° 转正 → eff1=100/cos25°，不是裸 LOS 100/cos30°。
    const a = 30 * Math.PI / 180
    const normal = [Math.sin(a), Math.cos(a), 0]
    const hits = [
      hit(ArmorSection.SPACED, 20.0, [0, 0, 0], { normal }),
      hit(ArmorSection.HULL, 100.0, [0, 0.5, 0], { normal }),
    ]
    const r = calculate(req('ap', 500.0, 100.0, hits, { normalization_deg: 5 }))
    expect(r.layers).toHaveLength(2)
    expect(Math.abs(r.layers[0].effective - 20.0 / Math.cos(12.5 * Math.PI / 180))).toBeLessThan(0.05)
    expect(Math.abs(r.layers[1].effective - 100.0 / Math.cos(25 * Math.PI / 180))).toBeLessThan(0.05)
    expect(Math.abs(r.layers[1].effective - 100.0 / Math.cos(30 * Math.PI / 180))).toBeGreaterThan(1.0)
  })

  it('external_module_does_not_participate_in_normalization', () => {
    // 动能弹击穿外部模块后不跳弹；模块是 flat 消耗，不参与 normalization。
    // 履带 20mm（flat）→ 主装甲 100mm @75°，口径 100、转正 5°、穿深 400。
    // 主装甲独立按 75°−5°=70° 计 → eff=100/cos70°≈292.38，余 380 → 穿透。
    const a = 75 * Math.PI / 180
    const normal = [Math.sin(a), Math.cos(a), 0]
    const hits = [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0.5, 0], { normal }),
    ]
    const r = calculate(req('ap', 400.0, 100.0, hits, { normalization_deg: 5 }))
    expect(r.layers).toHaveLength(2)
    expect(r.layers[1].angle_deg).toBeCloseTo(75, 6)
    expect(Math.abs(r.layers[1].effective - 100.0 / Math.cos(70 * Math.PI / 180))).toBeLessThan(0.05)
    expect(r.layers[1].effective).toBeLessThan(380)
    expect(r.layers[1].ricochet).toBe(false)
    expect(r.layers[1].overmatch).toBe(false)   // 真实 3× 口径规则：100 > 100×3 不成立
    expect(r.first_armor_norm_deg).toBeCloseTo(5, 6)
    expect(r.result).toBe('PENETRATION')
  })

  it('external_module_keeps_two_caliber_enhanced_normalization', () => {
    // 履带 20mm → 主装甲 40mm @75°，口径 100：2× 口径（100 > 80）→ 增强转正 8.75°
    // （1.4×5×100/(2×40)），等效 40/cos(66.25°)≈99.41；余 120−20=100 > 99.41 → 穿透。
    // 旧规则不转正给 154.69 → 被挡。
    const a = 75 * Math.PI / 180
    const normal = [Math.sin(a), Math.cos(a), 0]
    const hits = [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 40.0, [0, 0.5, 0], { normal }),
    ]
    const r = calculate(req('ap', 120.0, 100.0, hits, { normalization_deg: 5 }))
    const normDeg = (1.4 * 5 * 100) / (2 * 40)
    expect(Math.abs(r.layers[1].effective - 40.0 / Math.cos((75 - normDeg) * Math.PI / 180))).toBeLessThan(0.05)
    expect(r.layers[1].effective).toBeLessThan(120)
    expect(r.layers[1].ricochet).toBe(false)
    expect(r.layers[1].overmatch).toBe(false)
    expect(r.result).toBe('PENETRATION')
  })

  it('external_module_suppresses_ricochet_and_reports_actual_overmatch', () => {
    // 履带 20mm → 30mm 主装甲 @75°，口径 100：3× 碾压（100 > 90）成立 → overmatch=true；
    // 即使没有模块也本就不跳弹。另一例 100mm（非 3×）@75°：模块已使其不跳弹，但 overmatch
    // 字段必须是真实的 false（不得再用 layerIndex 冒充）。
    const a = 75 * Math.PI / 180
    const normal = [Math.sin(a), Math.cos(a), 0]
    const mk = (thickness) => calculate(req('ap', 1000.0, 100.0, [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.HULL, thickness, [0, 0.5, 0], { normal }),
    ], { normalization_deg: 5 }))

    const overmatched = mk(30.0)
    expect(overmatched.layers[1].overmatch).toBe(true)
    expect(overmatched.ricochet).toBe(false)
    expect(overmatched.layers[1].ricochet).toBe(false)

    const plain = mk(100.0)
    expect(plain.layers[1].overmatch).toBe(false)
    expect(plain.ricochet).toBe(false)
    expect(plain.layers[1].ricochet).toBe(false)
  })

  it('zero_thickness_first_armor_behind_module_does_not_nan', () => {
    // 0mm 是合法 fail-closed 板厚。模块后接 0mm 首层、normalization=0（HEAT/缺失）时，
    // 2× 公式 0/0 会生成 NaN；修后该层等效 0，剩余穿深 >0 → 穿透。
    const hits = [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 0.0, [0, 0.5, 0]),
    ]
    const ap = calculate(req('ap', 100.0, 100.0, hits, { normalization_deg: 0 }))
    expect(Number.isFinite(ap.layers[1].effective)).toBe(true)
    expect(ap.layers[1].effective).toBe(0)
    expect(ap.result).toBe('PENETRATION')

    const heat = calculate(req('heat', 100.0, 100.0, hits))
    const last = heat.layers[heat.layers.length - 1]
    expect(Number.isFinite(last.effective)).toBe(true)
    expect(last.effective).toBe(0)
    expect(heat.result).toBe('PENETRATION')
  })

  it('heat_gap_decay_blocks_across_large_gap', () => {
    // 200m 间隙：剩余穿深 ×0.5^200 → 0 → gap 层 blocked → BLOCKED
    const hits = [
      hit(ArmorSection.SPACED, 5.0, [0, 0, 0]),
      hit(ArmorSection.SPACED, 5.0, [0, 0, 200.0]),
    ]
    const r = calculate(req('heat', 500.0, 100.0, hits))
    expect(r.result).toBe('BLOCKED')
    expect(r.layers.some((l) => l.part_name.startsWith('Gap'))).toBe(true)
    expect(r.layers[r.layers.length - 1].penetrated).toBe(false)
  })

  it('distance_decay_applies_beyond_100m_for_ap', () => {
    // near 400 / far 300（guns.xml piercingPower 口径）：d≤100 → 400；
    // d=300 → 350；d=500 → far=300；d=1000 → 175（线性继续外推，不截断插值）。
    // 判定翻转：300m 剩 350 > 250 → 穿透；1000m 剩 175 < 250 → blocked。
    const mk = (d) =>
      calculate(
        req('ap', 400.0, 100.0, [hit(ArmorSection.HULL, 250.0, [0, 0, 0])], {
          distance_m: d,
          penetration_far: 300.0,
        }),
      )
    expect(Math.abs(mk(50).layers[0].remaining_before - 400)).toBeLessThan(1e-3)
    expect(Math.abs(mk(100).layers[0].remaining_before - 400)).toBeLessThan(1e-3)
    expect(Math.abs(mk(300).layers[0].remaining_before - 350)).toBeLessThan(1e-3)
    expect(Math.abs(mk(500).layers[0].remaining_before - 300)).toBeLessThan(1e-3)
    expect(Math.abs(mk(1000).layers[0].remaining_before - 175)).toBeLessThan(1e-3)
    expect(mk(300).result).toBe('PENETRATION')
    expect(mk(1000).result).toBe('BLOCKED')
  })

  it('distance_decay_he_is_exempt', () => {
    // HE 豁免（客户端 flag 分支 = kind==kHighExplosive）：远 300 仍给 near。
    const r = calculate(
      req('he', 400.0, 100.0, [hit(ArmorSection.HULL, 250.0, [0, 0, 0])], {
        distance_m: 1000,
        penetration_far: 300.0,
      }),
    )
    expect(Math.abs(r.layers[0].remaining_before - 400)).toBeLessThan(1e-3)
    expect(r.result).toBe('PENETRATION')
  })

  it('distance_decay_heat_flat_when_far_equals_near', () => {
    // HEAT 数据 far==near（全量统计 96%+）→ 飞行段恒平，其专属衰减是间隙项；
    // 无 penetration_far 字段 → 不衰减（旧行为）。
    const r = calculate(
      req('heat', 300.0, 100.0, [hit(ArmorSection.HULL, 100.0, [0, 0, 0])], {
        distance_m: 1000,
        penetration_far: 300.0,
      }),
    )
    expect(Math.abs(r.layers[0].remaining_before - 300)).toBeLessThan(1e-3)
    const r2 = calculate(
      req('ap', 400.0, 100.0, [hit(ArmorSection.HULL, 250.0, [0, 0, 0])], { distance_m: 1000 }),
    )
    expect(Math.abs(r2.layers[0].remaining_before - 400)).toBeLessThan(1e-3)
  })

  it('distance_decay_clamps_at_zero_and_maps_to_dash', () => {
    // 大距离外推穿零 → max(0)；穿零后按既有语义映射 "-"（blitzkit：pen>0 才 BLOCKED）。
    const r = calculate(
      req('ap', 400.0, 100.0, [hit(ArmorSection.HULL, 50.0, [0, 0, 0])], {
        distance_m: 2000,
        penetration_far: 300.0,
      }),
    )
    expect(Math.abs(r.layers[0].remaining_before - 0)).toBeLessThan(1e-3)
    expect(r.result).toBe('-')
  })

  it('he_track_only_splashes_like_game', () => {
    // HE 仅命中履带：游戏判有伤害(GB109 shot2 实测掉血 126)。履带 flat 20mm 参与衰减:
    // final = 0.5·100·(1-0/5) - 1.1·(20+min(100,20)) = 50 - 44 = +6 → SPLASH
    const r = calculate(req('he', 100.0, 150.0, [hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0])], { explosion_radius: 5.0 }))
    expect(r.result).toBe('SPLASH')
    expect(r.damage).toBeGreaterThan(0.0)
  })

  it('he_splash_formula_matches_blitzkit', () => {
    // HE：履带(20mm flat) → 主装甲(100mm, 0°)。
    // totalSpaced = 20；dist = 1；final = 0.5·400·(1-1/5) - 1.1·(100 + 20)
    const rq = req('he', 250.0, 150.0, [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0, 1.0]),
    ], { explosion_radius: 5.0 })
    const r = calculate(rq)
    const expectDmg = 0.5 * 400.0 * (1.0 - 1.0 / 5.0) - 1.1 * (100.0 + 20.0)
    expect(r.result).toBe('SPLASH')
    expect(Math.abs(r.damage - expectDmg)).toBeLessThan(1e-3)
  })

  it('he_single_primary_penetration_full_damage', () => {
    const r = calculate(req('he', 300.0, 150.0, [hit(ArmorSection.HULL, 100.0, [0, 0, 0])], { explosion_radius: 5.0 }))
    expect(r.result).toBe('PENETRATION')
    expect(r.damage).toBe(400.0)
  })

  it('out_ray_without_primary_returns_no_shot', () => {
    const r = calculate(req('ap', 300.0, 100.0, [hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0])], { allow_ricochet: false }))
    expect(r.result).toBe('-')
    expect(r.layers).toHaveLength(0)
  })

  it('external_after_primary_is_not_collected', () => {
    const hits = [
      hit(ArmorSection.HULL, 50.0, [0, 0, 0]),
      hit(ArmorSection.GUN_BARREL, 30.0, [0, 0, 1.0]),
    ]
    const r = calculate(req('ap', 100.0, 50.0, hits))
    expect(r.layers).toHaveLength(1)
  })

  it('calibrated_shells_coefficient', () => {
    // 100×1.06 = 106 > 105 → PENETRATION；HEAT ×1.07 = 107 > 105 → PENETRATION；107 < 108 → BLOCKED
    const r1 = calculate(req('ap', 100.0, 100.0, [hit(ArmorSection.HULL, 105.0, [0, 0, 0])], { calibrated_shells: true }))
    expect(r1.result).toBe('PENETRATION')
    const r2 = calculate(req('heat', 100.0, 100.0, [hit(ArmorSection.HULL, 105.0, [0, 0, 0])], { calibrated_shells: true }))
    expect(r2.result).toBe('PENETRATION')
    const r3 = calculate(req('heat', 100.0, 100.0, [hit(ArmorSection.HULL, 108.0, [0, 0, 0])], { calibrated_shells: true }))
    expect(r3.result).toBe('BLOCKED')
  })
})

describe('probability_layers（完整命中链，供 Armor Inspector 概率模型）', () => {
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

  it('概率链继续收集首个 Primary 之后的多层主装甲（击穿第一层不再终结概率）', () => {
    const hits = [
      hit(ArmorSection.HULL, 30.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0, 1]),
    ]
    const r = calculate(req('ap', 100.0, 100.0, hits))
    // 确定性层链仍按 BlitzKit 在首个 Primary 截断（用于确定性判定展示）。
    expect(r.result).toBe('PENETRATION')
    expect(r.layers).toHaveLength(1)
    // 概率链必须看到第二层主装甲，1× 消耗后概率为 0。
    expect(r.probability_layers.map(l => l.section)).toEqual(['hull', 'hull'])
    expect(penetrationChance(r.probability_penetration, r.probability_layers)).toBe(0)
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
