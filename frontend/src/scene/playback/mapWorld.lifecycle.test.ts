import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'

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
const gltfMock = vi.hoisted(() => ({ mode: 'idle' as 'idle' | 'load-scene' }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, onLoad: (g: { scene: THREE.Object3D }) => void, _onProgress: unknown, onError: (e: unknown) => void) {
      if (gltfMock.mode === 'load-scene') onLoad({ scene: new THREE.Group() })
      else onError?.(new Error('stub: no scenery'))
    }
  },
}))
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
    grassInstanceBudget: () => 0,
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
  const handle = createMapWorld(deps)
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
    expect(handle.meshOwner()).not.toBeNull()
    expect(handle.destruct()).not.toBeNull()
    expect(handle.destructPickList()).not.toBeNull()
    expect(handle.mapScenery()).toBe(group)
    handle.dispose()
    expect(handle.meshOwner()).toBeNull()
    expect(handle.destruct()).toBeNull()
    expect(handle.destructPickList()).toBeNull()
    expect(handle.mapScenery()).toBeNull()
    expect(handle.occlGrid()).toBeNull()
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
    setStale(true)
    const result = await pending
    expect(result.stale).toBe(true)
    expect(result.writes).toEqual({})
    expect(ctx.disposeObject3D).toHaveBeenCalledWith(gltf.scene)
    expect('mapScenery' in result.writes).toBe(false)
    expect('occlGrid' in result.writes).toBe(false)
  })

  it('destructDoc 晚 resolve + stale：只返回空 writes，不摘除已挂载宿主布景', async () => {
    let resolveDoc!: (d: unknown) => void
    const destructDocPromise = new Promise((res) => { resolveDoc = res })
    const { ctx, scene, setStale } = makeCtx({ destructDocPromise: destructDocPromise as never })
    const gltf = minimalGltf()
    const pending = assembleMapScenery(gltf as never, ctx)
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.onSceneryMounted).toHaveBeenCalledTimes(1)
    resolveDoc({ instances: [{ id: 1, pos: [10, 10, 0] }] })
    setStale(true)
    const result = await pending
    expect(result.stale).toBe(true)
    expect(result.writes).toEqual({})
    expect('meshOwner' in result.writes).toBe(false)
    expect('destructPickList' in result.writes).toBe(false)
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
    const c0 = handle.terrainCounters()
    expect(c0.terrainGeneration).toBe(1)
    expect(c0.terrainGeometriesCreated).toBe(1)
    expect(c0.terrainGeometriesDisposed).toBe(0)
    const initial = deps.perf()!.snapshot().events.filter((e: Record<string, unknown>) => e.stage === 'terrain-geometry')
    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({ owner: 'mapWorldTerrain', mode: 'initial', generation: 1, oldGeneration: 0, created: 1, disposed: 0, reason: 'map-load' })
    expect(initial[0].swapMs).toBeGreaterThanOrEqual(0)
    const target = (deps.getControls() as { target: THREE.Vector3 }).target
    return { handle, deps, scene, camera, target }
  }

  it('原位旋转（视距恒等、侧向位移超阈）必须重建；滞回窗口内移动不重建', async () => {
    const { handle, deps, camera, target } = await readyWorld()
    camera.position.set(200, 0, 0)
    handle.maybeRebuildTerrainLod(1000)
    const rebuilds0 = handle.terrainCounters().terrainRebuilds
    expect(rebuilds0).toBeGreaterThan(0)
    const geo0 = handle.terrainMesh()!.geometry
    expect(deps.constrainFreeCameraAltitude).toHaveBeenCalled()

    camera.position.set(0, 0, 200)
    handle.maybeRebuildTerrainLod(2000)
    expect(handle.terrainCounters().terrainRebuilds).toBe(rebuilds0 + 1)
    expect(handle.terrainMesh()!.geometry).not.toBe(geo0)
    const c1 = handle.terrainCounters()
    expect(c1.terrainGeneration).toBe(3)
    expect(c1.terrainGeometriesCreated).toBe(3)
    expect(c1.terrainGeometriesDisposed).toBe(2)
    const swaps = deps.perf()!.snapshot().events.filter((e: Record<string, unknown>) => e.stage === 'terrain-geometry' && e.mode === 'sync-fallback')
    expect(swaps).toHaveLength(2)
    expect(swaps[1]).toMatchObject({ owner: 'mapWorldTerrain', reason: 'lateral', generation: 3, oldGeneration: 2, created: 3, disposed: 2 })
    expect(swaps[0].swapMs).toBeGreaterThanOrEqual(0)

    const rebuilds1 = handle.terrainCounters().terrainRebuilds
    const geo1 = handle.terrainMesh()!.geometry
    camera.position.set(2, 0, 200)
    handle.maybeRebuildTerrainLod(2600)
    expect(handle.terrainCounters().terrainRebuilds).toBe(rebuilds1)
    expect(handle.terrainMesh()!.geometry).toBe(geo1)

    camera.position.set(2, 0, 205)
    handle.maybeRebuildTerrainLod(4000)
    expect(handle.terrainCounters().terrainRebuilds).toBe(rebuilds1)
    expect(target.length()).toBe(0)
  })

  it('perf reset 只清区间计数：当前几何身份保留，下一次换装从真实代次继续', async () => {
    const { handle, deps, camera } = await readyWorld()
    const before = handle.terrainCounters()
    expect(before.terrainGeneration).toBe(1)

    handle.resetTerrainCounters()
    const reset = handle.terrainCounters()
    expect(reset.terrainGeneration, 'reset 时地形仍在场景里，不得回到第 0 代').toBe(1)
    expect(reset.terrainVertices).toBe(before.terrainVertices)
    expect(reset.terrainIndices).toBe(before.terrainIndices)
    expect(reset.terrainGeometriesCreated).toBe(0)
    expect(reset.terrainGeometriesDisposed).toBe(0)
    expect(reset.terrainRebuilds).toBe(0)

    camera.position.set(200, 0, 0)
    handle.maybeRebuildTerrainLod(1000)
    const next = handle.terrainCounters()
    expect(next.terrainGeneration).toBe(2)
    expect(next.terrainGeometriesCreated).toBe(1)
    const swaps = deps.perf()!.snapshot().events.filter((e: Record<string, unknown>) => e.stage === 'terrain-geometry')
    expect(swaps.at(-1)).toMatchObject({ generation: 2, oldGeneration: 1, created: 1, disposed: 1 })
  })
})
