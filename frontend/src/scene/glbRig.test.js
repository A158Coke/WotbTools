import { describe, it, expect, vi } from 'vitest'
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

  it('无同名对手件 / mesh 数不同 → 保留', () => {
    expect(dropDuplicateGunMasks(root(piece('mask_01', box(1, 1, 1))))).toBe(0)
    const r = root(piece('gun_01_mask', box(1, 1, 1)), piece('mask_01', box(1, 1, 1)))
    // mesh 数不同（子树多一个 mesh）→ 视为不同几何
    r.getObjectByName('mask_01').add(new THREE.Mesh(box(1, 1, 1), new THREE.MeshBasicMaterial()))
    expect(dropDuplicateGunMasks(r)).toBe(0)
  })

  it('几何不同 → 原样保留（绝不凭命名像副本就删可见部件）', () => {
    const r = root(piece('gun_01_mask', box(1, 3, 1)), piece('mask_01', box(2, 2, 4)))
    expect(dropDuplicateGunMasks(r)).toBe(0)
    expect(r.getObjectByName('mask_01')).toBeTruthy()
  })

  it('顶点数相同、bbox 逐值相同，但内点位置不同 → 必须保留（旧「顶点数+bbox」判据会误删）', () => {
    const reference = new THREE.BoxGeometry(1, 3, 1, 2, 2, 2)
    const tampered = reference.clone()
    const pos = tampered.attributes.position
    const bb = { min: new THREE.Vector3(), max: new THREE.Vector3() }
    reference.computeBoundingBox()
    bb.min.copy(reference.boundingBox.min); bb.max.copy(reference.boundingBox.max)
    // 找一个 x/y 都严格位于 bbox 内部的顶点，沿 x 微移：顶点数与包围盒都不变，只有位置数据变了
    // （表面网格的顶点至少在一条轴上贴边，所以判据不能要求三轴都靠内）
    const v = new THREE.Vector3()
    let moved = false
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      if (v.x > bb.min.x + 1e-6 && v.x < bb.max.x - 1e-6
        && v.y > bb.min.y + 1e-6 && v.y < bb.max.y - 1e-6) {
        pos.setX(i, v.x + 0.05)
        moved = true
        break
      }
    }
    expect(moved, '测试前提：分段 box 必须存在内部顶点').toBe(true)
    tampered.computeBoundingBox()
    // 前提成立：旧判据（顶点数 + bbox）在这里会判定「重复」
    expect(tampered.attributes.position.count).toBe(reference.attributes.position.count)
    expect(tampered.boundingBox.min.distanceTo(bb.min)).toBeLessThan(1e-4)
    expect(tampered.boundingBox.max.distanceTo(bb.max)).toBeLessThan(1e-4)

    const r = root(piece('gun_01_mask', reference), piece('mask_01', tampered))
    expect(dropDuplicateGunMasks(r)).toBe(0)
    expect(r.getObjectByName('mask_01')).toBeTruthy()
  })

  it('位置相同但索引数据不同 → 保留', () => {
    const reference = box(1, 3, 1)
    const tampered = reference.clone()
    tampered.index.setX(0, (tampered.index.getX(0) + 1) % tampered.attributes.position.count)
    const r = root(piece('gun_01_mask', reference), piece('mask_01', tampered))
    expect(dropDuplicateGunMasks(r)).toBe(0)
  })

  it('属性集合不同（一侧多第二套 UV）→ 保留（真实车体类 primitive 带 TEXCOORD_1）', () => {
    const reference = box(1, 3, 1)
    const withUv1 = reference.clone()
    const uv1 = new Float32Array(withUv1.attributes.position.count * 2)
    withUv1.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
    const r = root(piece('gun_01_mask', reference), piece('mask_01', withUv1))
    expect(dropDuplicateGunMasks(r)).toBe(0)
    expect(r.getObjectByName('mask_01')).toBeTruthy()
  })

  it('第二套 UV 数值不同 → 保留（属性集合比较是全量的，不给误删留盲点）', () => {
    const reference = box(1, 3, 1)
    const a = reference.clone(); const b = reference.clone()
    const mk = (g, fill) => {
      const arr = new Float32Array(g.attributes.position.count * 2).fill(fill)
      g.setAttribute('uv1', new THREE.BufferAttribute(arr, 2))
      return g
    }
    const r = root(piece('gun_01_mask', mk(a, 0)), piece('mask_01', mk(b, 0.5)))
    expect(dropDuplicateGunMasks(r)).toBe(0)
  })

  it('一侧有索引一侧没有（拓扑形状不同）→ 保留', () => {
    const reference = box(1, 3, 1)
    const nonIndexed = reference.clone()
    nonIndexed.setIndex(null)
    const r = root(piece('gun_01_mask', reference), piece('mask_01', nonIndexed))
    expect(dropDuplicateGunMasks(r)).toBe(0)
    expect(r.getObjectByName('mask_01')).toBeTruthy()
  })

  it('去重时释放自己那份 geometry（不泄漏），且只释放未被保留节点引用的', () => {
    const dupGeo = box(1, 3, 1)
    const keptGeo = box(1, 3, 1)
    const dupSpy = vi.spyOn(dupGeo, 'dispose')
    const keptSpy = vi.spyOn(keptGeo, 'dispose')
    const r = root(piece('gun_01_mask', keptGeo), piece('mask_01', dupGeo))
    expect(dropDuplicateGunMasks(r)).toBe(1)
    expect(dupSpy).toHaveBeenCalledTimes(1)     // 被删节点独占的 geometry 正常释放
    expect(keptSpy).not.toHaveBeenCalled()      // 保留节点绝不被牵连
  })

  it('mask_NN 与 gun_NN_mask 共享同一 geometry object → 不得 dispose（保留节点仍引用）', () => {
    const shared = box(1, 3, 1)
    const spy = vi.spyOn(shared, 'dispose')
    const r = root(piece('gun_01_mask', shared), piece('mask_01', shared))
    expect(dropDuplicateGunMasks(r)).toBe(1)
    expect(r.getObjectByName('mask_01')).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()          // 共享几何被释放会让保留部件丢 GPU buffer
  })

  it('几何被第三方保留节点引用 → 仍不 dispose', () => {
    const shared = box(1, 3, 1)
    const spy = vi.spyOn(shared, 'dispose')
    const r = root(piece('gun_01_mask', box(1, 3, 1)), piece('mask_01', shared), piece('hull_mask', shared))
    expect(dropDuplicateGunMasks(r)).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('几何对象不同、但共享 uv/index 属性对象（真实 Maus 形态）→ 仍不 dispose', () => {
    // 实测 6929 资产：两份副本的 TEXCOORD_0/TEXCOORD_1/INDEX 是同一 accessor 对象，
    // POSITION/NORMAL 各写一份（仅 float32 舍入噪声）。释放被删几何会连带回收保留部件
    // 仍在用的 uv/index GPU buffer。
    const reference = box(1, 3, 1)
    const dup = reference.clone()
    expect(dup).not.toBe(reference)
    dup.attributes.uv = reference.attributes.uv      // 共享 uv attribute 对象
    dup.index = reference.index                      // 共享 index attribute 对象
    const spy = vi.spyOn(dup, 'dispose')
    const r = root(piece('gun_01_mask', reference), piece('mask_01', dup))
    expect(dropDuplicateGunMasks(r)).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('空输入安全（无模型时返回 0）', () => {
    expect(dropDuplicateGunMasks(null)).toBe(0)
  })
})
