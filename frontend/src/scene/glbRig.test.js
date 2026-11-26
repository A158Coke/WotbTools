import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import {
  cloneDetachedTurret, dropDuplicateGunMasks, neutralizeDefaultMetalness,
  poseFromYPR, yprScene, poseLocalBetween,
  terrainPitchRoll, clampHullAttitude, SUSP_TRAVEL_M,
} from './glbRig.ts'

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
    const root = new THREE.Group()
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
    expect(r.getObjectByName('gun_01_mask')).toBeTruthy()
    expect(r.getObjectByName('turret_01')).toBeTruthy()
  })

  it('无同名对手件 / mesh 数不同 → 保留', () => {
    expect(dropDuplicateGunMasks(root(piece('mask_01', box(1, 1, 1))))).toBe(0)
    const r = root(piece('gun_01_mask', box(1, 1, 1)), piece('mask_01', box(1, 1, 1)))
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
    expect(dupSpy).toHaveBeenCalledTimes(1)
    expect(keptSpy).not.toHaveBeenCalled()
  })

  it('mask_NN 与 gun_NN_mask 共享同一 geometry object → 不得 dispose（保留节点仍引用）', () => {
    const shared = box(1, 3, 1)
    const spy = vi.spyOn(shared, 'dispose')
    const r = root(piece('gun_01_mask', shared), piece('mask_01', shared))
    expect(dropDuplicateGunMasks(r)).toBe(1)
    expect(r.getObjectByName('mask_01')).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('几何被第三方保留节点引用 → 仍不 dispose', () => {
    const shared = box(1, 3, 1)
    const spy = vi.spyOn(shared, 'dispose')
    const r = root(piece('gun_01_mask', box(1, 3, 1)), piece('mask_01', shared), piece('hull_mask', shared))
    expect(dropDuplicateGunMasks(r)).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('几何对象不同、但共享 uv/index 属性对象（真实 Maus 形态）→ 仍不 dispose', () => {
    const reference = box(1, 3, 1)
    const dup = reference.clone()
    expect(dup).not.toBe(reference)
    dup.attributes.uv = reference.attributes.uv
    dup.index = reference.index
    const spy = vi.spyOn(dup, 'dispose')
    const r = root(piece('gun_01_mask', reference), piece('mask_01', dup))
    expect(dropDuplicateGunMasks(r)).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('空输入安全（无模型时返回 0）', () => {
    expect(dropDuplicateGunMasks(null)).toBe(0)
  })
})


describe('悬挂准备件（当前无调用方）：地形姿态 / 限幅残差 / 逆合成', () => {
  const plane = (gx, gz) => (x, z) => gx * x + gz * z

  it('地形姿态与记录姿态同域：前方低 → pitch 正；右侧低 → roll 负（左倾才为正）', () => {
    const downX = terrainPitchRoll(plane(-0.2, 0), 0, 0, Math.PI / 2)
    expect(downX.pitch).toBeGreaterThan(0.05)
    expect(Math.abs(downX.roll)).toBeLessThan(1e-9)
    const downX2 = terrainPitchRoll(plane(+0.2, 0), 0, 0, -Math.PI / 2)
    expect(downX2.pitch).toBeGreaterThan(0.05)
    const downZ = terrainPitchRoll(plane(0, -0.2), 0, 0, Math.PI / 2)
    expect(downZ.roll).toBeLessThan(-0.05)
    const flat = terrainPitchRoll(() => 7.5, 3, -4, 1.234)
    expect(flat.pitch).toBe(0)
    expect(flat.roll).toBe(0)
  })

  it('限幅：残差超行程时按行程截断，未超时原样保留；dy 同样限幅', () => {
    const terr = { pitch: 0, roll: 0 }
    const big = clampHullAttitude(20 * Math.PI / 180, 0, 5, terr, 0)
    expect(big.pitch).toBeLessThan(5 * Math.PI / 180)
    expect(big.pitch).toBeGreaterThan(4 * Math.PI / 180)
    expect(big.dy).toBeCloseTo(SUSP_TRAVEL_M, 9)
    const small = clampHullAttitude(Math.PI / 180, -Math.PI / 180, 0.1, terr, 0)
    expect(small.pitch).toBeCloseTo(Math.PI / 180, 9)
    expect(small.roll).toBeCloseTo(-Math.PI / 180, 9)
    expect(small.dy).toBeCloseTo(0.1, 9)
    const neg = clampHullAttitude(-20 * Math.PI / 180, 0, -5, terr, 0)
    expect(neg.pitch).toBeGreaterThan(-5 * Math.PI / 180)
    expect(neg.dy).toBeCloseTo(-SUSP_TRAVEL_M, 9)
  })

  it('poseLocalBetween = 父子世界朝向的逆合成；yprScene 不含 z-up→y-up 帧变换', () => {
    const parent = poseFromYPR(-0.7, 0.12, -0.2)
    const child = poseFromYPR(-0.7, 0.18, -0.2)
    const local = poseLocalBetween(parent, child)
    const back = parent.clone().multiply(local)
    expect(back.angleTo(child)).toBeLessThan(1e-6)
    expect(poseLocalBetween(parent, parent.clone()).angleTo(new (parent.constructor)())).toBeLessThan(1e-6)
    const a = yprScene(0, 0, 0)
    const b = poseFromYPR(0, 0, 0)
    expect(a.angleTo(b)).toBeGreaterThan(0.5)
    expect(yprScene(-0.4, 0.1, -0.1).angleTo(poseFromYPR(-0.4, 0.1, -0.1))).toBeGreaterThan(0.5)
  })
})


describe('cloneDetachedTurret: original mounted meshes and pivot', () => {
  it('preserves nested bakes, separates gun pitch, excludes hull and borrows resources', () => {
    const model = new THREE.Group()
    const parent = new THREE.Group(); parent.position.set(4, 0, 0); model.add(parent)
    const material = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry()
    const turret = new THREE.Mesh(geometry, material); turret.position.set(1, 2, 3); parent.add(turret)
    const gun = new THREE.Mesh(geometry, material); gun.position.set(0, 2, 0); turret.add(gun)
    const hidden = new THREE.Group(); hidden.visible = false
    hidden.add(new THREE.Mesh(geometry, material)); turret.add(hidden)
    model.add(new THREE.Mesh(geometry, material))
    const parts = { turretNode: turret, gunNodes: [gun], tP: [5, 2, 3], gP: [5, 2, 3], itr: null }
    const head = cloneDetachedTurret(model, parts, Math.PI / 2)
    expect(head.children).toHaveLength(2)
    const centre = new THREE.Vector3().setFromMatrixPosition(head.children[0].matrix)
    expect(centre.length()).toBeCloseTo(0)
    const barrel = new THREE.Vector3().setFromMatrixPosition(head.children[1].matrix)
    expect(barrel.x).toBeCloseTo(0); expect(barrel.y).toBeCloseTo(0); expect(barrel.z).toBeCloseTo(2)
    for (const mesh of head.children) {
      expect(mesh.geometry).toBe(geometry); expect(mesh.material).toBe(material)
      expect(mesh.matrixAutoUpdate).toBe(false)
    }
    expect(turret.parent).toBe(parent); expect(gun.parent).toBe(turret)
    expect(head.quaternion.angleTo(poseFromYPR(0, 0, 0))).toBeCloseTo(0)
  })
})
