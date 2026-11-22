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
    setSize() {}
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
describe('3D annotation pointer ownership', () => {
  function mouse(type, x, y, pointerId = 1) {
    const event = new MouseEvent(type, {
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    return event
  }

  function touch(type, x, y, pointerId) {
    const event = new MouseEvent(type, {
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    Object.defineProperty(event, 'pointerType', { value: 'touch' })
    Object.defineProperty(event, 'pageX', { value: x })
    Object.defineProperty(event, 'pageY', { value: y })
    return event
  }

  async function setup({ tool = 'pen', mapKey = 'probe_map' } = {}) {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 10, zmax: 10 })
    source.resolveMapKey.mockResolvedValue(mapKey)
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const onAnnotationCommit = vi.fn()
    const onAnnotationErase = vi.fn()
    const onVehicleSelect = vi.fn()
    const store = createPlaybackStore()
    const container = mountContainer()
    const api = initPlayback(container, store, null, { onVehicleSelect, onAnnotationCommit, onAnnotationErase })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'annotation-pointer.wotbreplay') })
    api.setPlaying(false)
    const canvas = container.querySelector('canvas')
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true })
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
    container.setPointerCapture = vi.fn()
    container.releasePointerCapture = vi.fn()
    api.setAnnotationInteraction({ enabled: true, tool, color: '#ff4d4f', width: 3, eraserWidth: 16 })
    return { api, store, container, canvas, onAnnotationCommit, onAnnotationErase, onVehicleSelect }
  }

  it('pen: single mouse pointer draws once, suppresses orbit, keeps semantic points', async () => {
    const { canvas, onAnnotationCommit } = await setup()
    const camera = window.__camera
    const before = camera.position.clone()
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    canvas.dispatchEvent(mouse('pointermove', 400, 300))
    canvas.dispatchEvent(mouse('pointermove', 420, 310))
    canvas.dispatchEvent(mouse('pointerup', 420, 310))
    expect(onAnnotationCommit).toHaveBeenCalledTimes(1)
    const annotation = onAnnotationCommit.mock.calls[0][0]
    expect(annotation.type).toBe('pen')
    expect(annotation.color).toBe('#ff4d4f')
    expect(annotation.points.length).toBeGreaterThanOrEqual(2)
    expect(annotation.width).toBeGreaterThan(0)
    for (const point of annotation.points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
    }
    const layer = window.__annotationLayer
    expect(layer.pick(380, 300).semantic).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
    expect(annotation.width).toBeCloseTo(3, 6)   // unknown map key -> stable 1:1 map units
    // 独立 oracle：semantic point 反投影必须回到按下时的 client px（锁 x 取负与 z 映射）。
    const first = annotation.points[0]
    camera.updateMatrixWorld()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
    const projected = new THREE.Vector3(-first.x, layer.sampler(-first.x, first.y), first.y).project(camera)
    expect((projected.x + 1) / 2 * 800).toBeCloseTo(380, 0)
    expect((1 - projected.y) / 2 * 600).toBeCloseTo(300, 0)
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9)
  })

  it('tool off: orbit still rotates and vehicle selection still works', async () => {
    const { api, canvas, onVehicleSelect } = await setup()
    api.setCam('follow')
    api.setAnnotationInteraction({ enabled: false, tool: null })
    expect(window.__controls.touches.ONE).toBe(0)
    const camera = window.__camera
    const before = camera.position.clone()
    canvas.dispatchEvent(mouse('pointerdown', 400, 300, 2))
    canvas.dispatchEvent(mouse('pointermove', 500, 340, 2))
    canvas.dispatchEvent(mouse('pointerup', 500, 340, 2))
    expect(camera.position.distanceTo(before)).toBeGreaterThan(1e-4)

    const object = new THREE.Object3D()
    object.userData.eid = 11
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object }])
    canvas.dispatchEvent(mouse('pointerdown', 400, 300, 3))
    canvas.dispatchEvent(mouse('pointerup', 400, 300, 3))
    expect(onVehicleSelect).toHaveBeenCalledWith(11, expect.anything())
  })

  it('pen on: vehicle selection is suppressed', async () => {
    const { canvas, onVehicleSelect } = await setup()
    const object = new THREE.Object3D()
    object.userData.eid = 11
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object }])
    canvas.dispatchEvent(mouse('pointerdown', 400, 300, 4))
    canvas.dispatchEvent(mouse('pointerup', 400, 300, 4))
    expect(onVehicleSelect).not.toHaveBeenCalled()
  })

  it('touch: fast continuous valid hits farther than maxReconnect never freeze', async () => {
    const { canvas, onAnnotationCommit } = await setup()
    canvas.dispatchEvent(touch('pointerdown', 380, 300, 21))
    canvas.dispatchEvent(touch('pointermove', 600, 300, 21))
    canvas.dispatchEvent(touch('pointerup', 600, 300, 21))
    expect(onAnnotationCommit).toHaveBeenCalledTimes(1)
    const points = onAnnotationCommit.mock.calls[0][0].points
    expect(points.length).toBeGreaterThanOrEqual(2)
    expect(Math.hypot(points[points.length - 1].x - points[0].x, points[points.length - 1].y - points[0].y)).toBeGreaterThan(25)
  })

  it('touch: a terrain miss followed by a far valid hit still applies reconnect protection', async () => {
    const { canvas, onAnnotationCommit } = await setup()
    canvas.dispatchEvent(touch('pointerdown', 380, 300, 22))
    canvas.dispatchEvent(touch('pointermove', 5000, 300, 22))   // 地形外：miss
    canvas.dispatchEvent(touch('pointermove', 600, 300, 22))    // 回到地形但 XZ 跳 > 25m
    canvas.dispatchEvent(touch('pointerup', 600, 300, 22))
    expect(onAnnotationCommit).not.toHaveBeenCalled()
  })

  it('a terrain LOD change refreshes heights in place instead of rebuilding strokes', async () => {
    const { api } = await setup()
    const layer = window.__annotationLayer
    api.setAnnotations([{ type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: -5, y: 0 }, { x: 5, y: 0 }] }])
    const builds = layer.stats.committedBuilds
    const geometry = layer.committedMesh.geometry
    const position = geometry.getAttribute('position')
    const version = position.version
    const xz = Array.from(position.array).filter((_, i) => i % 3 !== 1)
    layer.reproject()
    expect(layer.stats.committedBuilds).toBe(builds)
    expect(layer.committedMesh.geometry).toBe(geometry)
    expect(position.version).toBeGreaterThan(version)
    expect(Array.from(position.array).filter((_, i) => i % 3 !== 1)).toEqual(xz)
  })

  it('reuses committed ribbon topology when another stroke is added', async () => {
    const { api } = await setup()
    const first = { type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: -5, y: 0 }, { x: 5, y: 0 }] }
    api.setAnnotations([first])
    const vertices = window.__annotationLayer.stats.committedVertices
    expect(vertices).toBeGreaterThan(0)
    const second = { type: 'pen', color: '#40c4ff', width: 3, points: [{ x: -5, y: 4 }, { x: 5, y: 4 }] }
    api.setAnnotations([first, second])
    expect(window.__annotationLayer.stats.committedVertices).toBeGreaterThan(vertices)
  })

  it('pen width and eraser radius keep identical map-space semantics across camera distances', async () => {
    const { api, canvas } = await setup({ mapKey: 'amigosville' })
    const layer = window.__annotationLayer
    const image = mapImages.amigosville
    const expectedWidth = 3 * ((image.coordinateBounds.xMax - image.coordinateBounds.xMin) / image.width)
    const expectedRadius = 16 * ((image.coordinateBounds.xMax - image.coordinateBounds.xMin) / image.width)

    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    const nearWidth = layer.gesture().width
    canvas.dispatchEvent(mouse('pointercancel', 380, 300))
    window.__camera.position.set(0, 500, 0.01)
    window.__camera.updateMatrixWorld()
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    const farWidth = layer.gesture().width
    canvas.dispatchEvent(mouse('pointercancel', 380, 300))
    expect(nearWidth).toBeCloseTo(expectedWidth, 6)
    expect(farWidth).toBeCloseTo(expectedWidth, 6)

    api.setAnnotationInteraction({ enabled: true, tool: 'eraser', color: '#ff4d4f', width: 3, eraserWidth: 16 })
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    const nearRadius = layer.gesture().radius
    canvas.dispatchEvent(mouse('pointercancel', 380, 300))
    window.__camera.position.set(0, 255, 0.01)
    window.__camera.updateMatrixWorld()
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    const farRadius = layer.gesture().radius
    canvas.dispatchEvent(mouse('pointercancel', 380, 300))
    expect(nearRadius).toBeCloseTo(expectedRadius, 6)
    expect(farRadius).toBeCloseTo(expectedRadius, 6)
  })

  it('commits the normalized centerline at the pointerup boundary', async () => {
    const { canvas, onAnnotationCommit } = await setup()
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    canvas.dispatchEvent(mouse('pointermove', 460, 340))
    canvas.dispatchEvent(mouse('pointermove', 540, 300))
    const raw = window.__annotationLayer.gesture().points.map((p) => ({ ...p }))
    canvas.dispatchEvent(mouse('pointerup', 540, 300))
    expect(onAnnotationCommit).toHaveBeenCalledTimes(1)
    expect(onAnnotationCommit.mock.calls[0][0].points).toEqual(normalizePenPoints(raw))
  })

  it('eraser: single mouse pointer emits one semantic erase path with radius', async () => {
    const { canvas, onAnnotationCommit, onAnnotationErase } = await setup({ tool: 'eraser' })
    const camera = window.__camera
    const before = camera.position.clone()
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    canvas.dispatchEvent(mouse('pointermove', 400, 300))
    canvas.dispatchEvent(mouse('pointermove', 420, 310))
    canvas.dispatchEvent(mouse('pointerup', 420, 310))
    expect(onAnnotationCommit).not.toHaveBeenCalled()
    expect(onAnnotationErase).toHaveBeenCalledTimes(1)
    const path = onAnnotationErase.mock.calls[0][0]
    expect(path.points.length).toBeGreaterThanOrEqual(2)
    expect(path.radius).toBeGreaterThan(0)
    expect(path.radius).toBeCloseTo(16, 6)
    for (const point of path.points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
    }
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9)
  })

  it('eraser path keeps surfaceY/surfaceN for layer-aware clipping', async () => {
    const { canvas, onAnnotationErase } = await setup({ tool: 'eraser' })
    const layer = window.__annotationLayer
    const ground = layer.pick(380, 300)
    const sx = -ground.semantic.x
    const sz = ground.semantic.y
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), new THREE.MeshBasicMaterial())
    bridge.position.set(sx, 20, sz)
    window.__scene.add(bridge)
    bridge.updateMatrixWorld(true)
    const key = Math.floor(sx / 16) + ',' + Math.floor(sz / 16)
    layer.setSurfaceGrid(new Map([[key, [bridge]]]))

    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    canvas.dispatchEvent(mouse('pointerup', 380, 300))
    expect(onAnnotationErase).toHaveBeenCalledTimes(1)
    const path = onAnnotationErase.mock.calls[0][0]
    expect(path.points[0].surfaceY).toBeCloseTo(21, 5)
    expect(path.points[0].surfaceN.y).toBeCloseTo(1, 5)
  })

  it('second touch cancels the draft, hands off to pinch, and the next fresh touch draws', async () => {
    const { api, canvas, onAnnotationCommit } = await setup()
    api.setCam('follow')
    const controls = window.__controls
    const camera = window.__camera
    const dist0 = camera.position.distanceTo(controls.target)
    canvas.dispatchEvent(touch('pointerdown', 400, 300, 7))
    expect(controls.touches.ONE).toBeNull()
    canvas.dispatchEvent(touch('pointerdown', 600, 300, 9))
    expect(controls.state).toBe(5)
    canvas.dispatchEvent(touch('pointermove', 700, 320, 9))
    expect(Math.abs(camera.position.distanceTo(controls.target) - dist0)).toBeGreaterThan(0.1)
    canvas.dispatchEvent(touch('pointerup', 700, 320, 9))
    canvas.dispatchEvent(touch('pointerup', 400, 300, 7))
    expect(onAnnotationCommit).not.toHaveBeenCalled()

    canvas.dispatchEvent(touch('pointerdown', 400, 300, 11))
    canvas.dispatchEvent(touch('pointermove', 430, 300, 11))
    canvas.dispatchEvent(touch('pointerup', 430, 300, 11))
    expect(onAnnotationCommit).toHaveBeenCalledTimes(1)
  })

  it('pointercancel discards the draft and restores OrbitControls ownership', async () => {
    const { api, canvas, onAnnotationCommit } = await setup()
    api.setCam('follow')
    const controls = window.__controls
    canvas.dispatchEvent(touch('pointerdown', 400, 300, 7))
    canvas.dispatchEvent(touch('pointercancel', 400, 300, 7))
    expect(onAnnotationCommit).not.toHaveBeenCalled()
    api.setAnnotationInteraction({ enabled: false, tool: null })
    expect(controls.touches.ONE).toBe(0)
    const camera = window.__camera
    const before = camera.position.clone()
    canvas.dispatchEvent(touch('pointerdown', 400, 300, 9))
    canvas.dispatchEvent(touch('pointermove', 520, 300, 9))
    canvas.dispatchEvent(touch('pointerup', 520, 300, 9))
    expect(camera.position.distanceTo(before)).toBeGreaterThan(1e-4)
  })

  it('tool switch mid-gesture cancels without committing half a stroke', async () => {
    const { api, canvas, onAnnotationCommit } = await setup()
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    canvas.dispatchEvent(mouse('pointermove', 400, 300))
    api.setAnnotationInteraction({ enabled: true, tool: 'eraser', color: '#ff4d4f', width: 3, eraserWidth: 16 })
    canvas.dispatchEvent(mouse('pointermove', 420, 310))
    canvas.dispatchEvent(mouse('pointerup', 420, 310))
    expect(onAnnotationCommit).not.toHaveBeenCalled()
    expect(window.__annotationLayer.draftMesh.visible).toBe(false)
  })

  it('free camera: drawing does not move the camera and one-finger look is suppressed', async () => {
    const { api, canvas, onAnnotationCommit } = await setup()
    api.setCam('free')
    const camera = window.__camera
    const before = camera.position.clone()
    canvas.dispatchEvent(mouse('pointerdown', 400, 300))
    canvas.dispatchEvent(mouse('pointermove', 420, 310))
    canvas.dispatchEvent(mouse('pointerup', 420, 310))
    expect(onAnnotationCommit).toHaveBeenCalledTimes(1)
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9)

    onAnnotationCommit.mockClear()
    const afterMouse = camera.position.clone()
    canvas.dispatchEvent(touch('pointerdown', 400, 300, 13))
    canvas.dispatchEvent(touch('pointermove', 520, 380, 13))
    canvas.dispatchEvent(touch('pointerup', 520, 380, 13))
    expect(camera.position.distanceTo(afterMouse)).toBeLessThan(1e-9)
  })

  it('free camera: second touch cancels draft and hands off to fly pinch', async () => {
    const { api, canvas, onAnnotationCommit } = await setup()
    api.setCam('free')
    const camera = window.__camera
    const beforePinch = camera.position.clone()
    canvas.dispatchEvent(touch('pointerdown', 400, 300, 7))
    canvas.dispatchEvent(touch('pointerdown', 600, 300, 9))
    expect(window.__annotationLayer.draftMesh.visible).toBe(false)
    canvas.dispatchEvent(touch('pointermove', 700, 320, 9))
    expect(camera.position.distanceTo(beforePinch)).toBeGreaterThan(0.2)
    canvas.dispatchEvent(touch('pointerup', 700, 320, 9))
    canvas.dispatchEvent(touch('pointerup', 400, 300, 7))
    expect(onAnnotationCommit).not.toHaveBeenCalled()
    canvas.dispatchEvent(touch('pointerdown', 400, 300, 13))
    canvas.dispatchEvent(touch('pointermove', 430, 300, 13))
    canvas.dispatchEvent(touch('pointerup', 430, 300, 13))
    expect(onAnnotationCommit).toHaveBeenCalledTimes(1)
  })

  it('eraser move never rebuilds committed geometry and commits one callback', async () => {
    const { api, canvas, onAnnotationErase } = await setup({ tool: 'eraser' })
    api.setAnnotations([{ type: 'pen', color: '#ff4d4f', width: 1.5, points: [{ x: -20, y: -20 }, { x: 20, y: 20 }] }])
    const layer = window.__annotationLayer
    const geometry = layer.committedMesh.geometry
    const builds = layer.stats.committedBuilds
    canvas.dispatchEvent(mouse('pointerdown', 400, 300))
    expect(layer.ring.visible).toBe(true)
    expect(layer.ring.geometry.getAttribute('position').count).toBeGreaterThan(8)
    expect(layer.ringOutline.visible).toBe(true)
    expect(layer.ringOutline.geometry.getAttribute('position').count).toBeGreaterThan(8)
    canvas.dispatchEvent(mouse('pointermove', 410, 300))
    expect(layer.committedMesh.geometry).toBe(geometry)
    expect(layer.stats.committedBuilds).toBe(builds)
    canvas.dispatchEvent(mouse('pointermove', 420, 310))
    expect(layer.committedMesh.geometry).toBe(geometry)
    expect(layer.stats.committedBuilds).toBe(builds)
    canvas.dispatchEvent(mouse('pointerup', 420, 310))
    expect(layer.committedMesh.geometry).toBe(geometry)
    expect(layer.stats.committedBuilds).toBe(builds)
    expect(layer.ring.visible).toBe(false)
    expect(layer.ringOutline.visible).toBe(false)
    expect(onAnnotationErase).toHaveBeenCalledTimes(1)
    expect(layer.stats.eraseCallbacks).toBe(1)
  })

  it('color/width changes do not cancel an active stroke; gesture keeps its start values', async () => {
    const { api, canvas, onAnnotationCommit } = await setup()
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    canvas.dispatchEvent(mouse('pointermove', 400, 300))
    api.setAnnotationInteraction({ enabled: true, tool: 'pen', color: '#40c4ff', width: 8, eraserWidth: 24 })
    canvas.dispatchEvent(mouse('pointermove', 420, 310))
    canvas.dispatchEvent(mouse('pointerup', 420, 310))
    expect(onAnnotationCommit).toHaveBeenCalledTimes(1)
    const annotation = onAnnotationCommit.mock.calls[0][0]
    expect(annotation.color).toBe('#ff4d4f')
    expect(annotation.width).toBeCloseTo(3, 6)
  })

  it('lostpointercapture cancels the draft without committing', async () => {
    const { canvas, onAnnotationCommit } = await setup()
    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    canvas.dispatchEvent(mouse('pointermove', 400, 300))
    const lost = new Event('lostpointercapture', { bubbles: true })
    Object.defineProperty(lost, 'pointerId', { value: 1 })
    canvas.dispatchEvent(lost)
    canvas.dispatchEvent(mouse('pointerup', 400, 300))
    expect(onAnnotationCommit).not.toHaveBeenCalled()
    expect(window.__annotationLayer.draftMesh.visible).toBe(false)
  })

  it('ignores malformed pen annotations instead of throwing or crashing the layer', async () => {
    const { api } = await setup()
    const layer = window.__annotationLayer
    expect(() => api.setAnnotations([{ type: 'pen', color: '#ffffff', width: 1 }])).not.toThrow()
    expect(() => api.setAnnotations([{ type: 'pen', color: '#ffffff', width: 1, points: [null, { x: 1, y: 2 }] }])).not.toThrow()
    expect(layer.committedMesh.visible).toBe(false)
    expect(layer.committedMesh.geometry.getAttribute('position').count).toBe(0)
    api.setAnnotations([{ type: 'pen', width: 1, points: [{ x: -10, y: -10 }, { x: 10, y: 10 }] }])
    expect(layer.committedMesh.visible).toBe(true)
    expect(layer.committedMesh.geometry.getAttribute('color').getX(0)).toBeGreaterThan(0)
  })

  it('reattaches the annotation layer to the new Scene after renderer rebuild and disposes on destroy', async () => {
    const { api } = await setup()
    const layer = window.__annotationLayer
    const oldScene = window.__scene
    api.setAnnotations([{ type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: -5, y: 0 }, { x: 5, y: 0 }] }])
    expect(layer.group.parent).toBe(oldScene)
    expect(oldScene.children).toContain(layer.group)

    api.setLogdepth(true)
    await api.loadData({ kind: 'local', file: new File(['y'], 'annotation-rebuild.wotbreplay') })
    const newScene = window.__scene
    expect(newScene).not.toBe(oldScene)
    expect(layer.group.parent).toBe(newScene)
    expect(newScene.children).toContain(layer.group)
    expect(oldScene.children).not.toContain(layer.group)

    api.setAnnotations([{ type: 'pen', color: '#40c4ff', width: 3, points: [{ x: -5, y: 0 }, { x: 5, y: 0 }] }])
    expect(layer.committedMesh.visible).toBe(true)
    expect(layer.committedMesh.geometry.getAttribute('position').count).toBeGreaterThan(0)

    api.destroy()
    expect(window.__annotationLayer).toBeUndefined()
    expect(layer.group.parent).toBeNull()
  })

  it('bounds the groundMesh fallback to the finite placeholder plane', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    const api = initPlayback(container, store, null, {})
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'annotation-ground-bounds.wotbreplay') })
    const layer = window.__annotationLayer
    expect(layer.sampler(0, 0)).toBe(0)
    expect(layer.sampler(10000, 0)).toBeNull()
    expect(layer.sampler(0, 10000)).toBeNull()
  })

  it('anchors a bridge stroke on the nearest drawable scenery surface', async () => {
    const { canvas, api, onAnnotationCommit } = await setup()
    const layer = window.__annotationLayer
    const ground = layer.pick(380, 300)
    expect(ground).toBeTruthy()
    expect(ground.semantic.surfaceY).toBeUndefined()

    const sx = -ground.semantic.x
    const sz = ground.semantic.y
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), new THREE.MeshBasicMaterial())
    bridge.position.set(sx, 20, sz)
    window.__scene.add(bridge)
    bridge.updateMatrixWorld(true)
    layer.setSurfaceGrid(new Map([[`${Math.floor(sx / 16)},${Math.floor(sz / 16)}`, [bridge]]]))

    const picked = layer.pick(380, 300)
    expect(picked.semantic.surfaceY).toBeCloseTo(21, 5)
    expect(picked.semantic.surfaceN.y).toBeCloseTo(1, 5)
    const diag = layer.pickDebug(380, 300)
    expect(diag.candidateCount).toBeGreaterThan(0)
    expect(diag.chosen.surfaceY).toBeCloseTo(21, 5)

    canvas.dispatchEvent(mouse('pointerdown', 380, 300))
    canvas.dispatchEvent(mouse('pointermove', 390, 300))
    canvas.dispatchEvent(mouse('pointerup', 390, 300))
    expect(onAnnotationCommit).toHaveBeenCalledTimes(1)
    const annotation = onAnnotationCommit.mock.calls[0][0]
    expect(annotation.points.length).toBeGreaterThanOrEqual(2)
    expect(annotation.points.every((p) => Number.isFinite(p.surfaceY))).toBe(true)
    expect(annotation.points.every((p) => Number.isFinite(p.surfaceN?.y))).toBe(true)

    api.setAnnotations([annotation])
    const position = layer.committedMesh.geometry.getAttribute('position')
    expect(position.count).toBeGreaterThan(0)
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBeCloseTo(21 + ANNOTATION_LIFT, 2)
    }
  })

  it('destroy removes annotation pointer listeners and state', async () => {
    const { api, canvas, onAnnotationCommit } = await setup()
    api.destroy()
    canvas.dispatchEvent(mouse('pointerdown', 400, 300))
    canvas.dispatchEvent(mouse('pointermove', 420, 310))
    canvas.dispatchEvent(mouse('pointerup', 420, 310))
    expect(onAnnotationCommit).not.toHaveBeenCalled()
    expect(window.__annotationLayer).toBeUndefined()
    created = []
  })
})

describe('坦克接地阴影（High / Ultra opt-in）', () => {
  const shadowMeshes = () => (window.__scene?.children ?? []).filter((o) => o.name === 'tankContactShadow')
  const N = 120
  /** 沿 +X 匀速 0.5 m/样本；coverage 只到 42+20 s，其后车辆不可见（非阵亡） */
  function movingData() {
    const data = minimalData(42)
    data.meta.samples = N
    data.meta.duration = 42 + 58
    const pos = new Array(N * 3)
    for (let i = 0; i < N; i++) { pos[i * 3] = i * 0.5; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0 }
    data.vehicles = [{ eid: 1, team: 1, tank_name: 'T', max_hp: 1000,
      pos, hull_yaw: new Array(N).fill(0), hull_pitch: new Array(N).fill(0),
      turret_yaw: new Array(N).fill(0), gun_pitch: new Array(N).fill(0),
      hp: [], coverage: [42, 62], death_t: null }]
    return data
  }
  async function start(api, name = 'shadow.wotbreplay') {
    vi.spyOn(assetProvider, 'json').mockImplementation(() => Promise.resolve(null))
    source.loadPlaybackData.mockResolvedValue(movingData())
    await api.loadData({ kind: 'local', file: new File(['replay'], name) })
    for (let i = 0; i < 6; i++) await Promise.resolve()
    api.setPlaying(false)
  }

  it('流畅 / 均衡：开关被门禁拒绝（直接调 API 也不能绕过）', () => {
    window.history.replaceState(null, '', '/?debug&q=low')
    const { store, api } = createScene()
    api.setContactShadows(true)
    expect(store.contactShadows).toBe(false)
    api.setQuality('mid')
    api.setContactShadows(true)
    expect(store.contactShadows).toBe(false)
  })

  it('高清 / 极致：默认 OFF、可开；降档清零，再升档不自动恢复；不写 localStorage', () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { store, api } = createScene()
    expect(store.contactShadows).toBe(false)
    api.setContactShadows(true)
    expect(store.contactShadows).toBe(true)
    api.setQuality('ultra')
    expect(store.contactShadows).toBe(true)
    api.setQuality('mid')
    expect(store.contactShadows).toBe(false)
    api.setQuality('high')
    expect(store.contactShadows).toBe(false)
    expect(setItem.mock.calls.map(([k]) => k).filter((k) => /shadow/i.test(k))).toEqual([])
  })

  it('OFF：开播后场景里没有任何阴影对象', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const { store, api } = createScene()
    await start(api)
    expect(store.hasData).toBe(true)
    expect(shadowMeshes()).toHaveLength(0)
    expect(window.__pbV).toHaveLength(1)
    expect(window.__renderer.params.stencil).toBe(false)   // 关闭路径：渲染上下文与原来一致
  })

  it('开启时渲染器带模板缓冲（轮廓投影用）；下一场关闭后重建为不带模板的上下文', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const { api } = createScene()
    api.setContactShadows(true)
    await start(api, 'a.wotbreplay')
    const first = window.__renderer
    expect(first.params.stencil).toBe(true)
    api.setContactShadows(false)
    await start(api, 'b.wotbreplay')
    expect(window.__renderer).not.toBe(first)
    expect(window.__renderer.params.stencil).toBe(false)
    expect(shadowMeshes()).toHaveLength(0)
  })

  it('ON：选择穿过 loadData 内的 teardown 生效；随位姿/seek 跟随，不可见即隐藏，reset 后释放', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const { store, api } = createScene()
    api.setContactShadows(true)
    await start(api)
    expect(store.contactShadows).toBe(true)
    const meshes = shadowMeshes()
    expect(meshes).toHaveLength(1)
    const shadow = meshes[0]
    const centerX = () => {
      const p = shadow.geometry.getAttribute('position').array
      return p[((25 - 1) / 2) * 3]
    }
    const v = window.__pbV[0]
    api.seekTime(42 + 5)
    expect(shadow.visible).toBe(true)
    const x5 = centerX(), vx5 = v.group.position.x
    expect(Math.abs(x5 - vx5)).toBeLessThan(4)                  // 中心 ≈ 车位（太阳偏移有上限）
    api.seekTime(42 + 15)
    expect(Math.abs(v.group.position.x - vx5)).toBeGreaterThan(10)
    expect(centerX() - x5).toBeCloseTo(v.group.position.x - vx5, 4)   // 同朝向：阴影与车同位移
    api.seekTime(42 + 5)                                          // 向后 seek：无旧位置残留
    expect(centerX()).toBeCloseTo(x5, 5)
    api.seekTime(42 + 40)                                         // coverage 之外：车辆与阴影都隐藏
    expect(v.group.visible).toBe(false)
    expect(shadow.visible).toBe(false)
    api.reset()
    expect(shadowMeshes()).toHaveLength(0)
    expect(store.contactShadows).toBe(true)                      // 资源随会话释放；选择由面板换文件时清零
  })

  it('地图预览会话：即使选择为 ON 也不创建阴影', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const { api } = createScene()
    api.setContactShadows(true)
    await api.loadMapOnly({ mapId: 1 })
    expect(shadowMeshes()).toHaveLength(0)
  })
})
