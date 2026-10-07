// sceneryInstancing 纯模块测试：three 数学可无头运行，这里锁定三件事——
// 1) fallMatrix 与旧 pivot 装配**逐值等价**（树倒动画换实现不换语义的根锁）；
// 2) 分组稳定性与键完整性；
// 3) InstancedMesh 构造的矩阵/包围球正确性 + 隐藏实例不可命中。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  collectInstanceEntries, groupInstanceBatches, buildInstancedMesh,
  writeHiddenInstance, fallMatrix,
} from './sceneryInstancing.js'

const geo = (h = 1) => {
  const g = new THREE.BoxGeometry(1, h, 1)
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5 + h - 1, 0.5))
  return g
}
const mat = () => new THREE.MeshLambertMaterial()

describe('sceneryInstancing · fallMatrix 与旧 pivot 装配等价', () => {
  // 旧模型（playbackScene 加载段）：pivot 在 (px,py,pz)，命中 mesh 改位重挂为
  // childLocal = T(pos−p)·R·S，倒伏 = pivot.quaternion = R(axis, angle)。
  // 世界 = pivot.matrix · childLocal。实例模型必须得到同一个世界矩阵。
  it('随机位姿/轴向/角度下，实例矩阵 ≡ pivot·child 世界矩阵（平差 < 1e-5）', () => {
    let seed = 42
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let i = 0; i < 200; i++) {
      const p = new THREE.Vector3(rnd() * 400 - 200, rnd() * 400 - 200, rnd() * 8)
      const pos = new THREE.Vector3(p.x + rnd() * 0.04 - 0.02, p.y + rnd() * 0.04 - 0.02, rnd() * 8)
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI))
      const scale = new THREE.Vector3(1, 1, 1)
      const nodeM = new THREE.Matrix4().compose(pos, rot, scale)
      const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()
      const angle = rnd() * Math.PI / 2

      // 旧：pivot ∘ child
      const pivot = new THREE.Group()
      pivot.position.copy(p)
      pivot.quaternion.setFromAxisAngle(axis, angle)
      const child = new THREE.Mesh(geo())
      child.position.set(pos.x - p.x, pos.y - p.y, pos.z - p.z)
      child.quaternion.copy(rot)
      pivot.add(child)
      const parent = new THREE.Object3D()
      parent.add(pivot)
      parent.updateMatrixWorld(true)

      // 新：fallMatrix(base)
      const out = fallMatrix(nodeM, p.x, p.y, p.z, axis, angle, new THREE.Matrix4())

      const oldW = child.matrixWorld
      for (let k = 0; k < 16; k++) {
        expect(Math.abs(out.elements[k] - oldW.elements[k])).toBeLessThan(1e-5)
      }
    }
  })

  it('angle=0 时等于 base（静止树不因换实现而挪动）', () => {
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(12, -30, 3.3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 2, -0.3)),
      new THREE.Vector3(1, 1, 1))
    const out = fallMatrix(base, 12, -30, 3.3, new THREE.Vector3(0.6, 0.8, 0), 0, new THREE.Matrix4())
    expect(out).toEqual(base)
  })
})

describe('sceneryInstancing · 收集与分组', () => {
  const buildTree = () => {
    const root = new THREE.Object3D()
    const shared = geo(2), m1 = mat(), m2 = mat()
    for (let i = 0; i < 3; i++) {
      const a = new THREE.Mesh(shared, m1)
      a.name = `fir_${i}`
      a.position.set(i * 10, i * 5, i)
      root.add(a)
    }
    const b = new THREE.Mesh(geo(3), m2)
    b.name = 'rock'
    b.position.set(50, 50, 2)
    root.add(b)
    // 嵌套父链：变换要沿链累积
    const mid = new THREE.Object3D()
    mid.position.set(100, 0, 0)
    const c = new THREE.Mesh(shared, m1)
    c.name = 'nested'
    c.position.set(1, 2, 3)
    mid.add(c)
    root.add(mid)
    return { root, shared, m1, m2 }
  }

  it('cellSize 分片：同 (geometry, material) 按宫格拆多批，包围球局部化', () => {
    const root = new THREE.Object3D()
    const shared = geo(2), m1 = mat()
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Mesh(shared, m1)
      a.position.set(i * 200 - 300, 0, 0)   // 跨 ±300m
      root.add(a)
    }
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75)
    // 4 实例相距 ≥200m → 每格一片 = 4 片（整批形态是 1 片跨全图）
    expect(batches).toHaveLength(4)
    for (const b of batches) expect(b.items).toHaveLength(1)
    // 不传 cellSize = 单批（兼容形态）
    expect(groupInstanceBatches(collectInstanceEntries(root))).toHaveLength(1)
  })

  it('收集展平父链变换；分组按 (geometry, material)，共享几何进同批', () => {
    const { root, shared, m1, m2 } = buildTree()
    root.updateMatrixWorld(true)
    const entries = collectInstanceEntries(root)
    expect(entries).toHaveLength(5)
    const nested = entries.find((e) => e.name === 'nested')
    expect(nested.x).toBeCloseTo(101)
    expect(nested.z).toBeCloseTo(3)
    const batches = groupInstanceBatches(entries)
    expect(batches).toHaveLength(2)
    const big = batches.find((b) => b.geometry === shared)
    expect(big.material).toBe(m1)
    expect(big.items).toHaveLength(4)   // 3 平铺 + 1 嵌套
    const rock = batches.find((b) => b.geometry !== shared)
    expect(rock.material).toBe(m2)
    expect(rock.items).toHaveLength(1)
  })

  it('InstancedMesh：实例矩阵与源节点世界变换一致，包围球罩住全部实例', () => {
    const { root, shared, m1 } = buildTree()
    root.updateMatrixWorld(true)
    const batch = groupInstanceBatches(collectInstanceEntries(root)).find((b) => b.geometry === shared)
    const mesh = buildInstancedMesh(batch)
    expect(mesh.count).toBe(4)
    const m = new THREE.Matrix4()
    batch.items.forEach((it, i) => {
      mesh.getMatrixAt(i, m)
      expect(m).toEqual(it.matrix)
    })
    // 嵌套实例在 x≈101，几何自身球（半径 ~1）罩不住它——包围球必须已扩到全部实例
    expect(mesh.boundingSphere.radius).toBeGreaterThan(50)
    expect(mesh.isInstancedMesh).toBe(true)
    expect(mesh.matrixAutoUpdate).toBe(false)
  })

  it('隐藏实例写远处微缩矩阵：不可能被射线命中、也不污染包围球内的合法实例', () => {
    const { root, shared, m1 } = buildTree()
    root.updateMatrixWorld(true)
    const batch = groupInstanceBatches(collectInstanceEntries(root)).find((b) => b.geometry === shared)
    const mesh = buildInstancedMesh(batch)
    writeHiddenInstance(mesh, 0)
    const m = new THREE.Matrix4()
    mesh.getMatrixAt(0, m)
    const e = m.elements
    expect(e[13]).toBeLessThan(-1e5)            // y 平移在 -1e6
    const det = e[0] * e[5] * e[10]             // 对角微缩 → 行列式 ~1e-18
    expect(Math.abs(det)).toBeLessThan(1e-12)
    // 其余实例未动
    mesh.getMatrixAt(1, m)
    expect(m).toEqual(batch.items[1].matrix)
  })
})

describe('非均匀缩放槽位的包围球保守性（评审二轮）', () => {
  // 评审复现：erlenberg Spruce2 节点带 ≈[3.105, 2.389, 2.389] 缩放——未缩放扩张
  // （d + 原型 heightM + 2）不保守，倒伏射线仍 0 命中。锁定：扩张量必须按
  // base 变换后的实高（含缩放）计算，倒伏扫掠被球覆盖。
  it('非均匀缩放树倒伏后的最远触及点仍在扩张后的批次球内', async () => {
    const { fallMatrix } = await import('./sceneryInstancing.js')
    // 原型树：局部高 6m（树梢在 z=6），节点缩放 [3.105, 2.389, 2.389] → 实高 ≈18.6m
    const scale = [3.1051428, 2.3885715, 2.3885715]
    const root = new THREE.Object3D()
    const shared = geo(6)                       // boundingBox max.z = 6 + 0.5
    const m1 = mat()
    const trunk = new THREE.Mesh(shared, m1)
    trunk.position.set(14, 40, 3)
    trunk.scale.set(...scale)
    root.add(trunk)
    root.updateMatrixWorld(true)
    const batch = groupInstanceBatches(collectInstanceEntries(root), 75)[0]
    const mesh = buildInstancedMesh(batch)
    // base = 实例矩阵（含缩放）；fallQuat 复现评审射线姿态（倒向 -y）
    const base = batch.items[0].matrix
    // 场景内核扩张公式（与 playbackScene 装配段同式）
    const sph = mesh.boundingSphere
    const g = shared.boundingSphere
    const e = base.elements
    const cx = e[0] * g.center.x + e[4] * g.center.y + e[8] * g.center.z + e[12]
    const cy = e[1] * g.center.x + e[5] * g.center.y + e[9] * g.center.z + e[13]
    const cz = e[2] * g.center.x + e[6] * g.center.y + e[10] * g.center.z + e[14]
    const sr = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]))
    const d = Math.hypot(cx - 14, cy - 40, cz - 3)
    sph.radius = Math.max(sph.radius, d + g.radius * sr + 2)
    // 倒伏：绕基点旋转 90°（fallMatrix 与内核同式）→ 树梢伸到 ≈ (14, 40−18.6, 3)
    const out = fallMatrix(base, 14, 40, 3, new THREE.Vector3(0, -1, 0), Math.PI / 2, new THREE.Matrix4())
    // 树梢 = 几何顶点真实上界（boundingSphere.radius ≈ 3.08 > 手动 boundingBox 的半高）
    const tip = new THREE.Vector3(0, 0, shared.boundingSphere.radius).applyMatrix4(out)
    const far = tip.distanceTo(sph.center)
    expect(far).toBeLessThanOrEqual(sph.radius)   // 评审复现的 0 命中场景不再发生
  })
})

describe('同格双树批次球（评审四轮反例）', () => {
  it('批次球心到 pivot 的距离计入扩张——右树倒伏后射线可命中', async () => {
    const { buildInstancedMesh, groupInstanceBatches, collectInstanceEntries, fallMatrix, refreshBatchSphere }
      = await import('./sceneryInstancing.js')
    // 评审反例：同一 75m 格内两棵树（x=0 与 x=60）→ 同一批次，球心 ≈ x=30；
    // 右树（x=60）倒伏后，扩张若只算「几何球心→pivot」会漏 30m 的球心距离。
    const root = new THREE.Object3D()
    const shared = geo(6)
    const m1 = mat()
    for (const x of [0, 60]) {
      const t = new THREE.Mesh(shared, m1)
      t.position.set(x, 0, 0)
      root.add(t)
    }
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75)
    expect(batches).toHaveLength(1)            // 同格 = 同批
    const batch = batches[0]
    // idx/batch 回填与 playbackScene 装配段同式（groupInstanceBatches 本身不设）
    for (const b of batches) b.items.forEach((it, i) => { it.batch = b; it.idx = i })
    const mesh = buildInstancedMesh(batch)
    refreshBatchSphere(mesh, batch, () => false)
    const sph = mesh.boundingSphere
    // 生产扩张公式（playbackScene 装配段同式）：右树 pivot (60,0,0)，绕 z 倒伏
    const right = batch.items.find((e) => e.x === 60)
    const e = right.matrix.elements
    const g = shared.boundingSphere
    const cx = e[0] * g.center.x + e[4] * g.center.y + e[8] * g.center.z + e[12]
    const cy = e[1] * g.center.x + e[5] * g.center.y + e[9] * g.center.z + e[13]
    const cz = e[2] * g.center.x + e[6] * g.center.y + e[10] * g.center.z + e[14]
    const sr = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]))
    const r = g.radius * sr
    const dGeo = Math.hypot(cx - 60, cy - 0, cz - 0)
    const dCenter = Math.hypot(sph.center.x - 60, sph.center.y - 0, sph.center.z - 0)
    sph.radius = Math.max(sph.radius, dCenter + dGeo + r + 2)
    // 倒伏右树（绕 z 轴 90°），写入实例矩阵
    const fallen = fallMatrix(right.matrix, 60, 0, 0, new THREE.Vector3(0, 0, 1), Math.PI / 2, new THREE.Matrix4())
    mesh.setMatrixAt(right.idx, fallen)
    mesh.instanceMatrix.needsUpdate = true
    // 真实 Raycaster：倒伏后躯干（几何真实顶点 (0,2,0) 经倒伏矩阵）垂直下射，
    // 必须命中——评审同法（倒伏前该体积不在原球内 → mesh 级球测先拒，命中 0）
    const tip = new THREE.Vector3(0, 2, 0).applyMatrix4(fallen)
    const ray = new THREE.Raycaster(new THREE.Vector3(tip.x, tip.y + 50, tip.z), new THREE.Vector3(0, -1, 0))
    const hits = ray.intersectObject(mesh, false)
    expect(hits.length).toBeGreaterThan(0)
  })
})
