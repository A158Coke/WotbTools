// @vitest-environment happy-dom
// 射击复现分支回归（#820 review P1-C / P2-F）：
// hit = 目标可见 + 射手模型只加载一次；miss = 目标隐藏 + 走脱靶分支；
// 脱靶异步回调必须读取 ctx.currentShot（不是 deps 上不存在的字段），
// 过期响应不得继续摆位。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { runShotReplay } from './shotReplay.js'
import { renderMissShotAnnotation } from './shotReplayMiss.js'

const agentMocks = vi.hoisted(() => ({
  fetchReplayShots: vi.fn(),
  fetchTankData: vi.fn(),
  assetProvider: { url: (url) => url },
}))

vi.mock('../agentData.js', () => agentMocks)

const loaderState = vi.hoisted(() => ({
  calls: [],
  onLoads: [],
  manual: false,
  sceneFactory: null,
}))

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(url, onLoad) {
      loaderState.calls.push(url)
      if (loaderState.manual) {
        loaderState.onLoads.push(onLoad)
        return
      }
      onLoad({ scene: loaderState.sceneFactory() })
    }
  },
}))

function makeShooterScene() {
  const scene = new THREE.Group()
  const turret = new THREE.Group()
  turret.name = 'turret_01'
  const gun = new THREE.Group()
  gun.name = 'gun_01'
  scene.add(turret, gun)
  return scene
}

function makeShot(overrides = {}) {
  return {
    index: 1,
    target_name: 'T-54',
    target_pos: [10, 0, 10],
    target_ang: [0, 0, 0],
    target_turret_yaw: 0,
    target_gun_pitch: 0,
    shooter_pos: [0, 0, 0],
    shooter_ang: [0, 0, 0],
    shooter_turret_yaw: 0,
    shooter_gun_pitch: 0,
    launch_velocity: [100, 0, 100],
    ball_a: [0, 1, 0],
    ball_b: [10, 1, 10],
    damage: 100,
    shell_id: 1,
    hit_flags: 0,
    shooter_tick_samples: [],
    tick_samples: [],
    ...overrides,
  }
}

function makeHarness(shot) {
  const tankModel = new THREE.Group()
  const armorModel = new THREE.Group()
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const controls = {
    maxDistance: 0,
    minDistance: 0,
    mouseButtons: {},
    screenSpacePanning: true,
    target: new THREE.Vector3(),
    update: vi.fn(),
  }
  const loadGen = { value: 1 }
  const hm = {
    getPrimaryArmorScene: () => null,
    syncHeatOverlay: vi.fn(),
    updatePenetrationUniforms: vi.fn(),
    updateSpacedUniforms: vi.fn(),
  }
  const rig = {
    getArmorPivotGun: () => new THREE.Vector3(0, 0, 2),
    getArmorPivotTurret: () => new THREE.Vector3(1, 2, 3),
    updateTurretGun: vi.fn(),
  }
  const jc = {
    setShotRay: vi.fn(),
    doPenetrationCheck: vi.fn(),
    clearShotRay: vi.fn(),
  }
  const deps = {
    rig,
    hm,
    tc: { tidyTrajectory: vi.fn() },
    jc,
    ml: {
      models: { tankModel, armorModel },
      disposeDetachedModel: vi.fn(),
    },
    QP: new URLSearchParams('shot=1&shooter=123'),
    loadGen: { get: () => loadGen.value },
    isDestroyed: () => false,
    L: {
      shotView: 'shot view',
      relativeView: 'relative',
      worldView: 'world',
      armorStateAutoTitle: 'auto',
    },
    getTankData: () => ({
      visual_model_url: '/glb/123/model.glb',
      model_origins: { track: [0, 0, 0], turret: [0, 0, 0] },
      collision_boxes: null,
      armor_model: {},
    }),
    getScene: () => scene,
    getCamera: () => camera,
    getControls: () => controls,
    getFxScene: () => new THREE.Scene(),
    getSelectedShell: () => null,
    setSelectedShell: vi.fn(),
    getShooterShells: () => [],
    getShooterData: () => null,
    getPenetrationMode: () => false,
    getArmorStateDecl: () => null,
    getTurretDeg: () => 0,
    getGunDeg: () => 0,
    setWorldOverviewMode: vi.fn(),
    syncEquipmentCheckboxes: vi.fn(),
    clearShotError: vi.fn(),
    showShotError: vi.fn(),
    shotErrorHtml: () => '',
    eqBadge: () => '',
    dbgReset: vi.fn(),
    setupShotDebug: vi.fn(),
    dbgInfo: vi.fn(),
    fmt3: (x, y, z) => `${x},${y},${z}`,
    decodeModules: () => [],
    shellIdParts: () => null,
    srQualityIssues: () => [],
    setArmorState: vi.fn(),
    syncArmorStateControl: vi.fn(),
    isShooterLoading: () => false,
    getCurrentShooterId: () => 123,
    armorDebug: () => false,
  }
  return { deps, tankModel, armorModel, scene, camera, controls, loadGen, jc, rig }
}

function missDeps() {
  const tankModel = new THREE.Group()
  const armorModel = new THREE.Group()
  const scene = new THREE.Scene()
  return {
    ml: { models: { tankModel, armorModel } },
    rig: {},
    hm: {},
    tc: {},
    jc: {},
    QP: new URLSearchParams('shooter=123'),
    setWorldOverviewMode: vi.fn(),
    showShotError: vi.fn(),
    dbgReset: vi.fn(),
    getScene: () => scene,
    getCamera: () => new THREE.PerspectiveCamera(),
    getControls: () => ({ target: new THREE.Vector3(), update: vi.fn() }),
    dbgInfo: vi.fn(),
    fmt3: (x, y, z) => `${x},${y},${z}`,
    setupShotDebug: vi.fn(),
    shotErrorHtml: () => '',
    eqBadge: () => '',
    tankModel,
    armorModel,
    scene,
  }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="turret-controls"></div>'
  window.__debugSetVisible = vi.fn()
  window.__debugOn = false
  window.__worldAnno = null
  window.__shooterModel = null
  loaderState.calls.length = 0
  loaderState.onLoads.length = 0
  loaderState.manual = false
  loaderState.sceneFactory = makeShooterScene
  agentMocks.fetchTankData.mockResolvedValue({
    model_origins: { track: [0, 0, 0], turret: [0, 0, 0] },
    configs: [{ gun_origin: [0, 0, 0], turret_index: 0, gun_index: 0 }],
  })
})

afterEach(() => {
  vi.clearAllMocks()
  delete window.__debugSetVisible
  delete window.__worldAnno
})

describe('runShotReplay branch dispatch (P1-C)', () => {
  it('hit shot keeps the target visible and loads the shooter exactly once', async () => {
    agentMocks.fetchReplayShots.mockResolvedValue({ shots: [makeShot()] })
    const { deps, tankModel, armorModel, jc } = makeHarness()

    runShotReplay(deps)

    await vi.waitFor(() => expect(jc.doPenetrationCheck).toHaveBeenCalled())
    expect(tankModel.visible).toBe(true)
    expect(armorModel.visible).toBe(true)
    expect(loaderState.calls).toHaveLength(1)
  })

  it('miss shot hides the target and still loads the shooter exactly once', async () => {
    agentMocks.fetchReplayShots.mockResolvedValue({
      shots: [makeShot({ target_name: undefined })],
    })
    const { deps, tankModel, armorModel } = makeHarness()

    runShotReplay(deps)

    await vi.waitFor(() => expect(tankModel.visible).toBe(false))
    expect(armorModel.visible).toBe(false)
    expect(loaderState.calls).toHaveLength(1)
    expect(deps.jc.doPenetrationCheck).not.toHaveBeenCalled()
  })
})

// 状态装甲网格（turret_01_state_00_armor_11）不匹配普通炮塔板正则
// /^turret_\d+_armor/，turret-pivot 解码必须走 rig 枢轴 fallback；review P2 回归。
function addStateArmorMesh(armorModel) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  )
  mesh.name = 'turret_01_state_00_armor_11'
  mesh.userData.armorSection = 'turret'
  armorModel.add(mesh)
  return mesh
}

function turretPivotShot() {
  return {
    target_name: 'T-54',
    hit_token: 'ff008000ff40',
    server_part_index: 2,
  }
}

function turretCollisionBoxes() {
  return { turret: { min: [0, 0, 0], max: [2, 2, 2] } }
}

function expectedFallbackMarker(armorModel, hb, pivot, yawDeg) {
  const qc = (b, ax) => [0, 0, 0][ax] + 2 * (b / 255)
  const local = new THREE.Vector3(qc(hb[0], 0), qc(hb[2], 1), qc(hb[1], 2))
  local.applyMatrix4(new THREE.Matrix4()
    .makeRotationZ(THREE.MathUtils.degToRad(yawDeg))
    .setPosition(pivot.x, pivot.y, pivot.z))
  return armorModel.localToWorld(local)
}

describe('turret-pivot fallback with state armor meshes (review P2)', () => {
  it('uses the rig turret pivot for a status-armor mesh and keeps world-space markers + judgment', async () => {
    const shot = makeShot(turretPivotShot())
    agentMocks.fetchReplayShots.mockResolvedValue({ shots: [shot] })
    const { deps, tankModel, armorModel, jc, rig } = makeHarness()
    addStateArmorMesh(armorModel)
    deps.getTankData = () => ({
      visual_model_url: '/glb/123/model.glb',
      model_origins: { track: [0, 0, 0], turret: [0, 0, 0] },
      collision_boxes: turretCollisionBoxes(),
      armor_model: {},
    })
    deps.getTurretDeg = () => 90
    const pivot = rig.getArmorPivotTurret()

    runShotReplay(deps)

    await vi.waitFor(() => expect(jc.doPenetrationCheck).toHaveBeenCalled())
    expect(deps.showShotError).not.toHaveBeenCalled()
    expect(window.__segDiag.boxFrame).toBe('turret-pivot')
    expect(window.__worldSegMk).not.toBeNull()
    const hb = [255, 0, 128, 0, 255, 64]
    const p1 = expectedFallbackMarker(armorModel, hb, pivot, 90)
    const p2Local = new THREE.Vector3(0, 2 * 64 / 255, 2)
    p2Local.applyMatrix4(new THREE.Matrix4()
      .makeRotationZ(Math.PI / 2)
      .setPosition(pivot.x, pivot.y, pivot.z))
    const p2 = armorModel.localToWorld(p2Local.clone())
    expect(window.__worldSegMk.p1.position.distanceTo(p1)).toBeLessThan(1e-6)
    expect(window.__worldSegMk.p2.position.distanceTo(p2)).toBeLessThan(1e-6)
    expect(window.__segRay).not.toBeNull()
    expect(window.__segRay.dir.length()).toBeCloseTo(1, 6)
    expect(jc.setShotRay).toHaveBeenCalled()
    expect(tankModel.visible).toBe(true)
  })

  it('fail-closes when the turret pivot is absent, producing no judgment evidence', async () => {
    agentMocks.fetchReplayShots.mockResolvedValue({ shots: [makeShot(turretPivotShot())] })
    const { deps, armorModel, rig } = makeHarness()
    addStateArmorMesh(armorModel)
    deps.getTankData = () => ({
      visual_model_url: '/glb/123/model.glb',
      model_origins: { track: [0, 0, 0], turret: [0, 0, 0] },
      collision_boxes: turretCollisionBoxes(),
      armor_model: {},
    })
    rig.getArmorPivotTurret = () => null

    runShotReplay(deps)

    await vi.waitFor(() => expect(window.__segBoxMissing).toBe(true))
    expect(window.__segRay).toBeNull()
    expect(window.__worldSegMk).toBeNull()
    expect(window.__worldSegGroup).toBeNull()
    expect(deps.showShotError).toHaveBeenCalledWith(expect.stringContaining('炮塔枢轴未安装'))
    const loadChainErrors = deps.showShotError.mock.calls
      .map(([msg]) => String(msg))
      .filter((msg) => msg.includes('射击复现数据加载失败'))
    expect(loadChainErrors).toEqual([])
  })

  it('fail-closes if the pivot disappears between decode setup and marker update', async () => {
    agentMocks.fetchReplayShots.mockResolvedValue({ shots: [makeShot(turretPivotShot())] })
    const { deps, armorModel, rig } = makeHarness()
    addStateArmorMesh(armorModel)
    deps.getTankData = () => ({
      visual_model_url: '/glb/123/model.glb',
      model_origins: { track: [0, 0, 0], turret: [0, 0, 0] },
      collision_boxes: turretCollisionBoxes(),
      armor_model: {},
    })
    const pivot = new THREE.Vector3(1, 2, 3)
    let calls = 0
    rig.getArmorPivotTurret = () => (calls++ === 0 ? pivot : null)

    runShotReplay(deps)

    await vi.waitFor(() => expect(window.__segBoxMissing).toBe(true))
    expect(window.__segRay).toBeNull()
    expect(window.__worldSegMk).toBeNull()
    expect(window.__worldSegGroup).toBeNull()
    expect(deps.showShotError).toHaveBeenCalledWith(expect.stringContaining('炮塔枢轴未安装'))
  })
})

describe('renderMissShotAnnotation async guard (P2-F)', () => {
  it('poses the shooter on a successful in-generation response', async () => {
    const s = makeShot({ target_name: undefined })
    const deps = missDeps()
    let resolveLoad
    const loadShooterModel = vi.fn(() => new Promise((resolve) => {
      resolveLoad = resolve
    }))
    const poseShooterTurretGun = vi.fn()
    renderMissShotAnnotation(deps, {
      s,
      currentShot: () => true,
      loadShooterModel,
      poseShooterTurretGun,
    })

    expect(loadShooterModel).toHaveBeenCalledTimes(1)
    resolveLoad({ sd: {}, sModel: new THREE.Group(), breechGunLocal: null })
    await vi.waitFor(() => expect(poseShooterTurretGun).toHaveBeenCalledTimes(1))
  })

  it('drops a stale response without reading a non-existent deps.currentShot', async () => {
    const s = makeShot({ target_name: undefined })
    const deps = missDeps()
    let resolveLoad
    const loadShooterModel = vi.fn(() => new Promise((resolve) => {
      resolveLoad = resolve
    }))
    const poseShooterTurretGun = vi.fn()
    // 旧实现读 deps.currentShot()（undefined → TypeError）；正确实现读 ctx.currentShot()。
    renderMissShotAnnotation(deps, {
      s,
      currentShot: () => false,
      loadShooterModel,
      poseShooterTurretGun,
    })

    resolveLoad({ sd: {}, sModel: new THREE.Group(), breechGunLocal: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(poseShooterTurretGun).not.toHaveBeenCalled()
  })
})
