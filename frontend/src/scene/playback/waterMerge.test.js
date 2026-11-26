import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { mergeCoincidentWaterMeshes } from './waterMerge.js'

function waterMat() {
  const m = new THREE.MeshBasicMaterial({ transparent: true })
  m.userData.water = true
  return m
}

function quad(x = 0, y = 0, size = 1) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    x, y, 0, x + size, y, 0, x, y + size, 0, x + size, y + size, 0,
  ], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
  g.setIndex([0, 1, 2, 1, 3, 2])
  return g
}

describe('mergeCoincidentWaterMeshes', () => {
  it('同材质互不包含的水面合并为一个 mesh（世界变换烘焙进几何）', () => {
    const root = new THREE.Group()
    const mat = waterMat()
    const a = new THREE.Mesh(quad(0, 0), mat)
    const b = new THREE.Mesh(quad(10, 0), mat)
    b.position.set(5, 0, 0)
    root.add(a, b)
    const res = mergeCoincidentWaterMeshes(root)
    expect(res).toEqual({ groups: 1, merged: 2, dropped: 0, failed: 0 })
    const meshes = root.children.filter((o) => o.isMesh)
    expect(meshes.length).toBe(1)
    expect(meshes[0].name).toBe('water_merged')
    expect(meshes[0].renderOrder).toBe(10)
    const pos = meshes[0].geometry.getAttribute('position')
    expect(pos.count).toBe(8)
    let maxX = -Infinity
    for (let i = 0; i < pos.count; i++) maxX = Math.max(maxX, pos.getX(i))
    expect(maxX).toBeCloseTo(16, 6)
  })

  it('完全被另一块覆盖的重复水面只显示覆盖超集（不合并、不双画）', () => {
    const root = new THREE.Group()
    const mat = waterMat()
    const full = new THREE.Mesh(quad(0, 0, 2), mat)
    const inner = new THREE.Mesh(quad(0.5, 0.5, 1), mat)
    root.add(full, inner)
    const res = mergeCoincidentWaterMeshes(root)
    expect(res).toEqual({ groups: 1, merged: 0, dropped: 1, failed: 0 })
    const meshes = root.children.filter((o) => o.isMesh)
    expect(meshes.length).toBe(1)
    expect(meshes[0]).toBe(full)
    expect(inner.parent).toBeNull()
    expect(meshes[0].name).not.toBe('water_merged')
  })

  it('互相部分重叠但不包含 ⇒ 都保留并合并（不同水体/不同覆盖）', () => {
    const root = new THREE.Group()
    const mat = waterMat()
    root.add(new THREE.Mesh(quad(0, 0, 1), mat), new THREE.Mesh(quad(0.5, 0.5, 1), mat))
    const res = mergeCoincidentWaterMeshes(root)
    expect(res).toEqual({ groups: 1, merged: 2, dropped: 0, failed: 0 })
    expect(root.children.filter((o) => o.isMesh).length).toBe(1)
  })

  it('不同水面材质各自成组；非水面材质不参与', () => {
    const root = new THREE.Group()
    const m1 = waterMat()
    const m2 = waterMat()
    const plain = new THREE.MeshBasicMaterial()
    root.add(new THREE.Mesh(quad(0, 0), m1), new THREE.Mesh(quad(1, 0), m1))
    root.add(new THREE.Mesh(quad(20, 0), m2), new THREE.Mesh(quad(21, 0), m2))
    const plainMesh = new THREE.Mesh(quad(40, 0), plain)
    root.add(plainMesh)
    const res = mergeCoincidentWaterMeshes(root)
    expect(res.groups).toBe(2)
    expect(res.merged).toBe(4)
    expect(res.dropped).toBe(0)
    expect(plainMesh.parent).toBe(root)
  })

  it('单块水面不合并（少于 2 个网格零动作）', () => {
    const root = new THREE.Group()
    const only = new THREE.Mesh(quad(0, 0), waterMat())
    root.add(only)
    expect(mergeCoincidentWaterMeshes(root)).toEqual({ groups: 0, merged: 0, dropped: 0, failed: 0 })
    expect(root.children[0]).toBe(only)
  })

  it('属性集不一致（多余属性/缺 uv）时清理后仍可合并', () => {
    const root = new THREE.Group()
    const mat = waterMat()
    const a = quad(0, 0)
    const b = quad(4, 0)
    b.setAttribute('color', new THREE.Float32BufferAttribute(new Array(4 * 3).fill(1), 3))
    b.deleteAttribute('uv')
    root.add(new THREE.Mesh(a, mat), new THREE.Mesh(b, mat))
    const res = mergeCoincidentWaterMeshes(root)
    expect(res.failed).toBe(0)
    expect(res.merged).toBe(2)
    const merged = root.children.find((o) => o.name === 'water_merged')
    expect(merged.geometry.getAttribute('uv')).toBeTruthy()
    expect(merged.geometry.getAttribute('color')).toBeFalsy()
  })

  it('无水面材质：no-op', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(quad(0, 0), new THREE.MeshBasicMaterial()))
    expect(mergeCoincidentWaterMeshes(root)).toEqual({ groups: 0, merged: 0, dropped: 0, failed: 0 })
  })
})
