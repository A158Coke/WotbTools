// sceneryInstancing 纯模块测试：three 数学可无头运行，这里锁定三件事——
// 1) fallMatrix 与旧 pivot 装配**逐值等价**（树倒动画换实现不换语义的根锁）；
// 2) 分组稳定性与键完整性；
// 3) InstancedMesh 构造的矩阵/包围球正确性 + 隐藏实例不可命中。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectInstanceEntries, groupInstanceBatches, buildInstancedMesh, writeHiddenInstance, fallMatrix } from './sceneryInstancing.js'
import { geo, mat } from '../test/sceneryInstancingTestHelpers.js'



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
    // 小三角量组（12 tri × 4 = 48 ≤ 预算）默认整组合并单批（见 SCENERY_COLLAPSE_MAX_TRIS）；
    // 逐格分片语义用 maxCollapseTris: 0 显式开启（性能对照/诊断形态）
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75, { maxCollapseTris: 0 })
    // 4 实例相距 ≥200m → 每格一片 = 4 片（整批形态是 1 片跨全图）
    expect(batches).toHaveLength(4)
    for (const b of batches) expect(b.items).toHaveLength(1)
    // 不传 cellSize = 单批（兼容形态）
    expect(groupInstanceBatches(collectInstanceEntries(root))).toHaveLength(1)
  })

  it('小三角量稀疏组跨宫格合并单批：省 draw call，实例矩阵完整（2026-11-14 帧率优化）', () => {
    const root = new THREE.Object3D()
    const shared = geo(2), m1 = mat()
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Mesh(shared, m1)
      a.position.set(i * 200 - 300, 0, 0)
      root.add(a)
    }
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75)
    // 12 tri × 4 实例 = 48 ≤ 预算 → 跨 4 格合并为 1 批
    expect(batches).toHaveLength(1)
    expect(batches[0].items).toHaveLength(4)
    const mesh = buildInstancedMesh(batches[0])
    expect(mesh.count).toBe(4)
    const m = new THREE.Matrix4()
    batches[0].items.forEach((it, i) => {
      mesh.getMatrixAt(i, m)
      expect(m).toEqual(it.matrix)
    })
  })

  it('同组跨区超预算时，稀疏相邻格合批，稠密相邻格分别剔除', () => {
    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry(), material = mat()
    // 一盒 12 个三角：负坐标区有两个实例，可合并；正坐标区有三个，须按细格划分。
    for (const x of [-149, -74, 1, 2, 76]) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.x = x
      root.add(mesh)
    }
    const entries = collectInstanceEntries(root)
    const batches = groupInstanceBatches(entries, 75, { maxCollapseTris: 24 })
    const members = batches.map(batch => batch.items.map(entry => entry.x).sort((a, b) => a - b))
    expect(members.sort((a, b) => a[0] - b[0])).toEqual([[-149, -74], [1, 2], [76]])
  })

  it('大几何密集组不合并：总三角超预算仍按宫格分片（剔除粒度保留）', () => {
    const root = new THREE.Object3D()
    // 10000 三角的几何 × 4 实例 = 40000 > 预算 → 不合并
    const bigGeo = new THREE.BufferGeometry()
    bigGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    const idx = []
    for (let i = 0; i < 10000; i++) idx.push(0, 1, 2)
    bigGeo.setIndex(idx)
    const m1 = mat()
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Mesh(bigGeo, m1)
      a.position.set(i * 200 - 300, 0, 0)
      root.add(a)
    }
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75)
    expect(batches).toHaveLength(4)
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
