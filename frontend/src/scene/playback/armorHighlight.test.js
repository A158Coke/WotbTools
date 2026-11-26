import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import {
  aimedVehicle, armorEquipmentCoeffs, armorHighlightBlock, armorPosePart, armorWorldMatrix,
  authorShellAt, bucketedRtSize, createLoadRetry,
  markPickBoundsStale, mountedShell, reticleAimDirection, spacedBufferUv, spacedRectOf,
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
    v.turret.rotation.y = Math.PI / 2
    v.glb.updateMatrixWorld(true)
    expect(aimedVehicle(atBarrelTip, forward, [v])).toBeNull()
    expect(aimedVehicle(origin, new THREE.Vector3(0, 0, 1), [v])).toBe(v)
  })

  it('两车重叠时取实际先碰到的表面，不看聚合包围盒', () => {
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
      if (position.getY(i) < 0) position.setY(i, position.getY(i) - 3)
    }
    const newEdge = new THREE.Vector3(0, -3.5, 0)
    expect(aimedVehicle(newEdge, forward, [v])).toBeNull()
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
    expect(bucketedRtSize(3000, 2880)).toBe(2880)
    expect(bucketedRtSize(0, 0)).toBe(1)
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
    const rect = new THREE.Vector4(0.4, 0.25, 0.2, 0.3)
    const uv = new THREE.Vector2()
    spacedBufferUv(0.4, 0.25, rect, uv)
    expect(uv.x).toBeCloseTo(0)
    expect(uv.y).toBeCloseTo(0)
    spacedBufferUv(0.4 + 0.1, 0.25 + 0.15, rect, uv)
    expect(uv.x).toBeCloseTo(0.5)
    expect(uv.y).toBeCloseTo(0.5)
    spacedBufferUv(0.6, 0.55, rect, uv)
    expect(uv.x).toBeCloseTo(1)
    expect(uv.y).toBeCloseTo(1)
    const full = new THREE.Vector4(0, 0, 1, 1)
    spacedBufferUv(0.37, 0.62, full, uv)
    expect(uv.x).toBeCloseTo(0.37)
    expect(uv.y).toBeCloseTo(0.62)
    spacedBufferUv(0.4, 0.25, rect, uv)
    expect(uv.x).toBeLessThan(0.01)
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
    const position = mesh.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < 0) position.setY(i, position.getY(i) - 3)
    }
    markPickBoundsStale(mesh.geometry)
    aimedVehicle(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), [v])
    const box = mesh.geometry.boundingBox
    const sphere = mesh.geometry.boundingSphere
    expect(sphere.center.x).toBeCloseTo((box.min.x + box.max.x) / 2)
    expect(sphere.radius).toBeGreaterThanOrEqual(sphere.center.distanceTo(new THREE.Vector3(box.min.x, box.min.y, box.min.z)))
    let minY = Infinity
    for (let i = 0; i < position.count; i++) minY = Math.min(minY, position.getY(i))
    expect(sphere.radius).toBeGreaterThanOrEqual(Math.abs(minY - sphere.center.y) - 1e-6)
  })
})
