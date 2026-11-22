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
describe('playbackScene 名册运行时状态对 Vue 可见', () => {
  const vehicle = (def) => ({
    pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
    coverage: [42, 300], death_t: null, hp: [], ...def,
  })
  function rosterData(vehicles, extra = {}) {
    const data = { ...minimalData(42), ...extra, vehicles }
    data.meta = { ...data.meta, duration: 300, samples: 1 }
    return data
  }
  function manualFrames() {
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    return frames
  }

  describe('recorder view', () => {
    const facet = (overrides = {}) => ({
      version: 1,
      author_eid: 1,
      aim: { t: [42, 200], yaw: [0, 0], pitch: [0, 0], ray_x: [0, 0], ray_y: [2, 2], ray_z: [100, 100] },
      mode: { t: [42, 60, 70], raw: [1, 0, 1] },
      zoom: { t: [60.1], raw: [27] },
      bloom: { t: [], raw: [] },
      client_options: { backward_zoom: null },
      ...overrides,
    })
    const load = async ({ camera = facet(), vehicleOverrides = {}, others = [], overlay = null, shadows = false } = {}) => {
      if (shadows) window.history.replaceState(null, '', '/?debug&q=high')
      const frames = manualFrames()
      vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
      source.loadRecorderCameraFromFile.mockResolvedValue(camera)
      const data = rosterData([vehicle({ eid: 1, team: 1, nickname: 'A', tank_name: 'T', max_hp: 100, hp: [[42, 100]], ...vehicleOverrides }), ...others])
      data.meta = { ...data.meta, author_eid: 1 }
      source.loadPlaybackData.mockResolvedValue(data)
      const reticle = { update: vi.fn(), hide: vi.fn() }
      const store = createPlaybackStore()
      const stage = mountContainer()
      Object.defineProperty(stage, 'clientWidth', { value: 900, configurable: true })
      Object.defineProperty(stage, 'clientHeight', { value: 600, configurable: true })
      api = initPlayback(stage, store, overlay, { recorderReticle: reticle })
      created.push(api)
      if (shadows) api.setContactShadows(true)
      await api.loadData({ kind: 'local', file: new File(['r'], 'recorder.wotbreplay') })
      api.setPlaying(false)
      await Promise.resolve()
      const run = (count = 1) => { for (let i = 0; i < count; i++) frames.shift()?.() }
      return { api, store, frames, run, reticle, vehicle: window.__pbV[0] }
    }

    it('becomes available once the facet is ready, then drives an arcade camera along the aim', async () => {
      const { api, store, run, reticle } = await load()
      expect(store.recorderCameraStatus).toBe('ready')
      api.seekTime(50)
      expect(store.recorderViewAvailable).toBe(true)
      api.setCam('recorder')
      expect(store.cam).toBe('recorder')
      expect(window.__controls.enabled).toBe(false)
      run(5)
      const camera = window.__camera
      const direction = new THREE.Vector3()
      camera.getWorldDirection(direction)
      expect(direction.z).toBeCloseTo(1, 5)
      expect(camera.position.z).toBeLessThan(window.__pbV[0].group.position.z)
      expect(camera.fov).toBe(55)
      expect(reticle.update).toHaveBeenCalled()
    })

    it('开镜从渲染里摘掉本车时不留接地阴影；回到 Arcade 后恢复', async () => {
      const { api, run } = await load({ shadows: true })
      const shadow = () => window.__scene.children.find((o) => o.name === 'tankContactShadow')
      api.seekTime(50)
      expect(shadow().visible).toBe(true)
      api.setCam('recorder')
      api.seekTime(65)   // mode 0 = SNIPER
      run(12)
      expect(shadow().visible).toBe(false)
      api.seekTime(75)   // 回到 Arcade
      run(12)
      expect(shadow().visible).toBe(true)
    })

    describe('recorder backward_zoom 倒车判定（#913 review：恢复拆分前坐标转换——只反 x，保 z）', () => {
      // pose_kf 关键帧（绕开 1 采样网格回退）上 5 m/s 的直线运动：yaw=0（车体前向 = +z），
      // 相机航向 ray (0,2,100)（≈正 +z）。seek 落 T=75（Arcade 档：mode raw 1）。
      // 倒车拉远收敛后 boom = 14 × 1.35 = 18.9 m，不触发时恒 14 m——
      // 以 camera.z − 车体 z 的水平间距（负 = 相机在车后）判定。
      const motionKf = (sign) => ({ t: [42, 75], pos: [0, 0, 0, 0, 0, sign * 165], yaw: [0, 0], pitch: [0, 0] })
      const backwardFacet = () => facet({ client_options: { backward_zoom: true } })
      const settledGap = async (sign) => {
        const { api, run } = await load({ camera: backwardFacet(), vehicleOverrides: { pose_kf: motionKf(sign) } })
        api.seekTime(75)
        api.setCam('recorder')
        run(40)   // dt=0.1 × 40 帧 ≫ tau=0.25s：boom 缩放完全收敛到 1 或 1.35
        const v = window.__pbV[0]
        return window.__camera.position.z - v.group.position.z
      }
      it('前进（+z 推进）不触发倒车拉远（boom 恒 14m 档）', async () => {
        const gap = await settledGap(1)
        expect(gap).toBeGreaterThan(-16)
        expect(gap).toBeLessThan(-12)
      })
      it('倒车（−z）触发倒车拉远（boom 收敛到 18.9m 档）', async () => {
        const gap = await settledGap(-1)
        expect(gap).toBeLessThan(-16)
      })
    })

    it('accepts no camera input while active', async () => {
      const { api, run } = await load()
      api.seekTime(50)
      api.setCam('recorder')
      run(5)
      const before = window.__camera.position.clone()
      document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(false)
      run(1)
      expect(window.__camera.position.distanceTo(before)).toBeLessThan(1e-6)
    })

    it('enters the real sniper view: gun position, replay FOV and hidden own tank', async () => {
      const { api, run, vehicle } = await load()
      api.seekTime(50)
      api.setCam('recorder')
      run(5)
      api.seekTime(65)
      run(1)
      const camera = window.__camera
      expect(camera.fov).toBe(27)
      // 只从渲染中摘掉：车辆仍「在场」，炮口与击毁特效依赖 group.visible
      expect(vehicle.group.visible).toBe(true)
      expect(vehicle.meshHull.layers.test(camera.layers)).toBe(false)
      const gun = vehicle.gunPivot.getWorldPosition(new THREE.Vector3())
      expect(camera.position.distanceTo(gun)).toBeLessThan(1e-6)

      api.seekTime(75)
      run(1)
      expect(camera.fov).toBe(55)   // Arcade/Sniper 由回放驱动，硬切
      expect(vehicle.meshHull.layers.test(camera.layers)).toBe(true)
    })

    it('clears nearby foliage only while the recorder view is active', async () => {
      const { api, run } = await load()
      api.seekTime(50)
      expect(foliageClip.value).toBe(0)
      api.setCam('recorder')
      run(1)
      const arcade = foliageClip.value
      expect(arcade).toBeGreaterThan(0)
      api.seekTime(65)
      run(1)
      expect(foliageClip.value).toBeGreaterThan(arcade)
      api.setCam('free')
      expect(foliageClip.value).toBe(0)
    })

    const pointer = (type, x, y, id, pointerType) => Object.assign(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y }),
      { pointerId: id, pointerType },
    )

    it('keeps OrbitControls off through mouse drags and touch pinches', async () => {
      const { api, run } = await load()
      api.seekTime(50)
      api.setCam('recorder')
      run(5)
      const before = window.__camera.position.clone()
      const canvas = document.querySelector('canvas')
      canvas.dispatchEvent(pointer('pointerdown', 100, 100, 1, 'mouse'))
      expect(window.__controls.enabled).toBe(false)
      canvas.dispatchEvent(pointer('pointermove', 180, 140, 1, 'mouse'))
      canvas.dispatchEvent(pointer('pointerup', 180, 140, 1, 'mouse'))
      canvas.dispatchEvent(pointer('pointerdown', 100, 100, 4, 'touch'))
      canvas.dispatchEvent(pointer('pointermove', 260, 180, 4, 'touch'))
      canvas.dispatchEvent(pointer('pointerup', 260, 180, 4, 'touch'))
      canvas.dispatchEvent(pointer('pointerdown', 100, 100, 2, 'touch'))
      canvas.dispatchEvent(pointer('pointerdown', 200, 100, 3, 'touch'))
      canvas.dispatchEvent(pointer('pointermove', 260, 100, 3, 'touch'))
      canvas.dispatchEvent(pointer('pointerup', 260, 100, 3, 'touch'))
      canvas.dispatchEvent(pointer('pointerup', 100, 100, 2, 'touch'))
      expect(window.__controls.enabled).toBe(false)
      run(2)
      expect(window.__camera.position.distanceTo(before)).toBeLessThan(1e-6)
    })

    it('keeps the aim dot centered while the gun circle follows the real gun when the turret lags', async () => {
      const aim = { t: [42, 200], yaw: [0.3, 0.3], pitch: [0, 0], ray_x: [30, 30], ray_y: [2, 2], ray_z: [100, 100] }
      const { api, run, reticle } = await load({ camera: facet({ aim }) })
      api.seekTime(50)
      api.setCam('recorder')
      run(5)
      const [dot, circle] = reticle.update.mock.lastCall
      expect(Math.abs(dot.x - 450)).toBeLessThan(40)
      // 炮塔朝 +z、相机朝右偏 0.3 rad：圆必须落在中心一侧，不能跟着相机锁在中间
      expect(Math.abs(circle.x - dot.x)).toBeGreaterThan(100)
    })

    it('does not fake the center when the aim point cannot be projected', async () => {
      const { api, run, reticle } = await load({
        camera: facet({ aim: { t: [42, 200], yaw: [0, 0], pitch: [0, 0], ray_x: [0, 0], ray_y: [2, 2], ray_z: [-500, -500] } }),
      })
      api.seekTime(50)
      api.setCam('recorder')
      run(5)
      expect(reticle.update.mock.lastCall[0]).toBeNull()
    })

    describe('combat feedback while scoped', () => {
      const hitAt = 65.05
      const feedbackOverlay = () => {
        const anchors = new Map()
        return {
          anchors,
          setLabels: vi.fn(), clear: vi.fn(), spawnDamage: vi.fn(), clearDamages: vi.fn(),
          setAnchor: vi.fn((eid, anchor) => anchors.set(eid, { ...anchor })),
        }
      }
      const enemy = (overrides = {}) => vehicle({
        eid: 2, team: 2, nickname: 'B', tank_name: 'Krvagn', max_hp: 2664, pos: [0, 0, 100], hp: [[42, 1030]], ...overrides,
      })
      async function playAcrossHit(options) {
        const overlay = feedbackOverlay()
        const { api, run, store } = await load({ ...options, overlay })
        api.seekTime(65)
        api.setCam('recorder')
        run(12)   // 镜头过渡结束，开镜状态已生效
        expect(store.cam).toBe('recorder')
        api.setPlaying(true)
        run(3)
        api.setPlaying(false)
        return overlay
      }

      it('enemy damage produces the same fact and stays projected', async () => {
        const overlay = await playAcrossHit({ others: [enemy({ hp: [[42, 1030], [hitAt, 615]] })] })
        expect(overlay.spawnDamage.mock.calls).toEqual([[2, 415, FLOAT_DMG_MS * 2]])
        expect(overlay.anchors.get(2).projected).toBe(true)
      })

      it('own damage keeps the fact but has no projection point while hidden in the scope', async () => {
        const overlay = await playAcrossHit({ vehicleOverrides: { hp: [[42, 100], [hitAt, 60]] } })
        expect(overlay.spawnDamage.mock.calls).toEqual([[1, 40, FLOAT_DMG_MS * 2]])
        expect(overlay.anchors.get(1).projected).toBe(false)
      })
    })

    it('still bursts the recorder when it dies while scoped', async () => {
      const { api, run } = await load({ vehicleOverrides: { death_t: 66 } })
      api.seekTime(65.95)
      api.setCam('recorder')
      run(2)
      const burst = vi.spyOn(window.__battleFx, 'spawnBurst')
      api.setPlaying(true)
      run(3)
      expect(burst).toHaveBeenCalled()
    })

    it('renders the final restored FOV while paused', async () => {
      const { api, run } = await load({ vehicleOverrides: { death_t: 80 } })
      api.seekTime(65)
      api.setCam('recorder')
      run(5)
      expect(window.__camera.fov).toBe(27)
      const renderedFov = []
      vi.spyOn(window.__renderer, 'render').mockImplementation((_scene, camera) => { renderedFov.push(camera.fov) })
      api.seekTime(90)
      run(8)
      expect(window.__camera.fov).toBe(55)
      expect(renderedFov.at(-1)).toBe(55)   // 记录渲染当时的值：暂停时最后一帧也要画出来
    })

    it('falls back to Free near the old pose when the recorder dies, and only re-enables on seek back', async () => {
      const { api, store, run, reticle } = await load({ vehicleOverrides: { death_t: 80 } })
      api.seekTime(65)
      api.setCam('recorder')
      run(5)
      const before = window.__camera.position.clone()
      api.seekTime(90)
      run(1)
      expect(store.cam).toBe('free')
      expect(store.recorderViewAvailable).toBe(false)
      expect(window.__camera.position.distanceTo(before)).toBeLessThan(50)
      expect(reticle.hide).toHaveBeenCalled()
      run(5)
      expect(window.__camera.fov).toBeCloseTo(55)
      api.setCam('recorder')
      expect(store.cam).toBe('free')
      api.seekTime(50)
      expect(store.recorderViewAvailable).toBe(true)
      run(1)
      expect(store.cam).toBe('free')
    })

    it('stays disabled when the replay has no usable camera data', async () => {
      const { api, store } = await load({ camera: null })
      expect(store.recorderCameraStatus).toBe('unavailable')
      api.setCam('recorder')
      expect(store.cam).toBe('top')
    })

    it('rejects a facet for a different recorder', async () => {
      const { store } = await load({ camera: facet({ author_eid: 2 }) })
      expect(store.recorderCameraStatus).toBe('unavailable')
    })

    it('a parse failure leaves playback usable', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const frames = manualFrames()
      source.loadRecorderCameraFromFile.mockRejectedValue(new Error('boom'))
      source.loadPlaybackData.mockResolvedValue(rosterData([vehicle({ eid: 1, team: 1, nickname: 'A', tank_name: 'T', max_hp: 1, hp: [] })]))
      const { api: scene, store } = createScene()
      await scene.loadData({ kind: 'local', file: new File(['r'], 'recorder.wotbreplay') })
      await Promise.resolve()
      await Promise.resolve()
      expect(frames).toBeDefined()
      expect(store.hasData).toBe(true)
      expect(store.recorderCameraStatus).toBe('unavailable')
    })

    it('recorder mode on one replay opens the next at the default overview', async () => {
      const { api, store, run } = await load()
      api.seekTime(65)
      api.setCam('recorder')
      run(5)
      await api.loadData({ kind: 'local', file: new File(['n'], 'next.wotbreplay') })
      expect(store.cam).toBe('top')
      run(5)
      expect(window.__camera.fov).toBeCloseTo(55)
    })

    it('does not re-enable after a respawn, because a later life cannot prove camera ownership came back', async () => {
      const { api, store, run } = await load({ vehicleOverrides: { death_t: 80, resurrection_times: [90] } })
      api.seekTime(95)
      expect(window.__pbV[0].group.visible).toBe(true)
      expect(store.recorderViewAvailable).toBe(false)
      api.setCam('recorder')
      expect(store.cam).not.toBe('recorder')
      api.seekTime(65)
      expect(store.recorderViewAvailable).toBe(true)
      api.setCam('recorder')
      run(1)
      expect(store.cam).toBe('recorder')
      api.seekTime(95)
      run(1)
      expect(store.cam).toBe('free')
    })

    it('fails closed on an unknown Type23 mode instead of drawing an Arcade camera', async () => {
      const mode = { t: [42, 60, 70], raw: [1, 2, 1] }
      const { api, store, run, reticle } = await load({ camera: facet({ mode }) })
      api.seekTime(50)
      api.setCam('recorder')
      run(1)
      expect(store.cam).toBe('recorder')
      api.seekTime(65)
      run(1)
      expect(store.cam).toBe('free')
      expect(store.recorderViewAvailable).toBe(false)
      expect(store.recorderModeUnknown).toBe(true)
      expect(reticle.hide).toHaveBeenCalled()
      api.setCam('recorder')
      expect(store.cam).toBe('free')
      api.seekTime(75)
      expect(store.recorderViewAvailable).toBe(true)
      expect(store.recorderModeUnknown).toBe(false)
    })

    it('reset then Start, as the file picker does, still opens the next replay at the default overview', async () => {
      const { api, store, run } = await load()
      const overviewHeight = window.__camera.position.y
      api.seekTime(65)
      api.setCam('recorder')
      run(5)
      expect(window.__camera.position.y).not.toBeCloseTo(overviewHeight, 3)
      api.reset()
      expect(store.cam).toBe('free')
      run(5)
      await api.loadData({ kind: 'local', file: new File(['n'], 'next.wotbreplay') })
      expect(store.cam).toBe('top')
      expect(window.__camera.position.y).toBeCloseTo(overviewHeight, 3)
      run(5)
      expect(window.__camera.fov).toBeCloseTo(55)
    })
  })

  it('击杀公告带车型与敌我阵营', async () => {
    manualFrames()
    const { store, api } = createScene()
    source.loadPlaybackData.mockResolvedValue(rosterData([
      vehicle({ eid: 1, team: 1, nickname: 'Ally', tank_name: 'Maus', max_hp: 100 }),
      vehicle({ eid: 2, team: 2, nickname: 'Enemy', tank_name: 'E 100', max_hp: 100, death_t: 60 }),
    ], { kills: [{ t: 60, killer_eid: 1, victim_eid: 2, cause: 0 }] }))
    await api.loadData({ kind: 'local', file: new File(['k'], 'kills.wotbreplay') })
    api.seekTime(61)
    expect(store.killfeed.at(-1)).toMatchObject({
      kill: true, killer: 'Ally', killerTank: 'Maus', killerSide: 'ally',
      victim: 'Enemy', victimTank: 'E 100', victimSide: 'enemy',
    })
  })

  it('seek 到更晚时刻：effect 观察到名册行的 hp / dead，而不是停在满血', async () => {
    manualFrames()
    const { store, api } = createScene()
    source.loadPlaybackData.mockResolvedValue(rosterData([
      vehicle({ eid: 1, team: 1, nickname: 'CHRD-A158布丁', tank_name: 'Maus', max_hp: 3074,
        hp: [[60, 1200], [80, 0]], death_t: 80 }),
      vehicle({ eid: 2, team: 2, nickname: 'Enemy', tank_name: 'E 100', max_hp: 2700, hp: [[70, 1500]] }),
    ]))
    await api.loadData({ kind: 'local', file: new File(['x'], 'roster.wotbreplay') })
    let seen = null
    const stop = watchEffect(() => {
      seen = [...store.roster.team1, ...store.roster.team2].map(({ eid, hp, maxHp, dead }) => ({ eid, hp, maxHp, dead }))
    }, { flush: 'sync' })
    const atStart = [
      { eid: 1, hp: 3074, maxHp: 3074, dead: false },
      { eid: 2, hp: 2700, maxHp: 2700, dead: false },
    ]
    expect(seen).toEqual(atStart)
    api.seekTime(268)
    expect(store.hpFriend).toBe(0)
    expect(seen).toEqual([
      { eid: 1, hp: 0, maxHp: 3074, dead: true },
      { eid: 2, hp: 1500, maxHp: 2700, dead: false },
    ])
    api.seekTime(50)
    expect(seen).toEqual(atStart)
    stop()
  })

  it('播放中：名册随 HUD 节拍（≤10Hz）可见地推进，节流窗口内不逐帧重写，暂停补写到当前 T', async () => {
    const frames = manualFrames()
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { store, api } = createScene()
    source.loadPlaybackData.mockResolvedValue(rosterData([
      vehicle({ eid: 1, team: 1, max_hp: 3074, hp: [[42.25, 1000]], death_t: 42.45 }),
      vehicle({ eid: 2, team: 2, max_hp: 2700, hp: [[42.6, 1500]] }),
    ], { reloads: [{ eid: 1, clock: 40, phase: 3, duration_s: 10 }] }))
    await api.loadData({ kind: 'local', file: new File(['x'], 'play.wotbreplay') })
    expect(store.playing).toBe(true)
    let runs = 0
    let seen = null
    const stop = watchEffect(() => {
      runs++
      seen = [...store.roster.team1, ...store.roster.team2]
        .map(({ eid, hp, dead, reload }) => ({ eid, hp, dead, reload: reload?.[0]?.state ?? null }))
    }, { flush: 'sync' })
    expect(seen).toEqual([
      { eid: 1, hp: 3074, dead: false, reload: 'loading' },
      { eid: 2, hp: 2700, dead: false, reload: null },
    ])
    const frame = (ms) => { now += ms; frames.at(-1)() }
    runs = 0
    frame(30); frame(30); frame(30)
    expect(runs).toBe(0)
    for (let i = 0; i < 5; i++) frame(100)
    expect(seen).toEqual([
      { eid: 1, hp: 1000, dead: true, reload: null },
      { eid: 2, hp: 2700, dead: false, reload: null },
    ])
    frame(50)
    expect(seen[1].hp).toBe(2700)
    api.setPlaying(false)
    expect(store.time).toBeGreaterThan(42.6)
    expect(seen[1]).toEqual({ eid: 2, hp: 1500, dead: false, reload: null })
    stop()
  })

  it('自动停止点跟随引擎的 END：canonical 时长比 period 4 短时，播到 canonical 终点就停', async () => {
    const frames = manualFrames()
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { store, api } = createScene()
    source.loadPlaybackData.mockResolvedValue(rosterData([
      vehicle({ eid: 1, team: 1, max_hp: 3074, hp: [[42.25, 3074]] }),
    ], { periods: [{ clock: 50, period: 3 }, { clock: 290, period: 4 }] }))
    await api.loadData({ kind: 'local', file: new File(['x'], 'stop.wotbreplay') })
    expect(store.duration).toBe(290)
    api.setBattleClock({ startRaw: 50, durationSec: 100 })
    expect(store.duration).toBe(150)
    api.seekTime(149.8)
    api.setPlaying(true)
    for (let i = 0; i < 6 && frames.length; i++) { now += 100; frames.at(-1)() }
    expect(store.playing).toBe(false)
    expect(store.time).toBe(150)
  })

  it('暂停时切换跟随：名册行的 followed 立即可见（不等下次播放 / seek）', async () => {
    manualFrames()
    const { store, api } = createScene()
    source.loadPlaybackData.mockResolvedValue(rosterData([
      vehicle({ eid: 1, team: 1, max_hp: 3074 }),
      vehicle({ eid: 2, team: 2, max_hp: 2700 }),
    ]))
    await api.loadData({ kind: 'local', file: new File(['x'], 'follow.wotbreplay') })
    api.setPlaying(false)
    let followed = null
    const stop = watchEffect(() => {
      followed = [...store.roster.team1, ...store.roster.team2].filter((row) => row.followed).map((row) => row.eid)
    }, { flush: 'sync' })
    expect(followed).toEqual([])
    api.setFollow(2)
    expect(store.cam).toBe('follow')
    expect(followed).toEqual([2])
    api.setCam('top')
    expect(store.cam).toBe('top')
    expect(followed).toEqual([])
    stop()
  })

  it('炮弹在飞的帧不抛错且时间推进（折线推进 + 弧长回退尾巴）', async () => {
    const frames = manualFrames()
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { store, api } = createScene()
    source.loadPlaybackData.mockResolvedValue(rosterData([
      vehicle({ eid: 1, team: 1, max_hp: 1000, hp: [[42, 1000]] }),
      vehicle({ eid: 2, team: 2, max_hp: 1000, hp: [[42, 1000]] }),
    ], {
      shots: [{ t_fire: 42.2, eid: 1, from: [10, 0, 10], to: [60, 0, 30], flight_secs: 1 }],
    }))
    await api.loadData({ kind: 'local', file: new File(['x'], 'tracer.wotbreplay') })
    expect(store.playing).toBe(true)
    const frame = (ms) => { now += ms; frames.at(-1)() }
    for (let i = 0; i < 8; i++) frame(100)
    expect(store.time).toBeGreaterThan(42.5)
    expect(store.time).toBeLessThan(43.2)
  })
})

describe('画质四档阶梯契约（2026-10-07 重分档）', () => {
  it('四档键序固定，成本阶梯单调，内容开关按档位分布', () => {
    const keys = Object.keys(QUALITY_PRESETS)
    expect(keys).toEqual(['low', 'mid', 'high', 'ultra'])
    for (const k of ['maxDpr', 'terrainSeg', 'anisotropy']) {
      const ladder = keys.map((t) => QUALITY_PRESETS[t][k])
      expect(ladder).toEqual([...ladder].sort((a, b) => a - b))
    }
    for (const t of keys) {
      expect(QUALITY_PRESETS[t].allowGlb).toBe(t !== 'low')
      expect(QUALITY_PRESETS[t].scenery).toBe(true)
      expect(QUALITY_PRESETS[t].groundLayers).toBe(t === 'high' || t === 'ultra')
      expect(QUALITY_PRESETS[t].antialias).toBe(t !== 'low')
      expect(QUALITY_PRESETS[t].fx).toBe(FX_BUDGETS[t])   // 战斗特效预算与画质档同一键
    }
    expect(keys.map((t) => {
      const { antialias, maxDpr, anisotropy, terrainSeg, allowGlb, treadMarks, forceGlb, groundLayers } = QUALITY_PRESETS[t]
      return { antialias, maxDpr, anisotropy, terrainSeg, allowGlb, treadMarks, forceGlb, groundLayers }
    })).toEqual([
      { antialias: false, maxDpr: 1, anisotropy: 1, terrainSeg: 192, allowGlb: false, treadMarks: false, forceGlb: false, groundLayers: false },
      { antialias: true, maxDpr: 1.25, anisotropy: 2, terrainSeg: 256, allowGlb: true, treadMarks: false, forceGlb: false, groundLayers: false },
      { antialias: true, maxDpr: 1.5, anisotropy: 4, terrainSeg: 384, allowGlb: true, treadMarks: true, forceGlb: true, groundLayers: true },
      { antialias: true, maxDpr: 2, anisotropy: 8, terrainSeg: 512, allowGlb: true, treadMarks: true, forceGlb: true, groundLayers: true },
    ])
  })

  it('地面贴图四档统一用契约化的 `map`（ground.webp）；客户端 HUD 小地图不再进地面链路', async () => {
    // 2026-10-16 用户裁定（以 ±300 为准）：客户端小地图覆盖约 620 m、多出外围一圈，按 600 m 铺
    // 会压缩内容约 3% 并把圈外内容摊进边界 ⇒ 地面链路（含最低档）只认 ground.webp。
    const src = (await import('./playbackScene.js?raw')).default
    expect(src).not.toMatch(/map-mini/)
    expect(src).not.toMatch(/miniMap/)
    // All quality levels use the map loader's ground.webp path.
    const worldSrc = (await import('./playback/mapWorldLoader.ts?raw')).default
    expect(worldSrc).not.toMatch(/map-mini/)
    const groundPath = /const mapUrl = mapStaticUrl\('map', undefined, resolvedKey\);/
    expect(worldSrc).toMatch(groundPath)
    expect(worldSrc.replace("const mapUrl = mapStaticUrl('map', undefined, resolvedKey);", "const mapUrl = mapStaticUrl('map-mini', undefined, resolvedKey);")).not.toMatch(groundPath)
    const replay = (await import('./replaySource.js?raw')).default
    expect(replay).not.toMatch(/map-mini/)
  })
})

describe('会话销毁（issue #556 回归锁）', () => {
  it('没有标签覆盖层时销毁也不抛错（伤害数字改由覆盖层 DOM 呈现，场景不再持有飘字画布）', async () => {
    const { createPlaybackStore } = await import('./playbackStore.js')
    const sceneMod = await import('./playbackScene.js')
    const store = createPlaybackStore()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const api = sceneMod.initPlayback(container, store)
    expect(() => api.destroy()).not.toThrow()
    container.remove()
  })
})
