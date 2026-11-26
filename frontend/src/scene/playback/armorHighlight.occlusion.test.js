import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { canOccludeTarget, cropFrustum, isSolidOccluder, markPickBoundsStale, screenRect } from './armorHighlight.js'

describe('遮挡 pass 裁剪', () => {
  const camera = (fov = 30) => {
    const c = new THREE.PerspectiveCamera(fov, 2, 0.5, 2000)
    c.lookAt(0, 0, -1)
    c.updateMatrixWorld(true)
    c.updateProjectionMatrix()
    return c
  }
  const boxAt = (x, y, z, half = 2) => new THREE.Box3(
    new THREE.Vector3(x - half, y - half, z - half), new THREE.Vector3(x + half, y + half, z + half),
  )
  const mesh = (x, y, z, radius = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius))
    m.position.set(x, y, z)
    m.geometry.computeBoundingSphere()
    m.updateMatrixWorld(true)
    return m
  }
  const viewOf = (c, rect, maxDepth) => ({
    frustum: cropFrustum(c, rect, new THREE.Frustum()),
    origin: c.position.clone(), forward: c.getWorldDirection(new THREE.Vector3()), maxDepth,
  })

  it('screenRect 包住目标，只占屏幕一小块', () => {
    const c = camera()
    const rect = screenRect(boxAt(0, 0, -100), c)
    expect(rect.x0).toBeLessThan(0)
    expect(rect.x1).toBeGreaterThan(0)
    expect(rect.x1 - rect.x0).toBeLessThan(0.3)
  })

  it('screenRect：穿过近裁剪面退回整屏，视口外返回 null', () => {
    const c = camera()
    expect(screenRect(boxAt(0, 0, -1), c)).toEqual({ x0: -1, y0: -1, x1: 1, y1: 1 })
    expect(screenRect(boxAt(500, 0, -100), c)).toBeNull()
  })

  it('挡在目标与相机之间的物体保留，矩形外和目标之后的剔除', () => {
    const c = camera()
    const rect = screenRect(boxAt(0, 0, -100), c)
    const view = viewOf(c, rect, 102)
    expect(canOccludeTarget(mesh(0, 0, -50), view)).toBe(true)
    expect(canOccludeTarget(mesh(40, 0, -50), view)).toBe(false)
    expect(canOccludeTarget(mesh(0, 0, -300), view)).toBe(false)
  })

  it('物体只有边缘伸进矩形或压在目标深度上也保留', () => {
    const c = camera()
    const rect = screenRect(boxAt(0, 0, -100), c)
    const view = viewOf(c, rect, 102)
    expect(canOccludeTarget(mesh(0, 0, -105, 5), view)).toBe(true)
    expect(canOccludeTarget(mesh(6, 0, -50, 5), view)).toBe(true)
  })

  it('无法判断范围的物体按能遮挡处理', () => {
    const c = camera()
    const view = viewOf(c, screenRect(boxAt(0, 0, -100), c), 102)
    expect(canOccludeTarget({ frustumCulled: false }, view)).toBe(true)
    expect(canOccludeTarget({ geometry: {} }, view)).toBe(true)
  })

  it('形变后 bounds 未刷新的物体保留：友军履带不进拾取候选，旧包围球不可信', () => {
    const c = camera()
    const view = viewOf(c, screenRect(boxAt(0, 0, -100), c), 102)
    const track = mesh(40, 0, -50)
    track.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    expect(canOccludeTarget(track, view)).toBe(false)
    const position = track.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) position.setX(i, position.getX(i) - 40)
    expect(canOccludeTarget(track, view)).toBe(false)
    markPickBoundsStale(track.geometry)
    expect(canOccludeTarget(track, view)).toBe(true)
  })

  it('InstancedMesh 不拿单实例几何的包围球判断整片实例', () => {
    const c = camera()
    const view = viewOf(c, screenRect(boxAt(0, 0, -100), c), 102)
    const far = mesh(40, 0, -50)
    const forest = new THREE.InstancedMesh(far.geometry, far.material, 2)
    forest.position.copy(far.position)
    forest.updateMatrixWorld(true)
    expect(forest.boundingSphere).toBeNull()
    expect(canOccludeTarget(forest, view)).toBe(true)
  })
})

describe('isSolidOccluder', () => {
  const mesh = (material) => ({ material })

  it('不透明写深度的几何挡视线', () => {
    expect(isSolidOccluder(mesh({ transparent: false, depthWrite: true }))).toBe(true)
  })

  it('半透明、不写深度（天空/贴花）、植被都不挡；多材质一项不挡即排除', () => {
    expect(isSolidOccluder(mesh({ transparent: true }))).toBe(false)
    expect(isSolidOccluder(mesh({ depthWrite: false }))).toBe(false)
    expect(isSolidOccluder(mesh({ uniforms: { uFoliageClip: { value: 0 } } }))).toBe(false)
    expect(isSolidOccluder(mesh([{}, { transparent: true }]))).toBe(false)
  })

  it('镂空的硬表面按实心处理：宁可不着色也不穿墙', () => {
    expect(isSolidOccluder(mesh({ uniforms: { uAlphaCut: { value: 0.33 } } }))).toBe(true)
  })
})

describe('遮挡剔除批次 AABB', () => {
  const camera = () => {
    const c = new THREE.PerspectiveCamera(1, 2, 0.5, 2000)
    c.lookAt(0, 0, -1)
    c.updateMatrixWorld(true)
    c.updateProjectionMatrix()
    return c
  }
  const viewOf = (c, maxDepth) => ({
    frustum: cropFrustum(c, { x0: -1, y0: -1, x1: 1, y1: 1 }, new THREE.Frustum()),
    origin: c.position.clone(),
    forward: c.getWorldDirection(new THREE.Vector3()),
    maxDepth,
  })
  const batch = (box) => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 1)
    m.updateMatrixWorld(true)
    m.userData.occluderBox = box
    return m
  }

  it('盒在视锥外但包围球相交：不进遮挡集（宫格球整批重画的根因）', () => {
    const view = viewOf(camera(), 120)
    const mesh = batch(new THREE.Box3(new THREE.Vector3(2.1, -21.9, -101.9), new THREE.Vector3(45.9, 21.9, -98.1)))
    expect(canOccludeTarget(mesh, view)).toBe(false)
    mesh.userData.occluderBox = null
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(24, 0, -100), 30)
    expect(canOccludeTarget(mesh, view)).toBe(true)
  })

  it('盒支撑函数：球因半径膨胀误判可遮挡，盒按最小可能视线深度判退', () => {
    const view = viewOf(camera(), 50)
    const mesh = batch(new THREE.Box3(new THREE.Vector3(-1, -60, -101), new THREE.Vector3(1, 60, -99)))
    expect(canOccludeTarget(mesh, view)).toBe(false)
    mesh.userData.occluderBox = null
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -100), 60)
    expect(canOccludeTarget(mesh, view)).toBe(true)
  })

  it('盒相交视锥且支撑深度在线内：保留（保守包围不漏画）', () => {
    const view = viewOf(camera(), 120)
    const mesh = batch(new THREE.Box3(new THREE.Vector3(-1, -60, -101), new THREE.Vector3(1, 60, -99)))
    expect(canOccludeTarget(mesh, view)).toBe(true)
  })

  it('frustumCulled=false 与形变 bounds 未刷新的早退不受 AABB 影响', () => {
    const view = viewOf(camera(), 120)
    const mesh = batch(new THREE.Box3(new THREE.Vector3(2.1, -21.9, -101.9), new THREE.Vector3(45.9, 21.9, -98.1)))
    mesh.frustumCulled = false
    expect(canOccludeTarget(mesh, view)).toBe(true)
    mesh.frustumCulled = true
    mesh.geometry.userData.pickBoundsStale = true
    expect(canOccludeTarget(mesh, view)).toBe(true)
  })
})
