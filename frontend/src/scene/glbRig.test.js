import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { dropDuplicateGunMasks, neutralizeDefaultMetalness } from './glbRig.js'

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

describe('dropDuplicateGunMasks · 几何副本去重（Maus mask_01 ↔ gun_01_mask）', () => {
  /** 造一个和真实 GLB 同形的子树：组节点 → mesh 子节点（几何在子节点上） */
  const piece = (name, geo) => {
    const group = new THREE.Group(); group.name = name
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
    group.add(mesh)
    return group
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
  const root = (...nodes) => { const r = new THREE.Group(); nodes.forEach((n) => r.add(n)); return r }

  it('几何完全一致 → 丢弃 mask_NN（否则炮塔转走后它留在原地）', () => {
    const r = root(piece('turret_01', box(2, 2, 2)), piece('gun_01_mask', box(1, 3, 1)), piece('mask_01', box(1, 3, 1)))
    expect(dropDuplicateGunMasks(r)).toBe(1)
    expect(r.getObjectByName('mask_01')).toBeUndefined()
    expect(r.getObjectByName('gun_01_mask')).toBeTruthy()   // 保留被 rig 摆位的那一份
    expect(r.getObjectByName('turret_01')).toBeTruthy()
  })

  it('几何不同 → 原样保留（绝不凭命名像副本就删可见部件）', () => {
    const r = root(piece('gun_01_mask', box(1, 3, 1)), piece('mask_01', box(2, 2, 4)))
    expect(dropDuplicateGunMasks(r)).toBe(0)
    expect(r.getObjectByName('mask_01')).toBeTruthy()
  })

  it('无同名对手件 / 顶点数不同 → 保留', () => {
    expect(dropDuplicateGunMasks(root(piece('mask_01', box(1, 1, 1))))).toBe(0)
    const r = root(piece('gun_01_mask', box(1, 1, 1)), piece('mask_01', box(1, 1, 1), piece));
    // 顶点数不同（多加一个 mesh）→ 视为不同几何
    r.getObjectByName('mask_01').add(new THREE.Mesh(box(1, 1, 1), new THREE.MeshBasicMaterial()))
    expect(dropDuplicateGunMasks(r)).toBe(0)
  })

  it('空输入安全（无模型时返回 0）', () => {
    expect(dropDuplicateGunMasks(null)).toBe(0)
  })
})
