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
import { assetProvider } from './assetProvider.js'
import { foliageClip } from './sceneryMaterials.js'
import { createPlaybackStore } from './playbackStore.js'
import { fixtureFacets, requireFixtures } from '../replay-local/__golden__/agentWasmNode.js'
import { buildCanonicalReplayFacts, entityFirstSeenByAccount } from '../replay-local/canonical/facts.js'
import { toBattlePlaybackDataset } from '../replay-local/playback/toBattlePlaybackDataset.js'
import { validateAgentAiReview, validateAgentBattleResult, validateAgentPlayback } from '../api/agent-replay-facets.js'
import { FLOAT_DMG_MS } from '../utils/battlePlayback.js'
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

/**
 * 炮口定位：测试车没有 GLB（代理车），真实 muzzleTipOf 总是回落到记录起点。用例要验证
 * "炮管里那段不画"时把 `muzzleTip.reach` 设成炮管长度，模拟炮口在起点前方 reach 米处。
 */
const muzzleTip = vi.hoisted(() => ({ reach: 0 }))
vi.mock('./battleFx.js', async (importOriginal) => {
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
import { BURST_SECS, FX_BUDGETS } from './battleFx.js'

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
  // （`VITE_ASSET_BASE_URL=http://127.0.0.1:8123`，AGENTS.md 本地测试姿势），高档位
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

  // json/bin 配对（PR #615 review P2）：布局标记只对同一次发布的 bin 成立——bin 以 terrainBinSha256 作缓存键
  // 取回，解码前核对字节；不同批（发布进行中）fail-closed 回退 2D，不画错位一列的地形。
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
      if (u.includes('groundmeta')) return { ok: true, status: 200, json: async () => ({}) } // 缺 tiling
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
    expect(window.__terrain).toBeTruthy()   // 回退烘焙底图后地形仍建成
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
    const raw = (await import('./playbackScene.js?raw')).default
    expect(raw).toMatch(/store\.assetIssues = assetIssues/)
    expect(raw).toMatch(/store\.assetDegraded = true/)
    expect(raw).toMatch(/noteAsset\('map', `http-\$\{resp\.status\}`/)
    expect(raw).toMatch(/noteAsset\('terrain', 'unavailable'/)
    expect(raw).toMatch(/noteAsset\('scenery', 'failed'/)
    // 3D 与 2D 共用同一 visibility 投影（短隐藏段在 3D 也不能回退到 coverage）
    expect(raw).toMatch(/VIS_BY_EID = visibilitySpansByEid\(data\.visibility\)/)
    expect(raw).toMatch(/VIS_BY_EID\.get\(v\.def\.eid\) \?\? v\.def\.coverage/)
  })

  it('迟到 scenery GLB 不入 B 场景，且释放局部资源与隔离进度', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
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
    // 俯视是持续的战术总览模式：OrbitControls 接管，target 锁**地图中心**（旋转中心不是相机）
    expect(store.cam).toBe('top')
    expect(controls.enabled).toBe(true)
    expect(controls.enablePan).toBe(false)
    const viewDirection = () => new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(viewDirection().y).toBeLessThan(-0.99)   // 保持直下朝向，不回落到斜俯视
    // 飞行（WASD）不接管总览视角：flyTick 在俯视模式下为惰性
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
    expect(cam.position.y).toBeCloseTo(topHeight, 5)

    cam.position.y = topHeight - 0.1
    controls.target.y = topHeight - 5.1
    const touch = (type, x, pointerId) => {
      const event = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      return event
    }
    canvas.dispatchEvent(touch('pointerdown', 100, 7))
    canvas.dispatchEvent(touch('pointerdown', 300, 9))
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
    expect(cam.position.y).toBeGreaterThanOrEqual(27.5)

    cam.position.set(-30, 27.51, 0)
    controls.target.set(-20, 22.51, 0)
    const touch = (type, x, pointerId) => {
      const event = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      return event
    }
    canvas.dispatchEvent(touch('pointerdown', 100, 7))
    canvas.dispatchEvent(touch('pointerdown', 300, 9))
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
    expect(store.cam).toBe('top')   // 默认进入俯视总览模式
    const cam = window.__camera
    const controls = window.__controls
    const tacticalHeight = 255 // minimalData 的 WORLD_CENTER.ext = 150
    api.setCam('top')
    expect(store.cam).toBe('top')
    expect(cam.position.x).toBeCloseTo(0)
    expect(Math.abs(cam.position.z)).toBeLessThan(0.1)
    expect(cam.position.y).toBeGreaterThanOrEqual(400.5)   // 地形净空优先于默认高度
    expect(new THREE.Vector3().subVectors(controls.target, cam.position).normalize().y).toBeLessThan(-0.99)
  })

  // 回归（用户要求）：默认俯视视角的**旋转中心 = 地图中心**，不是相机。
  // 锁两件事：① target 钉在地图中心；② 绕转后 target 不随相机移动（OrbitControls 轨道语义），
  // 且极角上限仍挡在地平线以上。此前曾被改成「一次性动作 + 落进 free」，free 的 flyLook 把
  // target 重钉到 cam + dir×dist（旋转中心变成相机）。
  it('top view orbits around the map center, not the camera', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 0, zmax: 0 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'top-orbit.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    expect(store.cam).toBe('top')
    expect(controls.enabled).toBe(true)
    // ① target = WORLD_CENTER（minimalData：ext=150、cx=cz=0）
    expect(controls.target.x).toBeCloseTo(0, 3)
    expect(controls.target.z).toBeCloseTo(0, 3)
    // ② 模拟轨道绕转（相机绕 target 转到斜上方）：target 必须纹丝不动
    const center = controls.target.clone()
    const radius = cam.position.distanceTo(center)
    cam.position.set(radius * 0.6, radius * 0.75, radius * 0.2)
    controls.update()
    expect(controls.target.distanceTo(center)).toBeLessThan(1e-6)
    // ③ 不沉到地平线以下
    expect(controls.maxPolarAngle).toBeLessThanOrEqual(Math.PI * 0.5)
  })

  describe('default top view across sessions', () => {
    const TOP_HEIGHT = 255   // minimalData 的 ext = 150 × 1.7
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
      // 俯视是持续模式：OrbitControls 接管，旋转中心 = 地图中心（不是相机）
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      expect(window.__controls.target.x).toBeCloseTo(0, 3)
      expect(window.__controls.target.z).toBeCloseTo(0, 3)
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
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
      api.setCam('free')   // 飞行只在自由模式接管（俯视是轨道总览）
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      await expectPoseKept(api)
    })

    it('wheel dolly keeps the full camera pose on the next replay', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
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
        api.setLogdepth(false)   // 偏好会持久化，不得泄漏给后续用例
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
      // 要飞行先切自由模式（俯视下键盘飞行不接管）
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
    cam.position.set(8, -28, 0)   // 绕到 target 水平线以下（review 复现）
    api.setCam('follow')
    expect(controls.maxPolarAngle).toBeLessThanOrEqual(Math.PI / 2)
    expect(cam.position.y).toBeGreaterThanOrEqual(0.5)
    // 真实 OrbitControls update 也不得把相机带回地下
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
    // 旧实现只按 x=50 的地形一次外推到 x≈125.5，那里地面已 162.75：仍穿地。
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
    expect(cam.position.x).toBeCloseTo(50, 3)   // 不沿射线外推到无地形区
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

    // 在场景宿主里换入同一生产 builder 的远景 LOD，以确定性地产生 step=8→5 的正边裁剪 quad。
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
    const back = cam.position.clone().sub(p0)
    expect(back.length()).toBeGreaterThan(1)
    expect(back.dot(aim0)).toBeLessThan(0)                       // 位移沿视线反方向
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 3)  // 视距不变
    const aim1 = controls.target.clone().sub(cam.position).normalize()
    expect(aim1.dot(aim0)).toBeCloseTo(1, 4)                     // 视角不变
    expect(cam.getWorldDirection(new THREE.Vector3()).dot(aim1)).toBeCloseTo(1, 4)  // 朝向仍对准 target
    const p1 = cam.position.clone()
    wheel(-100)                                                  // 上滚 = 前进
    expect(cam.position.clone().sub(p1).dot(aim0)).toBeGreaterThan(0)
  })

  // 回归（2026-10-24 用户实测）：曾按 `(pointer: fine)` 决定是否接管，触屏笔记本 /
  // 平板模式报 coarse ⇒ 自由模式整条接管链失效（WASD 全灭、拖拽退回 OrbitControls）。
  // 语义改为「自由模式恒接管」，触屏用同一套手势。
  it('自由模式接管与指针能力无关：touch 拖拽同样转头且相机不动', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'touch-look.wotbreplay') })
    api.setCam('free')
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
    expect(cam.position.equals(cam0)).toBe(true)          // 旋转中心 = 相机自身
    expect(controls.target.equals(tgt0)).toBe(false)      // 朝向确实转了
    canvas.dispatchEvent(touch('pointerup', 180, 0))
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
    // 一次完整手势：两指从 200px 起，依次移动到 xs（第二指），再回到 200px 收势
    const gesture = (xs) => {
      canvas.dispatchEvent(touch('pointerdown', 100, 1, 7))
      canvas.dispatchEvent(touch('pointerdown', 300, 1, 9))   // 指距 200px（= d0）
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
    const load = async ({ camera = facet(), vehicleOverrides = {} } = {}) => {
      const frames = manualFrames()
      vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
      source.loadRecorderCameraFromFile.mockResolvedValue(camera)
      const data = rosterData([vehicle({ eid: 1, team: 1, nickname: 'A', tank_name: 'T', max_hp: 100, hp: [[42, 100]], ...vehicleOverrides })])
      data.meta = { ...data.meta, author_eid: 1 }
      source.loadPlaybackData.mockResolvedValue(data)
      const reticle = { update: vi.fn(), hide: vi.fn() }
      const store = createPlaybackStore()
      const stage = mountContainer()
      Object.defineProperty(stage, 'clientWidth', { value: 900, configurable: true })
      Object.defineProperty(stage, 'clientHeight', { value: 600, configurable: true })
      api = initPlayback(stage, store, null, { recorderReticle: reticle })
      created.push(api)
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
      expect(QUALITY_PRESETS[t].scenery).toBe(t === 'high' || t === 'ultra')
      expect(QUALITY_PRESETS[t].groundLayers).toBe(t === 'high' || t === 'ultra')
      expect(QUALITY_PRESETS[t].antialias).toBe(t !== 'low')
      expect(QUALITY_PRESETS[t].fx).toBe(FX_BUDGETS[t])   // 战斗特效预算与画质档同一键
    }
  })

  it('地面贴图四档统一用契约化的 `map`（ground.webp）；客户端 HUD 小地图不再进地面链路', async () => {
    // 2026-10-16 用户裁定（以 ±300 为准）：客户端小地图覆盖约 620 m、多出外围一圈，按 600 m 铺
    // 会压缩内容约 3% 并把圈外内容摊进边界 ⇒ 地面链路（含最低档）只认 ground.webp。
    const src = (await import('./playbackScene.js?raw')).default
    expect(src).not.toMatch(/map-mini/)
    expect(src).not.toMatch(/miniMap/)
    expect(src).toMatch(/const mapUrl = mapStaticUrl\('map', undefined, resolvedKey\);/)
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

  async function loadTurretless(vehicles, detachedTurrets = [], meta = {}) {
    window.history.replaceState(null, '', '/?debug&q=high')
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
    const overlay = { setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn() }
    const store = createPlaybackStore()
    api = initPlayback(mountContainer(), store, overlay)
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
