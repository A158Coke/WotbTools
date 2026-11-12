// 会话启动时序行为测试（#827 接替 sceneryMaterials.test.js 的 :1283 源码守卫）：
// 场景就绪（buildWorld → 地图资产 → 车辆构建 → GLB 恢复挂载）后着色器预热 compile 恰一次，
// 且先于开播（setPlaying）——首次开火才编译 = 开局/接火卡顿。
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../replaySource.js', () => ({
  mapStaticUrl: () => null,
  resolveMapKey: vi.fn(async () => 'malinovka'),
}))

import { createSessionLifecycle } from './sessionLifecycle.js'
import type { SessionLifecycleDeps, SessionStore } from './sessionLifecycle.js'

function makeDeps(overrides: Partial<SessionLifecycleDeps> = {}) {
  const order: string[] = []
  const track = (name: string) => () => { order.push(name) }
  const store: SessionStore = {
    hasData: false, loading: false, assetStage: false, assetProgress: null, assetIssues: [],
    assetDegraded: false, err: '', mapName: '', mapReady: false, mapKey: null,
  } as unknown as SessionStore
  const data = { meta: { map_id: 6, map_name: 'malinovka' }, vehicles: [] } as never
  const deps: SessionLifecycleDeps = {
    store,
    destroyed: () => false,
    perf: () => null,
    teardownSession: track('teardownSession'),
    publishSessionData: track('publishSessionData'),
    publishMapOnlyData: track('publishMapOnlyData'),
    ensureRenderer: track('ensureRenderer'),
    battleRange: () => [0, 120],
    publishSceneClock: track('publishSceneClock'),
    clearCanonicalClock: vi.fn(),
    prepareSessionCamera: track('prepareSessionCamera'),
    setMapKey: track('setMapKey'),
    getGlbOn: () => true,
    buildWorld: track('buildWorld'),
    setCam: track('setCam'),
    clampCameraTarget: vi.fn(),
    constrainFreeCameraAltitude: vi.fn(),
    loadMapImage: vi.fn(async () => { order.push('loadMapImage') }),
    buildBases: track('buildBases'),
    buildSpawns: track('buildSpawns'),
    buildVehicles: track('buildVehicles'),
    setupContactShadows: track('setupContactShadows'),
    applyGlbToggle: vi.fn(async () => { order.push('applyGlbToggle') }),
    buildRoster: track('buildRoster'),
    prepareResolvers: track('prepareResolvers'),
    prewarmShaders: track('prewarmShaders'),
    setPlaying: track('setPlaying'),
    tick: track('tick'),
    writeHud: track('writeHud'),
    invalidate: vi.fn(),
    loadRecorderCamera: vi.fn(),
    transients: { rebuildSources: track('rebuildSources'), rewindBursts: track('rewindBursts') },
    setClockRange: track('setClockRange'),
    setTime: track('setTime'),
    debug: false,
    exposeVehicles: vi.fn(),
    data: () => data,
    topViewOnLoad: () => true,
    cam: () => 'top',
    forceGlb: () => true,
    resetSessionCursors: track('resetSessionCursors'),
    ...overrides,
  }
  return { deps, order }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe(':1283 场景就绪时的着色器预热时序', () => {
  it('startPlayback：prewarmShaders 恰一次，在 GLB 恢复挂载（forceGlb await）之后、setPlaying 之前', async () => {
    const { deps, order } = makeDeps()
    const handle = createSessionLifecycle(deps)
    const ok = await handle.startPlayback(0)
    expect(ok).toBe(true)
    // 恰一次（重复预热 = 浪费加载窗口；漏预热 = 首次开火卡顿）
    expect(order.filter((s) => s === 'prewarmShaders').length).toBe(1)
    const at = (name: string) => order.indexOf(name)
    // GLB 恢复挂载（高/极致 forceGlb）先于预热：预热要 compile 车模材质
    expect(at('applyGlbToggle')).toBeGreaterThan(-1)
    expect(at('prewarmShaders')).toBeGreaterThan(at('applyGlbToggle'))
    expect(at('prewarmShaders')).toBeGreaterThan(at('buildVehicles'))
    expect(at('prewarmShaders')).toBeGreaterThan(at('buildRoster'))
    // 预热在开播之前（首个渲染帧已无编译阻塞）
    expect(at('setPlaying')).toBeGreaterThan(at('prewarmShaders'))
    expect(deps.store.startTime).toBe(0)
    expect(deps.store.assetStage).toBe(false)
  })

  it('过期会话（epoch 失效）：不预热、不开播', async () => {
    const { deps, order } = makeDeps()
    const handle = createSessionLifecycle(deps)
    const ok = await handle.startPlayback(99)   // 非 current epoch → 入口即放弃
    expect(ok).toBe(false)
    expect(order).not.toContain('prewarmShaders')
    expect(order).not.toContain('setPlaying')
  })
})
