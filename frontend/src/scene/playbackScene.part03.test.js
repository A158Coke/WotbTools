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


const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), loadRecorderCameraFromFile: vi.fn(), resolveMapKey: vi.fn(), mapStaticUrl: vi.fn() }))

vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  loadRecorderCameraFromFile: source.loadRecorderCameraFromFile,
  resolveMapKey: source.resolveMapKey,
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
describe('scene vehicle selection intent', () => {
  it('raycast click reports selection without moving the camera into Follow', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const onVehicleSelect = vi.fn()
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'selection.wotbreplay') })
    const object = new THREE.Object3D()
    object.userData.eid = 11
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object }])
    container.querySelector('canvas').setPointerCapture = vi.fn()
    container.querySelector('canvas').releasePointerCapture = vi.fn()
    const beforeCamera = window.__camera.position.clone()
    // 自由飞行接管后（2026-10-24）：选中在 pointerup 判定（≤SLOP 才算单击——
    // 按下即选会把"拖拽转头路过"的车辆选上）；右键不触发
    const canvas0 = container.querySelector('canvas')
    canvas0.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
    expect(onVehicleSelect).not.toHaveBeenCalled()      // down 不再立即选中
    canvas0.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 10, clientY: 10 }))
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBe(11)
    expect(onVehicleSelect.mock.calls[0][1]?.clientX).toBe(10)
    expect(store.cam).toBe('top')   // 跟随由 Pane 收到 selection 后发起，场景本身不切相机（默认俯视模式不变）
    expect(window.__camera.position.equals(beforeCamera)).toBe(true)
    canvas0.dispatchEvent(new MouseEvent('pointerdown', { button: 2 }))
    canvas0.dispatchEvent(new MouseEvent('pointerup', { button: 2 }))
    expect(onVehicleSelect).toHaveBeenCalledTimes(1)
  })

  it('空处单击上报 eid=null（宿主据此隐藏详情窗）；拖拽相机不算点击', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const onVehicleSelect = vi.fn()
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'empty.wotbreplay') })
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([])
    const canvas = container.querySelector('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 50 }))
    expect(onVehicleSelect).not.toHaveBeenCalled()
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 40, clientY: 50 }))
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBeNull()
    onVehicleSelect.mockClear()
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 50 }))
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 90, clientY: 70 }))
    expect(onVehicleSelect).not.toHaveBeenCalled()
    const object = new THREE.Object3D()
    object.userData.eid = 11
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object }])
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 50 }))
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 40, clientY: 50 }))
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBe(11)
  })

  // 回归（2026-10-24 用户实测）：拖拽只改 target 不改相机朝向 ⇒ 画面不转。
  // free 模式跳过 controls.update()（它的 lookAt 是平时更新朝向的地方），
  // 必须由 flyLookApply / animate 显式 lookAt(target)。
  it('鼠标拖拽转头：相机位不动、朝向与 target 对齐', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'mouse-look.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    const cam0 = cam.position.clone()
    const dir0 = cam.getWorldDirection(new THREE.Vector3())
    const ev = (type, x, buttons) => new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons, bubbles: true, cancelable: true })
    canvas.dispatchEvent(ev('pointerdown', 100, 1))
    canvas.dispatchEvent(ev('pointermove', 220, 1))
    const dir1 = cam.getWorldDirection(new THREE.Vector3())
    expect(cam.position.equals(cam0)).toBe(true)                 // 旋转中心 = 相机自身
    expect(dir1.angleTo(dir0)).toBeGreaterThan(0.2)              // 朝向确实转了（≈120px×0.0032）
    const toTgt = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(dir1.dot(toTgt)).toBeCloseTo(1, 3)                    // 朝向 = 看向 target
    canvas.dispatchEvent(ev('pointerup', 220, 0))
  })

  // 回归（2026-10-25 用户实测）：旧滚轮只改 flyLook.dist——target 沿视线挪、相机不动，
  // 画面毫无变化。滚轮语义 = 沿视线推拉相机（dolly）：相机与 target 同步平移，
  // 视角与视距不变；下滚后退、上滚前进。
  it('滚轮缩放：沿视线推拉相机，视角与视距不变', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'wheel-zoom.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    const aim0 = controls.target.clone().sub(cam.position).normalize()   // 飞行基准 = cam→target
    const dist0 = cam.position.distanceTo(controls.target)
    const wheel = (deltaY) => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    const p0 = cam.position.clone()
    wheel(100)                                                   // 下滚 = 后退
    await settleZoomFrames()                                     // 预算收敛到终点（#835 平滑）
    const back = cam.position.clone().sub(p0)
    expect(back.length()).toBeGreaterThan(1)
    expect(back.dot(aim0)).toBeLessThan(0)                       // 位移沿视线反方向
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 3)  // 视距不变
    const aim1 = controls.target.clone().sub(cam.position).normalize()
    expect(aim1.dot(aim0)).toBeCloseTo(1, 4)                     // 视角不变
    expect(cam.getWorldDirection(new THREE.Vector3()).dot(aim1)).toBeCloseTo(1, 4)  // 朝向仍对准 target
    const p1 = cam.position.clone()
    wheel(-100)                                                  // 上滚 = 前进
    await settleZoomFrames()
    expect(cam.position.clone().sub(p1).dot(aim0)).toBeGreaterThan(0)
  })

  // 回归（PR #872 review）：fly 平滑必须保持旧 flyDolly 的**可加世界位移**语义——
  // 旧即时公式：step = clamp(−Δ×0.0012, ±0.3)，一次性位移 = 事件时刻视距 × step
  // （flyDolly 平移 camera+target，视距不变）。平滑只改时间分布：终点位移与旧实现
  // 逐值一致、帧率无关、同帧相反输入精确抵消、连续同向正确累加。
  it('fly 滚轮终点位移 = 旧即时公式（+100/−100/往返/3×连续），真实 flyDolly 接线', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'fly-additive.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    // 注意：初始 fit 机位贴 maxY（topCameraDefaultHeight）且首次 wheel 会触发
    // flyLookSyncIfStale 重解朝向——先发一格「预热」滚轮完成同步并离开天花板
    // （钳制场景由既有「constrains mode entry…wheel」用例覆盖），再断言后续
    // 滚轮与旧即时公式逐值一致。
    const wheel = (deltaY) => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    wheel(-100); await settleZoomFrames()   // 预热：同步朝向 + 离开天花板
    const dist0 = cam.position.distanceTo(controls.target)
    // 位移方向 = flyLook 视线方向（初始 top 天顶机位的 pitch 回落是既有语义，新旧实现
    // 一致），它与 target−cam 方向的偏离是进入状态，不是本次回归的对象——旧公式的
    // 可验证不变量是：位移模长 = dist×step、视距不变、同向共线（净位移 = 份额之和）。
    const expected = (deltaY) => dist0 * Math.max(-0.3, Math.min(0.3, -deltaY * 0.0012))   // 旧即时步长

    // −100 单格：前进 0.12·dist（10 FPS 泵）
    const p0 = cam.position.clone()
    wheel(-100); await settleZoomFrames()
    expect(cam.position.distanceTo(p0)).toBeCloseTo(expected(-100), 4)
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 4)   // 视距不变

    // +100 单格：后退 0.12·dist（已离开天花板，无钳制）
    const p1 = cam.position.clone()
    wheel(100); await settleZoomFrames()
    expect(cam.position.distanceTo(p1)).toBeCloseTo(Math.abs(expected(100)), 4)

    // 往返：同帧 +100、−100 净位移为 0（预算精确抵消）
    const p2 = cam.position.clone()
    wheel(100); wheel(-100); await settleZoomFrames()
    expect(cam.position.distanceTo(p2)).toBeCloseTo(0, 4)

    // 连续同向 3 × −100：净位移 = 3 × 单次（旧语义视距不变 → 位移可加且共线）
    const p3 = cam.position.clone()
    wheel(-100); wheel(-100); wheel(-100); await settleZoomFrames()
    expect(cam.position.distanceTo(p3)).toBeCloseTo(3 * expected(-100), 3)
  })

  it('fly 滚轮位移帧率无关：60 FPS 与 10 FPS 收敛到同一终点', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'fly-fps.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    // 预热：首次 wheel 触发 flyLookSyncIfStale 重解朝向，先消耗掉再取测量基准
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    await settleZoomFrames()
    const dist0 = cam.position.distanceTo(controls.target)
    const expected = dist0 * Math.max(-0.3, Math.min(0.3, 100 * 0.0012))   // 前滚 −100：远离天花板
    const p0 = cam.position.clone()
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    await pumpZoomAt(1 / 60, 120)   // 60 FPS 逐帧推进（10 FPS 用例已锚定同一模长）
    expect(cam.position.distanceTo(p0)).toBeCloseTo(expected, 4)   // 与 10 FPS 终点一致 = 帧率无关
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 4)
  })

  // 回归（PR #872 review）：滚轮预算在模式切换 / 销毁时必须清空，旧目标不得在新机位继续生效。
  it('fly 滚轮未收敛预算在模式切换时清零：切换后不再产生位移', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'fly-reset.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const wheel = (deltaY) => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    wheel(100)   // 预算未收敛
    api.setCam('follow')
    api.setCam('free')
    const p = cam.position.clone()
    await settleZoomFrames()
    expect(cam.position.distanceTo(p)).toBeCloseTo(0, 4)
  })

  // 回归（PR #872 review）：orbit 拦截发生在 OrbitControls 收到事件之前，必须先复刻
  // three 0.185.1 _customWheelEvent 的归一化（行 ×16 / 页 ×100 / 触控板 pinch ×10，
  // 实体 Control 按键不乘），否则行/页设备与触控板捏合的实际缩放幅度都变小。
  it('orbit 滚轮保留 three 归一化：行/页/触控板 pinch/实体 Ctrl 终点倍率与 OrbitControls 一致', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'orbit-normalize.wotbreplay') })
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    // OrbitControls 直收滚轮的终点倍率（_getZoomScale 于归一化后的 delta）
    const factorOf = (deltaY) => {
      const scale = Math.pow(0.95, controls.zoomSpeed * Math.abs(deltaY) * 0.01)
      return deltaY > 0 ? 1 / scale : scale
    }
    const wheel = (init) => {
      const e = new WheelEvent('wheel', { clientX: 100, clientY: 100, bubbles: true, cancelable: true, ...init })
      if (init.ctrlKey !== undefined) Object.defineProperty(e, 'ctrlKey', { value: init.ctrlKey })   // happy-dom 未实现 WheelEvent.ctrlKey
      canvas.dispatchEvent(e)
      return settleZoomFrames()
    }
    const expectRatio = (d0, f) => {
      expect(cam.position.distanceTo(controls.target) / d0).toBeCloseTo(f, 3)
    }

    let d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: 3, deltaMode: 1 })          // 行单位：×16 → 48
    expectRatio(d0, factorOf(48))

    d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: 2, deltaMode: 2 })          // 页单位：×100 → 200
    expectRatio(d0, factorOf(200))

    d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: -10, ctrlKey: true })       // 触控板 pinch：×10 → −100
    expectRatio(d0, factorOf(-100))

    d0 = cam.position.distanceTo(controls.target)
    controls._controlActive = true                    // 实体 Control 按键按下（three keydown 维护）
    await wheel({ deltaY: -10, ctrlKey: true })       // 不乘 10 → −10
    expectRatio(d0, factorOf(-10))
    controls._controlActive = false

    d0 = cam.position.distanceTo(controls.target)
    controls.enableZoom = false                       // 输入关闭态不劫持：距离不变
    await wheel({ deltaY: 100 })
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(d0, 6)
    controls.enableZoom = true
  })

  // 回归（PR #872 review）：destroy 必须解除新增的 orbit wheel capture 监听——宿主
  // （MapPreview3DPane）复用 container 重建场景时，旧闭包会残留并继续消费 wheel。
  it('destroy 摘除 orbit wheel 监听：同 container 重建后旧实例不再消费 wheel', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const container = mountContainer()
    // dispatch 目标 = container 本身：只有 scene 的 capture wheel 处理器会 preventDefault
    // （OrbitControls 的监听挂在 canvas 上，不参与；fly 处理器在 follow 模式提前返回）。
    class CountingWheelEvent extends WheelEvent {
      constructor(init) { super('wheel', init); this.preventDefaultCalls = 0 }
      preventDefault() { this.preventDefaultCalls++; super.preventDefault() }
    }
    const consumeCount = () => {
      const e = new CountingWheelEvent({ deltaY: 100, cancelable: true })
      container.dispatchEvent(e)
      return e.preventDefaultCalls
    }
    const mk = async () => {
      const store = createPlaybackStore()
      const instance = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
      created.push(instance)
      try { await instance.loadData({ kind: 'local', file: new File(['x'], 'orbit-listener.wotbreplay') }) } catch (err) { console.log('DBG3 loadData threw', err && err.message) }
      await new Promise((r) => setTimeout(r, 25))   // 场景初始化/首帧让位（同 settleZoomFrames 前置）
      return instance
    }
    let instance = await mk()
    expect(consumeCount()).toBe(1)      // 单实例：恰好一个处理器消费
    instance.destroy()
    instance = await mk()
    expect(consumeCount()).toBe(1)      // 销毁 + 重建：旧实例监听已摘除，新实例恰好一份
    instance.destroy()
    instance = await mk()
    expect(consumeCount()).toBe(1)      // 多轮创建/销毁：监听数量不增长
  })

  // 回归（2026-10-24 用户实测）：曾按 `(pointer: fine)` 决定是否接管，触屏笔记本 /
  // 平板模式报 coarse ⇒ 自由模式整条接管链失效（WASD 全灭、拖拽退回 OrbitControls）。
  // 语义改为「自由模式恒接管」，触屏手势见下方「自由视角触屏手势」。
  it('自由模式接管与指针能力无关：touch 拖拽由 fly 接管且 OrbitControls 保持关闭', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'touch-look.wotbreplay') })
    api.setCam('free')
    container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    const cam0 = cam.position.clone()
    const tgt0 = controls.target.clone()
    const touch = (type, x, buttons, pointerId = 7) => {
      const e = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons, bubbles: true, cancelable: true })
      Object.defineProperty(e, 'pointerType', { value: 'touch' })
      Object.defineProperty(e, 'pointerId', { value: pointerId })
      return e
    }
    canvas.dispatchEvent(touch('pointerdown', 100, 1))
    canvas.dispatchEvent(touch('pointermove', 180, 1))
    canvas.dispatchEvent(touch('pointermove', 240, 1))
    expect(cam.position.equals(cam0)).toBe(false)
    expect(controls.target.equals(tgt0)).toBe(false)
    expect(controls.enabled).toBe(false)
    canvas.dispatchEvent(touch('pointerup', 240, 0))
  })

  it('双指捏合：沿视线推拉相机，且手势往返精确回位（评审 P2）', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'touch-pinch.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    const start = cam.position.clone()
    const dist0 = cam.position.distanceTo(controls.target)
    const aim0 = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    const touch = (type, x, buttons, pointerId) => {
      const e = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons, bubbles: true, cancelable: true })
      Object.defineProperty(e, 'pointerType', { value: 'touch' })
      Object.defineProperty(e, 'pointerId', { value: pointerId })
      return e
    }
    const frame = stubFrames()
    // 一次完整手势：两指走够判定距离后基准指距 200px，依次移动到 xs（第二指），再回到 200px 收势
    const gesture = (xs) => {
      canvas.dispatchEvent(touch('pointerdown', 100, 1, 7))
      canvas.dispatchEvent(touch('pointerdown', 280, 1, 9))
      canvas.dispatchEvent(touch('pointermove', 300, 1, 9))
      frame()                                                 // 判定为捏合：指距 200px（= d0）
      for (const x of xs) canvas.dispatchEvent(touch('pointermove', x, 1, 9))
      canvas.dispatchEvent(touch('pointerup', 300, 0, 9))
      canvas.dispatchEvent(touch('pointerup', 100, 0, 7))
    }
    // 分开 → 推近；回到原指距 → 精确回位（不是 25% 前进 / 20% 后退的漂移）
    gesture([350, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    // 同一手势拆成更多 pointermove：结果一致
    gesture([325, 350, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    // 大间距（触发 ±0.5 单事件上限）同样可逆
    gesture([500, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    // 中途分开时确实沿视线前进，且视距/视角不变
    const p0 = cam.position.clone()
    gesture([350])
    expect(cam.position.clone().sub(p0).dot(aim0)).toBeGreaterThan(0.5)
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 3)
    const aim1 = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(aim1.dot(aim0)).toBeCloseTo(1, 4)
    // 补一个完整往返：从当前位置分开再收回，精确回位（相对该手势起点）
    const pForward = cam.position.clone()
    gesture([350, 300])
    expect(cam.position.distanceTo(pForward)).toBeCloseTo(0, 4)
    // 单事件触限 + 回程分批：指距 200→350（比例 0.75 → 累计目标钳 0.5）→275→200
    // （第二指 x = 指距 + 100；d0 = 200px）
    const pBefore = cam.position.clone()
    gesture([450, 375, 300])
    expect(cam.position.distanceTo(pBefore)).toBeCloseTo(0, 4)
    // 同一端点、不同分批 ⇒ 相同位移（不能按单次增量截断）
    const base = cam.position.clone()
    gesture([450])                                  // 一次到指距 350（比例 0.75 → 钳 0.5）
    const oneShot = cam.position.clone().sub(base)
    expect(oneShot.length()).toBeGreaterThan(1)
    gesture([200])                                  // 反向到指距 100（-0.5）⇒ 精确回位
    expect(cam.position.distanceTo(base)).toBeCloseTo(0, 4)
    gesture([375, 450])                             // 分两步到同一指距 350
    const split = cam.position.clone().sub(base)
    expect(split.distanceTo(oneShot)).toBeCloseTo(0, 4)
  })
})

describe('自由视角触屏手势', () => {
  const touch = (type, x, y, pointerId) => Object.assign(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }),
    { pointerId, pointerType: 'touch' },
  )

  async function setup({ pos = [0, 100, 100], target = [0, 0, 0] } = {}) {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const frame = stubFrames()
    const onVehicleSelect = vi.fn()
    const container = mountContainer()
    container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
    container.setPointerCapture = vi.fn()
    container.releasePointerCapture = vi.fn()
    const api = initPlayback(container, createPlaybackStore(), null, { onVehicleSelect })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'touch-gestures.wotbreplay') })
    api.setPlaying(false)
    api.setCam('free')
    const cam = window.__camera
    const controls = window.__controls
    cam.position.set(...pos)
    controls.target.set(...target)
    cam.lookAt(controls.target)
    const canvas = container.querySelector('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    const send = (...args) => canvas.dispatchEvent(touch(...args))
    const dir = () => new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    return { api, cam, controls, canvas, send, dir, frame, onVehicleSelect }
  }

  // 手指当前射线与 y=0 平面的交点：不经过实现的平移计算，独立验证「地面跟手」
  function groundUnder(cam, x, y) {
    cam.updateMatrixWorld()
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(x / 800 * 2 - 1, -(y / 600 * 2 - 1)), cam)
    return raycaster.ray.at(-cam.position.y / raycaster.ray.direction.y, new THREE.Vector3())
  }

  describe('单指平移', () => {
    it('抓住的地面点留在手指下，朝向和高度不变，松手即停', async () => {
      const { cam, controls, send, dir } = await setup()
      const dir0 = dir()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)                        // 越过单击阈值，抓住地面点
      const grabbed = groundUnder(cam, 410, 300)
      send('pointermove', 520, 380, 1)
      expect(cam.position.y).toBe(100)
      expect(dir().dot(dir0)).toBeCloseTo(1, 8)
      expect(controls.enabled).toBe(false)
      const under = groundUnder(cam, 520, 380)
      expect(under.distanceTo(grabbed)).toBeLessThan(1e-3)
      expect(cam.position.x).not.toBeCloseTo(0, 1)
      send('pointerup', 520, 380, 1)
      const stopped = cam.position.clone()
      send('pointermove', 600, 300, 1)
      expect(cam.position.equals(stopped)).toBe(true)
    })

    it('手指回到起点时相机精确回位', async () => {
      const { cam, send } = await setup()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      const start = cam.position.clone()
      send('pointermove', 600, 450, 1)
      send('pointermove', 300, 200, 1)
      send('pointermove', 410, 300, 1)
      send('pointerup', 410, 300, 1)
      expect(cam.position.distanceTo(start)).toBeLessThan(1e-6)
    })

    it('手指按在地平线以上也不会把相机甩飞', async () => {
      const { cam, send } = await setup({ pos: [0, 100, 0], target: [0, 100, -100] })
      send('pointerdown', 400, 100, 1)
      send('pointermove', 410, 100, 1)
      send('pointermove', 500, 100, 1)
      send('pointerup', 500, 100, 1)
      expect(Number.isFinite(cam.position.x)).toBe(true)
      expect(Math.abs(cam.position.x)).toBeLessThan(800)
      expect(cam.position.y).toBe(100)
    })

    it('平移到地图边缘时相机停下而不是转头', async () => {
      const { cam, send, dir } = await setup()
      const dir0 = dir()
      let last = null
      for (let i = 0; i < 40; i++) {
        send('pointerdown', 400, 100, 1)
        send('pointermove', 400, 110, 1)
        send('pointermove', 400, 500, 1)
        send('pointerup', 400, 500, 1)
        expect(dir().dot(dir0)).toBeCloseTo(1, 6)
        if (i === 39) expect(cam.position.distanceTo(last)).toBeLessThan(1e-6)
        last = cam.position.clone()
      }
    })

    it('撞到地图边缘再反向，手指回到起点时相机回到手势起点', async () => {
      const { cam, controls, send } = await setup()
      for (let i = 0; i < 40; i++) {
        send('pointerdown', 400, 100, 1)
        send('pointermove', 400, 110, 1)
        send('pointermove', 400, 500, 1)
        send('pointerup', 400, 500, 1)
      }
      send('pointerdown', 400, 300, 2)
      send('pointermove', 400, 310, 2)
      const start = cam.position.clone()
      const target = controls.target.clone()
      send('pointermove', 400, 590, 2)                        // 继续顶住边缘
      send('pointermove', 400, 100, 2)                        // 反向
      send('pointermove', 400, 310, 2)                        // 回到手势起点
      send('pointerup', 400, 310, 2)
      expect(cam.position.distanceTo(start)).toBeLessThan(1e-6)
      expect(controls.target.distanceTo(target)).toBeLessThan(1e-6)
    })

    it('翻过高坡时不低于净空，回到原处恢复原高度', async () => {
      stubTerrainAssets()
      const { cam, send } = await setup({ pos: [-60, 26, 0], target: [-60, 11, -30] })
      send('pointerdown', 700, 300, 1)
      send('pointermove', 690, 300, 1)
      const start = cam.position.clone()
      let peak = 0
      for (let x = 680; x >= -3000; x -= 200) {
        send('pointermove', x, 300, 1)
        peak = Math.max(peak, cam.position.y)
        if (cam.position.x > -20) break
      }
      expect(peak).toBeGreaterThan(26)
      send('pointermove', 690, 300, 1)
      send('pointerup', 690, 300, 1)
      expect(cam.position.distanceTo(start)).toBeLessThan(1e-6)
    })

    it('≤ 4px 算单击且相机不动，超过后不算单击', async () => {
      const { cam, send, onVehicleSelect } = await setup()
      const start = cam.position.clone()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 403, 300, 1)
      send('pointerup', 403, 300, 1)
      expect(cam.position.equals(start)).toBe(true)
      expect(onVehicleSelect).toHaveBeenCalledTimes(1)
      send('pointerdown', 400, 300, 2)
      send('pointermove', 420, 300, 2)
      send('pointermove', 400, 300, 2)                        // 回到起点也不算单击
      send('pointerup', 400, 300, 2)
      expect(onVehicleSelect).toHaveBeenCalledTimes(1)
    })
  })

  describe('双指', () => {
    const lookCases = [
      ['右', [40, 0], (a, b) => b.x > a.x],
      ['左', [-40, 0], (a, b) => b.x < a.x],
      ['上', [0, -40], (a, b) => b.y > a.y],
      ['下', [0, 40], (a, b) => b.y < a.y],
    ]
    it.each(lookCases)('并拢一起向%s拖 = 转视角，相机不动', async (_, [dx, dy], changed) => {
      const { cam, controls, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 400, 300, 1)
      send('pointerdown', 440, 300, 2)
      send('pointermove', 400 + dx / 2, 300 + dy / 2, 1)
      send('pointermove', 440 + dx / 2, 300 + dy / 2, 2)
      frame()
      send('pointermove', 400 + dx, 300 + dy, 1)
      send('pointermove', 440 + dx, 300 + dy, 2)
      expect(changed(dir0, dir())).toBe(true)
      expect(dir().angleTo(dir0)).toBeGreaterThan(0.01)
      expect(cam.position.equals(start)).toBe(true)
      expect(controls.enabled).toBe(false)
      expect(cam.position.distanceTo(controls.target)).toBeCloseTo(start.distanceTo(new THREE.Vector3(0, 0, 0)), 6)
    })

    it.each([
      ['A A B', [[430, 1], [460, 1], [500, 2]]],
      ['B A A', [[500, 2], [430, 1], [460, 1]]],
    ])('同一帧内事件顺序 %s 不影响判定：两指同向 = 转视角', async (_, moves) => {
      const { cam, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 400, 300, 1)
      send('pointerdown', 440, 300, 2)
      for (const [x, id] of moves) send('pointermove', x, 300, id)
      frame()
      send('pointermove', 500, 300, 1)
      send('pointermove', 540, 300, 2)
      expect(dir().angleTo(dir0)).toBeGreaterThan(0.01)
      expect(cam.position.equals(start)).toBe(true)
    })

    it('一帧内越过阈值又退回时不留下判定状态，之后同向拖动仍是转视角', async () => {
      const { cam, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 313, 300, 1)
      send('pointermove', 300, 300, 1)
      frame()
      send('pointermove', 300, 320, 1)
      send('pointermove', 500, 320, 2)
      frame()
      send('pointermove', 300, 340, 1)
      send('pointermove', 500, 340, 2)
      expect(dir().angleTo(dir0)).toBeGreaterThan(0.01)
      expect(cam.position.equals(start)).toBe(true)
    })

    it('判定帧到来前手势已结束时不留下残余状态', async () => {
      const { cam, send, frame } = await setup()
      const start = cam.position.clone()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 340, 300, 1)
      send('pointerup', 500, 300, 2)
      send('pointerup', 340, 300, 1)
      frame()
      expect(cam.position.equals(start)).toBe(true)
    })

    it('指距分开较大时一起拖同样是转视角', async () => {
      const { cam, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 200, 300, 1)
      send('pointerdown', 600, 300, 2)
      send('pointermove', 200, 330, 1)
      send('pointermove', 600, 330, 2)
      frame()
      send('pointermove', 200, 360, 1)
      send('pointermove', 600, 360, 2)
      expect(dir().angleTo(dir0)).toBeGreaterThan(0.01)
      expect(cam.position.equals(start)).toBe(true)
    })

    it('转视角中指距变化不触发推拉', async () => {
      const { cam, send, frame } = await setup()
      const start = cam.position.clone()
      send('pointerdown', 400, 300, 1)
      send('pointerdown', 440, 300, 2)
      send('pointermove', 400, 330, 1)
      send('pointermove', 440, 330, 2)
      frame()
      send('pointermove', 300, 330, 1)
      send('pointermove', 540, 330, 2)
      expect(cam.position.equals(start)).toBe(true)
    })

    it.each([
      ['从并拢分开', [400, 420], [[380, 1], [440, 2]], [465, 2], 1],
      ['两指合拢', [300, 600], [[320, 1], [580, 2], [340, 1], [560, 2]], [500, 2], -1],
      ['一指不动', [300, 400], [[420, 2], [440, 2]], [520, 2], 1],
    ])('%s = 沿视线推拉，朝向不变', async (_, [x1, x2], moves, [lastX, lastId], sign) => {
      const { cam, send, dir, frame } = await setup()
      const dir0 = dir()
      send('pointerdown', x1, 300, 1)
      send('pointerdown', x2, 300, 2)
      for (const [x, id] of moves) send('pointermove', x, 300, id)
      frame()
      const before = cam.position.clone()
      send('pointermove', lastX, 300, lastId)
      expect(cam.position.clone().sub(before).dot(dir0) * sign).toBeGreaterThan(0)
      expect(dir().dot(dir0)).toBeCloseTo(1, 8)
    })

    it('捏合中两指改成同向移动也不转视角', async () => {
      const { send, dir, frame } = await setup()
      const dir0 = dir()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 280, 300, 1)
      send('pointermove', 520, 300, 2)
      frame()
      send('pointermove', 280, 400, 1)
      send('pointermove', 520, 400, 2)
      expect(dir().dot(dir0)).toBeCloseTo(1, 8)
    })

    it('判定前 12px 内相机不动', async () => {
      const { cam, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 305, 300, 1)
      send('pointermove', 495, 300, 2)
      frame()
      expect(cam.position.equals(start)).toBe(true)
      expect(dir().dot(dir0)).toBeCloseTo(1, 10)
    })

    it('平移中加第二指立即停止；抬起后剩下的手指不平移也不选车', async () => {
      const { cam, send, onVehicleSelect } = await setup()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      send('pointermove', 500, 300, 1)
      const stopped = cam.position.clone()
      send('pointerdown', 600, 300, 2)
      send('pointerup', 600, 300, 2)
      send('pointermove', 300, 300, 1)
      expect(cam.position.equals(stopped)).toBe(true)
      send('pointerup', 300, 300, 1)
      expect(onVehicleSelect).not.toHaveBeenCalled()
    })

    it('两指轻点不选车', async () => {
      const { send, onVehicleSelect } = await setup()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointerup', 500, 300, 2)
      send('pointerup', 300, 300, 1)
      expect(onVehicleSelect).not.toHaveBeenCalled()
    })

    it('pointercancel 清空手势，下一次单指正常平移', async () => {
      const { cam, send } = await setup()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointercancel', 300, 300, 1)
      send('pointercancel', 500, 300, 2)
      const start = cam.position.clone()
      send('pointerdown', 400, 300, 3)
      send('pointermove', 410, 300, 3)
      send('pointermove', 500, 300, 3)
      send('pointerup', 500, 300, 3)
      expect(cam.position.equals(start)).toBe(false)
    })

    it('第三根手指不留下残余手势', async () => {
      const { cam, send } = await setup()
      const start = cam.position.clone()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointerdown', 400, 200, 3)
      send('pointermove', 400, 100, 3)
      send('pointerup', 400, 100, 3)
      send('pointerup', 500, 300, 2)
      send('pointerup', 300, 300, 1)
      expect(cam.position.equals(start)).toBe(true)
    })
  })

  describe('其他模式不走自由视角手势', () => {
    it('绘制模式：单指不动相机，双指一起拖也只是捏合', async () => {
      const { api, cam, send, dir } = await setup()
      api.setAnnotationInteraction({ enabled: true, tool: 'pen', color: '#ff4d4f', width: 3, eraserWidth: 16 })
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 460, 300, 1)
      expect(cam.position.equals(start)).toBe(true)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 460, 360, 1)
      send('pointermove', 500, 360, 2)
      expect(dir().dot(dir0)).toBeCloseTo(1, 8)
      send('pointerup', 500, 360, 2)
      send('pointerup', 460, 360, 1)
    })

    it('沙盘：单指交给 OrbitControls，不走贴地平移', async () => {
      const { api, controls, send } = await setup()
      api.setCam('top')
      const target = controls.target.clone()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 500, 300, 1)
      send('pointerup', 500, 300, 1)
      expect(controls.target.equals(target)).toBe(true)
      expect(controls.enabled).toBe(true)
    })

    it('平移中回到俯视机位后，手指继续移动不把相机拉回手势起点', async () => {
      const { api, cam, send } = await setup()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      send('pointermove', 500, 300, 1)
      api.setCam('top-view')
      const top = cam.position.clone()
      send('pointermove', 600, 300, 1)
      expect(cam.position.equals(top)).toBe(true)
    })

    it('手势中切模式后不留下残余状态', async () => {
      const { api, cam, send } = await setup()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      api.setCam('top')
      api.setCam('free')
      const start = cam.position.clone()
      send('pointermove', 600, 300, 1)
      expect(cam.position.equals(start)).toBe(true)
    })
  })
})

describe('scene container geometry', () => {
  it('resizes projection and canvas on container changes and disconnects on destroy', async () => {
    let onSize
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { onSize = callback }
      observe = observe
      disconnect = disconnect
    })
    try {
      source.loadPlaybackData.mockResolvedValue(minimalData())
      const container = mountContainer()
      Object.defineProperty(container, 'clientWidth', { configurable: true, value: 800 })
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 })
      const store = createPlaybackStore()
      api = initPlayback(container, store)
      created.push(api)
      await api.loadData({ kind: 'local', file: new File(['x'], 'size.wotbreplay') })
      expect(observe).toHaveBeenCalledWith(container)
      const setSize = vi.spyOn(window.__renderer, 'setSize')
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 700 })
      onSize()
      expect(setSize).toHaveBeenCalledWith(800, 700)
      expect(window.__camera.aspect).toBe(800 / 700)
      api.destroy()
      expect(disconnect).toHaveBeenCalledTimes(1)
      created = []
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
