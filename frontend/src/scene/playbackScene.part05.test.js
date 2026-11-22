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
describe('destroyed vehicle visuals in the real scene lifecycle', () => {
  const vehicle = (overrides = {}) => ({
    eid: 1, account_id: 77, tank_id: 6929, team: 1, max_hp: 1000, is_author: true,
    pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
    hp: [[42, 1000]], coverage: [42, 300], death_t: 99, ...overrides,
  })
  const dataFor = (vehicles) => ({ ...minimalData(), meta: { ...minimalData().meta, duration: 300, samples: 1 }, vehicles })
  const canonicalFor = (tracks) => ({ clock: { startRaw: 42, durationSec: 200 }, dataset: { vehicles: tracks } })
  const deadTrack = (timestamp = 10) => ({ accountId: 77, lifeTransitions: [{ timeSec: 10, lifeState: 'DESTROYED', destroyedKnownAtSec: timestamp }] })

  async function load(vehicles, canonical = null, sceneData = dataFor(vehicles)) {
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
    const overlay = { setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn(), spawnDamage: vi.fn(), clearDamages: vi.fn() }
    const store = createPlaybackStore()
    api = initPlayback(mountContainer(), store, overlay)
    created.push(api)
    const state = { canonical }
    const session = { loadScene: vi.fn().mockResolvedValue(sceneData), getState: () => state }
    await api.loadData({ kind: 'local', file: new File(['replay'], 'wreck.wotbreplay'), session })
    api.setPlaying(false)
    return { api, store, overlay, frames, vehicles: window.__pbV }
  }

  /**
   * 伤害数字由 HTML 覆盖层呈现（血条右侧的 DOM 几何），场景只负责在掉血事件跨过回放时钟时
   * 生成一次、并在 seek 时清空：数字不能因为"曾经在屏幕上"而在倒带 / 重播时补播。
   */
  it('掉血事件生成一次覆盖层伤害数字（3D 寿命系数），seek 清空且不补播', async () => {
    const { api, frames, overlay } = await load([vehicle({ hp: [[42, 1000], [50, 600]] })])
    api.seekTime(49.9)
    api.setPlaying(true)
    frames.shift()()   // 越过 t=50：掉血 400
    expect(overlay.spawnDamage).toHaveBeenCalledWith(1, 400, FLOAT_DMG_MS * 2)

    api.setPlaying(false)
    overlay.clearDamages.mockClear()
    api.seekTime(40)
    expect(overlay.clearDamages, 'seek 必须清空屏幕上的伤害数字').toHaveBeenCalled()

    overlay.spawnDamage.mockClear()
    api.setPlaying(true)
    frames.shift()()
    expect(overlay.spawnDamage, '倒带后不得补播历史伤害数字').not.toHaveBeenCalled()
    api.setPlaying(false)
  })

  /** 幽灵段契约走真实 writer → reader：强制发布一次标签后读场景交给覆盖层的行。 */
  const publishedRow = (api, overlay) => {
    api.setLabelPrefs({})
    return overlay.setLabels.mock.lastCall[0].find((row) => row.eid === 1)
  }
  async function playTo(vehicleOverrides, startAt = 49.9) {
    const loaded = await load([vehicle(vehicleOverrides)])
    loaded.api.seekTime(startAt)
    loaded.api.setPlaying(true)
    return loaded
  }

  it('1030 → 615：数字、幽灵段、受击闪来自同一次掉血事实', async () => {
    const { api, frames, overlay } = await playTo({ max_hp: 2000, hp: [[42, 1030], [50, 615]] })
    frames.shift()()
    expect(overlay.spawnDamage).toHaveBeenCalledTimes(1)
    expect(overlay.spawnDamage).toHaveBeenCalledWith(1, 415, FLOAT_DMG_MS * 2)
    const row = publishedRow(api, overlay)
    expect(row.hp.current).toBe(615)
    expect(row.hpFlash).toBe(true)
    expect(row.hpGhost.prevPct).toBeCloseTo(51.5)
    expect(row.hpGhost.nextPct).toBeCloseTo(30.75)
    api.setPlaying(false)
  })

  it('幽灵段区间：损失前后比例直接来自 HP 链，全部是有限数', async () => {
    const { api, frames, overlay } = await playTo({ max_hp: 2000, hp: [[42, 1000], [50, 600]] })
    frames.shift()()
    const { hpGhost } = publishedRow(api, overlay)
    expect(hpGhost).toEqual({ prevPct: 50, nextPct: 30, bornMs: expect.any(Number), durationMs: GHOST_MS * 2 })
    expect(Number.isFinite(hpGhost.prevPct) && Number.isFinite(hpGhost.nextPct)).toBe(true)
    api.setPlaying(false)
  })

  it('存活期内连续受击：同一段向下延伸并重启寿命，不产生第二段', async () => {
    const { api, frames, overlay } = await playTo({ max_hp: 1000, hp: [[42, 1000], [50, 800], [50.3, 500]] })
    frames.shift()()
    const first = publishedRow(api, overlay).hpGhost
    expect(first).toMatchObject({ prevPct: 100, nextPct: 80 })
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + GHOST_MS)
    for (let i = 0; i < 5; i++) frames.shift()()
    const second = publishedRow(api, overlay).hpGhost
    expect(second).toMatchObject({ prevPct: 100, nextPct: 50 })
    expect(second.bornMs).toBeGreaterThan(first.bornMs)
    api.setPlaying(false)
  })

  it('一个 tick 跨过同车两次掉血：区间覆盖两次的总损失', async () => {
    const { api, frames, overlay } = await playTo({ max_hp: 1000, hp: [[42, 1000], [49.92, 800], [49.95, 500]] })
    frames.shift()()
    expect(overlay.spawnDamage).toHaveBeenCalledTimes(2)
    expect(publishedRow(api, overlay).hpGhost).toMatchObject({ prevPct: 100, nextPct: 50 })
    api.setPlaying(false)
  })

  it('上一段过期后再受击：只显示新损失，不向上延伸', async () => {
    const { api, frames, overlay } = await playTo({ max_hp: 1000, hp: [[42, 1000], [50, 800], [50.3, 500]] })
    frames.shift()()
    const now = performance.now()
    vi.spyOn(performance, 'now').mockReturnValue(now + GHOST_MS * 2 + 1)
    for (let i = 0; i < 5; i++) frames.shift()()
    expect(publishedRow(api, overlay).hpGhost).toMatchObject({ prevPct: 80, nextPct: 50 })
    api.setPlaying(false)
  })

  const detachedTrack = () => ({ eid: 9, vehicle_eid: 1, coverage: [52, 60, 80, 100], pose_kf: {
    t: [52, 54, 80, 82], pos: [1, 2, 3, 3, 4, 5, 20, 2, 30, 22, 2, 32],
    yaw: [0, 1, 2, 3], pitch: [0, 0.2, 0.4, 0.6], roll: [0, 0.4, 0.8, 1],
  } })

  it('separates the original proxy head at the known entity time, seeks/rewinds and respects AoI gaps', async () => {
    const sceneData = dataFor([vehicle({ death_t: 52 }), vehicle({ eid: 2, account_id: 88, hp: [[42, 0]], death_t: 52 })])
    sceneData.detached_turrets = [detachedTrack()]
    const { api, vehicles } = await load(sceneData.vehicles, null, sceneData)
    const [owner, other] = vehicles, head = owner.detachedTurrets[0]
    expect(head.root.visible).toBe(false); expect(owner.turretG.visible).toBe(true)
    expect(other.detachedTurrets).toHaveLength(0)
    api.seekTime(53)
    expect(owner.turretG.visible).toBe(false); expect(other.turretG.visible).toBe(true)
    expect(head.root.visible).toBe(true)
    expect(head.root.position.toArray()).toEqual([-2, 3, 4])
    expect(head.root.quaternion.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.5, -0.2, 'YXZ')))).toBeCloseTo(0)
    api.seekTime(70)
    expect(head.root.visible).toBe(false); expect(owner.turretG.visible).toBe(false)
    api.seekTime(81)
    expect(head.root.position.toArray()).toEqual([-21, 2, 31])
    api.setLabelPrefs({ classIcons: true })
    expect(head.root.visible).toBe(false)
    api.setLabelPrefs({ classIcons: false })
    expect(head.root.visible).toBe(true)
    api.seekTime(51)
    expect(head.root.visible).toBe(false); expect(owner.turretG.visible).toBe(true)
    api.seekTime(53)
    expect(head.root.position.toArray()).toEqual([-2, 3, 4])
    const disposed = head.proxyVisual.materials.map(({ material }) => vi.spyOn(material, 'dispose'))
    api.reset()
    expect(window.__scene.children).not.toContain(head.root)
    for (const dispose of disposed) expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('复活后装回炮塔：上一世的飞头不让新车继续无炮塔（issue #622 review P2）', async () => {
    // 同一 eid 死（52s 飞头）→ 复活（70s）：分离只属于那一世；飞头实体自身照旧按自己的 coverage 渲染。
    const sceneData = dataFor([vehicle({ death_t: 52, resurrection_times: [70] })])
    sceneData.detached_turrets = [detachedTrack()]
    const { api, vehicles } = await load(sceneData.vehicles, null, sceneData)
    const owner = vehicles[0], head = owner.detachedTurrets[0]
    expect(owner.turretG.visible).toBe(true)          // 分离前：装炮塔
    api.seekTime(53)
    expect(owner.turretG.visible).toBe(false)         // 分离期：摘掉炮塔
    expect(head.root.visible).toBe(true)
    api.seekTime(71)
    expect(owner.turretG.visible).toBe(true)          // 复活后：装回炮塔
    api.seekTime(81)
    expect(owner.turretG.visible).toBe(true)          // 复活后飞头仍在视野（coverage 80~100）也不摘
    expect(head.root.visible).toBe(true)
    api.seekTime(53)
    expect(owner.turretG.visible).toBe(false)         // 倒带回到分离世：恢复摘除
  })

  it('uses the same replay clock for pause and speed, with direct seek matching forward playback', async () => {
    const sceneData = dataFor([vehicle({ death_t: 52 })]); sceneData.detached_turrets = [detachedTrack()]
    const { api, vehicles, frames } = await load(sceneData.vehicles, null, sceneData)
    const head = vehicles[0].detachedTurrets[0]
    api.seekTime(52.8)
    api.setSpeed(2); api.setPlaying(true)
    frames.at(-1)()
    expect(head.root.position.x).toBeCloseTo(-2)
    const playedPosition = head.root.position.clone(), playedRotation = head.root.quaternion.clone()
    api.setPlaying(false)
    frames.at(-1)()
    expect(head.root.position.equals(playedPosition)).toBe(true)
    api.seekTime(51); api.seekTime(53)
    expect(head.root.position.distanceTo(playedPosition)).toBeCloseTo(0)
    expect(head.root.quaternion.angleTo(playedRotation)).toBeCloseTo(0)
  })

  it('late GLB replaces the detached proxy while paused and cleans only owned materials on toggle/replacement', async () => {
    window.history.replaceState(null, '', '/?debug&q=mid')
    const parked = track(deferred())
    vi.spyOn(assetProvider, 'bytes').mockReturnValue(parked.promise)
    vi.spyOn(assetProvider, 'json').mockImplementation(path => Promise.resolve(
      String(path).startsWith('/tank/') ? { model_origins: { track: [0, 0, 0], turret: [0, 0, 2] }, configs: [] } : null))
    const texture = new THREE.Texture(), geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4 })
    const template = new THREE.Group()
    for (const name of ['hull', 'turret_0', 'gun_0']) {
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name; template.add(mesh)
    }
    vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, _path, done) => done({ scene: template }))
    const texDispose = vi.spyOn(texture, 'dispose'), geoDispose = vi.spyOn(geometry, 'dispose')
    const sceneData = dataFor([vehicle({ death_t: 52 })]); sceneData.detached_turrets = [detachedTrack()]
    const { api, vehicles } = await load(sceneData.vehicles, null, sceneData)
    const owner = vehicles[0], head = owner.detachedTurrets[0]
    api.seekTime(55); api.setGlb(true); parked.resolve(new Uint8Array([1]))
    await vi.waitFor(() => expect(head.glb).toBeTruthy())
    expect(owner.glbParts.turretNode.visible).toBe(false)
    expect(owner.glbParts.gunNodes.every(n => !n.visible)).toBe(true)
    expect(head.proxy.visible).toBe(false); expect(head.glb.visible).toBe(true)
    expect(head.glb.children).toHaveLength(2)
    expect(head.glbVisual.amount).toBe(1)
    expect(head.glbVisual.materials[0].material).not.toBe(owner.glbVisual.materials[0].material)
    expect(material.roughness).toBe(0.4)
    const disposed = head.glbVisual.materials.map(({ material }) => vi.spyOn(material, 'dispose'))
    api.setGlb(false)
    expect(head.glb).toBeNull(); expect(head.proxy.visible).toBe(true)
    expect(head.root.visible).toBe(true); expect(owner.turretG.visible).toBe(false)
    for (const dispose of disposed) expect(dispose).toHaveBeenCalledTimes(1)
    expect(texDispose).not.toHaveBeenCalled(); expect(geoDispose).not.toHaveBeenCalled()
    api.setGlb(true)
    await vi.waitFor(() => expect(head.glb).toBeTruthy())
    api.seekTime(51)
    expect(owner.glbParts.turretNode.visible).toBe(true); expect(head.root.visible).toBe(false)
    const activeDisposed = head.glbVisual.materials.map(({ material }) => vi.spyOn(material, 'dispose'))
    const next = dataFor([vehicle({ tank_id: 0, death_t: null })])
    await api.loadData({ kind: 'local', file: new File(['next'], 'next.wotbreplay'), session: { loadScene: vi.fn().mockResolvedValue(next), getState: () => ({ canonical: null }) } })
    await Promise.resolve()
    expect(window.__scene.children).not.toContain(head.root)
    for (const dispose of activeDisposed) expect(dispose).toHaveBeenCalledTimes(1)
    expect(texDispose).toHaveBeenCalledTimes(1); expect(geoDispose).toHaveBeenCalledTimes(1)
    expect(window.__pbV[0].detachedTurrets).toHaveLength(0)
  })

  it('converts canonical battle seconds, keeps labels/roster/model consistent and rewinds without HP inference', async () => {
    const tracks = [deadTrack(), { accountId: 88, lifeTransitions: [{ timeSec: 0, lifeState: 'ALIVE' }] }]
    const { api, store, overlay, vehicles } = await load([
      vehicle(), vehicle({ eid: 2, account_id: 88, is_author: false, hp: [[42, 0]], death_t: 45 }),
    ], canonicalFor(tracks))
    const [a, b] = vehicles
    const ring = a.group.children.find(child => child.userData.keepWithGlb)
    const ringColor = ring.material.color.clone()
    expect(a.proxyVisual.materials[0].material).not.toBe(b.proxyVisual.materials[0].material)
    api.seekTime(51)
    expect(a.proxyVisual.amount).toBe(0)
    expect(store.roster.team1[0].dead).toBe(false)
    api.seekTime(52.30)
    expect(a.proxyVisual.amount).toBeCloseTo(0)
    expect(store.roster.team1[0].dead).toBe(true)
    expect(overlay.setLabels.mock.calls.at(-1)[0].map(row => row.destroyed)).toEqual([true, false])
    api.seekTime(52.55)
    expect(a.proxyVisual.amount).toBeCloseTo(0.5)
    api.seekTime(52.80)
    expect(a.proxyVisual.amount).toBe(1)
    expect(b.proxyVisual.amount).toBe(0)
    expect(store.roster.team1[1].dead).toBe(false)
    expect(ring.material.color.equals(ringColor)).toBe(true)
    api.seekTime(51)
    expect(a.proxyVisual.amount).toBe(0)
    expect(store.roster.team1[0].dead).toBe(false)
  })

  it('canonical arriving/removing while paused replaces fallback immediately at the unchanged time', async () => {
    const { api, store, vehicles, overlay } = await load([vehicle({ death_t: 45 })])
    api.seekTime(60)
    expect(vehicles[0].proxyVisual.amount).toBe(1)
    store.playbackSession.canonical = canonicalFor([{ accountId: 77, lifeTransitions: [{ timeSec: 0, lifeState: 'ALIVE' }] }])
    api.setBattleClock(store.playbackSession.canonical.clock)
    expect(vehicles[0].proxyVisual.amount).toBe(0)
    expect(store.roster.team1[0].dead).toBe(false)
    expect(overlay.setLabels.mock.calls.at(-1)[0][0].destroyed).toBe(false)
    store.playbackSession.canonical = canonicalFor([deadTrack(null)])
    api.setBattleClock(store.playbackSession.canonical.clock)
    expect(vehicles[0].proxyVisual.amount).toBe(1)
    store.playbackSession.canonical = canonicalFor([])
    api.setBattleClock(store.playbackSession.canonical.clock)
    expect(vehicles[0].proxyVisual.amount).toBe(0)
    store.playbackSession.canonical = null
    api.setBattleClock(null)
    expect(vehicles[0].proxyVisual.amount).toBe(1)
    expect(store.roster.team1[0].dead).toBe(true)
  })

  it.each([0.5, 1, 2, 4, 8])('transition advances only on the playback clock at speed %s', async (speed) => {
    const { api, frames, vehicles } = await load([vehicle({ death_t: 52 })])
    api.seekTime(52.30)
    frames.shift()()
    expect(vehicles[0].proxyVisual.amount).toBeCloseTo(0)
    api.setSpeed(speed)
    api.setPlaying(true)
    frames.shift()()
    const progress = Math.min(1, (0.1 * speed) / 0.5)
    expect(vehicles[0].proxyVisual.amount).toBeCloseTo(progress * progress * (3 - 2 * progress))
    api.setPlaying(false)
    const frozen = vehicles[0].proxyVisual.amount
    frames.shift()()
    expect(vehicles[0].proxyVisual.amount).toBe(frozen)
  })

  it('late same-model GLBs attach at paused T, isolate materials and dispose clones across toggles/session replacement', async () => {
    window.history.replaceState(null, '', '/?debug&q=mid')
    const parked = track(deferred())
    vi.spyOn(assetProvider, 'bytes').mockReturnValue(parked.promise)
    vi.spyOn(assetProvider, 'json').mockImplementation(path => Promise.resolve(
      String(path).startsWith('/tank/') ? { model_origins: { track: [0, 0, 0], turret: [0, 0, 0] }, configs: [] } : null))
    const texture = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4 })
    const geometry = new THREE.BoxGeometry()
    const template = new THREE.Group()
    for (const name of ['hull', 'turret_0', 'gun_0']) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = name
      template.add(mesh)
    }
    vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, _path, done) => done({ scene: template }))
    const texDispose = vi.spyOn(texture, 'dispose'), geoDispose = vi.spyOn(geometry, 'dispose'), templateDispose = vi.spyOn(material, 'dispose')
    const { api, vehicles, store } = await load([
      vehicle({ death_t: 52 }), vehicle({ eid: 2, account_id: 88, death_t: null, is_author: false }),
    ])
    api.seekTime(60)
    api.setGlb(true)
    parked.resolve(new Uint8Array([1]))
    await vi.waitFor(() => expect(vehicles.every(v => v.glb)).toBe(true))
    const [a, b] = vehicles
    expect(a.glbVisual.amount).toBe(1)
    expect(b.glbVisual.amount).toBe(0)
    expect(a.glbVisual.materials[0].material.roughness).toBeCloseTo(0.9)
    expect(b.glbVisual.materials[0].material.roughness).toBe(0.4)
    expect(material.roughness).toBe(0.4)
    const disposes = vehicles.map(v => vi.spyOn(v.glbVisual.materials[0].material, 'dispose'))
    api.setGlb(false)
    for (const dispose of disposes) expect(dispose).toHaveBeenCalledTimes(1)
    expect(texDispose).not.toHaveBeenCalled()
    expect(geoDispose).not.toHaveBeenCalled()
    expect(templateDispose).not.toHaveBeenCalled()
    api.setGlb(true)
    await vi.waitFor(() => expect(vehicles.every(v => v.glb)).toBe(true))
    expect(a.glbVisual.amount).toBe(1)
    api.seekTime(51)
    expect(a.glbVisual.amount).toBe(0)
    const activeDisposes = vehicles.map(v => vi.spyOn(v.glbVisual.materials[0].material, 'dispose'))
    const proxyDisposes = vehicles.map(v => vi.spyOn(v.proxyVisual.materials[0].material, 'dispose'))
    const nextSession = { loadScene: vi.fn().mockResolvedValue(dataFor([vehicle({ tank_id: 0, death_t: null })])), getState: () => ({ canonical: null }) }
    await api.loadData({ kind: 'local', file: new File(['next'], 'next.wotbreplay'), session: nextSession })
    await Promise.resolve()
    for (const dispose of [...activeDisposes, ...proxyDisposes]) expect(dispose).toHaveBeenCalledTimes(1)
    expect(texDispose).toHaveBeenCalledTimes(1)
    expect(geoDispose).toHaveBeenCalledTimes(1)
    expect(templateDispose).toHaveBeenCalledTimes(1)
    expect(window.__pbV[0].proxyVisual.amount).toBe(0)
    expect(store.roster.team1[0].dead).toBe(false)
  })

  it('GLB completion after session replacement cannot attach or allocate instance material clones', async () => {
    window.history.replaceState(null, '', '/?debug&q=mid')
    const parked = track(deferred())
    vi.spyOn(assetProvider, 'bytes').mockReturnValue(parked.promise)
    vi.spyOn(assetProvider, 'json').mockResolvedValue(null)
    const material = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry()
    const template = new THREE.Group()
    template.add(new THREE.Mesh(geometry, material))
    const clone = vi.spyOn(material, 'clone'), dispose = vi.spyOn(material, 'dispose')
    vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, _path, done) => done({ scene: template }))
    const { api, vehicles } = await load([vehicle()])
    api.setGlb(true)
    const nextSession = { loadScene: vi.fn().mockResolvedValue(dataFor([])), getState: () => ({ canonical: null }) }
    await api.loadData({ kind: 'local', file: new File(['next'], 'next.wotbreplay'), session: nextSession })
    parked.resolve(new Uint8Array([1]))
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1))
    expect(clone).not.toHaveBeenCalled()
    expect(vehicles[0].glb).toBeUndefined()
    expect(window.__pbV).toHaveLength(0)
  })

  const activeBursts = () => window.__battleFx?.activeBursts() ?? []
  const fxMesh = (name) => window.__battleFx.root.children.find(object => object.name === name)

  it('authoritative raw death without a kill makes a burst even after coverage ended; particles follow the wall clock and every FX resource is freed once', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { api, frames, vehicles } = await load([vehicle({ death_t: 52, coverage: [42, 51] })])
    api.seekTime(51.9)
    expect(vehicles[0].group.visible).toBe(false)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(vehicles[0].group.visible).toBe(true)
    expect(activeBursts()).toHaveLength(1)
    expect(activeBursts()[0].x).toBe(vehicles[0].group.position.x)
    expect(window.__battleFx.budget).toBe(QUALITY_PRESETS.low.fx)   // the suite runs with ?q=low
    const glow = fxMesh('battle-fx-glow'), smoke = fxMesh('battle-fx-smoke')
    expect(glow.visible).toBe(true)   // flash + fireball are written in the death frame
    expect(glow.material.blending).toBe(THREE.AdditiveBlending)
    for (const object of window.__battleFx.root.children) {
      expect(object.material.depthTest).toBe(true)
      expect(object.material.toneMapped).toBe(false)  // per-map exposure must not alter flame/spark colours
    }
    const resources = new Set(window.__battleFx.root.children.flatMap(object => [object.geometry, object.material]))
    resources.add(glow.material.uniforms.uMap.value)
    const disposes = [...resources].map(resource => vi.spyOn(resource, 'dispose'))
    now += 1500
    frames.shift()()
    expect(activeBursts()).toHaveLength(1)
    expect(smoke.geometry.instanceCount).toBeGreaterThan(0)  // smoke outlives the fireball
    now += BURST_SECS * 1000 - 1500
    frames.shift()()
    expect(activeBursts()).toHaveLength(0)
    expect(glow.visible).toBe(false)
    for (const dispose of disposes) expect(dispose).not.toHaveBeenCalled()
    api.seekTime(51.9)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(1)  // playing through the death again triggers it once more
    api.reset()
    for (const dispose of disposes) expect(dispose).toHaveBeenCalledTimes(1)
    expect(window.__battleFx).toBeUndefined()
  })

  const shotPair = () => [
    vehicle({ death_t: null }),
    vehicle({ eid: 2, account_id: 88, team: 2, is_author: false, pos: [100, 0, 0], death_t: null }),
  ]
  const fxStats = () => window.__battleFx.stats()

  it('shots: muzzle at fire, impact on arrival, trail held on the replay clock while paused, expired after hold + fade, cleared by seek', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const vehicles = shotPair()
    const shot = { t_fire: 50, shooter_eid: 1, target_eid: 2, from: [0, 2, 0], to: [-100, 2, 0], flight_secs: 0.2, game_hit_result: 3 }
    const { api, frames } = await load(vehicles, null, { ...dataFor(vehicles), shots: [shot] })
    api.seekTime(49.95)
    api.setPlaying(true)
    const muzzle = vi.spyOn(window.__battleFx, 'spawnMuzzle')
    frames.shift()()   // T 50.05: fired, in flight
    expect(fxStats()).toMatchObject({ muzzles: 1, impacts: 0, ribbons: 2 })   // tracer + trail
    // no GLB on the shooter (proxy vehicle): muzzle effects fall back to the recorded origin
    expect(muzzle).toHaveBeenCalledTimes(1)
    expect(muzzle.mock.calls[0][0].toArray()).toEqual([-0, 2, 0])
    expect(muzzle.mock.calls[0][1].toArray()).toEqual([1, 0, 0])
    const tracer = window.__battleFx.root.children.find(object => object.name === 'battle-fx-tracer')
    expect(tracer.material.uniforms.uCA.value.getHex()).toBe(0x3ee08a)   // friendly shooter: green tracer
    frames.shift()()
    frames.shift()()   // T 50.25 > arrival 50.2: impact, tracer returned
    expect(fxStats()).toMatchObject({ impacts: 1, ribbons: 1 })
    api.setPlaying(false)
    now += 10_000
    for (let i = 0; i < 3; i++) frames.shift()()   // wall clock runs on while the replay is paused
    expect(fxStats()).toMatchObject({ impacts: 0, muzzles: 0, ribbons: 1 })   // trail waits on the replay clock
    api.setPlaying(true)
    for (let i = 0; i < 38; i++) frames.shift()()   // T ≈ 54.05 < arrival + 2.5 s hold + 1.5 s fade
    expect(fxStats().ribbons).toBe(1)
    for (let i = 0; i < 3; i++) frames.shift()()
    expect(fxStats().ribbons).toBe(0)
    api.setPlaying(false)
    api.seekTime(49.95)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(fxStats()).toMatchObject({ muzzles: 1, ribbons: 2 })
    api.seekTime(49)
    expect(fxStats()).toMatchObject({ impacts: 0, muzzles: 0, ribbons: 0 })   // seek clears and never replays history
  })

  it('barrel: muzzle effects at the barrel tip; tracer and trail stay hidden inside the barrel and start at the muzzle', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    muzzleTip.reach = 8   // muzzle 8 m ahead of the recorded origin (gun pivot)
    const vehicles = shotPair()
    // 100 m in 2 s = 5 m per 0.1 s frame; a second point-blank shot lands 3 m out, inside the barrel
    const shots = [
      { t_fire: 50, shooter_eid: 1, target_eid: 2, from: [0, 2, 0], to: [-100, 2, 0], flight_secs: 2, game_hit_result: 3 },
      { t_fire: 60, shooter_eid: 1, target_eid: 2, from: [0, 2, 0], to: [-3, 2, 0], flight_secs: 0.3, game_hit_result: 3 },
    ]
    const { api, frames } = await load(vehicles, null, { ...dataFor(vehicles), shots })
    const fx = window.__battleFx
    const muzzle = vi.spyOn(fx, 'spawnMuzzle')
    const named = (name) => fx.root.children.filter((o) => o.name === name && o.visible)
    api.seekTime(49.95)
    api.setPlaying(true)
    frames.shift()()   // T 50.05: head 2.5 m out, still in the barrel
    expect(muzzle.mock.calls[0][0].toArray()).toEqual([8, 2, 0])
    expect(fxStats()).toMatchObject({ muzzles: 1, ribbons: 2 })
    expect(named('battle-fx-tracer')).toHaveLength(0)
    expect(named('battle-fx-trail')).toHaveLength(0)
    frames.shift()()   // T 50.15: 7.5 m, still in the barrel
    expect(named('battle-fx-tracer')).toHaveLength(0)
    frames.shift()()   // T 50.25: 12.5 m, out of the muzzle; tail clamped to the muzzle, not 14 m back
    const [tracer] = named('battle-fx-tracer')
    expect(tracer.material.uniforms.uA.value.x).toBeCloseTo(8, 5)
    expect(tracer.material.uniforms.uB.value.x).toBeCloseTo(12.5, 5)
    const [trail] = named('battle-fx-trail')
    expect(trail.material.uniforms.uA.value.x).toBeCloseTo(8, 5)
    expect(trail.material.uniforms.uB.value.x).toBeCloseTo(12.5, 5)
    api.setPlaying(false)
    api.seekTime(59.95)
    api.setPlaying(true)
    for (let i = 0; i < 5; i++) frames.shift()()   // point-blank: the whole 3 m path is inside the barrel
    expect(named('battle-fx-tracer')).toHaveLength(0)
    expect(named('battle-fx-trail')).toHaveLength(0)
    expect(muzzle.mock.calls[1][0].toArray()).toEqual([8, 2, 0])   // the flash still sits at the barrel tip
    expect(fxStats().impacts).toBe(1)                              // and the hit still lands on arrival
  })

  it.each([1, 2, 4, 8])('moving shooter at %sx with 100 ms frames: muzzle flash and trail start come from the barrel at fire time', async (speed) => {
    // PR #613 审查回归：真实 muzzleTipOf + 合成 GLB。射手 10 m/s 沿 +z 前进、t=50 过原点并开火，
    // 炮管从枢轴向前 4.5 m；处理帧晚于开火（倍速 × 0.1 s 帧）时，起点不得混入开火后的位移。
    window.history.replaceState(null, '', '/?debug&q=mid')
    const parked = track(deferred())
    vi.spyOn(assetProvider, 'bytes').mockReturnValue(parked.promise)
    vi.spyOn(assetProvider, 'json').mockImplementation(path => Promise.resolve(
      String(path).startsWith('/tank/') ? { model_origins: { track: [0, 0, 0], turret: [0, 0, 0] }, configs: [] } : null))
    const template = new THREE.Group()
    for (const [name, geometry] of [
      ['hull', new THREE.BoxGeometry(3, 6, 2)],
      ['turret_0', new THREE.BoxGeometry(2, 2, 1)],
      ['gun_0', new THREE.BoxGeometry(0.2, 4.5, 0.2).translate(0, 2.25, 0)],   // GLB 系 +y = 车头
    ]) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
      mesh.name = name
      template.add(mesh)
    }
    vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, _path, done) => done({ scene: template }))
    const n = 300, pos = []
    for (let i = 0; i < n; i++) pos.push(0, 0, (42 + i * 0.1 - 50) * 10)
    const zeros = new Array(n).fill(0)
    const shooter = vehicle({ death_t: null, pos, hull_yaw: zeros, hull_pitch: zeros, turret_yaw: zeros, gun_pitch: zeros })
    const data = dataFor([shooter])
    data.meta.samples = n
    data.shots = [{ t_fire: 50, shooter_eid: 1, target_eid: 2, from: [0, 0, 0], to: [0, 0, 100], flight_secs: 0.16, game_hit_result: 3 }]
    const { api, frames, vehicles } = await load([shooter], null, data)
    api.seekTime(49.95)
    api.setGlb(true)
    parked.resolve(new Uint8Array([1]))
    await vi.waitFor(() => expect(vehicles[0].glb).toBeTruthy())
    const muzzle = vi.spyOn(window.__battleFx, 'spawnMuzzle')
    api.setSpeed(speed)
    api.setPlaying(true)
    frames.shift()()   // 一帧 0.1 s × 倍速：处理帧落在开火后 0.05 / 0.15 / 0.35 / 0.75 s
    api.setPlaying(false)
    expect(vehicles[0].group.position.z).toBeCloseTo((0.1 * speed - 0.05) * 10, 5)   // 射手确实已前移
    expect(muzzle).toHaveBeenCalledTimes(1)
    expect(muzzle.mock.calls[0][0].z).toBeCloseTo(4.5, 4)
    const trail = window.__battleFx.root.children.find((o) => o.name === 'battle-fx-trail' && o.visible)
    expect(trail.material.uniforms.uA.value.z).toBeCloseTo(4.5, 4)
    // 摆回 T：开火定位后车模停在本帧姿态，没有留在开火时刻
    vehicles[0].glb.updateMatrixWorld(true)
    expect(vehicles[0].glb.position.z).toBeCloseTo(vehicles[0].group.position.z, 6)
  })

  it('ricochet: the impact fires when the shell reaches the hit point while the tracer continues along the exit leg', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const vehicles = shotPair()
    const shot = { t_fire: 50, shooter_eid: 2, target_eid: 1, is_author: true, hit_flags: 0x0008,
      from: [-100, 2, 0], via: [[0, 2, 0]], leg_secs: [0.1, 0.5], to: [20, 40, 60], flight_secs: 0.6 }
    const { api, frames } = await load(vehicles, null, { ...dataFor(vehicles), shots: [shot] })
    api.seekTime(49.95)
    api.setPlaying(true)
    frames.shift()()   // T 50.05: first leg
    expect(fxStats()).toMatchObject({ impacts: 0, ribbons: 3 })   // tracer + one trail per leg
    frames.shift()()   // T 50.15: past the hit point, still flying the exit leg
    api.setPlaying(false)
    expect(fxStats()).toMatchObject({ impacts: 1, ribbons: 3 })
    const tracer = window.__battleFx.root.children.find(object => object.name === 'battle-fx-tracer')
    expect(tracer.material.uniforms.uCA.value.getHex()).toBe(0xff5a45)   // enemy shooter: red tracer
  })

  it('high tier: wreck smoke follows the life fact — present after death, gone on rewind — and adds no redraws while paused', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    const vehicles = [vehicle({ death_t: 52, coverage: [42, 51] })]
    const { api, frames } = await load(vehicles)
    expect(window.__battleFx.budget).toBe(QUALITY_PRESETS.high.fx)
    const smoke = () => window.__battleFx.root.children.find(object => object.name === 'battle-fx-smoke')
    api.seekTime(60)
    frames.shift()()
    expect(smoke().geometry.instanceCount).toBeGreaterThan(0)
    const render = vi.spyOn(window.__renderer, 'render')
    frames.shift()()
    expect(render).not.toHaveBeenCalled()   // paused, nothing transient alive: on-demand rendering stays idle
    api.seekTime(51)
    frames.shift()()
    expect(smoke().geometry.instanceCount).toBe(0)
  })

  it('canonical death is timed with the same raw offset as the wreck, and repeated transitions do not spawn twice', async () => {
    const track = deadTrack()
    track.lifeTransitions.push({ timeSec: 11, lifeState: 'DESTROYED', destroyedKnownAtSec: 10 })
    const { api, frames, vehicles } = await load([vehicle()], canonicalFor([track]))
    api.seekTime(51.9)
    api.setPlaying(true)
    frames.shift()()
    expect(activeBursts()).toHaveLength(1)
    const burst = activeBursts()[0]
    for (let i = 0; i < 11; i++) frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toEqual([burst])
    expect(vehicles[0].proxyVisual.amount).toBe(1)
    api.seekTime(100)
    expect(activeBursts()).toHaveLength(0)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(0)  // seeking never replays historical explosions
  })

  it('respawn track: DESTROYED→ALIVE→DESTROYED — wreck un-fades on resurrection, roster follows (issue #622)', async () => {
    const track = { accountId: 77, lifeTransitions: [
      { timeSec: 10, lifeState: 'DESTROYED', destroyedKnownAtSec: 10 },
      { timeSec: 20, lifeState: 'ALIVE', destroyedKnownAtSec: null },
      { timeSec: 30, lifeState: 'DESTROYED', destroyedKnownAtSec: 30 },
    ] }
    const { api, store, vehicles } = await load([vehicle()], canonicalFor([track]))
    api.seekTime(53)
    expect(vehicles[0].proxyVisual.amount).toBe(1)
    expect(store.roster.team1[0].dead).toBe(true)
    api.seekTime(63)
    expect(vehicles[0].proxyVisual.amount).toBe(0)
    expect(store.roster.team1[0].dead).toBe(false)
    api.seekTime(73)
    expect(vehicles[0].proxyVisual.amount).toBe(1)
    expect(store.roster.team1[0].dead).toBe(true)
    api.seekTime(63)
    expect(vehicles[0].proxyVisual.amount).toBe(0)
    expect(store.roster.team1[0].dead).toBe(false)
  })

  it('respawn: distinct deaths each spawn one burst (canonical life has no ALIVE gap in normal battles)', async () => {
    const track = deadTrack()
    track.lifeTransitions.push(
      { timeSec: 20, lifeState: 'ALIVE', destroyedKnownAtSec: null },
      { timeSec: 30, lifeState: 'DESTROYED', destroyedKnownAtSec: 30 },
    )
    const { api, frames } = await load([vehicle()], canonicalFor([track]))
    const spawnBurst = vi.spyOn(window.__battleFx, 'spawnBurst')
    api.seekTime(51.9)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(spawnBurst).toHaveBeenCalledTimes(1)   // 第一次死亡
    api.seekTime(71.9)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(spawnBurst).toHaveBeenCalledTimes(2)   // 复活后的第二次死亡：独立爆焰
    expect(spawnBurst.mock.calls.every(([pos]) => pos === undefined || typeof pos === 'object')).toBe(true)
  })

  // 血量判死两条路径（2026-10-16 裁决 + 本仓评审）：`hp_state`=terminal 时负 i16 全族判死；
  // 字段缺省 = legacy 分类不放宽（0xFFFE/0xFFFF 仍属未证明哨兵 → 不判死）；0/0xFFFD 行为不变。
  // 唯一"不判死"的另一情形：死亡证据落在实体未入场期间（entry 42 = 开战时钟，身份不可归属）。
  it.each([
    [10, 20, 0, 49, undefined], [20, 10, 0, 49, undefined],
    [10, 20, 0xfffd, 49, undefined],
    [10, 20, 0xfffe, 49, 'terminal'], [10, 20, 0xffff, 49, 'terminal'],
    [10, 20, 0xfffe, 49, undefined], [10, 20, 0xffff, 49, undefined],
    [10, 20, 0, 42, undefined],
  ])(
    'real producer → scene re-entry %s → %s with prop3 %s and entry %s (hp_state %s)', async (oldId, newId, terminal, newEntry, hpState) => {
      const f = requireFixtures(await fixtureFacets('random-battle-example.wotbreplay'))
      const result = validateAgentBattleResult({ ...f.result, author_account_id: 77, author_team: 1,
        players: [{ ...f.result.players[0], account_id: 77, team: 1, survived: false, life_time_secs: 10 }] })
      // 本用例显式构造 legacy 口径（含"字段缺省 = legacy 不判死"反例行）→ legacy-compatible
      const aiReview = validateAgentAiReview({ ...f.aiReview,
        battle: { ...f.aiReview.battle, duration_secs: 200, periods: [{ period: 3, clock: 42 }, { period: 4, clock: 242 }] },
        rosters: [oldId, newId].map(eid => ({ eid, account_id: 77, team: 1, tank_id: 6929, tank_name: 'Maus', is_author: true })),
        poses: [], turrets: [], settlements: [], events: [
          { type: 'visibility', eid: oldId, t_in: 42, t_out: 48, hp_raw: 1000 },
          { type: 'visibility', eid: newId, t_in: newEntry, t_out: 51, hp_raw: 1000 },
          { type: 'health', eid: newId, t: 52, hp_raw: terminal, ...(hpState === undefined ? {} : { hp_state: hpState }) },
        ],
      }, 'legacy-compatible')
      const definitions = [vehicle({ eid: oldId, coverage: [42, 48], death_t: null }),
        // Deliberately equal render coverage starts: canonical evidence must determine identity.
        vehicle({ eid: newId, pos: [100, 0, 0], coverage: [42, 51], death_t: null, is_author: false })]
      const playback = validateAgentPlayback({ ...f.playback, meta: { ...f.playback.meta, samples: 1, t_start: 42, duration: 242 },
        vehicles: definitions.map(def => ({ ...f.playback.vehicles[0], ...def, pose_kf: undefined, hull_roll: [0] })),
        // The synthetic re-entry roster replaces every original vehicle ID.
        // Its unrelated real-fixture turret owners must be removed with the roster.
        detached_turrets: [], shots: [], kills: [], reloads: [], reload_effective: [],
      })
      const facts = buildCanonicalReplayFacts({ result, aiReview, streamEndRaw: playback.meta.duration })
      const dataset = toBattlePlaybackDataset(playback, result, aiReview, { canonicalFacts: facts })
      const canonical = { dataset, clock: facts.clock, entityStartsByAccount: entityFirstSeenByAccount(facts) }
      // 判死 = 字段权威全族 ∨ legacy 已证明值（0/0xFFFD）；legacy 未证明负值不算证据
      const terminalByState = hpState === 'terminal'
      const legacyTerminal = hpState === undefined && (terminal === 0 || terminal === 0xfffd)
      const destroyed = (terminalByState || legacyTerminal) && newEntry > 42
      expect(dataset.vehicles[0].lifeTransitions.some(life => life.lifeState === 'DESTROYED')).toBe(destroyed)
      const { api, frames, vehicles, overlay } = await load(definitions, canonical, playback)
      api.seekTime(51.9)
      api.setPlaying(true)
      frames.shift()()
      api.setPlaying(false)
      expect(activeBursts()).toHaveLength(destroyed ? 1 : 0)
      if (destroyed) expect(activeBursts()[0].x).toBe(vehicles[1].group.position.x)
      api.seekTime(53)
      expect(vehicles.map(v => v.proxyVisual.amount)).toEqual([0, destroyed ? 1 : 0])
      expect(vehicles[0].group.visible).toBe(false)
      expect(overlay.setLabels.mock.calls.at(-1)[0].map(row => row.destroyed)).toEqual([false, destroyed])
      api.seekTime(47)
      expect(vehicles.map(v => v.proxyVisual.amount)).toEqual([0, 0])
      expect(vehicles[0].group.visible).toBe(true)
    },
  )

  it('attributes one death to the re-entry entity, keeps old/future entities alive, and restores visibility on rewind', async () => {
    const { api, frames, vehicles, store, overlay } = await load([
      vehicle({ eid: 20, coverage: [42, 48], death_t: 52 }),
      vehicle({ eid: 10, pos: [100, 0, 0], coverage: [49, 51], death_t: 52, is_author: false }),
      vehicle({ eid: 30, coverage: [60, 90], death_t: 52, is_author: false }),
    ], canonicalFor([deadTrack()]))
    const [old, active, future] = vehicles
    api.seekTime(47)
    expect(vehicles.map(v => v.group.visible)).toEqual([true, false, false])
    api.seekTime(51.9)
    expect(vehicles.map(v => v.group.visible)).toEqual([false, false, false])
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(1)
    expect(activeBursts()[0].x).toBe(active.group.position.x)
    expect(vehicles.map(v => v.group.visible)).toEqual([false, true, false])
    expect(overlay.setLabels.mock.calls.at(-1)[0].map(row => row.destroyed)).toEqual([false, true, false])
    expect(store.roster.team1.map(row => row.dead)).toEqual([false, true, false])
    api.seekTime(53)
    expect([old.proxyVisual.amount, active.proxyVisual.amount, future.proxyVisual.amount]).toEqual([0, 1, 0])
    api.seekTime(61)
    expect(future.proxyVisual.amount).toBe(0)
    expect(old.group.visible).toBe(false)
    api.seekTime(47)
    expect(activeBursts()).toHaveLength(0)
    expect(vehicles.map(v => v.proxyVisual.amount)).toEqual([0, 0, 0])
    expect(vehicles.map(v => v.group.visible)).toEqual([true, false, false])
    // Unknown exact death time still uses the authoritative transition for entity identity.
    store.playbackSession.canonical = canonicalFor([deadTrack(null)])
    api.setBattleClock(store.playbackSession.canonical.clock)
    api.seekTime(53)
    expect(vehicles.map(v => v.proxyVisual.amount)).toEqual([0, 1, 0])
  })

  it('attributes delayed death confirmation by the actual death time, not the later transition time', async () => {
    const track = { accountId: 77, lifeTransitions: [{ timeSec: 20, lifeState: 'DESTROYED', destroyedKnownAtSec: 10 }] }
    const { api, frames, vehicles } = await load([
      vehicle({ eid: 20, pos: [100, 0, 0], coverage: [42, 51] }),
      vehicle({ eid: 10, pos: [200, 0, 0], coverage: [60, 90], is_author: false }),
    ], canonicalFor([track]))
    api.seekTime(61.9)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(1)
    expect(activeBursts()[0].x).toBe(vehicles[0].group.position.x)
    expect(vehicles.map(v => v.proxyVisual.amount)).toEqual([1, 0])
  })

  it('withholds account death and bursts when re-entry ownership is ambiguous', async () => {
    const { api, frames, vehicles } = await load([
      vehicle({ eid: 10, coverage: [42, 51] }),
      vehicle({ eid: 20, coverage: [42, 51], is_author: false }),
    ], canonicalFor([deadTrack()]))
    api.seekTime(51.9)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(0)
    api.seekTime(53)
    expect(vehicles.map(v => v.proxyVisual.amount)).toEqual([0, 0])
    expect(vehicles.map(v => v.group.visible)).toEqual([false, false])
  })

  it('late canonical only schedules future explosions; HP zero/unknown life and canonical ALIVE do not explode', async () => {
    const { api, frames, store } = await load([vehicle({ death_t: null, hp: [[42, 0]] })])
    api.seekTime(60)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(0)
    store.playbackSession.canonical = canonicalFor([deadTrack()])
    api.setBattleClock(store.playbackSession.canonical.clock)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(0)
    store.playbackSession.canonical = canonicalFor([{ accountId: 77, lifeTransitions: [{ timeSec: 70, lifeState: 'DESTROYED', destroyedKnownAtSec: 70 }] }])
    api.setBattleClock(store.playbackSession.canonical.clock)
    api.seekTime(111.9)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(1)
    api.seekTime(110)
    store.playbackSession.canonical = canonicalFor([{ accountId: 77, lifeTransitions: [{ timeSec: 0, lifeState: 'ALIVE' }] }])
    api.setBattleClock(store.playbackSession.canonical.clock)
    api.seekTime(111.9)
    api.setPlaying(true)
    frames.shift()()
    api.setPlaying(false)
    expect(activeBursts()).toHaveLength(0)
  })

})

describe('turretless GLB（固定战斗室歼击车）挂载与摆姿', () => {
  const mkVehicle = (overrides = {}) => ({
    eid: 1, account_id: 77, tank_id: 13857, team: 2, max_hp: 1000, is_author: false,
    pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
    hp: [[42, 1000]], coverage: [42, 300], death_t: null, ...overrides,
  })
  const mkData = (vehicles, detachedTurrets = []) => ({ ...minimalData(), meta: { ...minimalData().meta, duration: 300, samples: 1 }, vehicles, detached_turrets: detachedTurrets })

  /** 歼击车模板：hull + 炮管组（gun_0/gun_0_mask），无任何 turret_N 节点（T110E3 实测形态） */
  function stubTurretlessGlb({ withGun = true } = {}) {
    vi.spyOn(assetProvider, 'bytes').mockImplementation(() => Promise.resolve(new Uint8Array([1])))
    vi.spyOn(assetProvider, 'json').mockImplementation((path) => Promise.resolve(
      String(path).startsWith('/tank/')
        ? { model_origins: { track: [0, 0, 0], turret: [0, 0, 0] }, configs: [] }
        : null))
    const template = new THREE.Group()
    for (const [name, geometry] of [
      ['hull', new THREE.BoxGeometry(3, 6, 2)],
      ...(withGun ? [
        ['gun_0', new THREE.BoxGeometry(0.2, 4.5, 0.2).translate(0, 2.25, 0)],
        ['gun_0_mask', new THREE.BoxGeometry(0.6, 1, 0.6)],
      ] : []),
    ]) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
      mesh.name = name
      template.add(mesh)
    }
    vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_b, _p, done) => done({ scene: template }))
  }

  async function loadTurretless(vehicles, detachedTurrets = [], meta = {}, sceneOptions = {}) {
    window.history.replaceState(null, '', '/?debug&q=high')
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
    const overlay = { setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn() }
    const store = createPlaybackStore()
    api = initPlayback(mountContainer(), store, overlay, sceneOptions)
    created.push(api)
    const state = { canonical: null }
    const sceneData = mkData(vehicles, detachedTurrets)
    sceneData.meta = { ...sceneData.meta, ...meta }
    const session = { loadScene: vi.fn().mockResolvedValue(sceneData), getState: () => state }
    await api.loadData({ kind: 'local', file: new File(['replay'], 'td.wotbreplay'), session })
    api.setPlaying(false)
    return { api, store, frames, vehicles: window.__pbV }
  }

  it('录像者开镜的相机在 GLB 配置炮位，不是低模枢轴', async () => {
    stubTurretlessGlb()
    vi.mocked(assetProvider.json).mockImplementation((path) => Promise.resolve(
      String(path).startsWith('/tank/')
        ? { model_origins: { track: [0, 0, 0], turret: [0, 3.5, 1.8] }, configs: [] }
        : null))
    source.loadRecorderCameraFromFile.mockResolvedValue({
      version: 1, author_eid: 1,
      aim: { t: [42, 300], yaw: [0, 0], pitch: [0, 0], ray_x: [0, 0], ray_y: [2, 2], ray_z: [100, 100] },
      mode: { t: [42, 50], raw: [1, 0] }, zoom: { t: [50.1], raw: [27] }, bloom: { t: [], raw: [] },
      client_options: { backward_zoom: null },
    })
    const { api, frames, vehicles } = await loadTurretless([mkVehicle()], [], { author_eid: 1 })
    const v = vehicles[0]
    expect(v.glb).toBeTruthy()
    api.seekTime(60)
    api.setCam('recorder')
    for (let i = 0; i < 5; i++) frames.shift()?.()
    const expected = v.glbParts.gunNodes[0].parent.localToWorld(new THREE.Vector3(...v.glbParts.gP))
    expect(window.__camera.position.distanceTo(expected)).toBeLessThan(1e-3)
    const proxy = v.gunPivot.getWorldPosition(new THREE.Vector3())
    expect(window.__camera.position.distanceTo(proxy)).toBeGreaterThan(0.1)
  })

  it('录像者扩散圆沿渲染出的 GLB 炮管方向，含低模代理没有的 itr 补偿', async () => {
    stubTurretlessGlb()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    const yaw = 1.2
    const ray = [-Math.sin(yaw) * 300, 2, Math.cos(yaw) * 300]
    source.loadRecorderCameraFromFile.mockResolvedValue({
      version: 1, author_eid: 1,
      aim: { t: [42, 300], yaw: [yaw, yaw], pitch: [0, 0], ray_x: [ray[0], ray[0]], ray_y: [2, 2], ray_z: [ray[2], ray[2]] },
      mode: { t: [42], raw: [1] }, zoom: { t: [], raw: [] }, bloom: { t: [], raw: [] },
      client_options: { backward_zoom: null },
    })
    const reticle = { update: vi.fn(), hide: vi.fn() }
    const { api, frames, vehicles } = await loadTurretless(
      [mkVehicle({ hull_yaw: [yaw], hull_pitch: [0.2], turret_yaw: [yaw], gun_pitch: [0.05] })],
      [], { author_eid: 1 }, { recorderReticle: reticle },
    )
    const [v] = vehicles
    v.glbParts.itr = { yaw: 6, pitch: 0, roll: 0 }
    api.seekTime(60)
    api.setCam('recorder')
    for (let i = 0; i < 5; i++) frames.shift()?.()
    const gun = v.glbParts.gunNodes[0]
    gun.parent.updateWorldMatrix(true, false)
    const rig = gun.matrix.clone().multiply(gun.userData.__bake.clone().invert())
    const toWorld = gun.parent.matrixWorld.clone().multiply(rig)
    const origin = new THREE.Vector3(...v.glbParts.gP).applyMatrix4(toWorld)
    const direction = new THREE.Vector3(0, 1, 0).transformDirection(toWorld)
    const distance = origin.distanceTo(new THREE.Vector3(-ray[0], 2, ray[2]))
    const expected = origin.addScaledVector(direction, distance).project(window.__camera)
    const circle = reticle.update.mock.lastCall[1]
    expect(circle.x).toBeCloseTo((expected.x + 1) * 450, 1)
    expect(circle.y).toBeCloseTo((1 - expected.y) * 300, 1)
  })

  it('无 turret_N 但有炮管组：进场即挂载真模型，炮塔角改写炮管组（不再退代理）', async () => {
    stubTurretlessGlb()
    const { vehicles } = await loadTurretless([mkVehicle({ turret_yaw: [0.5], gun_pitch: [0.1] })])
    expect(vehicles).toHaveLength(1)
    const v = vehicles[0]
    expect(v.glb).toBeTruthy()                       // 不再是代理盒
    expect(v.glbParts.turretNode).toBeNull()         // 无炮塔节点
    expect(v.glbParts.gunNodes.length).toBe(2)       // 炮管 + 炮盾
    expect(v.glbParts.gunNodes.every(gn => gn.matrixAutoUpdate === false)).toBe(true) // 姿态系统接管炮管组
    expect(v.glb.visible).toBe(true)
  })

  it('无 turret_N 且无炮管组：无受姿部件，仍退代理车（fail-visible）', async () => {
    stubTurretlessGlb({ withGun: false })
    const { vehicles } = await loadTurretless([mkVehicle()])
    expect(vehicles).toHaveLength(1)
    expect(vehicles[0].glb).toBeFalsy()              // 保留代理车
  })

  it('turretless + 独立炮塔轨道：clone/分离/倒带全程不抛（cloneDetachedTurret 空炮塔回归锁）', async () => {
    stubTurretlessGlb()
    const detachedTrack = {
      vehicle_eid: 1,
      coverage: [50, 300],
      pose_kf: { t: [50], pos: [1, 0, 0], yaw: [0.3], pitch: [0], roll: [0] },
    }
    const { api, vehicles } = await loadTurretless([mkVehicle()], [detachedTrack])
    const v = vehicles[0]
    expect(v.glb).toBeTruthy()                       // 挂载阶段（clone 路径）不再踩 null.turretNode
    expect(v.detachedTurrets).toHaveLength(1)
    const head = v.detachedTurrets[0]
    expect(head.glb).toBeTruthy()
    expect(head.glb.children.length).toBeGreaterThan(0)   // 脱落件由炮管组构成
    api.seekTime(55)                                 // T ≥ 分离已知时刻：分离态
    expect(head.root.visible).toBe(true)
    expect(v.glbParts.gunNodes.every(gn => gn.visible === false)).toBe(true)  // 车上炮管组隐藏
    api.seekTime(45)                                 // 倒带到分离前：恢复
    expect(head.root.visible).toBe(false)
    expect(v.glbParts.gunNodes.every(gn => gn.visible === true)).toBe(true)
  })
})

describe('3D annotation renderer (scene projection)', () => {
  function stroke(points = [{ x: -50, y: -50 }, { x: 50, y: 50 }]) {
    return { type: 'pen', color: '#ff4d4f', width: 2, points }
  }

  function annotationVertices(layer) {
    const position = layer.committedMesh.geometry.getAttribute('position')
    const out = []
    for (let i = 0; i < position.count; i++) {
      out.push({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) })
    }
    return out
  }

  it('projects committed annotations after terrain arrives and drapes every vertex', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 10, zmax: 10 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'annotation-terrain.wotbreplay') })
    api.setAnnotations([stroke()])
    const layer = window.__annotationLayer
    expect(layer).toBeTruthy()
    const vertices = annotationVertices(layer)
    expect(vertices.length).toBeGreaterThan(10)
    for (const vertex of vertices) {
      expect(vertex.y).toBeCloseTo(10 + ANNOTATION_LIFT, 4)
    }
    expect(layer.stats.terrainRebuilds).toBeGreaterThanOrEqual(1)
  })

  it('skips same-reference projection and rebuilds on a new snapshot', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['b'], 'annotation-idle.wotbreplay') })
    const layer = window.__annotationLayer
    const annotations = [stroke()]
    api.setAnnotations(annotations)
    const first = layer.committedMesh.geometry
    const builds = layer.stats.committedBuilds
    api.setAnnotations(annotations)
    expect(layer.committedMesh.geometry).toBe(first)
    expect(layer.stats.committedBuilds).toBe(builds)
    api.setAnnotations([...annotations])
    expect(layer.committedMesh.geometry).not.toBe(first)
    expect(layer.stats.committedBuilds).toBe(builds + 1)
  })

  it('visibility only toggles renderer visibility, not geometry or state', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['c'], 'annotation-visible.wotbreplay') })
    const layer = window.__annotationLayer
    api.setAnnotations([stroke()])
    const geometry = layer.committedMesh.geometry
    api.setAnnotationsVisible(false)
    expect(layer.group.visible).toBe(false)
    api.setAnnotationsVisible(true)
    expect(layer.group.visible).toBe(true)
    expect(layer.committedMesh.geometry).toBe(geometry)
  })

  it('ignores non-pen/null annotations and clears derived geometry on teardown', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['d'], 'annotation-clear.wotbreplay') })
    const layer = window.__annotationLayer
    api.setAnnotations([{ type: 'line', color: '#fff', width: 2, x1: 0, y1: 0, x2: 10, y2: 0 }, null])
    expect(layer.committedMesh.visible).toBe(false)
    expect(layer.committedMesh.geometry.getAttribute('position').count).toBe(0)
    api.setAnnotations([stroke()])
    expect(layer.committedMesh.visible).toBe(true)
    api.reset()
    expect(layer.committedMesh.visible).toBe(false)
    expect(layer.committedMesh.geometry.getAttribute('position').count).toBe(0)
  })

  it('reprojects committed geometry through the terrain rebuild hook', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['e'], 'annotation-rebuild.wotbreplay') })
    const layer = window.__annotationLayer
    api.setAnnotations([stroke()])
    const before = layer.committedMesh.geometry
    const revisions = layer.stats.terrainRebuilds
    expect(layer.rebuild()).toBe(revisions + 1)
    expect(layer.stats.terrainRebuilds).toBe(revisions + 1)
    expect(layer.committedMesh.geometry).not.toBe(before)
  })

  it('keeps optional surface anchors through build and terrain reprojection', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 10, zmax: 10 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['anchor'], 'annotation-anchor.wotbreplay') })
    const layer = window.__annotationLayer
    const bridge = {
      type: 'pen', color: '#ff4d4f', width: 2,
      points: [{ x: -5, y: -5, surfaceY: 20 }, { x: 5, y: 5, surfaceY: 20 }],
    }
    api.setAnnotations([bridge])
    expect(annotationVertices(layer).every((v) => Math.abs(v.y - (20 + ANNOTATION_LIFT)) < 1e-3)).toBe(true)

    layer.reproject()
    expect(annotationVertices(layer).every((v) => Math.abs(v.y - (20 + ANNOTATION_LIFT)) < 1e-3)).toBe(true)

    // 纯地形笔迹仍按 terrain + lift 贴地（surface anchor 不影响 legacy 路径）。
    api.setAnnotations([stroke()])
    expect(annotationVertices(layer).every((v) => Math.abs(v.y - (10 + ANNOTATION_LIFT)) < 1e-3)).toBe(true)
  })

  it('disposes the annotation layer on destroy', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['f'], 'annotation-destroy.wotbreplay') })
    api.setAnnotations([stroke()])
    expect(window.__annotationLayer).toBeTruthy()
    api.destroy()
    expect(window.__annotationLayer).toBeUndefined()
    created = []
  })
})
