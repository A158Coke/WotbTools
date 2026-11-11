// mapWorld 生命周期行为测试（#827 接替 pickDebug.test.js:167/180 与
// sceneryMaterials.test.js:1344/1333）：
// - teardown（dispose）必须释放 meshOwner / destruct / destructPickList（reset 后不持有引用）；
// - assembleMapScenery 在每个 await 之后复查会话失效：stale → 只返回空 writes，
//   不摘除已挂载（onSceneryMounted）的宿主资源；纹理 await 后 stale → 就地 dispose gltf.scene；
// - maybeRebuildTerrainLod 消费相机姿态快照（terrainLodState）：原位旋转触发重建、
//   滞回窗口内移动不重建。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'

// 资产面/地形段 I/O 全部替身化：mapStaticUrl 按测试编排返回 URL
const urls = vi.hoisted(() => ({ map: {} as Record<string, string> }))
vi.mock('../replaySource.js', () => ({
  mapStaticUrl: (type: string) => urls.map[type] ?? null,
  resolveMapKey: vi.fn(async () => 'malinovka'),
}))
const provider = vi.hoisted(() => ({
  fetch: vi.fn(),
  json: vi.fn(async () => null),
  bytes: vi.fn(async () => new ArrayBuffer(0)),
  configured: () => true,
}))
vi.mock('../assetProvider.js', () => ({ assetProvider: provider }))
// GLTFLoader 替身：load 按 mode 收尾
const gltfMock = vi.hoisted(() => ({ mode: 'idle' as 'idle' | 'load-scene' }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, onLoad: (g: { scene: THREE.Object3D }) => void, _onProgress: unknown, onError: (e: unknown) => void) {
      if (gltfMock.mode === 'load-scene') onLoad({ scene: new THREE.Group() })
      else onError?.(new Error('stub: no scenery'))
    }
  },
}))
// groundPass 替身：地形读取/构建收口（真实 loadTerrain 需要 HTTP+u16 解码，与被测行为无关）
vi.mock('../groundPass.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    loadTerrain: vi.fn(async () => ({ field: new Float32Array(64).fill(2), meta: { size: 8, span: 600, terrainLayout: 2 }, metaStatus: 200, binStatus: 200 })),
    buildGroundGeometry: vi.fn(() => new THREE.BufferGeometry()),
    makeGroundMaterial: vi.fn(() => new THREE.MeshBasicMaterial()),
    groundLayerKeys: vi.fn(() => []),
    setupGroundTextures: vi.fn(),
  }
})
// assembleMapScenery 可编排：默认走真实实现（stale/stale-after-await 行为测试），
// impl 设置后由宿主测试直接决定 writes（dispose/teardown 语义测试）
const asmMock = vi.hoisted(() => ({ impl: null as null | ((gltf: unknown, ctx: unknown) => Promise<{ stale: boolean; writes: Record<string, unknown> }>) }))
vi.mock('./mapAssets.js', async (importOriginal) => {
  const actual = await importOriginal() as { assembleMapScenery: (g: unknown, c: unknown) => Promise<{ stale: boolean; writes: Record<string, unknown> }> }
  return {
    assembleMapScenery: (gltf: unknown, ctx: unknown) =>
      asmMock.impl ? asmMock.impl(gltf, ctx) : actual.assembleMapScenery(gltf, ctx),
  }
})

import { createPerf } from './perf.ts'
import { createMapWorld } from './mapWorld.js'
import type { MapWorldDeps } from './mapWorld.js'
import { assembleMapScenery } from './mapAssets.js'
import type { MapAssemblyContext } from './mapAssets.js'

function makeDeps(overrides: Partial<MapWorldDeps> = {}) {
  const perfHandle = createPerf({ now: () => 0 })
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000)
  const deps: MapWorldDeps = {
    store: { mapKey: null, assetProgress: null, assetIssues: [], assetDegraded: false },
    debug: false,
    perf: () => perfHandle,
    sessionEpoch: () => 1,
    destroyed: () => false,
    getData: () => ({ meta: { map_id: 6 }, vehicles: [] }),
    quality: () => ({ anisotropy: 1, scenery: true, groundLayers: false }),
    getScene: () => scene,
    getCamera: () => camera,
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
    ...overrides,
  }
  return { deps, scene, camera }
}

function makeWorld(overrides: Partial<MapWorldDeps> = {}) {
  const { deps, scene, camera } = makeDeps(overrides)
  const handle = createMapWorld(deps, { build: vi.fn(), clear: vi.fn() })
  return { handle, deps, scene, camera }
}

beforeEach(() => {
  urls.map = {}
  asmMock.impl = null
  gltfMock.mode = 'idle'
  provider.fetch.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('mapWorld dispose（会话 teardown 资源卫生）', () => {
  it('dispose 释放 meshOwner / destructPickList / destruct：getter 归 null，宿主布景随场景摘除', async () => {
    const { handle, deps, scene } = makeWorld()
    // 宿主布景：装配模块挂进 ctx.scene（onSceneryMounted 语义）
    const group = new THREE.Group()
    asmMock.impl = async (_gltf, ctx) => {
      (ctx as { scene: THREE.Scene }).scene.add(group)
      return {
        stale: false,
        writes: {
          mapScenery: group,
          occlGrid: new Map(),
          annotationSurfaceGrid: null,
          destructPickList: [{ id: 1 }],
          meshOwner: new Map([['mesh:k', { inst: { id: 1 } }]]),
          destruct: { states: [], ptr: 0, lastT: -1 },
          animLayerMats: [],
        },
      }
    }
    urls.map = { scenery: 'http://assets/scenery.glb', destructibles: 'http://assets/destructibles.json' }
    gltfMock.mode = 'load-scene'
    provider.fetch.mockResolvedValue({ ok: true, json: async () => ({ instances: [{ id: 1, pos: [10, 10, 0] }] }) })
    await handle.loadMapImage()
    // 装载完成后宿主确实持有拾取/可破坏物引用（teardown 前置态）
    expect(handle.meshOwner()).not.toBeNull()
    expect(handle.destruct()).not.toBeNull()
    expect(handle.destructPickList()).not.toBeNull()
    expect(handle.mapScenery()).toBe(group)
    handle.dispose()
    // reset 后不得残留引用（评审回归：拾取报告/可破坏物推进仍读旧会话资源）
    expect(handle.meshOwner()).toBeNull()
    expect(handle.destruct()).toBeNull()
    expect(handle.destructPickList()).toBeNull()
    expect(handle.mapScenery()).toBeNull()
    expect(handle.occlGrid()).toBeNull()   // 候选格属会话场景，随 dispose 失效
    expect(deps.disposeObject3D).toHaveBeenCalledWith(group)
    expect(scene.children.length).toBe(0)
  })
})

describe('assembleMapScenery 会话失效复查（每个 await 之后）', () => {
  const minimalGltf = () => ({ scene: new THREE.Group(), parser: { associations: new Map() } })

  function makeCtx(extra: Partial<MapAssemblyContext> = {}) {
    const scene = new THREE.Scene()
    let staleFlag = false
    const ctx: MapAssemblyContext = {
      DATA: { meta: { map_id: 6 }, destructible_areas: [], destructible_events: [] },
      Q: { anisotropy: 1 },
      DEBUG: false,
      groundLayers: null,
      camera: null,
      renderer: { capabilities: { getMaxAnisotropy: () => 8 } } as MapAssemblyContext['renderer'],
      scene,
      heightField: null,
      terrainSpan: 600,
      stale: () => staleFlag,
      disposeObject3D: vi.fn(),
      noteAsset: vi.fn(),
      sampleHeight: () => 0,
      onSceneryMounted: vi.fn(),
      onRefineMaskBuilt: vi.fn(),
      destructDocPromise: Promise.resolve(null),
      ...extra,
    }
    return { ctx, scene, setStale: (v: boolean) => { staleFlag = v } }
  }

  it('纹理依赖 await 之后、共享状态写入之前复查 stale：就地 dispose gltf.scene，不发布 writes', async () => {
    const { ctx, setStale } = makeCtx()
    const gltf = minimalGltf()
    const pending = assembleMapScenery(gltf as never, ctx)
    // await 期间会话翻转（reset/切场）：恢复执行后不得把旧场资源挂进新会话
    setStale(true)
    const result = await pending
    expect(result.stale).toBe(true)
    expect(result.writes).toEqual({})
    expect(ctx.disposeObject3D).toHaveBeenCalledWith(gltf.scene)
    // 未发布：宿主 mapScenery/遮挡表等保持旧值
    expect('mapScenery' in result.writes).toBe(false)
    expect('occlGrid' in result.writes).toBe(false)
  })

  it('destructDoc 晚 resolve + stale：只返回空 writes，不摘除已挂载宿主布景', async () => {
    let resolveDoc!: (d: unknown) => void
    const destructDocPromise = new Promise((res) => { resolveDoc = res })
    const { ctx, scene, setStale } = makeCtx({ destructDocPromise })
    const gltf = minimalGltf()
    const pending = assembleMapScenery(gltf as never, ctx)
    // 让 extras await 落定、装配段推进到 destructDoc 悬挂点（挂载即归属宿主：onSceneryMounted 无条件发生）
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.onSceneryMounted).toHaveBeenCalledTimes(1)
    resolveDoc({ instances: [{ id: 1, pos: [10, 10, 0] }] })
    setStale(true)
    const result = await pending
    expect(result.stale).toBe(true)
    expect(result.writes).toEqual({})
    expect('meshOwner' in result.writes).toBe(false)
    expect('destructPickList' in result.writes).toBe(false)
    // stale 只丢弃结果、不碰资源：已交给宿主的布景仍在场景里（B 解析失败时 A 仍保留）
    expect(scene.children.length).toBe(1)
    expect(ctx.disposeObject3D).not.toHaveBeenCalled()
  })
})

describe('maybeRebuildTerrainLod（地形 LOD 滞后与判据接线）', () => {
  async function readyWorld() {
    const { handle, deps, scene, camera } = makeWorld({
      quality: () => ({ anisotropy: 1, scenery: false, groundLayers: false }),
    })
    urls.map = { terrain: 'http://assets/terrain.u16.bin', 'terrain-meta': 'http://assets/terrain.json' }
    await handle.loadMapImage()
    expect(handle.terrainMesh()).not.toBeNull()
    expect(handle.heightField()).not.toBeNull()
    const target = (deps.getControls() as { target: THREE.Vector3 }).target
    return { handle, deps, scene, camera, target }
  }

  it('原位旋转（视距恒等、侧向位移超阈）必须重建；滞回窗口内移动不重建', async () => {
    const { handle, deps, camera, target } = await readyWorld()
    camera.position.set(200, 0, 0)
    handle.maybeRebuildTerrainLod(1000)
    const rebuilds0 = handle.terrainCounters().terrainRebuilds
    expect(rebuilds0).toBeGreaterThan(0)   // 首帧恒重建（prev 无快照）
    const geo0 = handle.terrainMesh()!.geometry
    expect(deps.constrainFreeCameraAltitude).toHaveBeenCalled()

    // 绕 target 原位旋转 90°：视距不变（旧实现只比视距 → 永不重建），侧向位移 = 200m ≥ 5%·200
    camera.position.set(0, 0, 200)
    handle.maybeRebuildTerrainLod(2000)   // ≥ 120ms 节流窗
    expect(handle.terrainCounters().terrainRebuilds).toBe(rebuilds0 + 1)
    expect(handle.terrainMesh()!.geometry).not.toBe(geo0)

    // 滞回窗口内：侧向位移 2m（< 5%·200）、视距/FOV/aspect 不变 → 不重建
    const rebuilds1 = handle.terrainCounters().terrainRebuilds
    const geo1 = handle.terrainMesh()!.geometry
    camera.position.set(2, 0, 200)
    handle.maybeRebuildTerrainLod(2600)
    expect(handle.terrainCounters().terrainRebuilds).toBe(rebuilds1)
    expect(handle.terrainMesh()!.geometry).toBe(geo1)

    // 视距在单向滞回内（拉近 <5%、拉远 <40%）也不重建
    camera.position.set(2, 0, 205)
    handle.maybeRebuildTerrainLod(4000)
    expect(handle.terrainCounters().terrainRebuilds).toBe(rebuilds1)
    expect(target.length()).toBe(0)
  })
})
