// @vitest-environment happy-dom
/**
 * `playbackScene` 的会话状态所有权契约。
 *
 * PR #465 review 的两条合并阻塞竞态，都必须在**场景层**修（组件层镜像状态会制造第二 owner）：
 *
 * 1. 被销毁/被取代的实例不得再写共享 store。注意 `loadGeneration` 是 `initPlayback` 实例内
 *    闭包：跨实例（destroy A → init B，同一个 store）时 A 的计数器不变，只看它就等于
 *    「被销毁的实例仍把自己评为最新代」。归属判定必须同时覆盖 `destroyed` 与加载令牌。
 * 2. `startPlayback()` 的资产阶段有多个 await，被取代后不得继续走完
 *    buildVehicles / buildRoster / setPlaying / tick / writeHud 并把自己标成 ready。
 *
 * 这里驱动**真实** `initPlayback` + `loadData`（只 mock 数据源与资产面），
 * 锁定的是生产代数逻辑，而不是测试自己手写的状态机。
 */
// @vitest-environment happy-dom
/**
 * `playbackScene` 的会话状态所有权契约。
 *
 * PR #465 review 的两条合并阻塞竞态，都必须在**场景层**修（组件层镜像状态会制造第二 owner）：
 *
 * 1. 被销毁/被取代的实例不得再写共享 store。注意 `loadGeneration` 是 `initPlayback` 实例内
 *    闭包：跨实例（destroy A → init B，同一个 store）时 A 的计数器不变，只看它就等于
 *    「被销毁的实例仍把自己评为最新代」。归属判定必须同时覆盖 `destroyed` 与加载令牌。
 * 2. `startPlayback()` 的资产阶段有多个 await，被取代后不得继续走完
 *    buildVehicles / buildRoster / setPlaying / tick / writeHud 并把自己标成 ready。
 *
 * 这里驱动**真实** `initPlayback` + `loadData`（只 mock 数据源与资产面），
 * 锁定的是生产代数逻辑，而不是测试自己手写的状态机。
 */
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


const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), loadRecorderCameraFromFile: vi.fn(), resolveMapKey: vi.fn(), mapStaticUrl: vi.fn(), tankNamesStatic: vi.fn(async () => new Map()) }))

vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  loadRecorderCameraFromFile: source.loadRecorderCameraFromFile,
  resolveMapKey: source.resolveMapKey,
  tankNamesStatic: source.tankNamesStatic,
  mapStaticUrl: source.mapStaticUrl,
}))


/**
 * probe_map / probe_multi 只为本文件的基地环用例存在（真实 mapBases 不含测试键）。
 * probe_multi.assault = 2 条 candidate：静态会话 fail-closed 判据（几何不唯一不画）的输入。
 */
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


/**
 * 渲染器 stub：happy-dom 没有 WebGL，`initScene()` 里的 `new THREE.WebGLRenderer()` 必然抛错，
 * 于是 `startPlayback()` 在**第一个写入之前**就失败——资产阶段竞态根本无法在测试里触发。
 * 只替换 WebGLRenderer，其余 three 保持真实实现（OrbitControls / Scene / 贴图 loader 照旧）。
 */
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal()
  class StubWebGLRenderer {
    constructor(params = {}) {
      this.params = params   // 上下文级参数（logdepth / stencil）的装配证据
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


/**
 * 炮口定位：测试车没有 GLB（代理车），真实 muzzleTipOf 总是回落到记录起点。用例要验证
 * "炮管里那段不画"时把 `muzzleTip.reach` 设成炮管长度，模拟炮口在起点前方 reach 米处。
 */
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


/** 最小可用 PlaybackData：空车队 + 一张地图。资产阶段与空名册都不会因此抛错。
 *  t_start 用非 0 值：`startTime` 只在 startPlayback 尾部写入，可作为「过期续体是否
 *  继续跑了 DATA 派生状态写入」的可观测探针（无 WebGL 时 hasData 不具区分度）。 */
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


/** 场景内核需要一个容器元素；渲染器在数据就位后才惰性创建，这里给空节点即可。 */
function mountContainer() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}


let api = null

/** 本用例创建过的全部实例（含被取代的 A）：每个实例都有自己的渲染器与事件监听，
 *  只销毁最后一个会让前面的实例继续跑，串到下个用例。 */
let created = []

/** 仍挂起的 defer：afterEach 兜底结算，避免悬挂 promise 把在途续体泄漏到下个用例。 */
let pending = []


function track(d) {
  pending.push(d)
  return d
}


beforeEach(() => {
  // 单元测试必须**无网**：happy-dom 的 fetch 会真发请求，而开发机常带 `.env.local`
  // （`VITE_ASSET_BASE_URL=http://127.0.0.1:8123`），高档位
  // `forceGlb: true` 的用例于是真的去下载 `/glb/<id>/model.glb` 与履带/悬挂资产 ⇒ 5 s 预算内
  // 必超时（CI 无 .env.local ⇒ 相对地址快速失败 ⇒ 绿）——这就是 "wreck smoke …" 用例长期
  // 「本机红 / CI 绿」的根因。默认钉成无网：需要资产的用例各自 `vi.stubGlobal('fetch', …)` 覆盖。
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


/** 手动驱动 rAF：双指判定一帧一次，测试用 frame() 表示这一帧结束。 */
function stubFrames() {
  const frames = []
  vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return () => { for (const cb of frames.splice(0)) cb() }
}


/** 滚轮缩放平滑（#835）的确定性收敛泵（recorder 视图 manualFrames + Clock 假 dt 同款）：
 *  派发 wheel 时动画循环还挂在**真实 rAF** 上——首次调用装 stubFrames，让出一个真实
 *  macrotask 供循环自转一帧（其内部下一帧注册落进 stub，此后不再有自发帧），随后按
 *  假 dt=0.1s 泵 17 帧：预算每帧释放 ~67%，5 帧内收敛。同一用例多次调用复用同一
 *  stub（循环的下一帧始终在既有 stub 队列里）；跨用例由 unstubAllGlobals 检测失效重建。 */
let zoomPump = null

async function settleZoomFrames() {
  vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
  if (!zoomPump || globalThis.requestAnimationFrame !== zoomPump.stub) {
    const frame = stubFrames()
    zoomPump = { stub: globalThis.requestAnimationFrame, frame }
    await new Promise((r) => setTimeout(r, 25))   // 循环自转一帧并迁入 stub
  }
  for (let i = 0; i < 17; i++) zoomPump.frame()
}


/** 指定 dt 的滚轮收敛泵（帧率无关性回归用）：与 settleZoomFrames 同一 stub 复用逻辑。 */
async function pumpZoomAt(dt, frames) {
  vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(dt)
  if (!zoomPump || globalThis.requestAnimationFrame !== zoomPump.stub) {
    const frame = stubFrames()
    zoomPump = { stub: globalThis.requestAnimationFrame, frame }
    await new Promise((r) => setTimeout(r, 25))
  }
  for (let i = 0; i < frames; i++) zoomPump.frame()
}


/** happy-dom 没有 2d canvas：基地圆盘贴图（drawBaseDecal）需要可写的 getContext('2d')。 */
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


/** 每次 initPlayback 一个独立实例（跨实例竞态测试要同时持有 A 与 B） */
function createInstance(store) {
  const instance = initPlayback(mountContainer(), store)
  created.push(instance)
  api = instance
  return instance
}
describe('opt-in profiler ownership', () => {
  it('does not publish a profiler when perf is disabled', () => {
    createScene()
    expect(window.__pbPerf).toBeUndefined()
  })

  it('stops the ?perf watchdog through the host destroy path', () => {
    // 看门狗由 createPerfProbe 在 ?perf 下启动（50ms setInterval）；销毁必须清表，
    // 否则每个已销毁实例永久空转。这里走真实 initPlayback().destroy()，不是直接调
    // probe.stopWatchdog()——验证宿主接线（playbackScene 销毁段）而不是清理函数自身。
    window.history.replaceState(null, '', '/?perf&q=low')
    const setSpy = vi.spyOn(window, 'setInterval').mockImplementation(() => 777)
    const clearSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined)
    const { api } = createScene()
    expect(setSpy).toHaveBeenCalled()
    const timerId = setSpy.mock.results[0].value
    api.destroy()
    expect(clearSpy).toHaveBeenCalledWith(timerId)
  })

  it('reads all annotation metrics from the existing owner without changing its state', async () => {
    window.history.replaceState(null, '', '/?perf&debug&q=low')
    const { api } = createScene()
    await api.loadMapOnly({ mapId: 1 })
    const stats = window.__annotationLayer.stats
    const expected = { committedBuilds: 1, draftBuilds: 2, terrainRebuilds: 3, eraseCallbacks: 4,
      lastBuildMs: 5, lastPickMs: 6, committedVertices: 7, draftVertices: 8 }
    Object.assign(stats, expected)
    const snapshot = window.__pbPerf.snapshot()
    expect(snapshot.annotation).toEqual(expected)
    expect(snapshot.annotation).not.toBe(stats)
    snapshot.annotation.committedBuilds = 99
    expect(window.__pbPerf.snapshot().annotation).toEqual(expected)
    const report = window.__pbPerf.report()
    expect(JSON.parse(report.split('\n').find(line => line.startsWith('annotation: ')).slice('annotation: '.length))).toEqual(expected)
    expect(report).toContain('gpu_total_ms: sum of successfully measured render-pass GPU timings')
    expect(stats).toEqual(expected)
  })

  it('keeps the new owner when an older scene is destroyed', () => {
    window.history.replaceState(null, '', '/?perf')
    const first = createScene().api
    const firstHandle = window.__pbPerf
    createScene()
    const secondHandle = window.__pbPerf
    expect(secondHandle).not.toBe(firstHandle)
    first.destroy()
    expect(window.__pbPerf).toBe(secondHandle)
    expect(secondHandle.snapshot().identity.identityComplete).toBe(false)
    expect(secondHandle.snapshot().gpu.status).toBe('not-initialized')
  })

  it('records map ready submission only after an actual render', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    const frame = stubFrames()
    const { api, store } = createScene()
    await api.loadMapOnly({ mapId: 1 })
    expect(store.mapReady).toBe(true)
    expect(window.__pbPerf.snapshot().events.some(e => e.stage === 'firstReadyFrameSubmittedMs')).toBe(false)
    frame()
    const snapshot = window.__pbPerf.snapshot()
    expect(snapshot.events.filter(e => e.stage === 'firstReadyFrameSubmittedMs')).toHaveLength(1)
    // #913 review P2：计时必须传入提交时刻（performance.now()）——durationMs 有限且非负
    for (const e of snapshot.events.filter(e => e.stage === 'firstReadyFrameSubmittedMs')) {
      expect(typeof e.durationMs).toBe('number')
      expect(Number.isFinite(e.durationMs)).toBe(true)
      expect(e.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(snapshot.latest.cpuFrameMs).toBeGreaterThanOrEqual(0)
    expect(snapshot.gpu.status).toBe('unsupported')
  })

  it('records terrain fetch and decode stages for the current map session', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    stubTerrainAssets()
    const { api } = createScene()
    await api.loadMapOnly({ mapId: 1 })
    const events = window.__pbPerf.snapshot().events
    for (const stage of ['terrain.meta.fetch', 'terrain.meta.body-json-aggregate', 'terrain.bin.fetch', 'terrain.bin.body', 'terrain.pair-check-aggregate', 'terrain.decode']) {
      expect(events).toContainEqual(expect.objectContaining({ stage, status: 'complete', durationMs: expect.any(Number) }))
    }
  })

  it('records replay ready submission after rendering, not on load completion', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    const frame = stubFrames()
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['x'], 'x') })
    expect(store.hasData).toBe(true)
    expect(window.__pbPerf.snapshot().events.some(e => e.stage === 'firstReadyFrameSubmittedMs')).toBe(false)
    frame()
    const readyEvents = window.__pbPerf.snapshot().events.filter(e => e.stage === 'firstReadyFrameSubmittedMs')
    expect(readyEvents).toHaveLength(1)
    // #913 review P2：计时必须传入提交时刻（performance.now()）——durationMs 有限且非负
    expect(typeof readyEvents[0].durationMs).toBe('number')
    expect(Number.isFinite(readyEvents[0].durationMs)).toBe(true)
    expect(readyEvents[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('does not attribute an old scene render to a loading session', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    const frame = stubFrames()
    const { api } = createScene()
    await api.loadMapOnly({ mapId: 1 }); frame()
    const pendingLoad = track(deferred())
    source.loadPlaybackData.mockReturnValue(pendingLoad.promise)
    const task = api.loadData({ kind: 'local', file: new File(['x'], 'x') })
    api.setCam('free'); frame()
    const snapshot = window.__pbPerf.snapshot()
    expect(snapshot.sampleCount).toBe(0)
    expect(snapshot.events.filter(e => e.sessionId === snapshot.sessionId && e.stage === 'firstReadyFrameSubmittedMs')).toHaveLength(0)
    api.destroy(); pendingLoad.resolve(null); await task
  })

  it('associates asynchronous GPU results with the submitted frame', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }
    const gl = { QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4,
      getExtension: () => ext, createQuery: () => ({}), beginQuery: vi.fn(), endQuery: vi.fn(),
      deleteQuery: vi.fn(), getParameter: () => false,
      getQueryParameter: (_query, key) => key === 3 ? true : 2000000 }
    vi.spyOn(THREE.WebGLRenderer.prototype, 'getContext').mockReturnValue(gl)
    const frame = stubFrames()
    const { api } = createScene()
    await api.loadMapOnly({ mapId: 1 })
    window.__pbPerf.startCapture({ scenarioId: 'gpu' })
    frame()
    const capture = window.__pbPerf.stopCapture()
    expect(capture.frames[0].gpu_main_ms).toBe(2)
    expect(capture.frames[0].gpu_total_ms).toBe(2)
    expect(gl.beginQuery).toHaveBeenCalledTimes(gl.endQuery.mock.calls.length)
  })

  it('keeps main CPU submission separate from the terrain check', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(THREE.WebGLRenderer.prototype, 'render').mockImplementation(() => { now += 30 })
    const frame = stubFrames()
    const { api } = createScene()
    await api.loadMapOnly({ mapId: 1 }); frame()
    expect(window.__pbPerf.snapshot().latest).toMatchObject({ renderMs: 30, terrainCheckInclusiveMs: 0, cpuFrameMs: 30 })
  })

  it('restores renderer statistics after a render exception', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    const frame = stubFrames()
    const render = vi.spyOn(THREE.WebGLRenderer.prototype, 'render').mockImplementation(() => { throw new Error('render failed') })
    const { api } = createScene()
    await api.loadMapOnly({ mapId: 1 })
    expect(frame).toThrow('render failed')
    expect(render.mock.instances[0].info.autoReset).toBe(true)
  })

  it('starts a fresh interval after even a short idle', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const frame = stubFrames()
    const { api } = createScene()
    await api.loadMapOnly({ mapId: 1 })
    frame()
    now = 150; frame()
    now = 200; api.setCam('free'); frame()
    expect(window.__pbPerf.snapshot().latest.frameIntervalMs).toBeNull()
  })

  it('interrupts capture and clears the window when the session is reset', async () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    const frame = stubFrames()
    const { api } = createScene()
    await api.loadMapOnly({ mapId: 1 })
    window.__pbPerf.startCapture({ scenarioId: 'clear' }); frame()
    api.reset()
    const snapshot = window.__pbPerf.snapshot()
    expect(snapshot.sampleCount).toBe(0)
    expect(snapshot.capture).toMatchObject({ interrupted: true, reason: 'session-reset' })
  })

  it('keeps a capture running when an invalid quality is requested', () => {
    window.history.replaceState(null, '', '/?perf&q=low')
    const { api } = createScene()
    window.__pbPerf.startCapture({ scenarioId: 'quality' })
    api.setQuality('not-a-quality')
    expect(window.__pbPerf.snapshot().capture).toMatchObject({ interrupted: false, reason: null })
  })

  it('cannot start a capture while the scene is suspended', () => {
    window.history.replaceState(null, '', '/?perf')
    const { api } = createScene()
    api.setPaused(true)
    expect(() => window.__pbPerf.startCapture({ scenarioId: 'hidden' })).toThrow()
    expect(window.__pbPerf.snapshot().capture).toBeNull()
  })

  it('does not count a background watchdog gap as a stall', () => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/?perf')
    const { api } = createScene()
    api.setPaused(true)
    vi.advanceTimersByTime(5000)
    api.setPaused(false)
    vi.advanceTimersByTime(50)
    expect(window.__pbPerf.report()).toContain('main-thread stalls >100ms: 0')
    api.destroy()
    vi.useRealTimers()
  })

  it('reports a failed load without exporting its error text', async () => {
    window.history.replaceState(null, '', '/?perf')
    source.loadPlaybackData.mockRejectedValue(new Error('private-path-or-token'))
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['x'], 'x') })
    const events = window.__pbPerf.snapshot().events
    expect(events).toContainEqual(expect.objectContaining({ stage: 'replay.load', status: 'error' }))
    expect(JSON.stringify(events)).not.toContain('private-path-or-token')
  })

  it('ignores loading diagnostics sent after reset or session replacement', async () => {
    window.history.replaceState(null, '', '/?perf')
    const { api } = createScene()
    let observer
    const pendingLoad = track(deferred())
    const session = { loadScene: vi.fn((_file, cb) => { observer = cb; return pendingLoad.promise }), getState: () => null }
    const task = api.loadData({ kind: 'local', file: new File(['x'], 'x'), session })
    observer({ stage: 'first', durationMs: 1 })
    expect(window.__pbPerf.snapshot().events.some(e => e.stage === 'first')).toBe(true)
    window.__pbPerf.reset()
    observer({ stage: 'late', durationMs: 2 })
    expect(window.__pbPerf.snapshot().events.some(e => e.stage === 'late')).toBe(false)
    api.destroy(); pendingLoad.resolve(null); await task
  })
})

describe('playbackScene 会话代数契约', () => {
  it('prepared session feeds scene and Details without another raw parse', async () => {
    const { store, api } = createScene()
    const result = { scenePlayback: minimalData(), canonical: { dataset: { vehicles: [] }, clock: { startRaw: 42 }, reloadTelemetry: null } }
    const session = { loadScene: vi.fn().mockResolvedValue(result.scenePlayback), getState: () => result }
    const file = new File(['x'], 'shared.wotbreplay')
    await api.loadData({ kind: 'local', file, session })
    expect(session.loadScene).toHaveBeenCalledWith(file)
    expect(source.loadPlaybackData).not.toHaveBeenCalled()
    expect(store.hasData).toBe(true)
    expect(store.playbackSession.canonical.dataset).toEqual(result.canonical.dataset)
    expect(store.playbackSession.canonical.clock.startRaw).toBe(42)
    api.reset()
    expect(store.playbackSession).toBeNull()
  })

  it('战斗时间轴 [START, END] 归引擎：从开战开始，seekBy / seekTime / seekFraction 都回不到准备 / 倒计时阶段', async () => {
    const { store, api } = createScene()
    const base = minimalData()
    const data = {
      ...base,
      meta: { ...base.meta, duration: 320 },
      // 准备（42）→ 倒计时（45）→ 开战（55）→ 战后（300）
      periods: [{ clock: 42, period: 1 }, { clock: 45, period: 2 }, { clock: 55, period: 3 }, { clock: 300, period: 4 }],
    }
    const session = { loadScene: vi.fn().mockResolvedValue(data), getState: () => ({ canonical: null, canonicalState: 'idle' }) }
    await api.loadData({ kind: 'local', file: new File(['x'], 'clock.wotbreplay'), session })
    expect(store.startTime).toBe(55)
    expect(store.duration).toBe(300)
    expect(store.time).toBeGreaterThanOrEqual(55)
    expect(store.time).toBeLessThan(56)
    api.setPlaying(false)
    api.seekTime(60)
    api.seekBy(-30)
    expect(store.time).toBe(55)
    api.seekTime(0)
    expect(store.time).toBe(55)
    api.seekFraction(0)
    expect(store.time).toBe(55)
    api.seekFraction(1)
    expect(store.time).toBe(300)
  })

  it('canonical clock 晚到：引擎重定 [START, END]、把 T 夹回范围；撤下后回到场景自推的时钟', async () => {
    const { store, api } = createScene()
    const base = minimalData()
    const data = {
      ...base,
      meta: { ...base.meta, duration: 320 },
      periods: [{ clock: 45, period: 2 }, { clock: 55, period: 3 }, { clock: 300, period: 4 }],
    }
    const session = { loadScene: vi.fn().mockResolvedValue(data), getState: () => ({ canonical: null, canonicalState: 'loading' }) }
    await api.loadData({ kind: 'local', file: new File(['x'], 'late.wotbreplay'), session })
    api.setPlaying(false)
    api.seekTime(55)
    api.setBattleClock({ startRaw: 56, durationSec: 200 })
    expect(store.startTime).toBe(56)
    expect(store.duration).toBe(256)
    expect(store.time).toBe(56)
    api.seekTime(1000)
    expect(store.time).toBe(256)
    api.seekBy(-1000)
    expect(store.time).toBe(56)
    api.seekTime(100)
    api.setBattleClock(null)
    expect(store.startTime).toBe(55)
    expect(store.duration).toBe(300)
    expect(store.time).toBe(100)
  })

  it('3D becomes ready before canonical readiness resolves', async () => {
    const { store, api } = createScene()
    const state = { canonical: null, canonicalState: 'loading' }
    const canonicalPending = track(deferred())
    const session = {
      loadScene: vi.fn().mockResolvedValue(minimalData()),
      loadCanonical: vi.fn(() => canonicalPending.promise),
      getState: () => state,
    }
    await api.loadData({ kind: 'local', file: new File(['x'], 'async.wotbreplay'), session })
    expect(store.hasData).toBe(true)
    expect(store.startTime).toBe(42)
    expect(state.canonicalState).toBe('loading')
    expect(session.loadCanonical).not.toHaveBeenCalled()
    expect(source.loadPlaybackData).not.toHaveBeenCalled()
  })

  it('canonical failure does not block raw 3D playback', async () => {
    const { store, api } = createScene()
    const result = { scenePlayback: minimalData(), canonical: null, canonicalError: new Error('AI failed') }
    const session = { loadScene: vi.fn().mockResolvedValue(result.scenePlayback), getState: () => result }
    await api.loadData({ kind: 'local', file: new File(['x'], 'partial.wotbreplay'), session })
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
    expect(store.playbackSession.canonical).toBeNull()
    expect(source.loadPlaybackData).not.toHaveBeenCalled()
  })

  it('class-icon presentation preserves factual visibility, raycast roots and HP, then restores artwork', async () => {
    const store = createPlaybackStore()
    const overlay = { setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn() }
    api = initPlayback(mountContainer(), store, overlay)
    created.push(api)
    const data = minimalData()
    data.meta.samples = 1
    data.vehicles = [{ eid: 1, account_id: 77, team: 1, is_author: true, nickname: 'Recorder', tank_name: 'Maus', max_hp: 3074,
      pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
      hp: [[42, 2048]], coverage: [42, 100], death_t: null }]
    const session = { loadScene: vi.fn().mockResolvedValue(data), getState: () => ({ canonical: { dataset: { vehicles: [{ accountId: 77, tankClass: 'Heavy tank' }] } } }) }
    await api.loadData({ kind: 'local', file: new File(['replay'], 'icons.wotbreplay'), session })
    api.setPlaying(false)
    const vehicle = window.__pbV[0]
    const beforeHp = store.roster.team1[0].hp
    const beforePosition = vehicle.group.position.clone()
    expect(vehicle.meshHull.visible).toBe(true)
    expect(overlay.setLabels.mock.calls.at(-1)[0][0].tankClass).toBe('Heavy tank')
    api.setLabelPrefs({ classIcons: true, showStatus: false })
    expect(vehicle.group.visible).toBe(true)
    expect(vehicle.group.position.equals(beforePosition)).toBe(true)
    expect(vehicle.group.children.every(child => !child.visible)).toBe(true)
    vehicle.group.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, -1, 0))
    expect(ray.intersectObjects([vehicle.group], true).length).toBeGreaterThan(0)
    expect(store.roster.team1[0].hp).toBe(beforeHp)
    api.setLabelPrefs({ enabled: false, classIcons: true, showStatus: false })
    expect(vehicle.meshHull.visible).toBe(true)
    api.setLabelPrefs({ classIcons: false, showStatus: true })
    expect(vehicle.group.children.every(child => child.visible)).toBe(true)
    api.seekTime(60)
    expect(vehicle.meshHull.visible).toBe(true)
    expect(vehicle.group.visible).toBe(true)
    api.setLabelPrefs({ classIcons: true, showStatus: false })
    api.reset()
    await api.loadData({ kind: 'local', file: new File(['next'], 'next.wotbreplay'), session })
    const nextVehicle = window.__pbV[0]
    expect(nextVehicle).not.toBe(vehicle)
    expect(nextVehicle.group.visible).toBe(true)
    expect(nextVehicle.group.children.every(child => !child.visible)).toBe(true)
    api.setLabelPrefs({ classIcons: false, showStatus: true })
    expect(nextVehicle.meshHull.visible).toBe(true)
    expect(store.hasData).toBe(true)
  })

  it('3D 名牌的定时消耗品徽标直接消费 facet 事件（active 剩余秒 / 未激活为空）', async () => {
    const store = createPlaybackStore()
    const overlay = { setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn() }
    api = initPlayback(mountContainer(), store, overlay)
    created.push(api)
    const data = minimalData()
    data.meta.samples = 1
    data.meta.duration = 100
    data.vehicles = [{ eid: 1, account_id: 77, team: 1, is_author: true, nickname: 'Recorder', tank_name: 'Maus', max_hp: 3074,
      pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
      hp: [[42, 2048]], coverage: [42, 100], death_t: null }]
    // AoI 两段：离开期间状态未知；重入不得复活离开前的激活
    data.visibility = [{ eid: 1, t_in: 42, t_out: 60 }, { eid: 1, t_in: 65, t_out: 100 }]
    // Playback facet 原始形状：snake_case + 数字 state；3D 的 T 与 clock 同 base。
    data.consumables = [
      { clock: 50, eid: 1, wire_code: 9, state: 2, state_name: 'ACTIVATED',
        duration_s: 20, ends_at: 70, ever_activated: true, slot: 0, logical_item_id: 'ADRENALINE' },
      { clock: 70, eid: 1, wire_code: 9, state: 2, state_name: 'ACTIVATED',
        duration_s: 20, ends_at: 90, ever_activated: true, slot: 0, logical_item_id: 'ADRENALINE' },
    ]
    const session = { loadScene: vi.fn().mockResolvedValue(data), getState: () => ({ canonical: null }) }
    await api.loadData({ kind: 'local', file: new File(['replay'], 'consumable.wotbreplay'), session })
    api.setPlaying(false)
    api.seekTime(55)
    expect(overlay.setLabels.mock.calls.at(-1)[0][0].consumables).toEqual([{
      slot: 0, logicalItemId: 'ADRENALINE', wireCode: 9, remainingSec: 15, durationSec: 20,
    }])
    api.seekTime(66)
    // 重入（65）后：离开前的激活（50–70）不得复活；新的激活（70）尚未发生
    expect(overlay.setLabels.mock.calls.at(-1)[0][0].consumables).toEqual([])
    api.seekTime(75)
    expect(overlay.setLabels.mock.calls.at(-1)[0][0].consumables).toEqual([{
      slot: 0, logicalItemId: 'ADRENALINE', wireCode: 9, remainingSec: 15, durationSec: 20,
    }])
    api.seekTime(45)
    expect(overlay.setLabels.mock.calls.at(-1)[0][0].consumables).toEqual([])
  })

  it('a late GLB obeys class-icon mode during attach, seek and restoration', async () => {
    window.history.replaceState(null, '', '/?debug&q=mid')
    const parked = track(deferred())
    vi.spyOn(assetProvider, 'bytes').mockImplementation(() => parked.promise)
    vi.spyOn(assetProvider, 'json').mockImplementation((path) => Promise.resolve(
      String(path).startsWith('/tank/')
        ? { model_origins: { track: { x: 0, y: 0, z: 0 }, turret: { x: 0, y: 0, z: 0 } }, configs: [] }
        : null))
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const turretNode = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    turretNode.name = 'turret_0'
    model.add(turretNode)
    const gunNode = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    gunNode.name = 'gun_0'
    model.add(gunNode)
    vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, _path, onLoad) => onLoad({ scene: model }))
    const data = minimalData()
    data.meta.samples = 1
    data.vehicles = [{ eid: 1, tank_id: 6929, team: 1, tank_name: 'Maus', max_hp: 3074,
      pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
      hp: [], coverage: [42, 100], death_t: null }]
    source.loadPlaybackData.mockResolvedValue(data)
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['model'], 'glb.wotbreplay') })
    api.setPlaying(false)
    api.setGlb(true)
    api.setLabelPrefs({ classIcons: true, showStatus: false })
    parked.resolve(new Uint8Array())
    await vi.waitFor(() => expect(window.__pbV[0].glb).toBeTruthy())
    const vehicle = window.__pbV[0]
    expect(vehicle.glb.visible).toBe(false)
    expect(vehicle.meshHull.visible).toBe(false)
    api.seekTime(60)
    expect(vehicle.glb.visible).toBe(false)
    api.setLabelPrefs({ classIcons: false, showStatus: true })
    expect(vehicle.glb.visible).toBe(true)
    expect(vehicle.meshHull.visible).toBe(false)
    api.setGlb(false)
    expect(vehicle.meshHull.visible).toBe(true)
  })

  it('履带印游标泵：seek 后退 = 全量重建、前进 = 增量，深浅/存量无残留（用户验收项）', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const { store, api } = createScene()
    const t0 = 42, n = 580
    const pos = new Array(n * 3)
    for (let i = 0; i < n; i++) { pos[i * 3] = i * 0.5; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0 }
    const data = minimalData(t0)
    data.meta.samples = n
    data.meta.duration = t0 + 58
    data.vehicles = [{ eid: 1, team: 1, tank_name: 'Maus', max_hp: 3074,
      pos, hull_yaw: new Array(n).fill(0), hull_pitch: new Array(n).fill(0),
      turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0),
      hp: [], coverage: [t0, t0 + 58], death_t: null }]
    vi.spyOn(assetProvider, 'json').mockImplementation((path) =>
      Promise.resolve(String(path) === '/tread/textures.json' ? {} : null))
    vi.spyOn(assetProvider, 'url').mockImplementation((path) => 'http://assets.test' + path)
    source.loadPlaybackData.mockResolvedValue(data)
    await api.loadData({ kind: 'local', file: new File(['replay'], 'trail.wotbreplay') })
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 6; i++) await Promise.resolve()
    api.setPlaying(false)
    // 客户端槽位模型：环 50 槽/侧（**含活戳**，覆写最老）+ 固定绘制窗口
    // （TRAIL_SLOTS = 50×2 = 100 个四边形，无效槽由显式隐藏处理）
    const readTrail = () => {
      const v = window.__pbV[0]
      const col = v.treadMesh ? v.treadMesh.geometry.getAttribute('color').array : null
      return {
        builtT: v.trail.builtT, total: v.trail.L.total, rTotal: v.trail.R.total,
        live: v.trail.L.segs.length,       // 环内活戳数 = min(total, 50)
        quads: v.treadMesh ? v.treadMesh.geometry.drawRange.count / 6 : 0,
        youngAlpha: (col && v.trail.L.total > 0) ? +col[((v.trail.L.total - 1) % 50) * 32 + 3].toFixed(2) : 'none',
        oldAlpha: (col && v.trail.L.total > 0) ? +col[3].toFixed(2) : 'none',
      }
    }
    api.seekTime(t0 + 18)
    let r = readTrail()
    // 落锚每 1 m 一戳（0.2 s/戳）：18 s → 90 戳；环只保留最近 50
    expect(r).toMatchObject({ builtT: t0 + 18, total: 90, rTotal: 90, live: 50, quads: 100 })
    expect(r.youngAlpha).toBeCloseTo(1)   // 客户端口径：无全局压暗（texScale 表 stub 为空 ⇒ 1.0）
    api.seekTime(t0 + 8)
    r = readTrail()
    expect(r).toMatchObject({ builtT: t0 + 8, total: 40, rTotal: 40, live: 40, quads: 100 })
    api.seekTime(t0 + 28)
    r = readTrail()
    expect(r).toMatchObject({ builtT: t0 + 28, total: 140, rTotal: 140, live: 50, quads: 100 })
    expect(r.oldAlpha).toBe(0)          // 环里最老戳（出生 20 s 前）早已出淡出窗（≤7.62 s）
    expect(r.youngAlpha).toBeCloseTo(1)   // 客户端口径：无全局压暗（texScale 表 stub 为空 ⇒ 1.0）
    api.seekTime(t0 + 55)
    r = readTrail()
    expect(r.builtT).toBe(t0 + 55)
    expect(r.total).toBe(275)
    expect(r.rTotal).toBe(275)
  })

  it('履带印 AoI 空洞断链：历史印记保留、出空洞从新锚开始且无跨空洞桥接（review blocker 回归，2026-10-11）', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const { api } = createScene()
    const t0 = 42, n = 150
    const pos = new Array(n * 3)
    for (let i = 0; i < n; i++) { pos[i * 3] = i * 0.5; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0 }
    const data = minimalData(t0)
    data.meta.samples = n
    data.meta.duration = t0 + 15
    data.vehicles = [{ eid: 1, team: 1, tank_name: 'Maus', max_hp: 3074,
      pos, hull_yaw: new Array(n).fill(0), hull_pitch: new Array(n).fill(0),
      turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0),
      hp: [], coverage: [t0, t0 + 5, t0 + 10, t0 + 15], death_t: null }]
    vi.spyOn(assetProvider, 'json').mockImplementation((path) =>
      Promise.resolve(String(path) === '/tread/textures.json' ? {} : null))
    vi.spyOn(assetProvider, 'url').mockImplementation((path) => 'http://assets.test' + path)
    source.loadPlaybackData.mockResolvedValue(data)
    await api.loadData({ kind: 'local', file: new File(['replay'], 'gap.wotbreplay') })
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 6; i++) await Promise.resolve()
    api.setPlaying(false)
    const gapStart = t0 + 5, gapEnd = t0 + 10
    const read = () => {
      const v = window.__pbV[0]
      return { total: v.trail.L.total,
               segs: v.trail.L.segs.map((sg) => ({ x0: sg.x0, x1: sg.x1, t: sg.t })) }
    }
    api.seekTime(t0 + 4)
    const before = read()
    expect(before.total).toBeGreaterThan(10)
    api.seekTime(t0 + 11)
    const r = read()
    expect(r.total).toBeGreaterThan(before.total)
    expect(r.segs.slice(0, before.total)).toEqual(before.segs)   // 历史段逐值保留
    // 空洞本身零出戳（跨空洞不连铺的最小不变量：没有任何戳出生在洞内）
    expect(r.segs.every((sg) => !(sg.t > gapStart && sg.t < gapEnd))).toBe(true)
    // ⚠️ 洞前尾巴（seek 目标 t0+4 → 空洞起点 t0+5 之间仍可见的 1 s）也出生在空洞之前，
    // 不能按 `slice(before.total)` 计数切进"洞后"桶——before 是在 t0+4 取的，尾巴在它之后
    // 才铺出来。按**出生时刻**过滤：< gapEnd = 洞前（含尾巴），≥ gapEnd = 洞后新锚段。
    const tail = r.segs.slice(before.total).filter((sg) => sg.t < gapEnd)
    const postGap = r.segs.slice(before.total).filter((sg) => sg.t >= gapEnd)
    expect(tail.length).toBeGreaterThanOrEqual(4)               // t0+4→t0+5 的 5 m ≈ 5 戳
    expect(tail.length).toBeLessThanOrEqual(6)
    const tailAbs = tail.map((sg) => Math.abs(sg.x0))
    expect(Math.min(...tailAbs)).toBeGreaterThan(19)            // 路径 21~25 m（L 带 +0.9 横偏）
    expect(Math.max(...tailAbs)).toBeLessThan(25)
    expect(postGap.length).toBeGreaterThanOrEqual(3)            // 洞后 1 s：锚点 + ~5 戳
    expect(postGap.length).toBeLessThanOrEqual(8)
    for (const sg of r.segs) expect(Math.abs(sg.x1 - sg.x0)).toBeLessThanOrEqual(1.1)   // 无长桥接戳
    for (const sg of postGap) expect(Math.abs(sg.x0)).toBeGreaterThan(45)
    const minPostGapAbs = Math.min(...postGap.map((sg) => Math.abs(sg.x0)))
    expect(minPostGapAbs).toBeLessThan(51)
    expect(minPostGapAbs).toBeGreaterThan(48.5)
  })

  it('履带印阵亡期断链：复活落在新位置时不与死前锚连铺（3.1.0 review P2，issue #622）', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const { api } = createScene()
    const t0 = 42, n = 150          // 15 s；步长 0.5 m/0.1 s
    // 阵亡期（t0+5 → t0+10）位姿仍在缓慢移动（渐进复活迁移）：每步 0.5 m 走不出大步断链阈值，
    // 若阵亡期只是跳过出戳而不复位锚点，复活后的首个接地点会与死前锚连铺出一条跨 25 m 的印记。
    const pos = new Array(n * 3)
    for (let i = 0; i < n; i++) { pos[i * 3] = i * 0.5; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0 }
    const data = minimalData(t0)
    data.meta.samples = n
    data.meta.duration = t0 + 15
    data.vehicles = [{ eid: 1, team: 1, tank_name: 'Maus', max_hp: 3074,
      pos, hull_yaw: new Array(n).fill(0), hull_pitch: new Array(n).fill(0),
      turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0),
      hp: [], coverage: [t0, t0 + 15], death_t: t0 + 5, resurrection_times: [t0 + 10] }]
    vi.spyOn(assetProvider, 'json').mockImplementation((path) =>
      Promise.resolve(String(path) === '/tread/textures.json' ? {} : null))
    vi.spyOn(assetProvider, 'url').mockImplementation((path) => 'http://assets.test' + path)
    source.loadPlaybackData.mockResolvedValue(data)
    await api.loadData({ kind: 'local', file: new File(['replay'], 'respawn-trail.wotbreplay') })
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 6; i++) await Promise.resolve()
    api.setPlaying(false)
    const read = () => {
      const v = window.__pbV[0]
      return { total: v.trail.L.total,
               segs: v.trail.L.segs.map((sg) => ({ x0: sg.x0, x1: sg.x1, t: sg.t })) }
    }
    api.seekTime(t0 + 4)
    const before = read()
    expect(before.total).toBeGreaterThan(10)
    api.seekTime(t0 + 11)
    const r = read()
    expect(r.total).toBeGreaterThan(before.total)
    expect(r.segs.slice(0, before.total)).toEqual(before.segs)   // 历史段逐值保留
    // 阵亡期零出戳（没有任何戳出生在阵亡区间内）
    expect(r.segs.every((sg) => !(sg.t > t0 + 5 && sg.t < t0 + 10))).toBe(true)
    // 无跨阵亡期桥接：死前锚在 x≈25、复活首点在 x≈50 —— 有 bug 时这里会出现一条 25 m 长戳
    for (const sg of r.segs) expect(Math.abs(sg.x1 - sg.x0)).toBeLessThanOrEqual(1.1)
    const post = r.segs.slice(before.total).filter((sg) => sg.t >= t0 + 10)
    expect(post.length).toBeGreaterThanOrEqual(3)                // 复活后 1 s：锚点 + ~5 戳
    expect(post.length).toBeLessThanOrEqual(8)
    expect(Math.min(...post.map((sg) => Math.abs(sg.x0)))).toBeGreaterThan(48.5)   // 新锚从复活位姿开始
  })

  describe('履带印 review 回归', () => {
    async function setupTrail({ n = 580, pos, hull_yaw, yaw = 0, duration = 58 }) {
      window.history.replaceState(null, '', '/?debug&q=high')
      const { store, api } = createScene()
      const data = minimalData(42)
      data.meta.samples = n
      data.meta.duration = 42 + duration
      data.vehicles = [{ eid: 1, team: 1, tank_name: 'Maus', max_hp: 3074,
        pos, hull_yaw: hull_yaw || new Array(n).fill(yaw), hull_pitch: new Array(n).fill(0),
        turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0),
        hp: [], coverage: [42, 42 + duration], death_t: null }]
      vi.spyOn(assetProvider, 'json').mockImplementation((path) =>
        Promise.resolve(String(path) === '/tread/textures.json' ? {} : null))
      vi.spyOn(assetProvider, 'url').mockImplementation((path) => 'http://assets.test' + path)
      source.loadPlaybackData.mockResolvedValue(data)
      await api.loadData({ kind: 'local', file: new File(['replay'], 'tread-review.wotbreplay') })
      await new Promise((r) => setTimeout(r, 0))
      for (let i = 0; i < 6; i++) await Promise.resolve()
      api.setPlaying(false)
      return { store, api, v: window.__pbV[0] }
    }
    const linePos = (n) => {
      const p = new Array(n * 3)
      for (let i = 0; i < n; i++) { p[i * 3] = i * 0.5; p[i * 3 + 1] = 0; p[i * 3 + 2] = 0 }
      return p
    }
    const normalY = (mesh, st, quad) => {
      const p = mesh.geometry.getAttribute('position').array
      const o = ((st.total - 1) % 1536) * 24 + quad * 12
      const ax = p[o + 3] - p[o], az = p[o + 5] - p[o + 2]
      const bx = p[o + 6] - p[o], bz = p[o + 8] - p[o + 2]
      return az * bx - ax * bz
    }
    const raycastFromAbove = (mesh, st, quad) => {
      const p = mesh.geometry.getAttribute('position').array
      const o = ((st.total - 1) % 1536) * 24 + quad * 12
      let sx = 0, sz = 0
      for (let q = 0; q < 4; q++) { sx += p[o + q * 3]; sz += p[o + q * 3 + 2] }
      mesh.updateMatrixWorld(true)
      const ray = new THREE.Raycaster(new THREE.Vector3(sx / 4, 50, sz / 4), new THREE.Vector3(0, -1, 0))
      return ray.intersectObject(mesh, false).length
    }

    it('倒车印记可见：绕序翻转的戳在双面材质下仍被从上方的射线命中（review P2 2026-10-11）', async () => {
      const fwd = await setupTrail({ n: 200, pos: linePos(200), yaw: Math.PI / 2 })
      fwd.api.seekTime(42 + 10)
      expect(fwd.v.treadMesh.material.side).toBe(THREE.DoubleSide)
      expect(normalY(fwd.v.treadMesh, fwd.v.trail.L, 0)).toBeGreaterThan(0)
      expect(raycastFromAbove(fwd.v.treadMesh, fwd.v.trail.L, 0)).toBeGreaterThan(0)
      const rev = await setupTrail({ n: 200, pos: linePos(200), yaw: -Math.PI / 2 })
      rev.api.seekTime(42 + 10)
      expect(rev.v.treadMesh.material.side).toBe(THREE.DoubleSide)
      expect(normalY(rev.v.treadMesh, rev.v.trail.L, 0)).toBeLessThan(0)
      expect(raycastFromAbove(rev.v.treadMesh, rev.v.trail.L, 0)).toBeGreaterThan(0)
    })

    it('转弯：左右弧长不同（L≠R）各自独立；固定绘制窗口 + 环外空槽显式隐藏（客户端槽位模型）', async () => {
      // 圆轨迹半径 5 m、ω=1 rad/s（中心 5 m/s）：外侧履带 5.9 m/s、内侧 4.1 m/s ⇒ 18 s 后
      // 两侧落锚数差 ≈32（左右弧长不同是常态：不能假设成对，也不按 min/max 互相截断——
      // 绘制窗口现为固定全槽位 + 无效槽显式隐藏）。
      const n = 580
      const pos = new Array(n * 3), yaw = new Array(n)
      for (let i = 0; i < n; i++) {
        const th = i * 0.1
        pos[i * 3] = 5 * Math.sin(th); pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 5 - 5 * Math.cos(th)
        yaw[i] = Math.PI / 2 - th
      }
      const { api, v } = await setupTrail({ n, pos, hull_yaw: yaw })
      const colArr = () => v.treadMesh.geometry.getAttribute('color').array
      api.seekTime(42 + 18)
      const L18 = v.trail.L.total, R18 = v.trail.R.total
      expect(Math.abs(L18 - R18)).toBeGreaterThanOrEqual(2)          // 弧长差 ⇒ 落锚数不同
      expect(v.treadMesh.geometry.drawRange.count / 6).toBe(100)     // TRAIL_SLOTS（50×2，含活戳）
      // 两侧最新戳都在窗口内且可见（固定窗口不再互相截断）
      expect(colArr()[((L18 - 1) % 50) * 32 + 0 + 3]).toBeGreaterThan(0)
      expect(colArr()[((R18 - 1) % 50) * 32 + 16 + 3]).toBeGreaterThan(0)
      // 先跑更长一轮（环写满），再 seek 后退全量重建：环外空槽（k ∈ [total, 50)）里残留的
      // 旧戳必须被显式清零——不靠"位置全零即退化"的偶然
      api.seekTime(42 + 40)
      expect(v.trail.L.total).toBeGreaterThan(50)
      expect(v.trail.R.total).toBeGreaterThan(50)
      api.seekTime(42 + 2)
      expect(v.trail.L.total).toBeLessThan(50)                       // 环未满：存在"应清空"的槽
      for (const [st, quad] of [[v.trail.L, 0], [v.trail.R, 1]]) {
        for (let k = st.total; k < 50; k++) {
          // 活戳槽（= total % 50）可能持有正在拉伸的活戳（alpha>0）——跳过
          if (k === st.total % 50) continue
          expect(colArr()[(k % 50) * 32 + quad * 16 + 3]).toBe(0)
        }
        expect(colArr()[((st.total - 1) % 50) * 32 + quad * 16 + 3]).toBeGreaterThan(0)
      }
    })

    it('前沿跟随：活戳槽末端 = 车辆当前车位（客户端每帧重发同款；滞后 ≤ 一个网格步）', async () => {
      const { api, v } = await setupTrail({ n: 580, pos: linePos(580), yaw: Math.PI / 2 })
      api.seekTime(42 + 10.1)
      const posAttr = v.treadMesh.geometry.getAttribute('position').array
      const col = v.treadMesh.geometry.getAttribute('color').array
      const g = v.group.position
      // L 活戳槽 = write 槽（total % 50，交错槽：L 偶）位置偏移 = (total%50)*24
      const o = (v.trail.L.total % 50) * 24
      const midX = (posAttr[o + 2 * 3] + posAttr[o + 3 * 3]) / 2      // 远端横截面两点中点
      const midZ = (posAttr[o + 2 * 3 + 2] + posAttr[o + 3 * 3 + 2]) / 2
      // yaw=π/2 ⇒ 前向 = −x、L 横向 = +z（trailHalfGauge 回落 0.9）
      expect(Math.hypot(midX - g.x, midZ - (g.z + 0.9))).toBeLessThanOrEqual(0.55)
      expect(col[(v.trail.L.total % 50) * 32 + 3]).toBeGreaterThan(0) // 活戳可见（新鲜）
    })

    it('关断重开：路径态与游标一起复位——同 T 的段数不翻倍（review P2 2026-10-11）', async () => {
      const { store, api, v } = await setupTrail({ n: 580, pos: linePos(580) })
      api.seekTime(42 + 12)
      const count = v.trail.L.total
      expect(count).toBe(60)
      const segs = v.trail.L.segs.map((s) => ({ ...s }))
      api.setTreadMarks(false)
      api.seekTime(42 + 12)
      api.setTreadMarks(true)
      api.seekTime(42 + 12)
      expect(store.treadOn).toBe(true)
      expect(v.trail.L.total).toBe(count)
      expect(v.trail.R.total).toBe(count)
      expect(v.trail.L.segs.map((s) => ({ ...s }))).toEqual(segs)
    })

    it('暂停态开关立即生效：不依赖继续播放或 seek（review P2 2026-10-11）', async () => {
      const { api, v } = await setupTrail({ n: 580, pos: linePos(580) })
      api.seekTime(42 + 10)
      expect(v.treadMesh.visible).toBe(true)
      expect(v.trail.L.total).toBe(50)
      api.setTreadMarks(false)
      expect(v.treadMesh.visible).toBe(false)
      api.setTreadMarks(true)
      expect(v.treadMesh.visible).toBe(true)
      expect(v.trail.L.total).toBe(50)
    })

    it('宽度晚到：suspension（GLB）就位后未 authored 宽度重解析并全量重建（review P2 2026-10-11）', async () => {
      const { api, v } = await setupTrail({ n: 580, pos: linePos(580), yaw: Math.PI / 2 })
      api.seekTime(42 + 10)
      expect(v.tread.width).toBeCloseTo(0.6)
      v.suspParts = { sides: { L: { beltW: 1.2, halfW: 0.7 }, R: { beltW: 1.2, halfW: 0.7 } } }
      api.seekTime(42 + 11)
      expect(v.tread.width).toBeCloseTo(1.2)
      expect(v.trail.L.total).toBe(55)
      const p = v.treadMesh.geometry.getAttribute('position').array
      const zs = [0, 1, 2, 3].map((q) => +p[q * 3 + 2].toFixed(6)).sort((a, b) => a - b)
      expect(zs).toEqual([0.1, 0.1, 1.3, 1.3])
    })

    it('喂样确定性：一次 seek 与 60fps 连续推进到同一终点逐值一致（review P2 2026-10-11）', async () => {
      const grab = (v) => ({ L: v.trail.L.segs.map((s) => ({ ...s })),
                             R: v.trail.R.segs.map((s) => ({ ...s })) })
      const once = await setupTrail({ n: 580, pos: linePos(580), yaw: Math.PI / 2 })
      once.api.seekTime(42 + 18)
      const oneShot = grab(once.v)
      const pump = await setupTrail({ n: 580, pos: linePos(580), yaw: Math.PI / 2 })
      for (let i = 1; i <= 1080; i++) pump.api.seekTime(42 + i / 60)
      const pumped = grab(pump.v)
      expect(pumped.L.length).toBe(oneShot.L.length)
      expect(pumped).toEqual(oneShot)
    })

    it('环满边界：open 未激活时 write 槽继续显示最老 committed（review 七轮 P2）', async () => {
      // 12 m/s：0.1 s 网格片走 1.2 m（子步 0.6 m），每片落 1 戳；5.0 s 恰好 50 戳。
      // 此时最老戳 age≈4.9 s < 5.45 s，alpha 必须仍为满值——避免旧测试在 5 m/s 下
      // oldest 已 >7.62 s、正确自然淡出和错误 hideQuads 都等于 0 的假绿。
      const n = 580
      const pos = new Array(n * 3)
      for (let i = 0; i < n; i++) {
        pos[i * 3] = i * 1.2
        pos[i * 3 + 1] = 0
        pos[i * 3 + 2] = 0
      }
      const { api, v } = await setupTrail({ n, pos, yaw: Math.PI / 2 })
      const alphaAt = (slot) => v.treadMesh.geometry.getAttribute('color').array[slot * 32 + 3]
      const freshAlpha = () => Math.fround(v.tread.texScale || 1)

      // 第 50 次提交后：ring 满、下一 active 尚未激活，slot0 仍属于最老 committed。
      api.seekTime(42 + 5.0)
      expect(v.trail.L.total).toBe(50)
      expect(v.trail.L.open).toBeNull()
      expect(alphaAt(0)).toBe(freshAlpha())

      // 不足完整 0.1 s 网格片：状态不推进，ownership 也不能提前切走。
      api.seekTime(42 + 5.05)
      expect(v.trail.L.total).toBe(50)
      expect(v.trail.L.open).toBeNull()
      expect(alphaAt(0)).toBe(freshAlpha())

      // 下一完整网格片内 active 先激活、随后第 51 次落锚；落锚后 write=slot1、open=null。
      // slot1 此时是新的最老 committed，必须继续显示；旧实现的尾部 else hideQuads
      // 会把它清成 0，正好由这一断言抓住。
      api.seekTime(42 + 5.1)
      expect(v.trail.L.total).toBe(51)
      expect(v.trail.L.open).toBeNull()
      expect(alphaAt(1)).toBe(freshAlpha())
    })

    it('alpha 量化门控：时钟不变的重复 tick 不再标脏重传（review P3 2026-10-11）', async () => {
      const { api, v } = await setupTrail({ n: 580, pos: linePos(580) })
      api.seekTime(42 + 10)
      const version = () => v.treadMesh.geometry.getAttribute('color').version
      const v1 = version()
      api.seekTime(42 + 10)
      expect(version()).toBe(v1)
      api.seekTime(42 + 11)
      expect(version()).toBeGreaterThan(v1)
    })
  })

  it('高/极致画质档强制 GLB：setGlb(false) 被忽略、开关停用（2026-10-11 裁示）', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const { store, api } = createScene()
    const data = minimalData()
    data.meta.samples = 1
    data.vehicles = [{ eid: 1, team: 1, tank_name: 'Maus', max_hp: 3074,
      pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
      hp: [], coverage: [42, 100], death_t: null }]
    source.loadPlaybackData.mockResolvedValue(data)
    await api.loadData({ kind: 'local', file: new File(['replay'], 'forced.wotbreplay') })
    expect(store.glbOn).toBe(true)
    expect(store.glbAllowed).toBe(false)
    expect(store.treadAllowed).toBe(true)
    api.setGlb(false)
    expect(store.glbOn).toBe(true)
    window.history.replaceState(null, '', '/?debug&q=low')
    const store2 = createPlaybackStore()
    const api2 = initPlayback(mountContainer(), store2, { setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn() })
    created.push(api2)
    await api2.loadData({ kind: 'local', file: new File(['replay'], 'low.wotbreplay'), session: { loadScene: vi.fn().mockResolvedValue(data), getState: () => ({ canonical: null }) } })
    expect(store2.treadAllowed).toBe(false)
  })

  it('战场标签使用回放 nickname 字段', async () => {
    const store = createPlaybackStore()
    const overlay = { setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn() }
    api = initPlayback(mountContainer(), store, overlay)
    created.push(api)
    const data = minimalData()
    data.meta.samples = 1
    data.vehicles = [{ eid: 1, team: 1, nickname: 'Recorder昵称', tank_name: 'Maus', max_hp: 3074,
      pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
      hp: [], coverage: [42, 100], death_t: null }]
    source.loadPlaybackData.mockResolvedValue(data)
    await api.loadData({ kind: 'local', file: new File(['replay'], 'names.wotbreplay') })
    expect(store.error).toBeFalsy()
    expect(overlay.setLabels).toHaveBeenCalled()
    expect(overlay.setLabels.mock.calls.at(-1)[0][0].playerName).toBe('Recorder昵称')
  })

  it('同一 scene 上接受新文件后：旧加载迟到完成不得清掉新加载的 loading', async () => {
    const { store, api } = createScene()
    const first = track(deferred())
    const second = track(deferred())
    source.loadPlaybackData
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    const loadB = api.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    first.reject(new Error('stale A failed'))
    await loadA
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.err).toBe('')
    second.reject(new Error('B failed'))
    await loadB
    expect(store.loading).toBe(false)
    expect(store.hasData).toBe(false)
    expect(store.err).toContain('B failed')
  })

  it('新 loadData 被接受的那一刻即落下就绪态（解析/资产阶段的旧 UI 不得仍是 ready）', async () => {
    const { store, api } = createScene()
    source.loadPlaybackData.mockImplementation(() => new Promise(() => {}))
    expect(store.hasData).toBe(false)
    void api.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
  })

  it('teardown（destroy）落下就绪态：会话终止后不得继续自称已就绪', () => {
    const { store, api } = createScene()
    store.hasData = true
    store.loading = false
    api.destroy()
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
  })
})

describe('playbackScene 被销毁实例不得再写共享 store', () => {
  it('destroy A → init B（同一 store）→ A 迟到结束：不得清 B 的 loading / 不得写 B 的 err', async () => {
    const store = createPlaybackStore()
    const lateA = track(deferred())
    source.loadPlaybackData
      .mockImplementationOnce(() => lateA.promise)
      .mockImplementationOnce(() => new Promise(() => {}))
    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)
    apiA.destroy()
    const apiB = createInstance(store)
    void apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    api = apiB
    lateA.reject(new Error('stale A after destroy'))
    await loadA
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.err).toBe('')
  })

  it('destroy A → init B → A 迟到「成功」：不得把 B 的就绪态/播放态写坏', async () => {
    const store = createPlaybackStore()
    const lateA = track(deferred())
    source.loadPlaybackData
      .mockImplementationOnce(() => lateA.promise)
      .mockImplementationOnce(() => new Promise(() => {}))
    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    apiA.destroy()
    const apiB = createInstance(store)
    void apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    api = apiB
    lateA.resolve(minimalData())
    await loadA
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.playing).toBe(false)
    expect(store.err).toBe('')
  })
})

describe('playbackScene 资产阶段过期续体', () => {
  it.each(['same instance', 'destroy and recreate'])('A 的内部地图解析不得改写 B（%s）', async (mode) => {
    const store = createPlaybackStore()
    source.loadPlaybackData
      .mockImplementationOnce(() => Promise.resolve(minimalData(917, 'map_a')))
      .mockImplementationOnce(() => Promise.resolve(minimalData(431, 'map_b')))
      .mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    const parkedA = track(deferred())
    source.resolveMapKey
      .mockResolvedValueOnce('map_a')
      .mockImplementationOnce(() => parkedA.promise)
      .mockResolvedValue('map_b')
    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    await vi.waitFor(() => expect(source.resolveMapKey).toHaveBeenCalledTimes(2))
    expect(store.assetStage).toBe(true)
    expect(store.loading).toBe(true)
    if (mode === 'destroy and recreate') apiA.destroy()
    const apiB = mode === 'same instance' ? apiA : createInstance(store)
    await apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.mapName).toBe('map_b')
    expect(store.startTime).toBe(431)
    expect(store.mapKey).toBe('map_b')
    expect(store.hasData).toBe(true)
    parkedA.resolve('map_a')
    await loadA
    expect(store.mapName).toBe('map_b')
    expect(store.startTime).toBe(431)
    expect(store.mapKey).toBe('map_b')
    expect(store.hasData).toBe(true)
  })

  it('未过期时资产阶段正常收尾（守住修复没有把正常路径一起关掉）', async () => {
    const store = createPlaybackStore()
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData()))
    source.resolveMapKey.mockImplementation(() => Promise.resolve(null))
    const only = createInstance(store)
    api = only
    await only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(false)
    expect(store.hasData).toBe(true)
    expect(store.startTime).toBe(42)
  })

  it('会话作废后 startPlayback 尾部不得启动播放（不写 mapName / startTime / playing）', async () => {
    const store = createPlaybackStore()
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    const parked = track(deferred())
    source.resolveMapKey
      .mockResolvedValueOnce('map_a')
      .mockImplementationOnce(() => parked.promise)
      .mockResolvedValue(null)
    const only = createInstance(store)
    api = only
    const load = only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    await vi.waitFor(() => expect(source.resolveMapKey).toHaveBeenCalledTimes(2))
    expect(store.assetStage).toBe(true)
    expect(store.mapName).toBe('map_a')
    only.destroy()
    const epochBefore = store.startTime
    parked.resolve('map_a')
    await load
    expect(store.startTime).toBe(epochBefore)
    expect(store.playing).toBe(false)
    expect(store.hasData).toBe(false)
  })
})

describe('playbackScene reset：撤下当前回放', () => {
  it('解析途中撤下：迟到解析不得落成会话，也不得把 DATA 留给下一场', async () => {
    const store = createPlaybackStore()
    const late = track(deferred())
    source.loadPlaybackData.mockImplementationOnce(() => late.promise)
    const only = createInstance(store)
    api = only
    const load = only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)
    only.reset()
    expect(store.loading).toBe(false)
    expect(store.hasData).toBe(false)
    late.resolve(minimalData(917, 'map_a'))
    await load
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.mapName).toBe('')
    expect(store.startTime).toBe(0)
    expect(store.err).toBe('')
    expect(store.qualityKey).toBe('low')
    only.setQuality('mid')
    expect(store.qualityKey).toBe('mid')
  })

  it('资产途中撤下：迟到续体不得触场景，也不得把内部异常当「加载失败」写给用户', async () => {
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    const parked = track(deferred())
    source.resolveMapKey
      .mockResolvedValueOnce('map_a')
      .mockImplementationOnce(() => parked.promise)
      .mockResolvedValue(null)
    const store = createPlaybackStore()
    const only = createInstance(store)
    api = only
    const load = only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    await vi.waitFor(() => expect(source.resolveMapKey).toHaveBeenCalledTimes(2))
    expect(store.assetStage).toBe(true)
    only.reset()
    expect(store.assetStage).toBe(false)
    expect(store.mapName).toBe('')
    parked.resolve('map_a')
    await load
    expect(store.mapName).toBe('')
    expect(store.startTime).toBe(0)
    expect(store.playing).toBe(false)
    expect(store.hasData).toBe(false)
    expect(store.assetStage).toBe(false)
    expect(store.err).toBe('')
  })
})
