import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import {
  aimedVehicle, armorEquipmentCoeffs, armorHighlightBlock, armorPosePart, armorWorldMatrix,
  authorShellAt, bucketedRtSize, canOccludeTarget, createArmorHighlight, createLoadRetry, cropFrustum, isSolidOccluder,
  markPickBoundsStale, mountedShell, reticleAimDirection, screenRect, spacedBufferUv, spacedRectOf,
} from './armorHighlight.js'

const AP = { type: 'ap', penetration: 200, caliber: 100 }
const CONFIG = { shell_global_ids: [32362, 32618], shells: [AP, { type: 'ap_cr', penetration: 300 }], caliber: 105 }
const eligible = {
  targetTankId: 1, targetConfig: {}, authorConfig: CONFIG, shellId: 32362,
  targetEquipment: [], authorEquipment: [],
}

describe('authorShellAt', () => {
  const timeline = [{ t: 5, shell_id: 1 }, { t: 30, shell_id: 2 }, { t: 40, shell_id: 3 }]

  it('取时刻 t 及之前最新的确认值，边界含等号', () => {
    expect(authorShellAt(timeline, 5)).toBe(1)
    expect(authorShellAt(timeline, 29.99)).toBe(1)
    expect(authorShellAt(timeline, 30)).toBe(2)
    expect(authorShellAt(timeline, 999)).toBe(3)
  })

  it('首条之前与缺字段都是未知，不取首发弹种顶替', () => {
    expect(authorShellAt(timeline, 4.99)).toBeNull()
    expect(authorShellAt(undefined, 10)).toBeNull()
    expect(authorShellAt([], 10)).toBeNull()
  })
})

describe('mountedShell', () => {
  it('弹体无 caliber 时取该炮口径；不在弹表返回 null', () => {
    expect(mountedShell(CONFIG, 32362).caliber).toBe(100)
    expect(mountedShell(CONFIG, 32618).caliber).toBe(105)
    expect(mountedShell(CONFIG, 999)).toBeNull()
  })
})

describe('armorHighlightBlock（证据不足一律关闭）', () => {
  it('全部满足时放行', () => {
    expect(armorHighlightBlock(eligible)).toBeNull()
  })

  it.each([
    ['target_config_unknown', { targetConfig: null }],
    ['author_config_unknown', { authorConfig: null }],
    ['shell_unknown', { shellId: null }],
    ['shell_not_mounted', { shellId: 999 }],
    ['shell_type_unknown', { authorConfig: { ...CONFIG, shells: [{ type: 'mystery', caliber: 100 }] } }],
    ['caliber_unknown', { authorConfig: { shell_global_ids: [32362], shells: [{ type: 'ap' }] } }],
    ['equipment_unknown', { targetEquipment: undefined }],
    ['equipment_unknown', { authorEquipment: undefined }],
    ['dynamic_armor', { targetTankId: 17777 }],
  ])('%s', (reason, patch) => {
    expect(armorHighlightBlock({ ...eligible, ...patch })).toBe(reason)
  })
})

describe('armorEquipmentCoeffs', () => {
  it('校准弹按弹种口径、强化装甲只看目标', () => {
    expect(armorEquipmentCoeffs(AP, [103], [])).toEqual({ penMul: 1.06, thickMul: 1 })
    expect(armorEquipmentCoeffs({ type: 'he' }, [103], [110])).toEqual({ penMul: 1.07, thickMul: 1.04 })
    expect(armorEquipmentCoeffs(AP, [110], [103])).toEqual({ penMul: 1, thickMul: 1 })
  })
})

describe('aimedVehicle', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const part = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  const at = (x, z) => {
    const glb = new THREE.Group()
    glb.position.set(x, 0, z)
    glb.add(part(4, 2, 6))
    glb.updateMatrixWorld(true)
    return { glb }
  }
  // 炮塔枢轴在车辆原点，炮管沿局部 +X 伸出 10 m
  const withBarrel = (x, z) => {
    const v = at(x, z)
    const turret = new THREE.Group()
    const barrel = part(10, 0.4, 0.4)
    barrel.position.set(7, 0, 0)
    turret.add(barrel)
    v.glb.add(turret)
    v.glb.updateMatrixWorld(true)
    return { ...v, turret, barrel }
  }
  const origin = new THREE.Vector3(0, 0, 0)
  const forward = new THREE.Vector3(0, 0, 1)

  it('取视线上最近的一台，偏离车模不算', () => {
    const near = at(0, 50), far = at(0, 120), aside = at(30, 20)
    expect(aimedVehicle(origin, forward, [far, aside, near])).toBe(near)
    expect(aimedVehicle(origin, forward, [aside])).toBeNull()
  })

  it('已命中更近车辆后不再对更远候选做逐网格求交（按根包围球最近距离剪枝）', () => {
    const near = at(0, 50), far = at(0, 120)
    const farMesh = far.glb.children[0]
    let farRaycasts = 0
    const realRaycast = farMesh.raycast
    farMesh.raycast = function (...args) { farRaycasts++; return realRaycast.apply(this, args) }
    expect(aimedVehicle(origin, forward, [far, near])).toBe(near)
    expect(farRaycasts).toBe(0)
  })

  it('炮塔转动后按当前姿态命中，首次拾取的结果不残留', () => {
    const v = withBarrel(0, 50)
    const atBarrelTip = new THREE.Vector3(10, 0, 0)
    expect(aimedVehicle(atBarrelTip, forward, [v])).toBe(v)
    v.turret.rotation.y = Math.PI / 2   // 炮管转到 -Z，旧位置已空
    v.glb.updateMatrixWorld(true)
    expect(aimedVehicle(atBarrelTip, forward, [v])).toBeNull()
    expect(aimedVehicle(origin, new THREE.Vector3(0, 0, 1), [v])).toBe(v)
  })

  it('两车重叠时取实际先碰到的表面，不看聚合包围盒', () => {
    // far 的长炮管把聚合盒撑到 near 身前，但这条线只会先碰到 near 的车体
    const near = at(0, 50), far = withBarrel(0, 60)
    far.turret.rotation.y = Math.PI / 2
    far.barrel.position.set(7, 3, 0)
    far.glb.updateMatrixWorld(true)
    expect(aimedVehicle(origin, forward, [far, near])).toBe(near)
  })

  it('悬挂形变把顶点移出旧 bounds 后，边缘仍能命中', () => {
    const v = at(0, 50)
    const track = v.glb.children[0]
    track.geometry.computeBoundingBox()
    track.geometry.computeBoundingSphere()
    const position = track.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < 0) position.setY(i, position.getY(i) - 3)   // 底段下移，球和盒都包不住
    }
    const newEdge = new THREE.Vector3(0, -3.5, 0)
    expect(aimedVehicle(newEdge, forward, [v])).toBeNull()               // 不标记就被旧 bounds 筛掉
    markPickBoundsStale(track.geometry)
    expect(aimedVehicle(newEdge, forward, [v])).toBe(v)
  })

  it('离视线远的车不重算 bounds', () => {
    const v = at(40, 50)
    const geometry = v.glb.children[0].geometry
    markPickBoundsStale(geometry)
    expect(aimedVehicle(origin, forward, [v])).toBeNull()
    expect(geometry.userData.pickBoundsStale).toBe(true)
  })

  it('隐藏的网格不参与命中', () => {
    const v = at(0, 50)
    v.glb.children[0].visible = false
    expect(aimedVehicle(origin, forward, [v])).toBeNull()
  })
})

describe('createLoadRetry', () => {
  const clock = () => {
    const c = { t: 0, now: () => c.t }
    return c
  }

  it('失败后等够间隔才能再试，临时错误过后可以恢复', () => {
    const c = clock()
    const retry = createLoadRetry({ attempts: 3, delayMs: 100, now: c.now })
    expect(retry.allowed(1)).toBe(true)
    retry.fail(1)
    expect(retry.allowed(1)).toBe(false)
    c.t = 100
    expect(retry.allowed(1)).toBe(true)
    retry.succeed(1)
    retry.fail(1)
    c.t = 200
    expect(retry.allowed(1)).toBe(true)
  })

  it('试满次数后停止，永久错误不会反复下载', () => {
    const c = clock()
    const retry = createLoadRetry({ attempts: 2, delayMs: 100, now: c.now })
    retry.fail(1)
    c.t = 100
    retry.fail(1)
    c.t = 10_000
    expect(retry.allowed(1)).toBe(false)
  })

  it('按车型独立计数', () => {
    const c = clock()
    const retry = createLoadRetry({ attempts: 1, delayMs: 100, now: c.now })
    retry.fail(1)
    expect(retry.allowed(1)).toBe(false)
    expect(retry.allowed(2)).toBe(true)
  })
})

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
    // 顶点被悬挂移进目标矩形，包围球仍是旧的
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

describe('reticleAimDirection', () => {
  const camera = () => {
    const c = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
    c.lookAt(0, 0, -1)
    c.updateMatrixWorld(true)
    return c
  }

  it('过渡中相机朝向偏离时，方向仍指向瞄准点而不是相机正前方', () => {
    const c = camera()
    c.rotation.y = 0.2
    c.updateMatrixWorld(true)
    const aim = new THREE.Vector3(0, 0, -100)
    const dir = reticleAimDirection(c, aim, new THREE.Vector3())
    expect(dir.x).toBeCloseTo(0, 6)
    expect(dir.z).toBeCloseTo(-1, 6)
    expect(c.getWorldDirection(new THREE.Vector3()).distanceTo(dir)).toBeGreaterThan(0.1)
  })

  it('瞄准点在画面外、身后或非有限时没有准星', () => {
    const c = camera()
    const out = new THREE.Vector3()
    expect(reticleAimDirection(c, new THREE.Vector3(500, 0, -100), out)).toBeNull()
    expect(reticleAimDirection(c, new THREE.Vector3(0, 0, 100), out)).toBeNull()
    expect(reticleAimDirection(c, new THREE.Vector3(NaN, 0, -100), out)).toBeNull()
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

describe('armor 姿态', () => {
  it('网格名决定跟随部件（含动态装甲 state 段）', () => {
    expect(armorPosePart('hull_armor_3')).toBe('hull')
    expect(armorPosePart('turret_01_state_01_armor_12')).toBe('turret')
    expect(armorPosePart('gun_02_armor_1')).toBe('gun')
  })

  it('世界矩阵 = 根 × 部件姿态 × 静止矩阵，顺序不可换', () => {
    const root = new THREE.Matrix4().makeTranslation(10, 0, 0)
    const pose = new THREE.Matrix4().makeRotationZ(Math.PI / 2)
    const rest = new THREE.Matrix4().makeTranslation(1, 0, 0)
    const p = new THREE.Vector3().applyMatrix4(armorWorldMatrix(root, pose, rest, new THREE.Matrix4()))
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(1)
  })
})

describe('装甲 RT 按目标矩形分配', () => {
  it('bucketedRtSize：向上取整到 64 的倍数并钳到 drawing buffer 上限', () => {
    expect(bucketedRtSize(1, 4096)).toBe(64)
    expect(bucketedRtSize(64, 4096)).toBe(64)
    expect(bucketedRtSize(65, 4096)).toBe(128)
    expect(bucketedRtSize(3000, 2880)).toBe(2880)   // 满屏目标 = 旧全尺寸行为
    expect(bucketedRtSize(0, 0)).toBe(1)            // 病态输入不为 0
  })

  it('spacedRectOf：全屏 = (0,0,1,1)，子矩形按整幅画面归一化（原点左下）', () => {
    const out = new THREE.Vector4()
    expect(spacedRectOf(0, 0, 1920, 1080, 1920, 1080, out).equals(new THREE.Vector4(0, 0, 1, 1))).toBe(true)
    spacedRectOf(1200, 300, 300, 200, 1920, 1080, out)
    expect(out.x).toBeCloseTo(1200 / 1920)
    expect(out.y).toBeCloseTo(300 / 1080)
    expect(out.z).toBeCloseTo(300 / 1920)
    expect(out.w).toBeCloseTo(200 / 1080)
  })

  it('spacedBufferUv（PBR_FRAG scBuf 公式的 JS 同式）：全画面 UV → rect 局部 RT UV', () => {
    // review R1：scBuf = (sc − xy) / zw——rect 左下角 → (0,0)，右上角 → (1,1)，全屏恒等
    const rect = new THREE.Vector4(0.4, 0.25, 0.2, 0.3)
    const uv = new THREE.Vector2()
    spacedBufferUv(0.4, 0.25, rect, uv)                       // rect 左下 → RT (0,0)
    expect(uv.x).toBeCloseTo(0)
    expect(uv.y).toBeCloseTo(0)
    spacedBufferUv(0.4 + 0.1, 0.25 + 0.15, rect, uv)          // rect 中心 → RT (0.5,0.5)
    expect(uv.x).toBeCloseTo(0.5)
    expect(uv.y).toBeCloseTo(0.5)
    spacedBufferUv(0.6, 0.55, rect, uv)                       // rect 右上 → RT (1,1)
    expect(uv.x).toBeCloseTo(1)
    expect(uv.y).toBeCloseTo(1)
    const full = new THREE.Vector4(0, 0, 1, 1)
    spacedBufferUv(0.37, 0.62, full, uv)                      // 全屏 rect 恒等
    expect(uv.x).toBeCloseTo(0.37)
    expect(uv.y).toBeCloseTo(0.62)
    // 旧错误公式（sc*zw+xy）在这组输入下会得到 (0.48, 0.295) —— 方向反了
    spacedBufferUv(0.4, 0.25, rect, uv)
    expect(uv.x).toBeLessThan(0.01)
  })
})

describe('遮挡剔除批次 AABB', () => {
  const camera = () => {
    const c = new THREE.PerspectiveCamera(1, 2, 0.5, 2000)   // 1° 窄视锥 ≈ 远目标长走廊
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
    // 长盒沿 x 转 45°：中心 (24,0,-100)，世界 AABB 半宽 ≈21.9（够不到 ±1.7 的窄视锥），
    // 包围球半径 ≈30（伸得进）——3.30.0 的球判定会把这类批次整批拉进遮挡集。
    const mesh = batch(new THREE.Box3(new THREE.Vector3(2.1, -21.9, -101.9), new THREE.Vector3(45.9, 21.9, -98.1)))
    expect(canOccludeTarget(mesh, view)).toBe(false)
    mesh.userData.occluderBox = null                      // 可破坏物批次回退球
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(24, 0, -100), 30)
    expect(canOccludeTarget(mesh, view)).toBe(true)
  })

  it('盒支撑函数：球因半径膨胀误判可遮挡，盒按最小可能视线深度判退', () => {
    const view = viewOf(camera(), 50)
    // 细高盒（半 y=60）中心深度 100：支撑深度 99 > 50 → 不可遮挡；球半径 ≈60 → 40 ≤ 50 误判
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

describe('拾取 bounds 单趟重算（悬挂形变路径）', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  it('aimedVehicle 刷新后的球是 AABB 半对角线保守球（覆盖全部顶点）', () => {
    const glb = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 6), material)
    glb.add(mesh)
    glb.updateMatrixWorld(true)
    const v = { glb }
    // 悬挂形变：底段下移出旧 bounds
    const position = mesh.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < 0) position.setY(i, position.getY(i) - 3)
    }
    markPickBoundsStale(mesh.geometry)
    aimedVehicle(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), [v])
    const box = mesh.geometry.boundingBox
    const sphere = mesh.geometry.boundingSphere
    // 保守球：中心 = AABB 中心，半径 = 半对角线 ≥ 任意顶点到中心距离
    expect(sphere.center.x).toBeCloseTo((box.min.x + box.max.x) / 2)
    expect(sphere.radius).toBeGreaterThanOrEqual(sphere.center.distanceTo(new THREE.Vector3(box.min.x, box.min.y, box.min.z)))
    // 形变后的最低顶点仍在覆盖内
    let minY = Infinity
    for (let i = 0; i < position.count; i++) minY = Math.min(minY, position.getY(i))
    expect(sphere.radius).toBeGreaterThanOrEqual(Math.abs(minY - sphere.center.y) - 1e-6)
  })
})


// Renderer stub records actual passes while real Three matrices, meshes and target
// construction exercise the occluder and render-target owners.
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    parse(_bytes, _path, done) {
      const model = new THREE.Group()
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 6), new THREE.MeshBasicMaterial())
      mesh.name = 'hull_armor_1'
      model.add(mesh)
      done({ scene: model })
    }
  },
}))

function highlightFixture() {
  let currentTarget = null, scissorTest = false, alpha = 1
  const scissor = new THREE.Vector4(3, 4, 50, 60)
  const viewport = new THREE.Vector4(1, 2, 300, 400)
  const color = new THREE.Color(0x123456)
  const renderer = {
    autoClear: true, localClippingEnabled: false, shadowMap: { autoUpdate: true },
    info: { render: { calls: 0 } }, extensions: { has: () => false },
    getDrawingBufferSize: out => out.set(800, 600), getPixelRatio: () => 2,
    getClearAlpha: () => alpha, getClearColor: out => out.copy(color),
    getScissorTest: () => scissorTest, getScissor: out => out.copy(scissor),
    getViewport: out => out.copy(viewport), setViewport: v => viewport.copy(v),
    getRenderTarget: () => currentTarget,
    setClearColor: (c, a) => { color.set(c); alpha = a },
    setScissorTest: v => { scissorTest = v },
    setScissor: vi.fn((...v) => { if (v[0]?.isVector4) scissor.copy(v[0]); else scissor.set(...v) }),
    setRenderTarget: vi.fn(target => { currentTarget = target }),
    clearDepth: vi.fn(), compile: vi.fn(),
    render: vi.fn(() => { renderer.info.render.calls++ }),
  }
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 1000)
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  const glb = new THREE.Group()
  const targetMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 6), new THREE.MeshBasicMaterial())
  glb.add(targetMesh); glb.position.z = -50; scene.add(glb); scene.updateMatrixWorld(true)
  const vehicle = { glb, def: { eid: 1, tank_id: 1 }, glbParts: { poseT: new THREE.Matrix4(), poseG: new THREE.Matrix4() } }
  const ready = vi.fn()
  const frame = { scene, camera, vehicle, tankData: { model_url: 'fixture', model_origins: { track: [0, 0, 0], turret: [0, 0, 0] } }, config: {}, shell: AP, caliber: 100, penMul: 1, thickMul: 1, onReady: ready, occluderRoots: [glb] }
  const effect = createArmorHighlight({ renderer, assetProvider: { bytes: async () => new Uint8Array() } })
  return { scene, camera, glb, renderer, effect, frame, ready, scissor, color, viewport }
}

async function readyHighlight(f) {
  f.effect.render(f.frame)
  for (let i = 0; i < 10 && !f.ready.mock.calls.length; i++) await Promise.resolve()
  expect(f.ready).toHaveBeenCalledTimes(1)
}

describe('armor renderer execution', () => {
  it('skips world render for only the target and retains wall/vehicle occluders', async () => {
    const f = highlightFixture()
    await readyHighlight(f)
    f.effect.render(f.frame)
    expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.scene)).toHaveLength(0)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 2), new THREE.MeshBasicMaterial())
    wall.position.z = -20; f.scene.add(wall); f.scene.updateMatrixWorld(true)
    f.frame.occluderRoots = [f.glb, wall]
    f.renderer.render.mockClear()
    f.effect.render(f.frame)
    expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.scene)).toHaveLength(1)
    expect(f.glb.children[0].layers.mask & (1 << 2)).toBe(0)
    expect(wall.layers.mask & (1 << 2)).not.toBe(0)
    // A dynamic mesh with unreliable bounds must stay conservative even if its
    // old geometry bounds are outside the camera corridor.
    const moving = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    moving.position.set(500, 0, -20); moving.frustumCulled = false
    f.scene.add(moving); f.scene.updateMatrixWorld(true)
    f.frame.occluderRoots = [f.glb, moving]
    f.renderer.render.mockClear()
    f.effect.render(f.frame)
    expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.scene)).toHaveLength(1)
    expect(moving.layers.mask & (1 << 2)).not.toBe(0)
    f.effect.dispose()
  })

  it('maps the cropped projection to logical scissor coordinates at DPR 2', async () => {
    const f = highlightFixture()
    await readyHighlight(f)
    let view
    f.renderer.render.mockImplementation((_scene, camera) => {
      if (camera !== f.camera && !view) view = { ...camera.view }
    })
    f.effect.render(f.frame)
    expect(view.enabled).toBe(true)
    const rect = f.renderer.setScissor.mock.calls.find(args => args.length === 4)
    expect(rect).toEqual([view.offsetX / 2, (view.fullHeight - view.offsetY - view.height) / 2, view.width / 2, view.height / 2])
    f.effect.dispose()
  })

  it('tracks independent render calls and GPU hooks, clearing stale counts on early return', async () => {
    const f = highlightFixture()
    const stats = { pickMs: 0, stateMs: 9, thicknessMs: 9, occluderMs: 9, colorMs: 9, calls: 9, stateCalls: 9, thicknessCalls: 9, occluderCalls: 9, colorCalls: 9, _t0: 0 }
    const gpu = { begin: vi.fn(() => true), end: vi.fn() }
    f.frame.stats = stats; f.frame.gpu = gpu
    await readyHighlight(f)
    expect([stats.stateCalls, stats.thicknessCalls, stats.occluderCalls, stats.colorCalls, stats.calls]).toEqual([0, 0, 0, 0, 0])
    f.effect.render(f.frame)
    expect([stats.stateCalls, stats.thicknessCalls, stats.occluderCalls, stats.colorCalls, stats.calls]).toEqual([1, 1, 0, 1, 3])
    expect(gpu.begin.mock.calls.map(([pass]) => pass)).toEqual(['state', 'thickness', 'color'])
    expect(gpu.end).toHaveBeenCalledTimes(3)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 2), new THREE.MeshBasicMaterial())
    wall.position.z = -20; f.scene.add(wall); f.scene.updateMatrixWorld(true)
    f.frame.occluderRoots = [wall]
    gpu.begin.mockClear(); gpu.end.mockClear()
    f.effect.render(f.frame)
    expect([stats.stateCalls, stats.thicknessCalls, stats.occluderCalls, stats.colorCalls, stats.calls]).toEqual([1, 1, 1, 1, 4])
    expect(gpu.begin.mock.calls.map(([pass]) => pass)).toEqual(['state', 'thickness', 'occluder', 'color'])
    expect(gpu.end).toHaveBeenCalledTimes(4)
    f.glb.position.x = 1000; f.scene.updateMatrixWorld(true)
    f.effect.render(f.frame)
    expect([stats.stateCalls, stats.thicknessCalls, stats.occluderCalls, stats.colorCalls, stats.calls]).toEqual([0, 0, 0, 0, 0])
    f.effect.dispose()
  })

  it('allocates bucketed targets, grows for a closer view, and releases each once', async () => {
    const f = highlightFixture()
    const stats = { pickMs: 0, stateMs: 0, thicknessMs: 0, occluderMs: 0, colorMs: 0, calls: 0, stateCalls: 0, thicknessCalls: 0, occluderCalls: 0, colorCalls: 0, _t0: 0 }
    f.frame.stats = stats
    await readyHighlight(f)
    f.effect.render(f.frame)
    const original = f.renderer.setRenderTarget.mock.calls.map(([rt]) => rt).filter(Boolean)
    expect(original).toHaveLength(2)
    expect(original[0].width % 64).toBe(0)
    expect(original[0].height % 64).toBe(0)
    expect(stats.rt).toEqual({ width: original[0].width, height: original[0].height, creates: 2, resizes: 0, disposes: 0,
      colorEstimateBytes: original[0].width * original[0].height * 2 * 4, estimateKind: 'color-only-estimate' })
    const oldDispose = original.map(rt => { const fn = vi.fn(); rt.addEventListener('dispose', fn); return fn })
    f.glb.position.z = -10; f.scene.updateMatrixWorld(true)
    f.renderer.setRenderTarget.mockClear()
    f.effect.render(f.frame)
    const resized = f.renderer.setRenderTarget.mock.calls.map(([rt]) => rt).filter(Boolean)
    expect(resized).toHaveLength(2)
    expect(resized[0].width).toBeGreaterThan(original[0].width)
    expect(oldDispose.map(fn => fn.mock.calls.length)).toEqual([1, 1])
    expect(stats.rt).toMatchObject({ width: resized[0].width, height: resized[0].height, creates: 4, resizes: 2, disposes: 2 })
    const newDispose = resized.map(rt => { const fn = vi.fn(); rt.addEventListener('dispose', fn); return fn })
    f.glb.position.z = -50; f.scene.updateMatrixWorld(true)
    for (let i = 0; i < 89; i++) f.effect.render(f.frame)
    expect(newDispose.map(fn => fn.mock.calls.length)).toEqual([0, 0])
    f.renderer.setRenderTarget.mockClear()
    f.effect.render(f.frame)
    expect(newDispose.map(fn => fn.mock.calls.length)).toEqual([1, 1])
    const shrunk = f.renderer.setRenderTarget.mock.calls.map(([rt]) => rt).filter(Boolean)
    expect(shrunk[0].width).toBeLessThan(resized[0].width)
    expect(stats.rt).toMatchObject({ width: shrunk[0].width, height: shrunk[0].height, creates: 6, resizes: 4, disposes: 4 })
    const shrunkDispose = shrunk.map(rt => { const fn = vi.fn(); rt.addEventListener('dispose', fn); return fn })
    f.effect.releaseRenderTargets(); f.effect.releaseRenderTargets()
    expect(shrunkDispose.map(fn => fn.mock.calls.length)).toEqual([1, 1])
    expect(stats.rt).toMatchObject({ width: null, height: null, colorEstimateBytes: null, creates: 6, resizes: 4, disposes: 6 })
    f.effect.dispose()
  })

  it('does not notify or render when template bytes arrive after dispose', async () => {
    const f = highlightFixture()
    f.effect.dispose()
    let finish
    const effect = createArmorHighlight({ renderer: f.renderer, assetProvider: { bytes: () => new Promise(resolve => { finish = resolve }) } })
    effect.render(f.frame)
    effect.dispose()
    finish(new Uint8Array())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(f.ready).not.toHaveBeenCalled()
    expect(f.renderer.render).not.toHaveBeenCalled()
  })

  it('prewarms once and restores clipping', () => {
    const f = highlightFixture()
    f.effect.prewarm(f.camera); f.effect.prewarm(f.camera)
    expect(f.renderer.compile).toHaveBeenCalledTimes(1)
    expect(f.renderer.localClippingEnabled).toBe(false)
    f.effect.dispose()
  })

  it('repeated dispose releases prewarmed materials once', () => {
    const f = highlightFixture()
    const disposed = []
    f.renderer.compile.mockImplementation(scene => scene.traverse(node => {
      if (node.isMesh) { const fn = vi.fn(); node.material.addEventListener('dispose', fn); disposed.push(fn) }
    }))
    f.effect.prewarm(f.camera)
    expect(disposed.length).toBeGreaterThan(0)
    f.effect.dispose(); f.effect.dispose()
    expect(disposed.every(fn => fn.mock.calls.length === 1)).toBe(true)
  })

  it('restores renderer and scene state after an occluder pass throws', async () => {
    const f = highlightFixture()
    await readyHighlight(f)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 2), new THREE.MeshBasicMaterial())
    wall.position.z = -20; f.scene.add(wall); f.scene.updateMatrixWorld(true)
    f.frame.occluderRoots = [wall]
    const bg = new THREE.Color('red'); f.scene.background = bg
    const oldTarget = new THREE.WebGLRenderTarget(16, 16)
    f.renderer.setRenderTarget(oldTarget)
    const originalMask = f.camera.layers.mask
    const gpu = { begin: vi.fn(() => true), end: vi.fn() }
    f.frame.gpu = gpu
    f.renderer.render.mockImplementation((scene) => { if (scene === f.scene) throw new Error('render failed') })
    expect(() => f.effect.render(f.frame)).toThrow('render failed')
    expect(gpu.begin.mock.calls.map(([pass]) => pass)).toEqual(['state', 'thickness', 'occluder'])
    expect(gpu.end).toHaveBeenCalledTimes(3)
    expect(f.scene.background).toBe(bg)
    expect(f.scene.overrideMaterial).toBeNull()
    expect(f.camera.layers.mask).toBe(originalMask)
    expect(f.renderer.getRenderTarget()).toBe(oldTarget)
    expect(f.renderer.getScissorTest()).toBe(false)
    expect(f.scissor.toArray()).toEqual([3, 4, 50, 60])
    expect(f.viewport.toArray()).toEqual([1, 2, 300, 400])
    expect(f.renderer.localClippingEnabled).toBe(false)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.renderer.autoClear).toBe(true)
    expect(f.color.getHex()).toBe(0x123456)
    f.effect.dispose(); oldTarget.dispose()
  })
})
