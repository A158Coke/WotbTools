import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { assignSpacedStencilBits, isClosedSurfaceGeometry, resolveSpacedHitMask, spacedDedupKey, SPACED_STENCIL_BIT_LIMIT } from './armorMeshTopology.ts'

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
