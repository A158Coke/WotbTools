// 击穿判定移植测试：上游 src/wargaming/penetration.rs 单测逐例对齐。
// 上游 Rust 判定语义变更时，本文件与 penetration.js 同版本跟随——两仓不变量保持同源。
import { describe, it, expect } from 'vitest'
import { calculate, isPrimary, ArmorSection } from './penetration.js'

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

  it('外部模块在前的层链：模块 flat、其后间隙甲裸 LOS（无跳弹/转正）——review 2026-10-13 用例', () => {
    // 20mm 履带（flat）→ 40mm 间隙甲@75°（layer>0：不跳弹、不转正）→ 100mm 主装甲@0°，AP 100/200/5°。
    // CPU：20 + 154.548 + 100 → BLOCKED（状态通道最近层=模块 → 无跳弹状态、差额 0，与管线一致）。
    const a = 75 * Math.PI / 180
    const hits = [
      hit(ArmorSection.CHASSIS, 20.0, [0, 0, 0]),
      hit(ArmorSection.SPACED, 40.0, [0, 0.3, 0], { normal: [Math.sin(a), Math.cos(a), 0] }),
      hit(ArmorSection.HULL, 100.0, [0, 0.6, 0]),
    ]
    const r = calculate(req('ap', 200.0, 100.0, hits, { normalization_deg: 5 }))
    expect(Math.abs(r.layers[0].effective - 20)).toBeLessThan(0.02)
    expect(Math.abs(r.layers[1].effective - 154.548)).toBeLessThan(0.05)
    expect(Math.abs(r.layers[2].effective - 100)).toBeLessThan(0.02)
    expect(r.result).toBe('BLOCKED')
  })

  it('多块重叠间隙板：首层转正、其后裸 LOS——两块 20mm@60° + 100mm 主装甲（review 2026-10-13）', () => {
    // AP 口径 100、穿深 164、转正 5°：层等效 = 27.1268（首层 2× 增强转正）+ 40（裸 LOS）+ 100 → BLOCKED。
    const a = 60 * Math.PI / 180
    const normal = [Math.sin(a), Math.cos(a), 0]
    const hits = [
      hit(ArmorSection.SPACED, 20.0, [0, 0, 0], { normal }),
      hit(ArmorSection.SPACED, 20.0, [0, 0.4, 0], { normal }),
      hit(ArmorSection.HULL, 100.0, [0, 0.8, 0]),
    ]
    const r = calculate(req('ap', 164.0, 100.0, hits, { normalization_deg: 5 }))
    expect(Math.abs(r.layers[0].effective - 27.1268)).toBeLessThan(0.02)
    expect(Math.abs(r.layers[1].effective - 40)).toBeLessThan(0.02)
    expect(Math.abs(r.layers[2].effective - 100)).toBeLessThan(0.02)
    expect(r.result).toBe('BLOCKED')
  })

  it('normalization_applies_only_to_first_armor_layer', () => {
    // WG 语义（用户 2026-10-13 裁示）：转正只作用于首个装甲层，击穿第一层后不再转正。
    // 层0 = 间隙板 20mm（30° 入射，2× overmatch 增强转正 17.5°）→ eff0 = 20/cos(12.5°)
    // 层1 = 主装甲 100mm（同 30°）→ 不转正 eff1 = 100/cos(30°)；逐层转正（旧行为）给 100/cos(25°)
    const a = 30 * Math.PI / 180
    const normal = [Math.sin(a), Math.cos(a), 0]
    const hits = [
      hit(ArmorSection.SPACED, 20.0, [0, 0, 0], { normal }),
      hit(ArmorSection.HULL, 100.0, [0, 0.5, 0], { normal }),
    ]
    const r = calculate(req('ap', 500.0, 100.0, hits, { normalization_deg: 5 }))
    expect(r.layers).toHaveLength(2)
    expect(Math.abs(r.layers[0].effective - 20.0 / Math.cos(12.5 * Math.PI / 180))).toBeLessThan(0.05)
    expect(Math.abs(r.layers[1].effective - 100.0 / Math.cos(a))).toBeLessThan(0.05)
    expect(Math.abs(r.layers[1].effective - 100.0 / Math.cos(25 * Math.PI / 180))).toBeGreaterThan(1.0)
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
