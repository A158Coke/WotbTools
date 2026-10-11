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

import { initPlayback, QUALITY_PRESETS } from './playbackScene.js'

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
    const readTrail = () => {
      const v = window.__pbV[0]
      const col = v.treadMesh ? v.treadMesh.geometry.getAttribute('color').array : null
      return {
        builtT: v.trail.builtT, total: v.trail.L.total, rTotal: v.trail.R.total,
        quads: v.treadMesh ? v.treadMesh.geometry.drawRange.count / 6 : 0,
        youngAlpha: (col && v.trail.L.total > 0) ? +col[((v.trail.L.total - 1) % 1536) * 32 + 3].toFixed(2) : 'none',
        oldAlpha: (col && v.trail.L.total > 0) ? +col[3].toFixed(2) : 'none',
      }
    }
    api.seekTime(t0 + 18)
    let r = readTrail()
    expect(r).toMatchObject({ builtT: t0 + 18, total: 90, rTotal: 90, quads: 180 })
    expect(r.youngAlpha).toBeCloseTo(0.8)
    api.seekTime(t0 + 8)
    r = readTrail()
    expect(r).toMatchObject({ builtT: t0 + 8, total: 40, rTotal: 40, quads: 80 })
    api.seekTime(t0 + 28)
    r = readTrail()
    expect(r).toMatchObject({ builtT: t0 + 28, total: 140, rTotal: 140, quads: 280 })
    expect(r.oldAlpha).toBe(0)
    expect(r.youngAlpha).toBeCloseTo(0.8)
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
    const read = () => {
      const v = window.__pbV[0]
      return { total: v.trail.L.total, segs: v.trail.L.segs.map((sg) => ({ x0: sg.x0, x1: sg.x1 })) }
    }
    api.seekTime(t0 + 4)
    const before = read()
    expect(before.total).toBeGreaterThan(10)
    api.seekTime(t0 + 11)
    const r = read()
    expect(r.total).toBeGreaterThan(before.total)
    expect(r.segs.slice(0, before.total)).toEqual(before.segs)
    const postGap = r.segs.slice(before.total)
    expect(postGap.length).toBeGreaterThanOrEqual(3)
    expect(postGap.length).toBeLessThanOrEqual(8)
    for (const sg of r.segs) expect(Math.abs(sg.x1 - sg.x0)).toBeLessThanOrEqual(1.1)
    for (const sg of postGap) expect(Math.abs(sg.x0)).toBeGreaterThan(45)
    const minPostGapAbs = Math.min(...postGap.map((sg) => Math.abs(sg.x0)))
    expect(minPostGapAbs).toBeLessThan(51)
    expect(minPostGapAbs).toBeGreaterThan(48.5)
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

    it('转弯：左右弧长不同（L≠R）时绘制窗口覆盖较长侧，较短侧空槽显式隐藏（review P2 2026-10-11）', async () => {
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
      expect(Math.abs(L18 - R18)).toBeGreaterThanOrEqual(2)
      expect(v.treadMesh.geometry.drawRange.count / 6).toBe(2 * Math.max(L18, R18))
      const longIsL = L18 > R18
      const longTotal = longIsL ? L18 : R18
      expect(colArr()[((longTotal - 1) % 1536) * 32 + (longIsL ? 0 : 16) + 3]).toBeGreaterThan(0)
      api.seekTime(42 + 30)
      expect(v.trail.L.total).toBeGreaterThan(L18)
      expect(v.trail.R.total).toBeGreaterThan(R18)
      api.seekTime(42 + 18)
      expect(v.trail.L.total).toBe(L18)
      expect(v.trail.R.total).toBe(R18)
      const pairs = Math.max(L18, R18)
      for (const [st, quad] of [[v.trail.L, 0], [v.trail.R, 1]]) {
        for (let k = st.total; k < pairs; k++) {
          expect(colArr()[(k % 1536) * 32 + quad * 16 + 3]).toBe(0)
        }
      }
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
    const terrain = window.__terrain
    expect(terrain).toBeDefined()
    expect(terrain.geometry.attributes.position.getY(0)).toBeCloseTo(20)
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
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
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBe(11)
    expect(onVehicleSelect.mock.calls[0][1]?.clientX).toBe(10)
    expect(store.cam).toBe('free')
    expect(window.__camera.position.equals(beforeCamera)).toBe(true)
    container.querySelector('canvas').dispatchEvent(new MouseEvent('pointerdown', { button: 2 }))
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
    api.setCam('free')
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
      expect(QUALITY_PRESETS[t].miniMap).toBe(t === 'low')
      expect(QUALITY_PRESETS[t].antialias).toBe(t !== 'low')
    }
  })
})

describe('disposeFxPool 会话切换（issue #556 回归锁）', () => {
  it('impact-* 池的 JS 包装对象不炸：解包 g 后 dispose，同 root 去重', async () => {
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
