import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { assignSpacedStencilBits, firstPhysicalHit, isClosedSurfaceGeometry, resolveSpacedHitMask, spacedDedupKey, withGapOrigin, SPACED_STENCIL_BIT_LIMIT } from './armorMeshTopology.ts'
import { ArmorSection, calculate } from './penetration.js'

describe('isClosedSurfaceGeometry', () => {
  it('闭合盒体（含 non-indexed 副本）判定为闭合', () => {
    const box = new THREE.BoxGeometry(1, 1, 1)
    expect(isClosedSurfaceGeometry(box)).toBe(true)
    expect(isClosedSurfaceGeometry(box.toNonIndexed())).toBe(true)
  })

  it('开放面片判定为开放（双面渲染）', () => {
    expect(isClosedSurfaceGeometry(new THREE.PlaneGeometry(1, 1))).toBe(false)
  })

  it('空缺一面的盒体判定为开放', () => {
    const box = new THREE.BoxGeometry(1, 1, 1)
    const pos = box.attributes.position
    const index = box.index.array
    // 丢掉第一个面（两个三角形）→ 出现 4 条边界边。
    const trimmed = new THREE.BufferGeometry()
    trimmed.setAttribute('position', pos)
    trimmed.setIndex(Array.from(index.slice(6)))
    expect(isClosedSurfaceGeometry(trimmed)).toBe(false)
  })

  it('空几何与缺失位置属性安全返回 false', () => {
    expect(isClosedSurfaceGeometry(null)).toBe(false)
    expect(isClosedSurfaceGeometry(new THREE.BufferGeometry())).toBe(false)
  })
})

describe('spacedDedupKey', () => {
  it('与点击链 collectJudgmentHits 的 origSection:plateId 同粒度', () => {
    expect(spacedDedupKey('gun', 'spaced', '2')).toBe('gun:2')
    expect(spacedDedupKey(undefined, 'hull', '6')).toBe('hull:6')
    expect(spacedDedupKey('turret', 'spaced', 10)).toBe('turret:10')
    expect(spacedDedupKey(null, null, null)).toBe(':')
  })

  it('不同 section 的同号板是不同键（plateId 只在所属装甲表内唯一）', () => {
    expect(spacedDedupKey('hull', 'spaced', '6')).not.toBe(spacedDedupKey('turret', 'spaced', '6'))
  })
})

describe('resolveSpacedHitMask（点击链同板去重，与 per-key stencil 同口径）', () => {
  const hit = (key, backface, spaced = true) => ({ key, backface, spaced })

  it('入射面 → 出射面：只留入射面（原行为）', () => {
    expect(resolveSpacedHitMask([hit('gun:2', false), hit('gun:2', true)])).toEqual([true, false])
  })

  it('出射面 → 入射面（近背远正）：仍只留入射面——判据与穿越顺序无关', () => {
    expect(resolveSpacedHitMask([hit('gun:2', true), hit('gun:2', false)])).toEqual([false, true])
  })

  it('同键没有入射面：出射面全部计入（GPU back clone 无位可测时逐片元累计）', () => {
    expect(resolveSpacedHitMask([hit('gun:2', true), hit('gun:2', true)])).toEqual([true, true])
  })

  it('同键多个入射面：全部保留（GPU front clone 逐片元累计）', () => {
    expect(resolveSpacedHitMask([hit('gun:5', false), hit('gun:5', false)])).toEqual([true, true])
  })

  it('非间隙甲的背面命中一律剔除，迎面命中保留', () => {
    expect(resolveSpacedHitMask([hit('hull:1', true, false), hit('hull:1', false, false)])).toEqual([false, true])
  })

  it('键之间互不影响：无入射面的键不被另一键的入射面抑制', () => {
    const mask = resolveSpacedHitMask([
      hit('gun:2', true), hit('turret:3', false), hit('gun:2', false),
    ])
    expect(mask).toEqual([false, true, true])
  })

  it('空命中集合返回空掩码', () => {
    expect(resolveSpacedHitMask([])).toEqual([])
  })

  it('判定区间止于首个 Primary：区间外的同键 front 不得抑制面前的 back', () => {
    // back(120mm) → hull Primary → 同键 front：collectFilteredHits 在 hull 截断，
    // GPU 侧主装甲深度先写、远处 front 也写不了位 —— back 必须保留。
    const hits = [
      hit('gun:2', true), hit('hull:1', false, false), hit('gun:2', false),
    ]
    expect(resolveSpacedHitMask(hits, 2)).toEqual([true, true, true])
  })

  it('区间内的同键 front 正常抑制 back（窗口不改变顺序无关判定）', () => {
    const hits = [hit('gun:2', true), hit('gun:2', false), hit('hull:1', false, false)]
    expect(resolveSpacedHitMask(hits, 3)).toEqual([false, true, true])
  })

  it('spanEnd 缺省 = 整条射线；越界 spanEnd 夹到命中数', () => {
    const hits = [hit('gun:2', true), hit('gun:2', false)]
    expect(resolveSpacedHitMask(hits)).toEqual([false, true])
    expect(resolveSpacedHitMask(hits, 99)).toEqual([false, true])
    expect(resolveSpacedHitMask(hits, -1)).toEqual([true, true])
  })
})

describe('firstPhysicalHit（HE 首触面，去重之前）', () => {
  const hit = (key, backface, spaced = true) => ({ key, backface, spaced })

  it('首个命中即首触面', () => {
    expect(firstPhysicalHit([hit('gun:2', false), hit('gun:2', true)])).toBe(0)
  })

  it('近背远正：背面就是首触面（不得被同键 front 顶替）', () => {
    expect(firstPhysicalHit([hit('gun:2', true), hit('hull:1', false, false)])).toBe(0)
  })

  it('主装甲/外部模块的背面命中是出射面，跳过', () => {
    expect(firstPhysicalHit([hit('hull:1', true, false), hit('gun:2', false)])).toBe(1)
  })

  it('全是非间隙甲背面 / 空集合 → -1', () => {
    expect(firstPhysicalHit([hit('hull:1', true, false), hit('turret:2', true, false)])).toBe(-1)
    expect(firstPhysicalHit([])).toBe(-1)
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
})

describe('HEAT 间隙衰减（首触面在前 vs 被去重）', () => {
  const heatReq = (hits) => ({
    shell_type: 'heat', penetration: 250, caliber: 75, view_dir: [0, 1, 0],
    hits, damage: 400, explosion_radius: 0,
    calibrated_shells: false, enhanced_armor: false, allow_ricochet: true,
  })
  const screen = (point, distance) => ({
    section: ArmorSection.SPACED, plate_id: '2', thickness: 20,
    normal: [0, 1, 0], point, distance, part_name: 'spaced-2',
  })
  const hull = (point, distance) => ({
    section: ArmorSection.HULL, plate_id: '1', thickness: 150,
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
})

describe('判定链与区间（back → Primary → 同键 front）', () => {
  it('首个 Primary 之后的同键 front 不参与判定，面前的间隙甲层仍生效', () => {
    const candidates = [
      { key: 'gun:2', spaced: true, backface: true },
      { key: 'hull:1', spaced: false, backface: false },
      { key: 'gun:2', spaced: true, backface: false },
    ]
    // 判定区间 = 首个 Primary（index 1）→ spanEnd = 2。
    const keep = resolveSpacedHitMask(candidates, 2)
    const chain = candidates.filter((_, i) => keep[i])
    const hits = chain.map((c, i) => ({
      section: c.spaced ? ArmorSection.SPACED : ArmorSection.HULL,
      plate_id: c.key.split(':')[1],
      thickness: c.spaced ? 120 : 40,
      normal: [0, 1, 0],
      point: [0, 0, -i],
      part_name: c.key,
    }))
    const req = {
      shell_type: 'ap', penetration: 100, caliber: 75, view_dir: [0, 1, 0],
      hits, damage: 400, explosion_radius: 0,
      calibrated_shells: false, enhanced_armor: false, allow_ricochet: true,
    }
    const r = calculate(req)
    // 未修（整条射线抑制）：面前的 120mm 间隙甲被删 → hull 40mm 被 100mm 穿深击穿。
    expect(r.result).toBe('BLOCKED')
    expect(r.layers[0].thickness).toBe(120)
  })
})

describe('assignSpacedStencilBits', () => {
  it('按首次出现顺序分配 0x01..0x80，同键共享同一位', () => {
    const { bits, overflow } = assignSpacedStencilBits(['gun:2', 'hull:6', 'gun:2'])
    expect(overflow).toBe(false)
    expect(bits.get('gun:2')).toBe(0x01)
    expect(bits.get('hull:6')).toBe(0x02)
    expect(bits.size).toBe(2)
  })

  it('恰好 8 个键不溢出（0x80 为最高位）', () => {
    const keys = Array.from({ length: SPACED_STENCIL_BIT_LIMIT }, (_, i) => 'k' + i)
    const { bits, overflow } = assignSpacedStencilBits(keys)
    expect(overflow).toBe(false)
    expect(bits.get('k7')).toBe(0x80)
  })

  it('第 9 个键溢出 → fail-closed 标记', () => {
    const keys = Array.from({ length: SPACED_STENCIL_BIT_LIMIT + 1 }, (_, i) => 'k' + i)
    const { overflow } = assignSpacedStencilBits(keys)
    expect(overflow).toBe(true)
  })

  it('空输入无溢出无位', () => {
    const { bits, overflow } = assignSpacedStencilBits([])
    expect(overflow).toBe(false)
    expect(bits.size).toBe(0)
  })
})
