import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { neutralizeDefaultMetalness } from './glbRig.js'

// 复刻 GLTFLoader 的赋值：省略 metallicFactor 时取 glTF 规范默认 1.0（three 自己的
// MeshStandardMaterial 默认是 0.0，所以必须显式设成 1 才是真实的装载结果）；
// 有 metallicRoughness 贴图时该贴图同时绑到 metalnessMap 与 roughnessMap。
const nonPbrMaterial = () => {
  const m = new THREE.MeshStandardMaterial({ roughness: 1 })
  m.metalness = 1
  return m
}
const pbrMaterial = () => {
  const m = nonPbrMaterial()
  m.metalnessMap = new THREE.Texture()
  m.roughnessMap = new THREE.Texture()
  return m
}
const mesh = (material) => new THREE.Mesh(new THREE.BufferGeometry(), material)
/** 按 hull → turret_01 → gun_01 的层级挂链（真实模型的子树形态），返回根节点 */
const tree = (material) => {
  const gun = new THREE.Group()
  gun.name = 'gun_01'
  gun.add(mesh(material))
  const turret = new THREE.Group()
  turret.name = 'turret_01'
  turret.add(gun)
  const hull = new THREE.Group()
  hull.name = 'hull'
  hull.add(turret)
  return hull
}

describe('neutralizeDefaultMetalness（老式车不得按全金属渲染）', () => {
  it('无 metalnessMap 且仍是默认 1.0 → 归零，且不动粗糙度', () => {
    const m = nonPbrMaterial()
    neutralizeDefaultMetalness(mesh(m))
    expect(m.metalness).toBe(0)
    expect(m.roughness).toBe(1)
  })

  it('PBR 车（有 metallicRoughness 贴图）不受影响——金属度由贴图给', () => {
    const m = pbrMaterial()
    neutralizeDefaultMetalness(tree(m))
    expect(m.metalness).toBe(1)
  })

  it('显式声明过金属度的材质不受影响（只动 glTF 默认值）', () => {
    const m = new THREE.MeshStandardMaterial({ metalness: 0.3 })
    neutralizeDefaultMetalness(mesh(m))
    expect(m.metalness).toBe(0.3)
  })

  it('hull/turret/gun 嵌套子树逐 mesh 生效，非 mesh 节点不报错', () => {
    const m = nonPbrMaterial()
    neutralizeDefaultMetalness(tree(m))
    expect(m.metalness).toBe(0)
    const root = new THREE.Group()   // 无 material 的节点不得抛错
    neutralizeDefaultMetalness(root)
    expect(root.children).toHaveLength(0)
  })

  it('幂等：重复调用不改变结果，也不会碰已归零/PBR 材质', () => {
    const old_ = nonPbrMaterial()
    const pbr = pbrMaterial()
    const root = tree(old_)
    root.add(mesh(pbr))
    neutralizeDefaultMetalness(root)
    neutralizeDefaultMetalness(root)
    expect(old_.metalness).toBe(0)
    expect(pbr.metalness).toBe(1)
  })

  it('一次调用修复同一模型内的多个老式车材质（零件各自成 mesh）', () => {
    const a = nonPbrMaterial()
    const b = nonPbrMaterial()
    const root = tree(a)
    root.add(mesh(b))
    neutralizeDefaultMetalness(root)
    expect([a.metalness, b.metalness]).toEqual([0, 0])
  })
})
