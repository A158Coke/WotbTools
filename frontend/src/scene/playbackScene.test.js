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
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assetProvider } from './assetProvider.js'
import { createPlaybackStore } from './playbackStore.js'

const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), resolveMapKey: vi.fn(), mapStaticUrl: vi.fn() }))
vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  resolveMapKey: source.resolveMapKey,
  mapStaticUrl: source.mapStaticUrl,
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
      this.capabilities = { getMaxAnisotropy: () => 8 }
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
  vi.spyOn(assetProvider, 'fetch').mockImplementation((...args) => fetch(...args))
  source.loadPlaybackData.mockReset()
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
  window.history.replaceState(null, '', '/')
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
  it('prepared session feeds scene and Details without another raw parse', async () => {
    const { store, api } = createScene()
    const result = { scenePlayback: minimalData(), canonical: { dataset: { vehicles: [] }, clock: { startRaw: 42 }, reloadTelemetry: null } }
    const session = { load: vi.fn().mockResolvedValue(result) }
    const file = new File(['x'], 'shared.wotbreplay')
    await api.loadData({ kind: 'local', file, session })
    expect(session.load).toHaveBeenCalledWith(file)
    expect(source.loadPlaybackData).not.toHaveBeenCalled()
    expect(store.hasData).toBe(true)
    expect(store.playbackSession.canonical.dataset).toEqual(result.canonical.dataset)
    expect(store.playbackSession.canonical.clock.startRaw).toBe(42)
    api.reset()
    expect(store.playbackSession).toBeNull()
  })

  it('canonical failure does not block raw 3D playback', async () => {
    const { store, api } = createScene()
    const session = { load: vi.fn().mockResolvedValue({ scenePlayback: minimalData(), canonical: null, canonicalError: new Error('AI failed') }) }
    await api.loadData({ kind: 'local', file: new File(['x'], 'partial.wotbreplay'), session })
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
    expect(store.playbackSession.canonical).toBeNull()
    expect(source.loadPlaybackData).not.toHaveBeenCalled()
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

/** 真实驱动 loadMapImage 内部 await，外层预解析立即返回。 */
describe('playbackScene 资产阶段过期续体', () => {
  it.each(['same instance', 'destroy and recreate'])('A 的内部地图解析不得改写 B（%s）', async (mode) => {
    const store = createPlaybackStore()
    // A / B 使用可区分的地图名与时间轴起点：任何一处标记出现，就证明过期续体跑到了尾部
    source.loadPlaybackData
      .mockImplementationOnce(() => Promise.resolve(minimalData(917, 'map_a')))
      .mockImplementationOnce(() => Promise.resolve(minimalData(431, 'map_b')))
      .mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    // 第一次是 startPlayback 预解析，第二次才是 loadMapImage 内部解析
    const parkedA = track(deferred())
    source.resolveMapKey
      .mockResolvedValueOnce('map_a')
      .mockImplementationOnce(() => parkedA.promise)
      .mockResolvedValue('map_b')

    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    // 等 A 停进资产阶段（A 在挂起点之前已写 mapName）
    await vi.waitFor(() => expect(source.resolveMapKey).toHaveBeenCalledTimes(2))
    expect(store.assetStage).toBe(true)
    expect(store.loading).toBe(true)

    // A 被销毁（工作台切走 / file=null 的真实路径），随后 B 完整跑完
    if (mode === 'destroy and recreate') apiA.destroy()
    const apiB = mode === 'same instance' ? apiA : createInstance(store)
    await apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.mapName).toBe('map_b')
    expect(store.startTime).toBe(431)
    expect(store.mapKey).toBe('map_b')
    expect(store.hasData).toBe(true)

    // 放行 A 的资产续体：会话身份已过期，必须立刻放弃
    parkedA.resolve('map_a')
    await loadA
    // 过期续体必须放弃：A 的两个专属标记都不得被写回（B 已写完并保持）
    expect(store.mapName).toBe('map_b')      // 不是 'map_a'
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
      .mockResolvedValueOnce('map_a')
      .mockImplementationOnce(() => parked.promise)
      .mockResolvedValue(null)

    const only = createInstance(store)
    api = only
    const load = only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    await vi.waitFor(() => expect(source.resolveMapKey).toHaveBeenCalledTimes(2))
    expect(store.assetStage).toBe(true)
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

/**
 * `reset()`（工作台清空选择 / 换选场次）也落在**加载途中**：撤下必须让在途续体整体作废，
 * 而不是等它自己跑完。否则旧场解析完成会绕过 reset 把旧场景画回来，还会把 `DATA` 占住。
 */
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

    // 旧场解析迟到完成：不得落成会话、不得改写等待态
    late.resolve(minimalData(917, 'map_a'))
    await load
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.mapName).toBe('')
    expect(store.startTime).toBe(0)
    expect(store.err).toBe('')

    // DATA 也不得被旧场占用：画质选择必须仍是「就地生效」，
    // 而不是走 `if (DATA)` 的「已在播放 → 整页重载」分支
    expect(store.qualityKey).toBe('low')
    only.setQuality('mid')
    expect(store.qualityKey).toBe('mid')
  })

  it('资产途中撤下：迟到续体不得触场景，也不得把内部异常当「加载失败」写给用户', async () => {
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    // 第一次是 startPlayback 预解析，第二次（挂起）在资产阶段内部
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
    expect(store.mapName).toBe('')       // 不是 'map_a'
    expect(store.startTime).toBe(0)      // 不是 917
    expect(store.playing).toBe(false)
    expect(store.hasData).toBe(false)
    expect(store.assetStage).toBe(false)
    // 关键：续体必须「安静地」放弃。撤下已 teardown 掉 DATA（= null），若让它继续跑
    // buildVehicles，会在 DATA.vehicles 上抛错并把 TypeError 当成「加载失败」写给用户。
    expect(store.err).toBe('')
  })
})

/**
 * 场景未初始化（渲染器/时钟惰性创建前）的 HUD API 调用安全：待开播 / 解析期间切走能力
 * 再切回，面板会对 `setPaused(false)`——此时 `clock` 还不存在，恢复分支不得触场景内部
 * 对象（线上实测 TypeError: Cannot read properties of undefined (reading 'getDelta')）。
 */
describe('playbackScene 场景未初始化时的调用安全', () => {
  it('initScene 之前 pause → resume 会重新挂起被取消的 rAF，且场景 API 不炸', async () => {
    // 精确锁定线上路径：待开播时 initPlayback 已有一个空转 rAF；切走会 cancel，
    // 切回时 clock/renderer 仍不存在，但必须重新挂回 rAF。否则之后 Start 虽能 ready，
    // animation loop 仍是 0，画面与时间永久停死。
    const raf = vi.fn()
      .mockReturnValueOnce(101)
      .mockReturnValueOnce(102)
      .mockReturnValue(103)
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', cancel)

    const { store, api } = createScene()   // 只 initPlayback：clock/renderer 尚不存在
    expect(raf).toHaveBeenCalledTimes(1)
    expect(() => api.setPaused(true)).not.toThrow()
    expect(cancel).toHaveBeenCalledWith(101)

    expect(() => api.setPaused(false)).not.toThrow()
    expect(raf).toHaveBeenCalledTimes(2)   // pre-init resume 必须重新 arm animation loop

    // 后续正常 Start / initScene 仍可落成 ready；不能只是“不抛异常”。
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
    // 会话未被闸门破坏：就绪态保持、无错误（minimalData 的 END==t_start，加载完成即播完，
    // playing 落回 false 属正常，不在此断言播放态）
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
  })
})

/** 同一实例替换：B 的资源引用与高度场不得被 A 的迟到结果覆盖。 */
describe('playbackScene 资产发布顺序', () => {
  function prepareAssets(kinds) {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    source.resolveMapKey.mockResolvedValue('probe_map')
    source.mapStaticUrl.mockImplementation((kind) => kinds.includes(kind) ? '/assets/' + kind : null)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  }

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
    // 当前贴图同时被地面材质与会话引用持有，teardown 会分别释放它。
    // 若旧续体把 mapTexture 置 null，第二次释放就缺失。
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
      if (url.endsWith('terrain-meta')) return { ok: true, json: async () => ({ size: 2, span: 600, zmin: 20, zmax: 100 }) }
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
    const terrain = window.__scene.children.find((o) => o.isMesh && o.geometry.type === 'PlaneGeometry' && o.geometry.attributes.position.count > 4)
    expect(terrain).toBeDefined()
    expect(terrain.geometry.attributes.position.getZ(0)).toBeCloseTo(20)
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
  })

  it('迟到 scenery GLB 不入 B 场景，且释放局部资源与隔离进度', async () => {
    window.history.replaceState(null, '', '/?debug&q=mid')
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
    container.querySelector('canvas').dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
    // 第二个参数是原始指针事件：面板据此把详情浮窗落在与这台车相对的一侧
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBe(11)
    expect(onVehicleSelect.mock.calls[0][1]?.clientX).toBe(10)
    expect(store.cam).toBe('free')
    expect(window.__camera.position.equals(beforeCamera)).toBe(true)
    container.querySelector('canvas').dispatchEvent(new MouseEvent('pointerdown', { button: 2 }))
    expect(onVehicleSelect).toHaveBeenCalledTimes(1)
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
