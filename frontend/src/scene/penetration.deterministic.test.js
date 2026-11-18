import { describe, it, expect } from 'vitest'
import { hit, req } from '../test/penetrationTestHelpers.js'
import { calculate, ArmorSection, hasPrimaryLayer } from './penetration.js'

// 击穿判定移植测试：上游 src/wargaming/penetration.rs 单测逐例对齐。
// 上游 Rust 判定语义变更时，本文件与 penetration.js 同版本跟随——两仓不变量保持同源。

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
      req('he', 400.0, 100.0, [hit(ArmorSection.HULL, 50.0, [0, 0, 0])], {
        distance_m: 1000,
        penetration_far: 300.0,
        explosion_radius: 5.0,
      }),
    )
    expect(Math.abs(r.layers[0].remaining_before - 400)).toBeLessThan(1e-3)
    // HE 的伤害形态是溅射界（满伤由外层概率表达）；距离衰减只影响 remaining_before。
    expect(r.result).toBe('SPLASH')
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
    // HE 仅命中履带：单射线兜底用 func7695 同公式；射向 [0,1,0] 与板法线
    // 同向 → base = 0.1m。upper = 0.5·400·1.25·0.98-20 = 225；
    // lower = 0.5·400·0.75·0.98-20 = 127
    const r = calculate(req('he', 100.0, 150.0, [hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0])], { explosion_radius: 5.0 }))
    expect(r.result).toBe('SPLASH')
    expect(r.damage).toBeCloseTo(176.0, 3)
    expect(r.he).toMatchObject({
      splash_min: 127.0,
      splash_max: 225.0,
      splash_avg: 176.0,
      samples: 1,
      best: null,
      best_lower: null,
      source: 'single-ray',
      degraded: true,
    })
  })

  it('he_zero_or_missing_explosion_radius_fails_closed', () => {
    // 半径缺失/0 时不允许回退满伤：即使存在正厚度 Primary 与概率链，
    // 也必须保持 BLOCKED / 0 damage / 无 he 数据，供 UI 走确定性 fail-closed 卡。
    const hits = [hit(ArmorSection.HULL, 100.0, [0, 0, 0])]
    for (const radius of [0, undefined]) {
      const r = calculate(req('he', 300.0, 150.0, hits, { explosion_radius: radius }))
      expect(r.result).toBe('BLOCKED')
      expect(r.damage).toBe(0)
      expect(r.he).toBeNull()
      expect(r.probability_layers.length).toBeGreaterThan(0)
      expect(hasPrimaryLayer(r.probability_layers)).toBe(true)
    }
  })

  it('he_splash_fallback_uses_func7695_formula', () => {
    // HE：履带(20mm) → 主装甲(100mm, 0°)；名义层厚 120，d = 0.1 + 1m。
    // upper = 0.5·400·1.25·0.78 - 120 = 75；lower = 0.5·400·0.75·0.78 - 120 → 0
    const rq = req('he', 250.0, 150.0, [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.HULL, 100.0, [0, 0, 1.0]),
    ], { explosion_radius: 5.0 })
    const r = calculate(rq)
    expect(r.result).toBe('SPLASH')
    expect(r.damage).toBeCloseTo(37.5, 3)
    expect(r.he).toMatchObject({
      splash_min: 0,
      splash_max: 75.0,
      splash_avg: 37.5,
      samples: 1,
      source: 'single-ray',
      degraded: true,
    })
  })

  it('he_splash_sampler_overrides_legacy_formula', () => {
    // tankViewer 的 800 射线采样结果优先：Armor Inspector func7695 的
    // he_min/he_max 是两个 roll 界的最大值，avg 取中点；旧 1.1 公式不再参与。
    const r = calculate(req('he', 39.0, 76.0, [hit(ArmorSection.HULL, 50.0, [0, 0, 0])], {
      explosion_radius: 1.09,
      damage: 200.0,
      he_splash: { min: 21.59, max: 69.32, avg: 45.455, samples: 325 },
    }))
    expect(r.result).toBe('SPLASH')
    expect(r.damage).toBeCloseTo(45.455, 3)
    expect(r.he).toMatchObject({
      splash_min: 21.59,
      splash_max: 69.32,
      splash_avg: 45.455,
      full_damage: 200.0,
      samples: 325,
      source: 'sampler',
    })
  })

  it('he_splash_zero_samples_is_authoritative_zero', () => {
    // 60TP 炮口命中：炮弹在 z≈-8.27m，60TP 主装最前缘 ≤3.62m，R=3.66m——
    // 800 条射线在半径内只碰到炮管（模块），func7695 全部 skip。
    // 这是确定的零溅射，不是“采样器不可用”，不得回退单射线公式造出 285.5。
    const r = calculate(req('he', 80.0, 152.4, [hit(ArmorSection.GUN_BARREL, 70.0, [0, 0, 0])], {
      explosion_radius: 3.66,
      damage: 720.0,
      he_splash: { min: 0, max: 0, avg: 0, samples: 0 },
    }))
    expect(r.result).toBe('BLOCKED')
    expect(r.damage).toBe(0)
    expect(r.he).toMatchObject({
      splash_min: 0,
      splash_max: 0,
      splash_avg: 0,
      samples: 0,
      source: 'sampler',
    })
    expect(r.he.unavailable).toBeUndefined()
  })

  it('he_splash_error_is_explicit_error_without_fallback', () => {
    // 采样器跑不了（碰撞包/网格/入参）：显式 ERROR，禁止拿单射线 285.5 冒充。
    const r = calculate(req('he', 80.0, 152.4, [hit(ArmorSection.GUN_BARREL, 70.0, [0, 0, 0])], {
      explosion_radius: 3.66,
      damage: 720.0,
      he_splash_error: 'collision-grid:grid-too-dense',
    }))
    expect(r.result).toBe('ERROR')
    expect(r.damage).toBe(0)
    expect(r.he).toMatchObject({
      splash_min: 0,
      splash_max: 0,
      splash_avg: 0,
      samples: 0,
      source: 'sampler',
      unavailable: true,
      reason: 'collision-grid:grid-too-dense',
    })
  })

  it('he_without_sampler_keeps_upstream_single_ray_contract', () => {
    // 无采样器的调用方（上游纯函数 / /api/penetrate）仍按上游单射线契约给值，
    // 但必须标记 degraded——客户端正常路径不会消费这条结果。
    const r = calculate(req('he', 80.0, 152.4, [hit(ArmorSection.GUN_BARREL, 70.0, [0, 0, 0])], {
      explosion_radius: 3.66,
      damage: 720.0,
    }))
    expect(r.result).toBe('SPLASH')
    expect(r.he).toMatchObject({ samples: 1, source: 'single-ray', degraded: true })
  })

  it('he_splash_malformed_result_is_explicit_error', () => {
    // 采样器给了对象但缺字段/NaN：输出不可信 → ERROR，不得静默落回单射线。
    const r = calculate(req('he', 80.0, 152.4, [hit(ArmorSection.HULL, 100.0, [0, 0, 0])], {
      explosion_radius: 3.66,
      damage: 720.0,
      he_splash: { min: 0, max: 0 },   // 缺 avg / samples
    }))
    expect(r.result).toBe('ERROR')
    expect(r.damage).toBe(0)
    expect(r.he).toMatchObject({ unavailable: true, reason: 'sampler:invalid-result', samples: 0 })
  })

  it('he_invalid_hit_thickness_fails_closed', () => {
    // 板厚 NaN/负数不是 0mm 板：单射线路径也不能拿 ||0 把伤害抬高。
    const r = calculate(req('he', 80.0, 152.4, [hit(ArmorSection.HULL, Number.NaN, [0, 0, 0])], {
      explosion_radius: 3.66,
      damage: 720.0,
    }))
    expect(r.result).toBe('ERROR')
    expect(r.damage).toBe(0)
    expect(r.he).toMatchObject({ unavailable: true, reason: 'invalid-hit-thickness' })
  })

  it('he_missing_hit_normal_fails_closed', () => {
    // 0.1m 起点偏移的层距离依赖首板法线；缺法线时不能拿 [0,1,0] 猜。
    const r = calculate(req('he', 80.0, 152.4, [
      hit(ArmorSection.HULL, 100.0, [0, 0, 0], { normal: undefined }),
    ], { explosion_radius: 3.66, damage: 720.0 }))
    expect(r.result).toBe('ERROR')
    expect(r.damage).toBe(0)
    expect(r.he).toMatchObject({ unavailable: true, reason: 'missing-hit-normal' })
  })

  it('he_single_primary_uses_splash_bounds_not_full_damage', () => {
    // HE 的单层主装不再走旧 BlitzKit“穿透=满伤”分支：func7695 的口径始终是
    // 0.75/1.25 两个溅射界；满伤由外层击穿概率表达。d=0.1m（正入射），100mm：
    // upper = 245-100 = 145；lower = 147-100 = 47；avg = 96
    const r = calculate(req('he', 300.0, 150.0, [hit(ArmorSection.HULL, 100.0, [0, 0, 0])], { explosion_radius: 5.0 }))
    expect(r.result).toBe('SPLASH')
    expect(r.damage).toBeCloseTo(96.0, 3)
    expect(r.he).toMatchObject({
      splash_min: 47.0,
      splash_max: 145.0,
      splash_avg: 96.0,
      samples: 1,
    })
  })

  it('he_fallback_distance_uses_shot_normal_cos', () => {
    // 兜底层距离与采样器同口径：base = 0.1×|cos(shot, plateNormal)|。
    // 60° 入射 → base=0.05；100mm/R=5：upper=250·0.99-100=147.5，
    // lower=150·0.99-100=48.5，avg=98。
    const h = hit(ArmorSection.HULL, 100.0, [0, 0, 0], {
      normal: [Math.sin(Math.PI / 3), Math.cos(Math.PI / 3), 0.0],
    })
    const r = calculate(req('he', 300.0, 150.0, [h], { explosion_radius: 5.0 }))
    expect(r.result).toBe('SPLASH')
    expect(r.damage).toBeCloseTo(98.0, 3)
    expect(r.he).toMatchObject({ splash_min: 48.5, splash_max: 147.5, splash_avg: 98.0 })
  })

  it('he_fallback_applies_enhanced_armor_coefficient', () => {
    // 强化装甲 +4%：100mm → 104mm。d=0.1/R=5：
    // upper=250·0.98-104=141，lower=150·0.98-104=43，avg=92。
    const r = calculate(req('he', 300.0, 150.0, [hit(ArmorSection.HULL, 100.0, [0, 0, 0])], {
      explosion_radius: 5.0,
      enhanced_armor: true,
    }))
    expect(r.result).toBe('SPLASH')
    expect(r.he).toMatchObject({ splash_min: 43.0, splash_max: 141.0, splash_avg: 92.0 })
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
