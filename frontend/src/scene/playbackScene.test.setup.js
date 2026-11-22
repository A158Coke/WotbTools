// @vitest-environment happy-dom
// playbackScene 六套场景测试的共享装配（评审抽取，#820 共享 fixture 要求）：
// 场景工厂、beforeEach/afterEach 生命周期与地形/动画帧/2d 画布夹具只保留这一份。
// vi.mock 必须留在各套件文件内提升（helper 里的 mock 对动态 import 不生效），因此
// replaySource mock 包 source 与炮口探针 muzzleTip 由各套件注入；api/created/pending 是
// **文件级**可变绑定（测试体直接赋值/读取裸 api），经 state 存取器回接到本模块的钩子与工厂。
import { afterEach, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import * as THREE from 'three'
import { assetProvider } from './assetProvider.ts'
import { createPlaybackStore } from './playbackStore.js'
import { initPlayback } from './playbackScene.js'

export function minimalData(tStart = 42, mapName = 'probe_map') {
  return {
    meta: { map_id: 1, map_name: mapName, t_start: tStart, friendly_team: 1 },
    vehicles: [], shots: [], kills: [], reloads: [], reload_effective: [], supremacy_points: new Map(),
    periods: [], supremacy_bases: [],
  }
}

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 场景内核需要一个容器元素；渲染器在数据就位后才惰性创建，这里给空节点即可。 */
export function mountContainer() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

export function installSceneTestSetup({ source, muzzleTip, state }) {
  // api/created/pending 的 owner 仍是各套件文件（测试体直接赋值/读取裸绑定），
  // 经 state 存取器回接：钩子与工厂只通过 state 读写。
  function track(d) {
    state.pending.push(d)
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
    state.api = null
    state.created.length = 0
    state.pending.length = 0
  })

  afterEach(async () => {
    for (const d of state.pending) { try { d.resolve(null) } catch (_) {} }
    for (let i = 0; i < 8; i++) await Promise.resolve()
    for (const instance of state.created) { try { instance?.destroy?.() } catch (_) {} }
    state.api = null
    state.created.length = 0
    state.pending.length = 0
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
    const api = initPlayback(mountContainer(), store)
    state.api = api
    state.created.push(api)
    return { store, api }
  }

  /** 每次 initPlayback 一个独立实例（跨实例竞态测试要同时持有 A 与 B） */
  function createInstance(store) {
    const instance = initPlayback(mountContainer(), store)
    state.created.push(instance)
    state.api = instance
    return instance
  }

  return {
    track, stubTerrainAssets, stubFrames, settleZoomFrames, pumpZoomAt, stubCanvas2d,
    createScene, createInstance,
  }
}
