// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createPlaybackStore } from './playbackStore.js'
import { initPlayback } from './playbackScene.js'
import { installSceneTestSetup, minimalData, mountContainer } from './playbackScene.test.setup.js'

const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), loadRecorderCameraFromFile: vi.fn(), resolveMapKey: vi.fn(), mapStaticUrl: vi.fn(), tankNamesStatic: vi.fn(async () => new Map()) }))
vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  loadRecorderCameraFromFile: source.loadRecorderCameraFromFile,
  resolveMapKey: source.resolveMapKey,
  tankNamesStatic: source.tankNamesStatic,
  mapStaticUrl: source.mapStaticUrl,
}))

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

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal()
  class StubWebGLRenderer {
    constructor(params = {}) {
      this.params = params
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

const state = { api: null, created: [], pending: [] }
installSceneTestSetup({ source, muzzleTip: { reach: 0 }, state })

describe('attack_enemy 目标身份：canonical 修正后重解析', () => {
  const mkVehicle = (overrides = {}) => ({
    eid: 1, account_id: 77, tank_id: 6929, team: 1, max_hp: 1000, is_author: true,
    pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
    hp: [[42, 1000]], coverage: [42, 300], death_t: 99, ...overrides,
  })
  const dataFor = (vehicles) => ({ ...minimalData(), meta: { ...minimalData().meta, duration: 300, samples: 1 }, vehicles })
  const mapOf = (entries) => new Map(entries.map(([k, v]) => [k, new Map(v)]))

  let apiLocal = null
  afterEach(() => {
    apiLocal?.destroy?.()
    apiLocal = null
    document.body.innerHTML = ''
  })

  it('晚到的 canonical 身份修正让环与卡片重选车（EID 49→42）；显式 target_eid 不变', async () => {
    const recorder = mkVehicle({ eid: 1, account_id: 77, team: 1, is_author: true, pos: [0, 0, 0], coverage: [42, 300], nickname: 'Sniper', tank_name: 'Leopard' })
    const oldCar = mkVehicle({ eid: 42, account_id: 2001, team: 2, is_author: false, pos: [10, 0, 0], coverage: [42, 300], death_t: null, tank_id: 6929, nickname: 'Old-2001', tank_name: 'T-34' })
    const newCar = mkVehicle({ eid: 49, account_id: 2001, team: 2, is_author: false, pos: [30, 0, 30], coverage: [42, 300], death_t: null, tank_id: 6929, nickname: 'New-2001', tank_name: 'BZT-70' })
    const data = dataFor([recorder, oldCar, newCar])
    data.markers = [{ t: 111, entity_id: 1, account_id: 11, marker_type: 4, target_eid: 42 }]
    data.chat_events = [{ t: 110, channel: 0, sender: 'Sniper', command_name: 'attack_enemy', target: 2001 }]
    data.visibility = [
      { eid: 1, t_in: 42, t_out: 300 },
      { eid: 42, t_in: 42, t_out: 300 },
      { eid: 49, t_in: 42, t_out: 300 },
    ]
    const entityStartsByAccount = mapOf([[2001, [[42, 0], [49, 60]]]])
    const canonical = {
      clock: { startRaw: 42, durationSec: 200 },
      dataset: { vehicles: [] },
      entityStartsByAccount,
    }
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
    const markerAnchors = []
    const markerLabelRows = []
    const overlay = {
      setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn(), spawnDamage: vi.fn(), clearDamages: vi.fn(),
      setMarkerLabels: (rows) => markerLabelRows.push(rows.map((row) => ({ ...row }))),
      setMarkerAnchor: (key, anchor) => markerAnchors.push({ key, x: anchor.x, y: anchor.y, visible: anchor.visible }),
    }
    const store = createPlaybackStore()
    const container = mountContainer()
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1280 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 960 })
    apiLocal = initPlayback(container, store, overlay)
    const session = { loadScene: vi.fn().mockResolvedValue(data), getState: () => ({ canonical }) }
    await apiLocal.loadData({ kind: 'local', file: new File(['replay'], 'marker-identity.wotbreplay'), session })
    apiLocal.setPlaying(false)
    apiLocal.seekTime(112.5)
    frames.shift()()

    const anchorByKey = (key) => markerAnchors.filter((a) => a.key === key).at(-1)
    const before0 = anchorByKey('0')
    const before1 = anchorByKey('1')
    expect(before0).toBeTruthy()
    expect(before1).toBeTruthy()
    expect(before0.visible).toBe(true)
    expect(before1.visible).toBe(true)
    expect(before0.x).not.toBe(before1.x)
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'BZT-70')).toBe(true)

    entityStartsByAccount.get(2001).set(49, 130)
    apiLocal.setBattleClock(canonical.clock)
    frames.shift()()

    const after0 = anchorByKey('0')
    expect(after0.visible).toBe(true)
      expect(after0.y).toBeCloseTo(before1.y, 6)
    expect(after0.y).not.toBe(before0.y)
      expect(anchorByKey('1').y).toBeCloseTo(before1.y, 6)
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'T-34')).toBe(true)
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'BZT-70')).toBe(false)
  })
})

describe('attack_enemy 目标身份：跨会话复用 SceneApi', () => {
  const mkVehicle = (overrides = {}) => ({
    eid: 1, account_id: 77, tank_id: 6929, team: 1, max_hp: 1000, is_author: true,
    pos: [0, 0, 0], hull_yaw: [0], hull_pitch: [0], turret_yaw: [0], gun_pitch: [0],
    hp: [[42, 1000]], coverage: [42, 300], death_t: 99, ...overrides,
  })
  const dataFor = (vehicles) => ({ ...minimalData(), meta: { ...minimalData().meta, duration: 300, samples: 1 }, vehicles })
  const mapOf = (entries) => new Map(entries.map(([k, v]) => [k, new Map(v)]))

  let apiLocal = null
  afterEach(() => {
    apiLocal?.destroy?.()
    apiLocal = null
    document.body.innerHTML = ''
  })

  it('换场后晚到的同款身份仍重解析（快照随 teardown 清空、随建源同步）', async () => {
    const mkData = () => {
      const data = dataFor([
        mkVehicle({ eid: 1, account_id: 77, team: 1, is_author: true, pos: [0, 0, 0], coverage: [42, 300], nickname: 'Sniper', tank_name: 'Leopard' }),
        mkVehicle({ eid: 42, account_id: 2001, team: 2, is_author: false, pos: [10, 0, 0], coverage: [42, 300], death_t: null, tank_id: 6929, nickname: 'Old-2001', tank_name: 'T-34' }),
        mkVehicle({ eid: 49, account_id: 2001, team: 2, is_author: false, pos: [30, 0, 30], coverage: [42, 300], death_t: null, tank_id: 6929, nickname: 'New-2001', tank_name: 'BZT-70' }),
      ])
      data.markers = []
      data.chat_events = [{ t: 110, channel: 0, sender: 'Sniper', command_name: 'attack_enemy', target: 2001 }]
      data.visibility = [
        { eid: 1, t_in: 42, t_out: 300 },
        { eid: 42, t_in: 42, t_out: 300 },
        { eid: 49, t_in: 42, t_out: 300 },
      ]
      return data
    }
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
    const pump = (label) => {
      const cb = frames.shift()
      if (typeof cb !== 'function') throw new Error(label + ': animate loop died, frames=' + frames.length)
      cb()
    }
    const markerAnchors = []
    const markerLabelRows = []
    const overlay = {
      setLabels: vi.fn(), setAnchor: vi.fn(), clear: vi.fn(), spawnDamage: vi.fn(), clearDamages: vi.fn(),
      setMarkerLabels: (rows) => markerLabelRows.push(rows.map((row) => ({ ...row }))),
      setMarkerAnchor: (key, anchor) => markerAnchors.push({ key, x: anchor.x, y: anchor.y, visible: anchor.visible }),
    }
    const anchorY = (key) => markerAnchors.filter((a) => a.key === key).at(-1)?.y
    const store = createPlaybackStore()
    const container = mountContainer()
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1280 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 960 })
    apiLocal = initPlayback(container, store, overlay)

    const canonicalA = { clock: { startRaw: 42, durationSec: 200 }, dataset: { vehicles: [] }, entityStartsByAccount: mapOf([[2001, [[42, 0], [49, 60]]]]) }
    const stateA = { canonical: null }
    const sessionA = { loadScene: vi.fn().mockResolvedValue(mkData()), getState: () => stateA }
    await apiLocal.loadData({ kind: 'local', file: new File(['a'], 'marker-a.wotbreplay'), session: sessionA })
    apiLocal.setPlaying(false)
    apiLocal.seekTime(112.5)
    pump('A-fallback')
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'T-34')).toBe(true)
    const fallbackA = anchorY('0')

    stateA.canonical = canonicalA
    apiLocal.setBattleClock(canonicalA.clock)
    pump('A-late')
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'BZT-70')).toBe(true)
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'T-34')).toBe(false)
    expect(anchorY('0')).not.toBe(fallbackA)

    markerLabelRows.length = 0
    const stateB = { canonical: null }
    const sessionB = { loadScene: vi.fn().mockResolvedValue(mkData()), getState: () => stateB }
    await apiLocal.loadData({ kind: 'local', file: new File(['b'], 'marker-b.wotbreplay'), session: sessionB })
    apiLocal.setPlaying(false)
    apiLocal.seekTime(112.5)
    pump('B-fallback')
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'T-34')).toBe(true)
    const fallbackB = anchorY('0')

    stateB.canonical = canonicalA
    apiLocal.setBattleClock(canonicalA.clock)
    pump('B-late')
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'BZT-70')).toBe(true)
    expect(markerLabelRows.at(-1)?.some((row) => row.target === 'T-34')).toBe(false)
    expect(anchorY('0')).not.toBe(fallbackB)
  })
})
