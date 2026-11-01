import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  aimedVehicle, armorEquipmentCoeffs, armorHighlightBlock, armorPosePart, armorWorldMatrix,
  authorShellAt, canOccludeTarget, cropFrustum, isSolidOccluder, markPickBoundsStale, mountedShell,
  reticleAimDirection, screenRect,
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
