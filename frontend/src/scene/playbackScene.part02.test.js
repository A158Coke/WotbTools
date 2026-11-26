// @vitest-environment happy-dom
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { watchEffect } from 'vue'

import { createHash } from 'node:crypto'

import * as THREE from 'three'

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { assetProvider } from './assetProvider.ts'

import { foliageClip } from './sceneryMaterials.ts'

import { createPlaybackStore } from './playbackStore.js'

import { fixtureFacets, requireFixtures } from '../replay-local/__golden__/agentWasmNode.js'

import { buildCanonicalReplayFacts, entityFirstSeenByAccount } from '../replay-local/canonical/facts.js'

import { toBattlePlaybackDataset } from '../replay-local/playback/toBattlePlaybackDataset.js'

import { validateAgentAiReview, validateAgentBattleResult, validateAgentPlayback } from '../api/agent-replay-facets.js'

import { FLOAT_DMG_MS, GHOST_MS } from '../utils/battlePlayback.js'

import { mapImages } from '../data/mapImages.js'

import { normalizePenPoints } from './playback/annotation3d.js'
import { followCameraMinDistance } from './playback/followCameraDistance.js'


const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), loadRecorderCameraFromFile: vi.fn(), resolveMapKey: vi.fn(), mapStaticUrl: vi.fn(), tankNamesStatic: vi.fn(async () => new Map()) }))

vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  loadRecorderCameraFromFile: source.loadRecorderCameraFromFile,
  resolveMapKey: source.resolveMapKey,
  tankNamesStatic: source.tankNamesStatic,
  mapStaticUrl: source.mapStaticUrl,
}))


vi.mock('../data/mapBases.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    mapBases: {
      ...actual.mapBases,
      probe_map: {
        supremacy: [
          { baseId: 'A', x: -10, y: 20, radius: 15 },
          { baseId: 'B', x: 0, y: 0, radius: 15 },
          { baseId: 'C', x: 10, y: -20, radius: 15 },
        ],
        assault: [{ x: 5, y: 5, radius: null, team: 1 }],
      },
      probe_multi: {
        supremacy: [{ baseId: 'A', x: 0, y: 0, radius: 15 }],
        assault: [{ x: 0, y: 0, radius: null, team: 1 }, { x: 9, y: 9, radius: null, team: 2 }],
      },
    },
  }
})


vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal()
  class StubWebGLRenderer {
    constructor(params = {}) {
      this.params = params
      this.domElement = document.createElement('canvas')
      this.toneMapping = 0
      this.toneMappingExposure = 1
      this.shadowMap = { enabled: false }
      this.capabilities = { getMaxAnisotropy: () => 8 }
      this.info = { autoReset: true, reset() {}, render: { calls: 0 } }
    }
    setSize(w, h) { this.size = { width: w, height: h } }
    getSize(v) { v.set(this.size?.width ?? 800, this.size?.height ?? 600); return v }
    getDrawingBufferSize(v) { return this.getSize(v) }
    setPixelRatio() {}
    getPixelRatio() { return 1 }
    getContext() { return null }
    render() {}
    dispose() {}
    forceContextLoss() {}
    setAnimationLoop() {}
  }
  return { ...actual, WebGLRenderer: StubWebGLRenderer }
})


const muzzleTip = vi.hoisted(() => ({ reach: 0 }))

vi.mock('./battleFx.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    muzzleTipOf: (nodes, from, dir, out) => (muzzleTip.reach > 0
      ? out.copy(from).addScaledVector(dir, muzzleTip.reach)
      : actual.muzzleTipOf(nodes, from, dir, out)),
  }
})


import { initPlayback, QUALITY_PRESETS } from './playbackScene.js'

import { buildGroundGeometry } from './groundPass.js'

import { ANNOTATION_LIFT } from './playback/annotation3d.js'

import { BURST_SECS, FX_BUDGETS } from './battleFx.ts'


function minimalData(tStart = 42, mapName = 'probe_map') {
  return {
    meta: { map_id: 1, map_name: mapName, t_start: tStart, friendly_team: 1 },
    vehicles: [], shots: [], kills: [], reloads: [], reload_effective: [], supremacy_points: new Map(),
    periods: [], supremacy_bases: [],
  }
}


function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}


function mountContainer() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}


let api = null

let created = []

let pending = []


function track(d) {
  pending.push(d)
  return d
}


beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('unit tests run without network'))))
  vi.spyOn(assetProvider, 'fetch').mockImplementation((...args) => fetch(...args))
  source.loadPlaybackData.mockReset()
  source.loadRecorderCameraFromFile.mockReset()
  source.loadRecorderCameraFromFile.mockResolvedValue(null)
  source.resolveMapKey.mockReset()
  source.mapStaticUrl.mockReset()
  source.mapStaticUrl.mockReturnValue(null)
  window.history.replaceState(null, '', '/?debug&q=low')
  source.loadPlaybackData.mockImplementation(() => new Promise(() => {}))
  source.resolveMapKey.mockImplementation(() => Promise.resolve(null))
  api = null
  created = []
  pending = []
})


afterEach(async () => {
  for (const d of pending) { try { d.resolve(null) } catch (_) {} }
  for (let i = 0; i < 8; i++) await Promise.resolve()
  for (const instance of created) { try { instance?.destroy?.() } catch (_) {} }
  api = null
  created = []
  pending = []
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  muzzleTip.reach = 0
  window.history.replaceState(null, '', '/')
})


function stubTerrainAssets({ values = [0, 65535, 0, 65535], zmin = 0, zmax = 30 } = {}) {
  const size = Math.sqrt(values.length)
  if (!Number.isInteger(size)) throw new Error('terrain test values must form a square heightfield')
  source.resolveMapKey.mockResolvedValue('probe_map')
  source.mapStaticUrl.mockImplementation((kind) => ['terrain', 'terrain-meta'].includes(kind) ? `/assets/${kind}` : null)
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).endsWith('terrain-meta')) return {
      ok: true,
      status: 200,
      json: async () => ({
        size, span: 600, zmin, zmax, terrainLayout: 2,
        worldBounds: { min: [-300, -300, zmin], max: [300, 300, zmax] },
      }),
    }
    if (String(url).endsWith('/terrain')) return {
      ok: true, status: 200, arrayBuffer: async () => new Uint16Array(values).buffer,
    }
    return { ok: false, status: 404 }
  }))
}


function stubFrames() {
  const frames = []
  vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return () => { for (const cb of frames.splice(0)) cb() }
}


let zoomPump = null

async function settleZoomFrames() {
  vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
  if (!zoomPump || globalThis.requestAnimationFrame !== zoomPump.stub) {
    const frame = stubFrames()
    zoomPump = { stub: globalThis.requestAnimationFrame, frame }
    await new Promise((r) => setTimeout(r, 25))
  }
  for (let i = 0; i < 17; i++) zoomPump.frame()
}


async function pumpZoomAt(dt, frames) {
  vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(dt)
  if (!zoomPump || globalThis.requestAnimationFrame !== zoomPump.stub) {
    const frame = stubFrames()
    zoomPump = { stub: globalThis.requestAnimationFrame, frame }
    await new Promise((r) => setTimeout(r, 25))
  }
  for (let i = 0; i < frames; i++) zoomPump.frame()
}


function stubCanvas2d() {
  const ctx = new Proxy({}, { get: () => () => {} })
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
}


function createScene(existingStore = null) {
  const store = existingStore ?? createPlaybackStore()
  api = initPlayback(mountContainer(), store)
  created.push(api)
  return { store, api }
}


function createInstance(store) {
  const instance = initPlayback(mountContainer(), store)
  created.push(instance)
  api = instance
  return instance
}
describe('playbackScene loadMapOnly：地图预览会话', () => {
  it('地图资产就绪 → mapReady 落位、hasData 保持 false（传输/阵容门控不误开）', async () => {
    stubTerrainAssets()
    const { store } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(store.mapReady).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.assetStage).toBe(false)
    expect(store.err).toBe('')
    expect(store.mapName).toBe('Yukon')
    expect(store.mapKey).toBe('probe_map')
    expect(store.playing).toBe(false)
  })

  it('reset 撤下地图预览：mapReady 复位，不留就绪残留', async () => {
    stubTerrainAssets()
    const { store } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(store.mapReady).toBe(true)
    api.reset()
    expect(store.mapReady).toBe(false)
    expect(store.hasData).toBe(false)
    expect(store.mapKey).toBe(null)
  })

  it('地图预览之后 loadData 正常接管回放会话（SESSION_MODE 复位）', async () => {
    stubTerrainAssets()
    const { store } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(store.mapReady).toBe(true)
    const session = { loadScene: vi.fn().mockResolvedValue(minimalData(7, 'map_b')), getState: () => null }
    await api.loadData({ kind: 'local', file: new File(['x'], 'b.wotbreplay'), session })
    expect(store.hasData).toBe(true)
    expect(store.mapReady).toBe(false)
    expect(store.mapName).toBe('map_b')
  })

  it('resolveMapKey 失败也 fail-soft：网格兜底照样就绪', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    source.resolveMapKey.mockImplementation(() => Promise.reject(new Error('offline')))
    const { store } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(store.mapReady).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.err).toBe('')
  })

  it('setMapBasesKind 显式选组：中立视图进 store.baseViews；非法值归一 null 清空', async () => {
    stubTerrainAssets()
    stubCanvas2d()
    const frame = stubFrames()
    const { store, api } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    frame()
    expect(store.baseViews).toEqual([])
    api.setMapBasesKind('supremacy')
    frame()
    expect(store.baseViews.map((v) => [v.baseId, v.kind, v.owner, v.progress])).toEqual([
      ['A', 'supremacy', 'neutral', null],
      ['B', 'supremacy', 'neutral', null],
      ['C', 'supremacy', 'neutral', null],
    ])
    api.setMapBasesKind('assault')
    frame()
    expect(store.baseViews.map((v) => [v.baseId, v.kind, v.owner, v.progress])).toEqual([
      ['BASE', 'assault', 'neutral', null],
    ])
    api.setMapBasesKind('bogus')
    frame()
    expect(store.baseViews).toEqual([])
  })

  it('assault 组多 candidate 无证据 fail-closed：几何不唯一就不画（supremacy 不受影响）', async () => {
    stubTerrainAssets()
    stubCanvas2d()
    source.resolveMapKey.mockResolvedValue('probe_multi')
    const frame = stubFrames()
    const { store, api } = createScene()
    await api.loadMapOnly({ mapId: 18, mapName: 'Multi' })
    api.setMapBasesKind('assault')
    frame()
    expect(store.baseViews).toEqual([])
    api.setMapBasesKind('supremacy')
    frame()
    expect(store.baseViews).toHaveLength(1)
  })

  it('MAP_BASES_KIND 随 teardown 复位：重建会话在宿主补推前不画旧组', async () => {
    stubTerrainAssets()
    stubCanvas2d()
    const frame = stubFrames()
    const { store, api } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    api.setMapBasesKind('supremacy')
    frame()
    expect(store.baseViews).toHaveLength(3)
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    frame()
    expect(store.baseViews).toEqual([])
  })
})

describe('playbackScene 场景未初始化时的调用安全', () => {
  it('initScene 之前 pause → resume 会重新挂起被取消的 rAF，且场景 API 不炸', async () => {
    const raf = vi.fn()
      .mockReturnValueOnce(101)
      .mockReturnValueOnce(102)
      .mockReturnValue(103)
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { store, api } = createScene()
    expect(raf).toHaveBeenCalledTimes(1)
    expect(() => api.setPaused(true)).not.toThrow()
    expect(cancel).toHaveBeenCalledWith(101)
    expect(() => api.setPaused(false)).not.toThrow()
    expect(raf).toHaveBeenCalledTimes(2)
    source.loadPlaybackData.mockResolvedValueOnce(minimalData())
    await api.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
    expect(() => api.setPlaying(false)).not.toThrow()
    expect(() => api.togglePlay()).not.toThrow()
    expect(store.playing).toBe(true)
    expect(() => api.togglePlay()).not.toThrow()
    expect(store.playing).toBe(false)
  })

  it('初始化之后 setPaused 仍正常停帧 / 恢复（守住修复没有把正常路径关掉）', async () => {
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData()))
    const store = createPlaybackStore()
    const only = createInstance(store)
    await only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.hasData).toBe(true)
    expect(() => only.setPaused(true)).not.toThrow()
    expect(() => only.setPaused(false)).not.toThrow()
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
  })
})

describe('playbackScene 资产发布顺序', () => {
  function prepareAssets(kinds) {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    source.resolveMapKey.mockResolvedValue('probe_map')
    source.mapStaticUrl.mockImplementation((kind) => kinds.includes(kind) ? '/assets/' + kind : null)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  }

  it.each(['low', 'mid'])('%s 加载并挂载场景；reset 后撤下场景', async (quality) => {
    window.history.replaceState(null, '', `/?debug&q=${quality}`)
    prepareAssets(['scenery'])
    const root = new THREE.Group()
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: root, parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadMapOnly({ mapId: 1, mapName: 'probe_map' })
    expect(store.mapReady).toBe(true)
    expect(root.parent?.parent).toBe(window.__scene)
    expect(store.assetIssues.some((issue) => issue.key === 'scenery')).toBe(false)
    api.reset()
    expect(store.mapReady).toBe(false)
    expect(root.parent?.parent).toBeNull()
  })

  it.each(['low', 'mid'])('%s 场景资源失败时记录降级并完成会话', async (quality) => {
    window.history.replaceState(null, '', `/?debug&q=${quality}`)
    prepareAssets(['scenery'])
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, _ok, _progress, onError) => onError(new Error('missing')))
    const { api, store } = createScene()
    await api.loadMapOnly({ mapId: 1, mapName: 'probe_map' })
    expect(store.mapReady).toBe(true)
    expect(store.assetDegraded).toBe(true)
    expect(store.assetIssues.some((issue) => issue.key === 'scenery' && issue.status === 'failed')).toBe(true)
  })

  it('迟到底图只 dispose A；B 的当前贴图引用仍由会话持有', async () => {
    prepareAssets(['map'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, headers: new Headers(), blob: async () => new Blob(['map']),
    }))
    const textureA = new THREE.Texture()
    const textureB = new THREE.Texture()
    const disposeA = vi.spyOn(textureA, 'dispose')
    const disposeB = vi.spyOn(textureB, 'dispose')
    const parked = track(deferred())
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockImplementationOnce(() => parked.promise)
      .mockResolvedValue(textureB)
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    await api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    expect(store.hasData).toBe(true)
    const groundB = window.__scene.children.find((o) => o.material?.map === textureB)
    expect(groundB).toBeDefined()
    parked.resolve(textureA)
    await loadA
    expect(disposeA).toHaveBeenCalledTimes(1)
    expect(disposeB).not.toHaveBeenCalled()
    expect(groundB.material.map).toBe(textureB)
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    api.destroy()
    expect(disposeB).toHaveBeenCalledTimes(2)
    created = []
  })

  it('迟到 terrain arrayBuffer 不得覆盖 B 正在提交的高度场', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['terrain', 'terrain-meta', 'groundmeta'])
    const parkedBuffer = track(deferred())
    const parkedGround = track(deferred())
    const readBuffer = vi.fn()
      .mockImplementationOnce(() => parkedBuffer.promise)
      .mockResolvedValue(new Uint16Array([0, 0, 0, 0]).buffer)
    const groundFetch = vi.fn().mockImplementationOnce(() => parkedGround.promise)
      .mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('terrain-meta')) return { ok: true, json: async () => ({ size: 2, span: 600, zmin: 20, zmax: 100, terrainLayout: 2 }) }
      if (url.endsWith('terrain')) return { ok: true, arrayBuffer: readBuffer }
      if (url.endsWith('groundmeta')) return groundFetch()
      throw new Error('unexpected asset ' + url)
    }))
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(readBuffer).toHaveBeenCalledTimes(1))
    const loadB = api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    await vi.waitFor(() => expect(groundFetch).toHaveBeenCalledTimes(1))
    parkedBuffer.resolve(new Uint16Array([65535, 65535, 65535, 65535]).buffer)
    await loadA
    expect(store.loading).toBe(true)
    parkedGround.resolve({ ok: false })
    await loadB
    const terrain = window.__terrain
    expect(terrain).toBeDefined()
    expect(terrain.geometry.attributes.position.getY(0)).toBeCloseTo(20)
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
  })

  function terrainPairFetch(meta, bin) {
    return vi.fn(async (url) => {
      if (url.endsWith('terrain-meta')) return { ok: true, json: async () => ({ ...meta }) }
      if (url.startsWith('/assets/terrain')) return { ok: true, arrayBuffer: async () => bin }
      throw new Error('unexpected asset ' + url)
    })
  }
  const sha256Hex = (buf) => createHash('sha256').update(Buffer.from(buf)).digest('hex')

  it('terrain bin 以 terrainBinSha256 作缓存键取回，字节配对才建地形', async () => {
    prepareAssets(['terrain', 'terrain-meta'])
    window.__terrain = undefined
    const bin = new Uint16Array([0, 65535, 0, 65535]).buffer
    const sha = sha256Hex(bin)
    const fetchMock = terrainPairFetch({ size: 2, span: 600, zmin: 20, zmax: 100, terrainLayout: 2, terrainBinSha256: sha }, bin)
    vi.stubGlobal('fetch', fetchMock)
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(`/assets/terrain?sha256=${sha}`)
    expect(window.__terrain).toBeDefined()
    expect(window.__terrain).not.toBeNull()
    expect(store.hasData).toBe(true)
  })

  it('迟到底图失败不得把旧会话诊断写进新 store（reset 后 assetIssues 保持干净）', async () => {
    prepareAssets(['map'])
    const parked = track(deferred())
    vi.stubGlobal('fetch', vi.fn(() => parked.promise))
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    api.reset()
    parked.reject(new Error('late map failure'))
    await loadA
    expect(store.assetIssues).toEqual([])
    expect(store.assetDegraded).toBe(false)
    expect(store.hasData).toBe(false)
  })

  it('terrain 双 404 是核心资产降级，不得标为 optional', async () => {
    prepareAssets(['map', 'terrain', 'terrain-meta'])
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(new THREE.Texture())
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/terrain')) return { ok: false, status: 404 }
      return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['map']) }
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetDegraded).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'terrain' && i.status === 'missing')).toBe(true)
  })

  it('变体映射缺失时 fail-closed 裁剪进入资产降级', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['scenery'])
    const root = new THREE.Group()
    const tagged = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    tagged.userData.mdVariant = 'md1'
    root.add(tagged)
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: root, parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'scenery' && i.status === 'variant-fail-closed')).toBe(true)
  })

  it('variantMappingIncomplete 标记本身也进入资产降级（active 映射存在但标签缺失）', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['scenery'])
    const root = new THREE.Group()
    root.userData.variantByMapId = { 1: 'md1' }
    root.userData.variantMappingIncomplete = true
    const tagged = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    tagged.userData.mdVariant = 'md2'
    root.add(tagged)
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: root, parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'scenery' && i.status === 'variant-fail-closed')).toBe(true)
  })

  it('分层地表元数据畸形：记降级、回退烘焙底图，不跳过场景', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['map', 'terrain', 'terrain-meta', 'groundmeta', 'groundtex', 'scenery'])
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(new THREE.Texture())
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (u.includes('terrain-meta')) return { ok: true, status: 200, json: async () => ({ size: 2, span: 600, zmin: 0, zmax: 1, terrainLayout: 2 }) }
      if (u.includes('/terrain')) return { ok: true, status: 200, arrayBuffer: async () => new Uint16Array([0, 1, 2, 3]).buffer }
      if (u.includes('groundmeta')) return { ok: true, status: 200, json: async () => ({}) }
      if (u.includes('groundtex')) return { ok: true, status: 200, blob: async () => new Blob(['x']) }
      return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['map']) }
    }))
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: new THREE.Group(), parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetDegraded).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'groundLayers' && i.status === 'invalid')).toBe(true)
    expect(window.__terrain).toBeTruthy()
  })

  it('场景装配步骤抛错也进入资产降级（不只 loader 返回空）', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['scenery'])
    const boom = new THREE.Group()
    boom.traverse = () => { throw new Error('assembly boom') }
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: boom,
      parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetDegraded).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'scenery' && i.status === 'failed' && i.detail.includes('assembly boom'))).toBe(true)
  })

  it('terrain bin 与 terrain.json 不同批（sha256 不符）⇒ 不建地形、回退 2D', async () => {
    prepareAssets(['terrain', 'terrain-meta'])
    window.__terrain = undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bin = new Uint16Array([0, 65535, 0, 65535]).buffer
    const otherSha = sha256Hex(new Uint16Array([1, 2, 3, 4]).buffer)
    vi.stubGlobal('fetch', terrainPairFetch({ size: 2, span: 600, zmin: 20, zmax: 100, terrainLayout: 2, terrainBinSha256: otherSha }, bin))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(window.__terrain == null).toBe(true)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('sha256 不符'))).toBe(true)
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
  })

  it('资产缺失/失败进入 assetIssues + assetDegraded（不再只写 console 后算完成）', async () => {
    const runtimeRaw = (await import('./playback/sessionRuntime.ts?raw')).default
    const stateRaw = (await import('./playback/sceneState.ts?raw')).default
    const raw = runtimeRaw + '\n' + stateRaw
    const worldSrc = (await import('./playback/mapWorldLoader.ts?raw')).default
    expect(worldSrc).toMatch(/store\.assetIssues = assetIssues/)
    expect(worldSrc).toMatch(/store\.assetDegraded = true/)
    expect(worldSrc.replace('store.assetDegraded = true', '')).not.toMatch(/store\.assetDegraded = true/)
    expect(worldSrc).toMatch(/noteAsset\('map', `http-\$\{resp\.status\}`/)
    expect(worldSrc).toMatch(/noteAsset\('terrain', 'unavailable'/)
    expect(worldSrc).toMatch(/noteAsset\('scenery', 'failed'/)
    expect(raw).toMatch(/VIS_BY_EID = visibilitySpansByEid\(data\.visibility\)/)
    expect(raw).toMatch(/VIS_BY_EID\.get\(v\.def\.eid\) \?\? v\.def\.coverage/)
  })

  it.each(['low', 'mid', 'high'])('%s 迟到 scenery GLB 不入 B 场景，且释放局部资源与隔离进度', async (quality) => {
    window.history.replaceState(null, '', `/?debug&q=${quality}`)
    prepareAssets(['scenery'])
    const gltfA = new THREE.Group()
    const geometryA = new THREE.BoxGeometry()
    const textureA = new THREE.Texture()
    const materialA = new THREE.MeshBasicMaterial({ map: textureA })
    gltfA.add(new THREE.Mesh(geometryA, materialA))
    const disposeGeo = vi.spyOn(geometryA, 'dispose')
    const disposeMat = vi.spyOn(materialA, 'dispose')
    const disposeTex = vi.spyOn(textureA, 'dispose')
    let finishA, progressA
    const loader = vi.spyOn(GLTFLoader.prototype, 'load')
      .mockImplementationOnce((_url, onLoad, onProgress) => { finishA = onLoad; progressA = onProgress })
      .mockImplementation((_url, onLoad) => onLoad({ scene: new THREE.Group() }))
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    await api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    const currentProgress = store.assetProgress
    progressA({ loaded: 3, total: 10, lengthComputable: true })
    expect(store.assetProgress).toBe(currentProgress)
    finishA({ scene: gltfA })
    await loadA
    expect(gltfA.parent).toBeNull()
    expect(disposeGeo).toHaveBeenCalledTimes(1)
    expect(disposeMat).toHaveBeenCalledTimes(1)
    expect(disposeTex).toHaveBeenCalledTimes(1)
    expect(store.hasData).toBe(true)
    expect(store.assetProgress).toBe(currentProgress)
  })

  it('分层纹理 worker 迟到时释放全部局部纹理，不发布旧分层或进度', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['groundmeta', 'groundtex'])
    let groundCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('groundmeta')) {
        if (++groundCalls === 2) return { ok: false }
        return { ok: true, json: async () => ({ height_blend: false }) }
      }
      return { ok: true, blob: async () => new Blob(['layer']) }
    }))
    const parked = track(deferred())
    const lateTexture = new THREE.Texture()
    const disposeLate = vi.spyOn(lateTexture, 'dispose')
    const localTextures = []
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockImplementationOnce(() => parked.promise)
      .mockImplementation(async () => {
        const texture = new THREE.Texture()
        localTextures.push({ texture, dispose: vi.spyOn(texture, 'dispose') })
        return texture
      })
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(6))
    await api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    const progressB = store.assetProgress
    parked.resolve(lateTexture)
    await loadA
    expect(disposeLate).toHaveBeenCalledTimes(1)
    for (const { dispose } of localTextures) expect(dispose).toHaveBeenCalledTimes(1)
    expect(window.__gdbg.layers).toBe(false)
    expect(store.assetProgress).toBe(progressB)
    expect(store.hasData).toBe(true)
  })

  it('新 loadData 的解析阶段清掉上一会话的 assetStage / assetProgress', async () => {
    source.loadPlaybackData.mockResolvedValueOnce(minimalData())
    const parked = track(deferred())
    source.resolveMapKey.mockResolvedValueOnce('map_a').mockImplementationOnce(() => parked.promise)
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(store.assetStage).toBe(true))
    store.assetProgress = 0.6
    const parserB = track(deferred())
    source.loadPlaybackData.mockImplementationOnce(() => parserB.promise)
    const loadB = api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    expect(store.assetStage).toBe(false)
    expect(store.assetProgress).toBeNull()
    expect(store.loading).toBe(true)
    parked.resolve('map_a')
    await loadA
    expect(store.assetStage).toBe(false)
    expect(store.assetProgress).toBeNull()
    expect(store.loading).toBe(true)
    parserB.reject(new Error('B parser failed'))
    await loadB
  })

  it('destroy 在资产阶段清掉 loading / assetStage / assetProgress', async () => {
    source.loadPlaybackData.mockResolvedValueOnce(minimalData())
    const parked = track(deferred())
    source.resolveMapKey.mockResolvedValueOnce('map_a').mockImplementationOnce(() => parked.promise)
    const { api, store } = createScene()
    const load = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(store.assetStage).toBe(true))
    store.assetProgress = 0.6
    api.destroy()
    expect(store.loading).toBe(false)
    expect(store.assetStage).toBe(false)
    expect(store.assetProgress).toBeNull()
    parked.resolve('map_a')
    await load
    expect(store.assetStage).toBe(false)
    expect(store.assetProgress).toBeNull()
    created = []
  })
})

describe('Free Camera terrain floor', () => {
  it('uses the Top mode default camera height as the Free hard ceiling', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 20, zmax: 20 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'terrain-top-ceiling.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    api.setCam('top')
    const topHeight = cam.position.y
    expect(store.cam).toBe('top')
    expect(controls.enabled).toBe(true)
    expect(controls.enablePan).toBe(false)
    const viewDirection = () => new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(viewDirection().y).toBeLessThan(-0.99)
    expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(false)
    api.setCam('free')
    expect(controls.enabled).toBe(false)
    expect(controls.enablePan).toBe(true)
    expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
    const afterForward = cam.position.y
    expect(api.flyTick(0.1, new Set(['KeyE']))).toBe(true)
    expect(cam.position.y).toBeLessThan(afterForward)
    api.setCam('free')

    cam.position.y = topHeight - 0.1
    controls.target.y = topHeight - 5.1
    cam.lookAt(controls.target)
    api.setFlySpeed(6)
    expect(api.flyTick(0.1, new Set(['KeyQ']))).toBe(true)
    expect(cam.position.y).toBeCloseTo(topHeight, 5)

    const canvas = document.querySelector('canvas')
    cam.position.y = topHeight - 0.1
    controls.target.y = topHeight - 5.1
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    await settleZoomFrames()
    expect(cam.position.y).toBeCloseTo(topHeight, 5)

    cam.position.y = topHeight - 0.1
    controls.target.y = topHeight - 5.1
    const touch = (type, x, pointerId) => {
      const event = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      return event
    }
    const frame = stubFrames()
    canvas.dispatchEvent(touch('pointerdown', 100, 7))
    canvas.dispatchEvent(touch('pointerdown', 340, 9))
    canvas.dispatchEvent(touch('pointermove', 300, 9))
    frame()
    canvas.dispatchEvent(touch('pointermove', 260, 9))
    expect(cam.position.y).toBeCloseTo(topHeight, 5)
    canvas.dispatchEvent(touch('pointerup', 260, 9))
    canvas.dispatchEvent(touch('pointerup', 100, 7))

    cam.position.y = topHeight + 50
    controls.target.y = topHeight + 45
    const beforeClamp = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    api.setCam('free')
    expect(cam.position.y).toBeCloseTo(topHeight, 5)
    const afterClamp = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(afterClamp.dot(beforeClamp)).toBeCloseTo(1, 8)
  })

  it('constrains mode entry, high-speed fly, uphill fly, wheel and pinch while preserving view direction', async () => {
    stubTerrainAssets()
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'terrain-floor.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    const dir = () => new THREE.Vector3().subVectors(controls.target, cam.position).normalize()

    api.setCam('top')
    cam.position.set(-30, 20, 0)
    controls.target.set(-20, 15, 0)
    const entryDir = dir()
    api.setCam('free')
    expect(cam.position.y).toBeCloseTo(27.5, 5)
    expect(dir().dot(entryDir)).toBeCloseTo(1, 8)
    cam.position.y = 45
    controls.target.y += 17.5
    api.setCam('free')
    expect(cam.position.y).toBe(45)

    cam.position.set(-30, 45, 0)
    controls.target.set(-20, 40, 0)
    api.setFlySpeed(6)
    const descentDir = dir()
    expect(api.flyTick(0.1, new Set(['KeyE']))).toBe(true)
    expect(cam.position.y).toBeCloseTo(27.5, 5)
    expect(dir().dot(descentDir)).toBeCloseTo(1, 8)
    for (let i = 0; i < 3; i++) {
      expect(api.flyTick(0.1, new Set(['KeyE']))).toBe(true)
      expect(cam.position.y).toBeCloseTo(27.5, 5)
    }

    cam.position.set(-30, 28, 0)
    controls.target.set(-20, 28, 0)
    expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
    expect(cam.position.x).toBeCloseTo(-10, 5)
    expect(cam.position.y).toBeGreaterThanOrEqual(29.5)

    cam.position.set(-30, 27.51, 0)
    controls.target.set(-20, 22.51, 0)
    const canvas = document.querySelector('canvas')
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
    await settleZoomFrames()
    expect(cam.position.y).toBeGreaterThanOrEqual(27.5)

    cam.position.set(-30, 27.51, 0)
    controls.target.set(-20, 22.51, 0)
    const touch = (type, x, pointerId) => {
      const event = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      return event
    }
    const frame = stubFrames()
    canvas.dispatchEvent(touch('pointerdown', 100, 7))
    canvas.dispatchEvent(touch('pointerdown', 260, 9))
    canvas.dispatchEvent(touch('pointermove', 300, 9))
    frame()
    canvas.dispatchEvent(touch('pointermove', 340, 9))
    expect(cam.position.y).toBeGreaterThanOrEqual(27.5)
    canvas.dispatchEvent(touch('pointerup', 340, 9))
    canvas.dispatchEvent(touch('pointerup', 100, 7))
  })

  it('does not create a world-zero floor without terrain or outside the heightfield span', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const noTerrain = createScene()
    await noTerrain.api.loadData({ kind: 'local', file: new File(['empty'], 'no-terrain.wotbreplay') })
    const cam = window.__camera
    noTerrain.api.setCam('top')
    const topHeight = cam.position.y
    cam.position.y = -10
    noTerrain.api.setCam('free')
    expect(cam.position.y).toBe(-10)
    cam.position.y = topHeight + 50
    noTerrain.api.setCam('free')
    expect(cam.position.y).toBeCloseTo(topHeight, 5)
    noTerrain.api.destroy()
    created = []

    stubTerrainAssets({ values: [10, 10, 10, 10], zmin: 10, zmax: 10 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const withTerrain = createScene()
    await withTerrain.api.loadData({ kind: 'local', file: new File(['terrain'], 'terrain-boundary.wotbreplay') })
    const terrainCam = window.__camera
    withTerrain.api.setCam('top')
    const topPosition = terrainCam.position.clone()
    expect(topPosition.y).toBeGreaterThan(10)
    terrainCam.position.set(300, -10, 0)
    withTerrain.api.setCam('free')
    expect(terrainCam.position.y).toBe(-10)
    expect(terrainCam.position.x).toBe(300)
    terrainCam.position.y = 500
    withTerrain.api.setCam('free')
    expect(terrainCam.position.y).toBeCloseTo(topPosition.y, 5)

    withTerrain.api.setCam('follow')
    terrainCam.position.set(0, -10, 0)
    expect(withTerrain.api.flyTick(0.1, new Set(['KeyE']))).toBe(false)
    expect(terrainCam.position.y).toBe(-10)
  })

  it('applies the floor once when terrain is published after the initial Free scene', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 400, zmax: 400 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['late-terrain'], 'late-terrain.wotbreplay') })
    expect(store.cam).toBe('top')
    const cam = window.__camera
    const controls = window.__controls
    const tacticalHeight = 255
    api.setCam('top')
    expect(store.cam).toBe('top')
    expect(cam.position.x).toBeCloseTo(0)
    expect(Math.abs(cam.position.z)).toBeLessThan(0.1)
    expect(cam.position.y).toBeGreaterThanOrEqual(400.5)
    expect(new THREE.Vector3().subVectors(controls.target, cam.position).normalize().y).toBeLessThan(-0.99)
  })

  it('top view orbits around the map center, not the camera', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 0, zmax: 0 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'top-orbit.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    expect(store.cam).toBe('top')
    expect(controls.enabled).toBe(true)
    expect(controls.target.x).toBeCloseTo(0, 3)
    expect(controls.target.z).toBeCloseTo(0, 3)
    const center = controls.target.clone()
    const radius = cam.position.distanceTo(center)
    cam.position.set(radius * 0.6, radius * 0.75, radius * 0.2)
    controls.update()
    expect(controls.target.distanceTo(center)).toBeLessThan(1e-6)
    expect(controls.maxPolarAngle).toBeLessThanOrEqual(Math.PI * 0.5)
  })

  describe('default top view across sessions', () => {
    const TOP_HEIGHT = 255
    const loadScene = async () => {
      stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 0, zmax: 0 })
      source.loadPlaybackData.mockResolvedValue(minimalData())
      const scene = createScene()
      await scene.api.loadData({ kind: 'local', file: new File(['a'], 'first.wotbreplay') })
      return scene
    }
    const loadNext = (api) => api.loadData({ kind: 'local', file: new File(['b'], 'second.wotbreplay') })

    it('opens at the top overview mode (map-center target) and repeats it while untouched', async () => {
      const { api, store } = await loadScene()
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      expect(window.__controls.target.x).toBeCloseTo(0, 3)
      expect(window.__controls.target.z).toBeCloseTo(0, 3)
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
      expect(window.__controls.minDistance).toBe(1)
      await loadNext(api)
      expect(store.cam).toBe('top')
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
      expect(window.__controls.target.x).toBeCloseTo(0, 3)
      expect(window.__controls.target.z).toBeCloseTo(0, 3)
    })

    const expectPoseKept = async (api) => {
      const position = window.__camera.position.clone()
      const target = window.__controls.target.clone()
      await loadNext(api)
      expect(window.__camera.position.distanceTo(position)).toBeLessThan(1e-6)
      expect(window.__controls.target.distanceTo(target)).toBeLessThan(1e-6)
    }

    it('top-view jumps to the overhead pose and stays in working Free, unlike the persistent overview', async () => {
      const { api, store } = await loadScene()
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      api.setCam('free')
      window.__camera.position.set(10, 40, 10)
      api.setCam('top-view')
      expect(store.cam).toBe('free')
      expect(window.__controls.enabled).toBe(false)
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
      const direction = new THREE.Vector3().subVectors(window.__controls.target, window.__camera.position).normalize()
      expect(direction.y).toBeLessThan(-0.99)
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      api.setCam('top')
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(false)
    })

    it('keyboard flight keeps the full camera pose on the next replay', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      await expectPoseKept(api)
    })

    it('wheel dolly keeps the full camera pose on the next replay', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
      await settleZoomFrames()
      await expectPoseKept(api)
    })

    it('drag look keeps the full camera pose on the next replay', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      const canvas = document.querySelector('canvas')
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: 100, clientY: 100 }))
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, buttons: 1, clientX: 160, clientY: 120 }))
      canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 160, clientY: 120 }))
      await expectPoseKept(api)
    })

    it('a renderer rebuild keeps the pose and the flight heading', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      api.setLogdepth(true)
      try {
        await expectPoseKept(api)
        const before = window.__camera.position.clone()
        expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
        expect(window.__camera.position.distanceTo(before)).toBeGreaterThan(0.01)
      } finally {
        api.setLogdepth(false)
      }
    })

    it('a kept pose still obeys the next map terrain floor', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      window.__camera.position.y = 100
      window.__controls.target.y = 90
      stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 150, zmax: 150 })
      await loadNext(api)
      expect(window.__camera.position.y).toBeGreaterThanOrEqual(150.5)
    })

    it('Follow 的 OrbitControls 近端收到车辆尺度，不再固定 20 m', async () => {
      const { api } = await loadScene()
      api.setFollow(1)
      expect(window.__controls.minDistance).toBeCloseTo(followCameraMinDistance(undefined), 6)
      expect(window.__controls.minDistance).toBeGreaterThan(1)
      expect(window.__controls.minDistance).toBeLessThan(10)
    })

    it('地形高度场不可用时 Follow 仍写入模型近端，不把 1 m 留给相机穿模', async () => {
      source.loadPlaybackData.mockResolvedValue(minimalData())
      const { api } = createScene()
      await api.loadData({ kind: 'local', file: new File(['no-terrain'], 'follow-no-heightfield.wotbreplay') })
      api.setFollow(1)
      expect(window.__controls.minDistance).toBeCloseTo(followCameraMinDistance(undefined), 6)
    })

    it('Follow on one replay opens the next at the top overview mode', async () => {
      const { api, store } = await loadScene()
      api.setFollow(1)
      expect(store.cam).toBe('follow')
      window.__camera.position.set(40, 60, 40)
      await loadNext(api)
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      expect(window.__controls.target.x).toBeCloseTo(0, 3)
      expect(window.__controls.target.z).toBeCloseTo(0, 3)
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
      api.setCam('free')
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
    })
  })

  it('Follow 不允许相机绕到 target 下方；已在地下的点被抬到地形净空', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 0, zmax: 0 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'follow-down.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    controls.target.set(0, 2, 0)
    cam.position.set(8, -28, 0)
    api.setCam('follow')
    expect(controls.maxPolarAngle).toBeLessThanOrEqual(Math.PI / 2)
    expect(cam.position.y).toBeGreaterThanOrEqual(0.5)
    controls.update()
    expect(cam.position.y).toBeGreaterThanOrEqual(0.5)
  })

  it('坡面外推按新 x/z 重采样，最终相机点高于实际地形', async () => {
    const n = 64, span = 600, zmin = -50, zmax = 400
    const values = []
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = (c / n - 0.5) * span
        const h = 100 + 0.5 * x
        values.push(Math.round((h - zmin) / (zmax - zmin) * 65535))
      }
    }
    stubTerrainAssets({ values, zmin, zmax })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'follow-slope.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    controls.target.set(0, 0, 0)
    cam.position.set(50, 50, 0)
    api.setCam('follow')
    expect(cam.position.x).toBeGreaterThan(150)
    expect(cam.position.y).toBeGreaterThanOrEqual(100 + 0.5 * cam.position.x + 0.49)
  })

  it('坡面比射线更陡、射线无安全交点时，在相机当前 x/z 垂直抬升', async () => {
    const n = 64, span = 600, zmin = -100, zmax = 750
    const values = []
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = (c / n - 0.5) * span
        const h = 100 + 2 * x
        values.push(Math.round((h - zmin) / (zmax - zmin) * 65535))
      }
    }
    stubTerrainAssets({ values, zmin, zmax })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'follow-steep.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    controls.target.set(0, 0, 0)
    cam.position.set(50, 50, 0)
    api.setCam('follow')
    expect(cam.position.x).toBeCloseTo(50, 3)
    expect(cam.position.y).toBeGreaterThanOrEqual(200.49)
  })

  it('places the Free camera above the rendered triangle on a non-coplanar terrain cell', async () => {
    stubTerrainAssets({ values: [0, 65535, 65535, 0], zmin: 0, zmax: 30 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['non-coplanar'], 'terrain-triangle-floor.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    const x = -150, z = -150
    const terrain = []
    window.__scene.traverse((object) => {
      if (object.geometry?.userData?.terrainBuild) terrain.push(object)
    })
    expect(terrain).toHaveLength(1)
    window.__scene.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0))
    const renderedY = ray.intersectObject(terrain[0], false)[0]?.point.y
    const bilinearY = (0 + 30 + 30 + 0) / 4
    expect(renderedY).toBeGreaterThan(bilinearY)

    cam.position.set(x, -10, z)
    controls.target.set(x, -15, z)
    api.setCam('free')
    expect(cam.position.y).toBeCloseTo(renderedY + 0.5, 5)
  })

  it('applies the rendered-terrain floor inside a positive clipped edge quad', async () => {
    const n = 101
    stubTerrainAssets({ values: new Array(n * n).fill(0), zmin: 20, zmax: 20 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['clipped-edge'], 'terrain-clipped-edge.wotbreplay') })
    const cam = window.__camera
    const terrain = []
    window.__scene.traverse((object) => {
      if (object.geometry?.userData?.terrainBuild) terrain.push(object)
    })
    expect(terrain).toHaveLength(1)

    const oldGeometry = terrain[0].geometry
    terrain[0].geometry = buildGroundGeometry({
      field: new Float32Array(n * n).fill(20), n, span: 600,
      cam: { x: 0, y: 10000, z: 0 }, fovY: (55 * Math.PI) / 180, aspect: 16 / 9,
    })
    oldGeometry.dispose()

    const i = 50, j = 98, span = 600
    const x = ((j + 0.5) / n - 0.5) * span
    const z = ((i + 0.5) / n - 0.5) * span
    const build = terrain[0].geometry.userData.terrainBuild
    const cell = i * n + j
    expect(build.sizeAt[cell]).toBeGreaterThan(0)
    expect(build.originJAt[cell]).toBe(96)
    expect(build.sizeAt[cell]).toBe(5)

    window.__scene.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0))
    const renderedY = ray.intersectObject(terrain[0], false)[0]?.point.y
    expect(renderedY).toBeCloseTo(20, 5)
    cam.position.set(x, -10, z)
    window.__controls.target.set(x, -15, z)
    api.setCam('free')
    expect(cam.position.y).toBeCloseTo(renderedY + 0.5, 5)
  })
})
