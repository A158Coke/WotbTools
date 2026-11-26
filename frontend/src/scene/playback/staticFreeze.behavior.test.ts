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
const gltfMock = vi.hoisted(() => ({ mode: 'idle' as 'idle' | 'load-scene', scene: null as THREE.Object3D | null }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, onLoad: (g: { scene: THREE.Object3D }) => void, _p: unknown, onError: (e: unknown) => void) {
      if (gltfMock.mode === 'load-scene') onLoad({ scene: gltfMock.scene ?? new THREE.Group() })
      else onError?.(new Error('stub: no scenery'))
    }
  },
}))
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
  it.each([false, true])('静态布景冻结，独立损毁批次按本场换模事件参与绘制（有事件=%s）', async (canActivate) => {
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
    const dMat = new THREE.MeshBasicMaterial()
    const dNode = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), dMat)
    dNode.name = 'D_tree_001'
    dNode.position.set(10, 300, 0)
    scene.add(dNode)
    const ctx: MapAssemblyContext = {
      DATA: {
        meta: { map_id: 6 }, destructible_areas: [{ eid: 42, x: 10, z: 300 }],
        destructible_events: canActivate ? [{ clock: 20, area_eid: 42, prop: 2, slot: 1, fall_dir: 0, body_len: 0, args: [] }] : [],
      },
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
      destructDocPromise: Promise.resolve({ instances: [{ id: 'tree', pos: [10, 300], serverId: { cell: [0, 3], slot: 1 } }] }),
    }
    const result = await assembleMapScenery({ scene } as never, ctx)
    expect(result.stale).toBe(false)
    const mapScenery = result.writes.mapScenery as THREE.Group

    for (const o of originals) expect(o.parent).toBeNull()
    expect(dNode.parent).toBeNull()
    const instanced = gltfSceneInstanced(scene)
    expect(instanced.length).toBeGreaterThanOrEqual(2)
    expect(mapScenery.parent).toBe(ctx.scene)

    expect(mapScenery.matrixAutoUpdate).toBe(false)
    expect((scene as THREE.Object3D).matrixAutoUpdate).toBe(false)
    for (const im of instanced) expect(im.matrixAutoUpdate).toBe(false)

    const dBatch = instanced.find((im) => hasHiddenInstance(im))!
    expect(dBatch.visible).toBe(canActivate)
    const occlValues = [...(result.writes.occlGrid as Map<string, unknown[]>).values()].flat()
    expect(occlValues).not.toContain(dBatch)
    const visibleBatch = instanced.find((im) => !hasHiddenInstance(im))!
    expect(visibleBatch.visible).toBe(true)
    expect(occlValues).toContain(visibleBatch)
  })

  it('大遮挡物足印按 AABB 全枚举登记进 occlGrid（包围球足印 5×5 格，非对角线格不漏）', async () => {
    const geo = new THREE.BoxGeometry(40, 10, 40)
    const mat = new THREE.MeshBasicMaterial()
    const scene = new THREE.Group()
    const building = new THREE.Mesh(geo, mat)
    building.name = 'building_001'
    building.position.set(20, 5, 20)
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
    expect(keys.length).toBe(25)
    expect(keys).toContain('0,1')
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
    if (m.elements[13] < -1e5) return true
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
    grassInstanceBudget: () => 0,
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
    const handle = createMapWorld(deps)
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

    handle.updateDestructibles(11)
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(nu).toBe(true)
    const st0 = states[0] as { pivotPos: { x: number; y: number; z: number }; fallQuat: { w: number }; stopRad: number; heightM: number; clock: number }
    const frame = treeFrame(st0 as never, true, 11)!
    expect(frame).toBeTruthy()
    const axis = new THREE.Vector3(frame.axis[0], frame.axis[1], frame.axis[2])
    const expected = fallMatrix(base(0), st0.pivotPos.x, st0.pivotPos.y, st0.pivotPos.z, axis, frame.angle, new THREE.Matrix4())
    const applied = new THREE.Matrix4()
    mesh.getMatrixAt(0, applied)
    for (let k = 0; k < 16; k++) expect(applied.elements[k]).toBeCloseTo(expected.elements[k], 5)
    expect(st0.fallQuat.w).not.toBe(1)
    expect((handle.destruct() as { animating: boolean }).animating).toBe(true)

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
      store: { glbOn: false, lastKnownOn: false },
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
    expect(worldSpy).not.toHaveBeenCalled()
    expect((v as unknown as { glb: THREE.Group }).glb.position.equals(new THREE.Vector3(1, 0, 2))).toBe(true)
    expect((v as unknown as { glbParts: { poseT: THREE.Matrix4 } }).glbParts.poseT).not.toEqual(new THREE.Matrix4())
    worldSpy.mockRestore()
  })
})
