// 静态子树矩阵冻结 + 实例化合批行为测试（#827 接替 playbackScene.staticFreeze.test.js
// 的 :16/:23/:59/:67/:75/:91；:45 PK 与 :101 dynres 装配无 GPU seam 保留源码守卫）：
// - 装配定型后 bake 世界矩阵并冻结全树（含 mapScenery 根组）；
// - 合批后原节点摘出渲染图、InstancedMesh 入场景；D_ 损毁态实例隐藏且不进遮挡候选；
// - poseGlb 逐帧姿态不强制全树 updateMatrixWorld（renderer 根遍历已传播）；
// - 树倒 = 逐实例矩阵（fallMatrix）+ 倒带复位；同帧多树同批次只触发一次 needsUpdate。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'

const urls = vi.hoisted(() => ({ map: {} as Record<string, string> }))
vi.mock('../replaySource.js', () => ({
  mapStaticUrl: (type: string) => urls.map[type] ?? null,
  resolveMapKey: vi.fn(async () => 'malinovka'),
}))
const provider = vi.hoisted(() => ({
  fetch: vi.fn(async () => ({ ok: false, status: 404 })),
  json: vi.fn(async () => null),
  bytes: vi.fn(async () => new ArrayBuffer(0)),
  configured: () => true,
}))
vi.mock('../assetProvider.js', () => ({ assetProvider: provider }))
const gltfMock = vi.hoisted(() => ({ mode: 'idle' as 'idle' | 'load-scene' }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, onLoad: (g: { scene: THREE.Object3D }) => void, _p: unknown, onError: (e: unknown) => void) {
      if (gltfMock.mode === 'load-scene') onLoad({ scene: gltfMock.scene ?? new THREE.Group() })
      else onError?.(new Error('stub: no scenery'))
    }
  },
}))
gltfMock.scene = null as THREE.Object3D | null
vi.mock('../groundPass.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    loadTerrain: vi.fn(async () => ({ field: null, meta: null, metaStatus: 404, binStatus: 404 })),
    buildGroundGeometry: vi.fn(() => new THREE.BufferGeometry()),
    makeGroundMaterial: vi.fn(() => new THREE.MeshBasicMaterial()),
    groundLayerKeys: vi.fn(() => []),
    setupGroundTextures: vi.fn(),
  }
})
const asmMock = vi.hoisted(() => ({ impl: null as null | ((gltf: unknown, ctx: unknown) => Promise<{ stale: boolean; writes: Record<string, unknown> }>) }))
vi.mock('./mapAssets.js', async (importOriginal) => {
  const actual = await importOriginal() as { assembleMapScenery: (g: unknown, c: unknown) => Promise<{ stale: boolean; writes: Record<string, unknown> }> }
  return {
    assembleMapScenery: (gltf: unknown, ctx: unknown) =>
      asmMock.impl ? asmMock.impl(gltf, ctx) : actual.assembleMapScenery(gltf, ctx),
  }
})

import { assembleMapScenery } from './mapAssets.js'
import type { MapAssemblyContext } from './mapAssets.js'
import { createMapWorld } from './mapWorld.js'
import type { MapWorldDeps } from './mapWorld.js'
import { createVehicleRuntime } from './vehicleRuntime.js'
import type { VehicleRuntimeDeps } from './vehicleRuntime.js'
import { treeFrame } from '../destructibles.js'
import { fallMatrix } from '../sceneryInstancing.js'
import { createPerf } from './perf.ts'

beforeEach(() => {
  urls.map = {}
  asmMock.impl = null
  gltfMock.mode = 'idle'
  gltfMock.scene = null
  provider.fetch.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('assembleMapScenery：矩阵冻结 + 合批摘除 + D_ 隐藏（行为）', () => {
  it('合批后原节点摘出渲染图、InstancedMesh 入场景；全树（含 mapScenery 根组）冻结', async () => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshBasicMaterial()
    const scene = new THREE.Group()
    const originals: THREE.Mesh[] = []
    for (const [name, x, z] of [['tree_001', 10, 10], ['tree_002', 20, 10], ['tree_003', -30, 10]] as const) {
      const m = new THREE.Mesh(geo, mat)
      m.name = name
      m.position.set(x, 0, z)
      scene.add(m)
      originals.push(m)
    }
    const dNode = new THREE.Mesh(geo, mat)
    dNode.name = 'D_tree_001'
    dNode.position.set(10, 300, 0)   // 远隔宫格（gltf 地面系 x/y）：独立批次
    scene.add(dNode)
    const ctx: MapAssemblyContext = {
      DATA: { meta: { map_id: 6 }, destructible_areas: [], destructible_events: [] },
      Q: { anisotropy: 1 },
      DEBUG: false,
      groundLayers: null,
      camera: null,
      renderer: { capabilities: { getMaxAnisotropy: () => 8 } } as MapAssemblyContext['renderer'],
      scene: new THREE.Scene(),
      heightField: null,
      terrainSpan: 600,
      stale: () => false,
      disposeObject3D: vi.fn(),
      noteAsset: vi.fn(),
      sampleHeight: () => 0,
      onSceneryMounted: vi.fn(),
      onRefineMaskBuilt: vi.fn(),
      destructDocPromise: Promise.resolve(null),
    }
    const result = await assembleMapScenery({ scene } as never, ctx)
    expect(result.stale).toBe(false)
    const mapScenery = result.writes.mapScenery as THREE.Group

    // 合批：原节点摘出渲染图（漏摘 = 原 Mesh 照常画一遍，优化失效）
    for (const o of originals) expect(o.parent).toBeNull()
    expect(dNode.parent).toBeNull()
    const instanced = gltfSceneInstanced(scene)
    expect(instanced.length).toBeGreaterThanOrEqual(2)   // 可见批 + D_ 独立批
    expect(mapScenery.parent).toBe(ctx.scene)

    // 冻结：bake 世界矩阵后全树（含 mapScenery 根组与合批节点）matrixAutoUpdate=false
    expect(mapScenery.matrixAutoUpdate).toBe(false)
    expect((scene as THREE.Object3D).matrixAutoUpdate).toBe(false)
    for (const im of instanced) expect(im.matrixAutoUpdate).toBe(false)

    // D_ 损毁态实例初始隐藏（远处 + 微缩矩阵），且该批次不进遮挡候选
    const dBatch = instanced.find((im) => hasHiddenInstance(im))!
    expect(dBatch).toBeTruthy()
    const occlValues = [...(result.writes.occlGrid as Map<string, unknown[]>).values()].flat()
    expect(occlValues).not.toContain(dBatch)
    // 可见批次按世界位置 + 半径登记进候选格
    const visibleBatch = instanced.find((im) => !hasHiddenInstance(im))!
    expect(occlValues).toContain(visibleBatch)
  })

  it('大遮挡物足印按 AABB 全枚举登记进 occlGrid（包围球足印 5×5 格，非对角线格不漏）', async () => {
    const geo = new THREE.BoxGeometry(40, 10, 40)
    const mat = new THREE.MeshBasicMaterial()
    const scene = new THREE.Group()
    const building = new THREE.Mesh(geo, mat)
    building.name = 'building_001'
    building.position.set(20, 5, 20)   // 足印 0..40 → 16m 格 (0..2)×(0..2) = 9 格
    scene.add(building)
    const ctx: MapAssemblyContext = {
      DATA: { meta: { map_id: 6 }, destructible_areas: [], destructible_events: [] },
      Q: { anisotropy: 1 }, DEBUG: false, groundLayers: null, camera: null,
      renderer: { capabilities: { getMaxAnisotropy: () => 8 } } as MapAssemblyContext['renderer'],
      scene: new THREE.Scene(), heightField: null, terrainSpan: 600,
      stale: () => false, disposeObject3D: vi.fn(), noteAsset: vi.fn(), sampleHeight: () => 0,
      onSceneryMounted: vi.fn(), onRefineMaskBuilt: vi.fn(), destructDocPromise: Promise.resolve(null),
    }
    const result = await assembleMapScenery({ scene } as never, ctx)
    const occl = result.writes.occlGrid as Map<string, unknown[]>
    const keys = [...occl.keys()]
    // 登记半径 = 几何包围球（40m 盒 → r≈28.3 → 足印 -8..48 → 5×5 格）
    expect(keys.length).toBe(25)
    expect(keys).toContain('0,1')   // 非对角线覆盖格（线段遍历登记会漏的评审 P0 回归）
    expect(keys).toContain('2,1')
    for (const list of occl.values()) expect(list).toContain((scene.children[0] as never))
  })
})

function gltfSceneInstanced(scene: THREE.Object3D): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = []
  scene.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh) })
  return out
}
function hasHiddenInstance(im: THREE.InstancedMesh): boolean {
  const m = new THREE.Matrix4()
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m)
    if (m.elements[13] < -1e5) return true   // 隐藏槽位 y=-1e6
  }
  return false
}

describe('updateDestructibles：逐实例矩阵倒伏 + 倒带复位 + needsUpdate 按帧合并（行为）', () => {
  function makeWorldWithDestruct(states: unknown[]) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), states.length)
    const { handle, deps } = makeMapWorld()
    asmMock.impl = async () => ({
      stale: false,
      writes: { mapScenery: new THREE.Group(), occlGrid: new Map(), annotationSurfaceGrid: null, destructPickList: [], meshOwner: new Map(), destruct: { states, ptr: 0, lastT: -1 }, animLayerMats: [] },
    })
    urls.map = { scenery: 'http://assets/scenery.glb', destructibles: 'http://assets/destructibles.json' }
    gltfMock.mode = 'load-scene'
    return { handle, deps, mesh }
  }

  function makeMapWorld() {
    const scene = new THREE.Scene()
    const deps: MapWorldDeps = {
      store: { mapKey: null, assetProgress: null, assetIssues: [], assetDegraded: false },
      debug: false,
      perf: () => perfHandle,
      sessionEpoch: () => 1,
      destroyed: () => false,
      getData: () => ({ meta: { map_id: 6 }, vehicles: [] }),
      quality: () => ({ anisotropy: 1, scenery: true, groundLayers: false }),
      getScene: () => scene,
      getCamera: () => new THREE.PerspectiveCamera(),
      getRenderer: () => null,
      getControls: () => ({ target: new THREE.Vector3() }),
      invalidate: vi.fn(),
      disposeObject3D: vi.fn(),
      constrainFreeCameraAltitude: vi.fn(),
      regroundBases: vi.fn(),
      regroundSpawns: vi.fn(),
      rebuildAnnotationProjection: vi.fn(),
      lightingTargets: () => ({ renderer: null, scene: null, sunLight: null, hemiLight: null, debug: false }),
      buildWorldCameraPlacement: vi.fn(),
      scopedHiddenEid: () => 0,
      reprojectAnnotationHeights: vi.fn(),
      onTerrainReground: vi.fn(),
      onLightingApplied: vi.fn(),
    }
    const perfHandle = createPerf({ now: () => 0 })
    const handle = createMapWorld(deps, { build: vi.fn(), clear: vi.fn() })
    return { handle, deps }
  }

  it('50 棵树同帧倒伏：逐实例 fallMatrix 写入（倒带恢复直立），同批次 needsUpdate 只置一次', async () => {
    const N = 50
    const base = (i: number) => new THREE.Matrix4().makeTranslation(i * 2, 0, 0)
    const states = Array.from({ length: N }, (_, i) => ({
      key: 't' + i, clock: 10, prop: 3, fallDir: 0, inst: { id: i, pos: [i * 2, 0] },
      slots: [{ mesh: null as unknown as THREE.InstancedMesh, idx: i, base: base(i) }],
      pivotPos: { x: i * 2, y: 0, z: 0 }, fallQuat: { w: 1 }, upright: true,
      heightM: 12, stopRad: Math.PI / 2, settled: false,
    }))
    const { handle, mesh } = makeWorldWithDestruct(states)
    for (const st of states as Array<{ slots: Array<{ mesh: THREE.InstancedMesh }> }>) st.slots[0].mesh = mesh
    await handle.loadMapImage()

    let nu = false
    const setSpy = vi.fn((v: boolean) => { nu = v })
    Object.defineProperty(mesh.instanceMatrix, 'needsUpdate', { configurable: true, get: () => nu, set: setSpy })

    // 前进越过倒伏窗口：50 槽位逐实例矩阵 ≠ base；同帧同批次只置一次 needsUpdate
    handle.updateDestructibles(11)
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(nu).toBe(true)
    const st0 = states[0] as { pivotPos: { x: number }; fallQuat: { w: number }; stopRad: number; heightM: number; clock: number }
    const frame = treeFrame(st0 as never, true, 11)!
    expect(frame).toBeTruthy()
    const axis = new THREE.Vector3(frame.axis[0], frame.axis[1], frame.axis[2])
    const expected = fallMatrix(base(0), st0.pivotPos.x, st0.pivotPos.y, st0.pivotPos.z, axis, frame.angle, new THREE.Matrix4())
    const applied = new THREE.Matrix4()
    mesh.getMatrixAt(0, applied)
    // 逐实例矩阵 = T(p)·R·T(−p)·base（逐元素近似比对，避免浮点位图差异）
    for (let k = 0; k < 16; k++) expect(applied.elements[k]).toBeCloseTo(expected.elements[k], 5)
    expect(st0.fallQuat.w).not.toBe(1)            // settled 自校验的 fallQuat 同步维护
    expect((handle.destruct() as { animating: boolean }).animating).toBe(true)

    // 倒带（seek 后退）：恢复 base 直立矩阵、fallQuat 归位、游标重置
    handle.updateDestructibles(5)
    expect(setSpy).toHaveBeenCalledTimes(2)
    const back = new THREE.Matrix4()
    mesh.getMatrixAt(0, back)
    expect(back.equals(base(0))).toBe(true)
    expect((states[0] as { fallQuat: { w: number } }).fallQuat.w).toBe(1)
    expect((handle.destruct() as { ptr: number }).ptr).toBe(0)
  })
})

describe('poseGlb：逐帧姿态不强制全树 updateMatrixWorld（renderer 根遍历已传播）', () => {
  it('poseGlbRig 写位姿/炮塔矩阵但不调用 updateMatrixWorld', () => {
    const kf = { t: [0, 10], pos: [0, 0, 0, 5, 0, 0], yaw: [0, 0.5], pitch: [0, 0], roll: [0, 0] }
    const v = {
      def: { eid: 1, account_id: 1, tank_id: 10001, team: 1, death_t: null, pos: [0, 0, 0, 0, 0, 0], pose_kf: kf },
      group: new THREE.Group(),
      turretG: new THREE.Group(),
      gunPivot: new THREE.Group(),
      meshHull: new THREE.Mesh(),
      hullGroup: new THREE.Group(),
      detachedTurrets: [],
      proxyVisual: null,
      glbVisual: null,
      labelAnchor: new THREE.Vector3(),
      trail: null,
      tread: null,
      treadMesh: null,
      glb: new THREE.Group(),
      glbParts: {
        hullGroup: new THREE.Group(),
        turretNode: null,
        gunNodes: [new THREE.Group()],
        tP: [0, 1, 0], gP: [0, 2, 1],
        poseT: new THREE.Matrix4(), poseG: new THREE.Matrix4(),
      },
    } as never
    const deps: VehicleRuntimeDeps = {
      store: { glbOn: false },
      destroyed: () => false,
      sessionGen: () => 0,
      getScene: () => new THREE.Scene(),
      getT: () => 5,
      getData: () => ({ vehicles: [], detached_turrets: [] }) as never,
      teamColor: () => 0xff0000,
      quality: () => ({}),
      classIconsVisible: () => false,
      showMarkerStatus: () => false,
      invalidate: vi.fn(),
      visibleAt: () => true,
      sceneLifeAt: () => null,
      sampleHeight: () => 0,
      treadAttachVehicle: vi.fn(),
      disposeObject3D: vi.fn(),
      poseGrid: {} as never,
      visByEid: () => new Map(),
      contactShadows: () => null,
      scopedHiddenEid: () => 0,
    }
    const rt = createVehicleRuntime(deps)
    const worldSpy = vi.spyOn(THREE.Object3D.prototype, 'updateMatrixWorld')
    rt.poseGlbRig(v, 5, new THREE.Vector3(1, 0, 2))
    // 纯重（compose/multiply 本地矩阵），根位姿与炮塔矩阵已写，但不强制全树刷新
    expect(worldSpy).not.toHaveBeenCalled()
    expect((v as unknown as { glb: THREE.Group }).glb.position.equals(new THREE.Vector3(1, 0, 2))).toBe(true)
    expect((v as unknown as { glbParts: { poseT: THREE.Matrix4 } }).glbParts.poseT).not.toEqual(new THREE.Matrix4())
    worldSpy.mockRestore()
  })
})
