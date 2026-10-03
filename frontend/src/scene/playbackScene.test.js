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
import { createPlaybackStore } from './playbackStore.js'

const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), resolveMapKey: vi.fn() }))
vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  resolveMapKey: source.resolveMapKey,
  mapStaticUrl: () => null,
}))

/**
 * 渲染器 stub：happy-dom 没有 WebGL，`initScene()` 里的 `new THREE.WebGLRenderer()` 必然抛错，
 * 于是 `startPlayback()` 在**第一个写入之前**就失败——资产阶段竞态根本无法在测试里触发。
 * 只替换 WebGLRenderer，其余 three 保持真实实现（OrbitControls / Scene / 贴图 loader 照旧）。
 */
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal()
  class StubWebGLRenderer {
    constructor() {
      this.domElement = document.createElement('canvas')
      this.toneMapping = 0
      this.toneMappingExposure = 1
      this.shadowMap = { enabled: false }
    }
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
    setAnimationLoop() {}
  }
  return { ...actual, WebGLRenderer: StubWebGLRenderer }
})

import { initPlayback } from './playbackScene.js'

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
  source.loadPlaybackData.mockReset()
  source.resolveMapKey.mockReset()
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
})

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

describe('playbackScene 会话代数契约', () => {
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

    // 新会话被接受：仍是 loading，且不得继承上一会话的就绪态
    const loadB = api.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)

    // A 迟到完成（gen 落后两代）：owned 状态必须纹丝不动
    first.reject(new Error('stale A failed'))
    await loadA
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.err).toBe('')

    // B 完成才允许落下 loading（数据源拒绝 → 走错误路径，但其 finally 仍属最新代）
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
    // 关键：不是等解析结束才清，而是接受新会话即清
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

/**
 * 跨实例竞态（review blocker 1）：真实 Workspace 生命周期是
 * 「file=null / blocked → destroy A → file=B → initPlayback B」，A 与 B 是**同一个 store**
 * 上的两个实例，各自持有自己的 `loadGeneration` 闭包。
 */
describe('playbackScene 被销毁实例不得再写共享 store', () => {
  it('destroy A → init B（同一 store）→ A 迟到结束：不得清 B 的 loading / 不得写 B 的 err', async () => {
    const store = createPlaybackStore()
    const lateA = track(deferred())
    source.loadPlaybackData
      .mockImplementationOnce(() => lateA.promise)     // A 的加载
      .mockImplementationOnce(() => new Promise(() => {}))   // B 的加载保持挂起

    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)

    // 工作台销毁 A（file=null / blocked），随后用同一 store 建 B 并开始加载
    apiA.destroy()
    const apiB = createInstance(store)
    void apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    api = apiB

    // A 迟到结束（reject）：被销毁实例的续体不得触碰共享 store
    lateA.reject(new Error('stale A after destroy'))
    await loadA
    expect(store.loading).toBe(true)          // B 仍在加载
    expect(store.hasData).toBe(false)
    expect(store.err).toBe('')                // 旧 A 的错误不得落上来
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

    // A 的数据迟到就位：不得继续资产阶段、不得标 ready、不得启动播放
    lateA.resolve(minimalData())
    await loadA
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.playing).toBe(false)
    expect(store.err).toBe('')
  })
})

/**
 * 资产阶段竞态（review blocker 2）：`startPlayback()` 的 await 之后被取代时，
 * 不得继续 buildVehicles / buildRoster / setPlaying / tick / writeHud 并标 ready。
 *
 * 挂起点用 `loadMapImage()` 内部真实的资产请求 await（`fetch(mapUrl)`）——此时 A 已经
 * 走完「数据 → teardown → 资产解析 await → buildWorld → 进入资产阶段」，是真正的中途被取代。
 *
 * 可观测探针选 `store.mapName`：它写在 `initScene()` 之后、`loadMapImage()` 之前，
 * 因此**不依赖 WebGL**（happy-dom 里渲染器创建必然失败，`startTime` 等尾部写入不可达），
 * 却能精确回答「过期续体有没有继续跑自己的资产阶段」。
 */
describe('playbackScene 资产阶段过期续体', () => {
  it('A 的资产阶段续体不得复活已被 B 取代的会话', async () => {
    const store = createPlaybackStore()
    // A / B 使用可区分的地图名与时间轴起点：任何一处标记出现，就证明过期续体跑到了尾部
    source.loadPlaybackData
      .mockImplementationOnce(() => Promise.resolve(minimalData(917, 'map_a')))
      .mockImplementationOnce(() => Promise.resolve(minimalData(431, 'map_b')))
      .mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    // 只挂起 A（第 1 次 loadMapImage 内的 resolveMapKey）；之后一律立即返回
    const parkedA = track(deferred())
    source.resolveMapKey
      .mockImplementationOnce(() => parkedA.promise)
      .mockImplementation(() => Promise.resolve(null))

    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    // 等 A 停进资产阶段（A 在挂起点之前已写 mapName）
    for (let i = 0; i < 30 && store.mapName !== 'map_a'; i++) await Promise.resolve()
    if (store.mapName !== 'map_a') throw new Error('A 未进入资产阶段: ' + JSON.stringify({ err: String(store.err), loading: store.loading }))
    expect(store.loading).toBe(true)

    // A 被销毁（工作台切走 / file=null 的真实路径），随后 B 完整跑完
    apiA.destroy()
    const apiB = createInstance(store)
    await apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.mapName).toBe('map_b')
    expect(store.startTime).toBe(431)

    // 放行 A 的资产续体：会话身份已过期，必须立刻放弃
    parkedA.resolve('map_a')
    await loadA
    // 过期续体必须放弃：A 的两个专属标记都不得被写回（B 已写完并保持）
    expect(store.mapName).toBe('map_b')      // 不是 'map_a'
    expect(store.startTime).toBe(431)
  })

  it('未过期时资产阶段正常收尾（守住修复没有把正常路径一起关掉）', async () => {
    const store = createPlaybackStore()
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData()))
    source.resolveMapKey.mockImplementation(() => Promise.resolve(null))

    const only = createInstance(store)
    api = only
    await only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    // 正常路径（未被取代）必须真的落成：loading 落下 + ready 立起。
    // 若代数复核误伤正常加载，这里会抓到。
    expect(store.loading).toBe(false)
    expect(store.hasData).toBe(true)
    expect(store.startTime).toBe(42)
  })

  /**
   * 过期会话不得启动播放：`startPlayback` 尾部（setPlaying/tick/writeHud）之前必须再复核一次
   * 会话身份。这里直接操纵内核暴露的状态让「当前会话」作废，锁住那道复核——
   * 否则被取代的会话会在资产加载返回后自行开始 tick、把旧 HUD 复活到新会话上。
   */
  it('会话作废后 startPlayback 尾部不得启动播放（不写 mapName / startTime / playing）', async () => {
    const store = createPlaybackStore()
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    // 资产阶段挂起，拿到句柄后再让「会话作废」，最后放行，模拟被取代的时序
    const parked = track(deferred())
    source.resolveMapKey
      .mockImplementationOnce(() => parked.promise)
      .mockImplementation(() => Promise.resolve(null))

    const only = createInstance(store)
    api = only
    const load = only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    for (let i = 0; i < 30 && store.mapName !== 'map_a'; i++) await Promise.resolve()
    expect(store.mapName).toBe('map_a')       // 已过入口复核、进入资产阶段

    // 会话作废（等价于新的 loadData / destroy 换掉会话身份），然后才放行资产阶段
    only.destroy()
    const epochBefore = store.startTime
    parked.resolve('map_a')
    await load

    // 过期续体必须放弃：尾部写入一个都不许落地
    expect(store.startTime).toBe(epochBefore)  // 不是 917
    expect(store.playing).toBe(false)          // 不得自行开始播放
    expect(store.hasData).toBe(false)
  })
})
