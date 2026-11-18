import { describe, it, expect } from 'vitest'
import { hit, req } from '../test/penetrationTestHelpers.js'
import { calculate, ArmorSection, ricochetSurface, withContactRicochet } from './penetration.js'




describe('withContactRicochet / ricochetSurface（首触面只服务跳弹，不改厚度几何）', () => {
  const h = (distance, normal, thickness = 30, section = 'spaced', plateId = '2') => ({
    distance, point: [0, 0, -distance], normal, thickness, section, plate_id: plateId,
    part_name: `${section}-${plateId}`,
  })

  it('首触面在首层之前：只附加 contact_normal/contact_point，normal/thickness/point 不动', () => {
    const hits = [h(1.05, [0, 1, 0])]
    const contact = h(1.0, [0.98, 0.17, 0])
    const out = withContactRicochet(hits, contact)
    expect(out[0].contact_normal).toEqual([0.98, 0.17, 0])
    expect(out[0].contact_point).toEqual([0, 0, -1])
    expect(out[0].contact_thickness).toBe(30)
    expect(out[0].contact_part_name).toBe('spaced-2')
    expect(out[0].normal).toEqual([0, 1, 0])
    expect(out[0].thickness).toBe(30)
    expect(out[0].point).toEqual([0, 0, -1.05])
    expect(hits[0].contact_normal).toBeUndefined()
  })

  it('首触面在首层之后 / 无首触面 / 空链：原样返回', () => {
    const hits = [h(1.05, [0, 1, 0])]
    expect(withContactRicochet(hits, h(1.2, [0.98, 0.17, 0]))).toBe(hits)
    expect(withContactRicochet(hits, null)).toBe(hits)
    expect(withContactRicochet([], h(1.0, [0.98, 0.17, 0]))).toEqual([])
  })

  it('ricochetSurface 优先首触面，否则用自身点/法线', () => {
    const hit = { ...h(1.05, [0, 1, 0]), contact_normal: [0.98, 0.17, 0], contact_point: [0, 0, -1] }
    expect(ricochetSurface(hit)).toEqual({ point: [0, 0, -1], normal: [0.98, 0.17, 0] })
    expect(ricochetSurface(h(1.05, [0, 1, 0]))).toEqual({ point: [0, 0, -1.05], normal: [0, 1, 0] })
    expect(ricochetSurface(null)).toBe(null)
  })
})



describe('动能弹首层跳弹按物理首触面判定（厚度几何不改）', () => {
  const apReq = (hits, penetration = 250) => ({
    shell_type: 'ap', penetration, caliber: 75, view_dir: [0, 1, 0],
    hits, damage: 400, explosion_radius: 0,
    calibrated_shells: false, enhanced_armor: false, allow_ricochet: true,
  })
  const normalAt = (deg) => {
    const r = deg * Math.PI / 180
    return [Math.sin(r), Math.cos(r), 0]
  }
  const armor = (section, plateId, thickness, deg, distance) => ({
    section, plate_id: plateId, thickness,
    normal: normalAt(deg), point: [0, 0, -distance], distance,
    part_name: `${section}-${plateId}`,
  })

  it('同键近背 80° / 远正 0°：附加首触面后判 RICOCHET，无首触信息为 PENETRATION', () => {
    const chain = [armor(ArmorSection.SPACED, '2', 30, 0, 2), armor(ArmorSection.HULL, '1', 100, 0, 3)]
    expect(calculate(apReq(chain)).result).toBe('PENETRATION')
    const withContact = withContactRicochet(chain, armor(ArmorSection.SPACED, '2', 30, 80, 1))
    expect(calculate(apReq(withContact)).result).toBe('RICOCHET')
  })

  it('不同键（A 背 80° → B 正 0° → A 正 0°）：物理跳弹仍发生在 A 的首触面', () => {
    const chain = [
      armor(ArmorSection.SPACED, '9', 10, 0, 1.5),
      armor(ArmorSection.SPACED, '2', 30, 0, 2),
      armor(ArmorSection.HULL, '1', 100, 0, 3),
    ]
    const withContact = withContactRicochet(chain, armor(ArmorSection.SPACED, '2', 30, 80, 1))
    expect(calculate(apReq(withContact)).result).toBe('RICOCHET')
  })

  it('非跳弹角（60°/0°）不改等效厚度：30mm 屏仍是 30mm，160mm 击穿 120mm 主装', () => {
    const chain = [armor(ArmorSection.SPACED, '2', 30, 0, 1.05), armor(ArmorSection.HULL, '1', 120, 0, 2)]
    const withContact = withContactRicochet(chain, armor(ArmorSection.SPACED, '2', 30, 60, 1))
    const r = calculate(apReq(withContact, 160))
    expect(r.layers[0].effective).toBe(30)
    expect(r.layers[0].ricochet).toBe(false)
    expect(r.result).toBe('PENETRATION')
  })

  it('模块首层也要判首触跳弹：A 背 80° → 10mm 炮管 → A 正 0° → 主装', () => {
    const chain = [
      armor(ArmorSection.GUN_BARREL, '1', 10, 0, 1.5),
      armor(ArmorSection.SPACED, '2', 30, 0, 2),
      armor(ArmorSection.HULL, '1', 100, 0, 3),
    ]
    expect(calculate(apReq([...chain])).result).toBe('PENETRATION')
    const withContact = withContactRicochet(chain, armor(ArmorSection.SPACED, '2', 30, 80, 1))
    const r = calculate(apReq(withContact))
    expect(r.result).toBe('RICOCHET')
    // 结果卡按首触板呈现（炮管只是被穿过的保留层），角度取首触面 80°。
    expect(r.layers[0].part_name).toBe('gunBarrel-1')
    expect(r.layers[0].contact_part_name).toBe('spaced-2')
    expect(r.layers[0].contact_thickness).toBe(30)
    expect(r.layers[0].angle_deg).toBeCloseTo(80, 5)
    expect(r.probability_layers[0].contact_part_name).toBe('spaced-2')
    expect(r.probability_layers[0].contact_thickness).toBe(30)
  })

  it('首触板 3× 口径按强化装甲后的厚度判（25mm × 1.04 = 26mm → 78 > 76.2 不 overmatch）', () => {
    const chain = [armor(ArmorSection.SPACED, '2', 25, 0, 1.05), armor(ArmorSection.HULL, '1', 100, 0, 2)]
    const withContact = withContactRicochet(chain, armor(ArmorSection.SPACED, '2', 25, 80, 1))
    const req = (enhanced, penetration = 250, caliber = 76.2) => ({
      shell_type: 'ap', penetration, caliber, view_dir: [0, 1, 0],
      hits: withContact, damage: 400, explosion_radius: 0,
      calibrated_shells: false, enhanced_armor: enhanced, allow_ricochet: true,
    })
    // 未强化：76.2 > 25×3 = 75 → overmatch 抑制跳弹。
    expect(calculate(req(false)).result).toBe('PENETRATION')
    // 强化：76.2 < 26×3 = 78 → 不抑制，按 80° 判跳弹；概率链同样带跳弹标记。
    const r = calculate(req(true))
    expect(r.result).toBe('RICOCHET')
    expect(r.probability_layers[0].ricochet).toBe(true)
  })

  it('HEAT 厚度链同样不受首触面影响：30mm 屏有效厚度 30mm（不是 80° 下的 172.76mm）', () => {
    const chain = [armor(ArmorSection.SPACED, '2', 30, 0, 1.05), armor(ArmorSection.HULL, '1', 100, 0, 1.1)]
    const withContact = withContactRicochet(chain, armor(ArmorSection.SPACED, '2', 30, 80, 1))
    const r = calculate({
      shell_type: 'heat', penetration: 250, caliber: 75, view_dir: [0, 1, 0],
      hits: withContact, damage: 400, explosion_radius: 0,
      calibrated_shells: false, enhanced_armor: false, allow_ricochet: true,
    })
    expect(r.layers[0].effective).toBe(30)
    expect(r.result).toBe('PENETRATION')
  })
})
