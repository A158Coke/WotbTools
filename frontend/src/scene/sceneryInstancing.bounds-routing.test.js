import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectInstanceEntries, groupInstanceBatches, buildInstancedMesh, writeHiddenInstance, fallMatrix, hasTransparentMaterial, buildStandaloneLightmappedMeshes } from './sceneryInstancing.js'
import { geo, mat } from '../test/sceneryInstancingTestHelpers.js'



describe('非均匀缩放槽位的包围球保守性（评审二轮）', () => {
  it('非均匀缩放树倒伏后的最远触及点仍在扩张后的批次球内', async () => {
    const { fallMatrix } = await import('./sceneryInstancing.js')
    const scale = [3.1051428, 2.3885715, 2.3885715]
    const root = new THREE.Object3D()
    const shared = geo(6)
    const m1 = mat()
    const trunk = new THREE.Mesh(shared, m1)
    trunk.position.set(14, 40, 3)
    trunk.scale.set(...scale)
    root.add(trunk)
    root.updateMatrixWorld(true)
    const batch = groupInstanceBatches(collectInstanceEntries(root), 75)[0]
    const mesh = buildInstancedMesh(batch)
    const base = batch.items[0].matrix
    const sph = mesh.boundingSphere
    const g = shared.boundingSphere
    const e = base.elements
    const cx = e[0] * g.center.x + e[4] * g.center.y + e[8] * g.center.z + e[12]
    const cy = e[1] * g.center.x + e[5] * g.center.y + e[9] * g.center.z + e[13]
    const cz = e[2] * g.center.x + e[6] * g.center.y + e[10] * g.center.z + e[14]
    const sr = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]))
    const d = Math.hypot(cx - 14, cy - 40, cz - 3)
    sph.radius = Math.max(sph.radius, d + g.radius * sr + 2)
    const out = fallMatrix(base, 14, 40, 3, new THREE.Vector3(0, -1, 0), Math.PI / 2, new THREE.Matrix4())
    const tip = new THREE.Vector3(0, 0, shared.boundingSphere.radius).applyMatrix4(out)
    const far = tip.distanceTo(sph.center)
    expect(far).toBeLessThanOrEqual(sph.radius)
  })
})



describe('同格双树批次球（评审四轮反例）', () => {
  it('批次球心到 pivot 的距离计入扩张——右树倒伏后射线可命中', async () => {
    const { buildInstancedMesh, groupInstanceBatches, collectInstanceEntries, fallMatrix, refreshBatchSphere }
      = await import('./sceneryInstancing.js')
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
    expect(batches).toHaveLength(1)
    const batch = batches[0]
    for (const b of batches) b.items.forEach((it, i) => { it.batch = b; it.idx = i })
    const mesh = buildInstancedMesh(batch)
    refreshBatchSphere(mesh, batch, () => false)
    const sph = mesh.boundingSphere
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
    const fallen = fallMatrix(right.matrix, 60, 0, 0, new THREE.Vector3(0, 0, 1), Math.PI / 2, new THREE.Matrix4())
    mesh.setMatrixAt(right.idx, fallen)
    mesh.instanceMatrix.needsUpdate = true
    const tip = new THREE.Vector3(0, 2, 0).applyMatrix4(fallen)
    const ray = new THREE.Raycaster(new THREE.Vector3(tip.x, tip.y + 50, tip.z), new THREE.Vector3(0, -1, 0))
    const hits = ray.intersectObject(mesh, false)
    expect(hits.length).toBeGreaterThan(0)
  })
})



describe('损毁态批次球（评审五轮回归）', () => {
  it('全隐藏批次：球按 base 位姿非空，激活后视锥与射线均通过', async () => {
    const { buildInstancedMesh, groupInstanceBatches, collectInstanceEntries, writeHiddenInstance, refreshBatchSphere }
      = await import('./sceneryInstancing.js')
    const root = new THREE.Object3D()
    const shared = geo(2)
    const m1 = mat()
    const r = new THREE.Mesh(shared, m1)
    r.position.set(60, 0, 0)
    root.add(r)
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75)
    const batch = batches[0]
    batch.items.forEach((it, i) => { it.batch = batch; it.idx = i })
    const mesh = buildInstancedMesh(batch)
    for (const e of batch.items) { writeHiddenInstance(mesh, e.idx); e.hidden = true }
    refreshBatchSphere(mesh, batch, (e) => e.hidden)
    expect(mesh.boundingSphere.radius).toBeGreaterThan(0)
    for (const e of batch.items) { mesh.setMatrixAt(e.idx, e.matrix); e.hidden = false }
    mesh.instanceMatrix.needsUpdate = true
    const cam = new THREE.PerspectiveCamera(55, 1, 0.5, 4000)
    cam.position.set(60, 50, 60)
    cam.lookAt(60, 0, 0)
    cam.updateMatrixWorld(true)
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
    expect(frustum.intersectsSphere(mesh.boundingSphere)).toBe(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(60, 50, 0), new THREE.Vector3(0, -1, 0))
    expect(ray.intersectObject(mesh, false).length).toBeGreaterThan(0)
  })

  it('混合批次：隐藏槽位的 base 位姿同样在覆盖内（激活前后同一球可用）', async () => {
    const { buildInstancedMesh, groupInstanceBatches, collectInstanceEntries, writeHiddenInstance, refreshBatchSphere }
      = await import('./sceneryInstancing.js')
    const root = new THREE.Object3D()
    const shared = geo(2)
    const m1 = mat()
    for (const x of [0, 60]) {
      const t = new THREE.Mesh(shared, m1)
      t.position.set(x, 0, 0)
      root.add(t)
    }
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75)
    const batch = batches[0]
    batch.items.forEach((it, i) => { it.batch = batch; it.idx = i })
    const mesh = buildInstancedMesh(batch)
    const hidden = batch.items.find((e) => e.x === 60)
    writeHiddenInstance(mesh, hidden.idx)
    hidden.hidden = true
    refreshBatchSphere(mesh, batch, (e) => e.hidden)
    const far = new THREE.Vector3(60, 0, 0).distanceTo(mesh.boundingSphere.center)
    expect(far).toBeLessThanOrEqual(mesh.boundingSphere.radius)
  })
})




describe('透明材质不进入实例化批', () => {
  it('单材质/多材质任一 transparent 都保留独立节点（three 批内不排序）', () => {
    expect(hasTransparentMaterial({ transparent: false })).toBe(false)
    expect(hasTransparentMaterial(null)).toBe(false)
    expect(hasTransparentMaterial({ transparent: true })).toBe(true)
    expect(hasTransparentMaterial([{ transparent: false }, { transparent: true }])).toBe(true)
    expect(hasTransparentMaterial([{ transparent: false }])).toBe(false)
  })
})




describe('透明+光照图网格保留逐节点 lm 变换', () => {
  it('单实例 InstancedMesh 挂 aLm 并摘除原节点（保持一个透明排序单位）', () => {
    const target = new THREE.Group()
    const node = new THREE.Mesh(geo(), new THREE.MeshBasicMaterial({ transparent: true }))
    target.add(node)
    const entry = {
      node, geometry: node.geometry, material: node.material,
      matrix: new THREE.Matrix4(), lm: [0.25, 0.25, 0.5, 0.5],
      name: 'lm-transparent', x: 0, y: 0,
    }
    const out = buildStandaloneLightmappedMeshes([entry], target)
    expect(out).toHaveLength(1)
    expect(out[0].mesh.count).toBe(1)
    expect(out[0].mesh.geometry.attributes.aLm.getX(0)).toBeCloseTo(0.25)
    expect(out[0].mesh.geometry.attributes.aLm.getY(0)).toBeCloseTo(0.25)
    expect(out[0].mesh.geometry.attributes.aLm.getZ(0)).toBeCloseTo(0.5)
    expect(out[0].mesh.geometry.attributes.aLm.getW(0)).toBeCloseTo(0.5)
    expect(node.parent).toBe(null)
  })
})



describe('批次 AABB（开镜装甲高亮遮挡剔除）', () => {
  it('refreshBatchSphere 产出 occluderBox：覆盖全部实例，隐藏槽位按 base 位姿计入', async () => {
    const { buildInstancedMesh, groupInstanceBatches, collectInstanceEntries, writeHiddenInstance, refreshBatchSphere }
      = await import('./sceneryInstancing.js')
    const root = new THREE.Object3D()
    const shared = geo(2)
    const m1 = mat()
    for (const x of [0, 60]) {
      const t = new THREE.Mesh(shared, m1)
      t.position.set(x, 0, 0)
      root.add(t)
    }
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75)
    const batch = batches[0]
    batch.items.forEach((it, i) => { it.batch = batch; it.idx = i })
    const mesh = buildInstancedMesh(batch)
    const hidden = batch.items.find((e) => e.x === 60)
    writeHiddenInstance(mesh, hidden.idx)
    hidden.hidden = true
    refreshBatchSphere(mesh, batch, (e) => e.hidden)
    const box = mesh.userData.occluderBox
    expect(box).toBeInstanceOf(THREE.Box3)
    expect(box.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true)
    expect(box.containsPoint(new THREE.Vector3(60, 0, 0))).toBe(true)
    expect(box.max.y).toBeGreaterThanOrEqual(1.5)
  })

  it('可见槽位按当前实例矩阵计入（重算刷新同一 Box3）', async () => {
    const { buildInstancedMesh, groupInstanceBatches, collectInstanceEntries, refreshBatchSphere }
      = await import('./sceneryInstancing.js')
    const root = new THREE.Object3D()
    const shared = geo(2)
    root.add(new THREE.Mesh(shared, mat()))
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root), 75)
    const batch = batches[0]
    batch.items.forEach((it, i) => { it.batch = batch; it.idx = i })
    const mesh = buildInstancedMesh(batch)
    refreshBatchSphere(mesh, batch, () => false)
    const box = mesh.userData.occluderBox
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(120, 0, 0))
    mesh.instanceMatrix.needsUpdate = true
    refreshBatchSphere(mesh, batch, () => false)
    expect(box.containsPoint(new THREE.Vector3(120, 0, 0))).toBe(true)
    expect(mesh.userData.occluderBox).toBe(box)
  })
})
