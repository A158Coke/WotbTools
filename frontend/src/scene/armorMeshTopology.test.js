import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { isClosedSurfaceGeometry } from './armorMeshTopology.js'

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
