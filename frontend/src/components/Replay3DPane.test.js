// @vitest-environment happy-dom
/**
 * 3D 回放面板（Replay3DPane）契约：
 * - WebGL 预检（不支持时不初始化场景，整块换说明）；
 * - 文件由工作台派生（面板自己不选文件）：先停在**待开播**（选画质），按「开始」才解析；
 * - 换文件先撤下上一场（内核 reset），不把旧场景留在待开播面板后面；
 * - `active` 闸门：切走停帧但不销毁会话、键盘不再被劫持；切回不重新解析；
 * - 解析失败可重试同一份文件（不必再选一次）；
 * - 顶栏双方血量 / 比分按**阵营视角**字段渲染（friendly_team 映射在场景层做）；
 * - HUD 阵营色走语义 token（阵容 / 胜负横幅不再写死红绿）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, shallowReactive } from 'vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { makeBattlePlaybackDataset } from '../test/playbackV2TestUtil.js'

// 源码级守卫用（CSS 结构契约：名册不得是嵌套滚动盒等）
const here = dirname(fileURLToPath(import.meta.url))
let Replay3DPane

const canonical = vi.hoisted(() => ({ load: vi.fn(), portrait: vi.fn() }))
vi.mock('../vehicle-portraits/runtime.js', () => ({ loadVehiclePortrait: canonical.portrait }))
const playback = vi.hoisted(() => ({ api: null, init: null, apis: [] }))
/**
 * 模拟 `playbackScene.initPlayback` 的**真实契约**：加载状态与就绪状态由场景层唯一持有
 * （见 frontend/src/scene/playbackScene.js 的 loadData / teardownSession / reset）。
 * 组件层不再镜像这些状态，所以 mock 必须自己承担，否则测试会验证一个不存在的 owner。
 */
const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
})

vi.mock('../scene/playbackScene.js', () => {
  playback.init = vi.fn((container, store) => {
    let generation = 0
    const api = {
      store,
      loadData: vi.fn(async (source) => {
        const current = ++generation
        // 真实契约：新会话被接受即 loading=true / hasData=false，完成后反向翻转
        store.hasData = false
        store.loading = true
        const result = source.session ? await source.session.loadScene(source.file) : null
        if (current !== generation) return
        store.playbackSession = source.session?.getState(source.file) ?? null
        store.loading = false
        store.hasData = true
      }),
      destroy: vi.fn(() => {
        // 会话终止 = 不再有可用回放数据（与生产 teardownSession 一致）
        store.hasData = false
        store.loading = false
      }),
      reset: vi.fn(() => {
        generation++
        store.playbackSession = null
        // 撤下当前回放（工作台清空 / 换选）：回到「无数据」等待态
        store.hasData = false
        store.loading = false
        store.assetStage = false
        store.err = ''
      }),
      setPlaying: vi.fn(),
      seekBy: vi.fn(),
      setSpeed: vi.fn(),
      seekTime: vi.fn(),
      setCam: vi.fn(),
      setFollow: vi.fn(),
      setGlb: vi.fn(),
      setLabelPrefs: vi.fn(),
      setQuality: vi.fn(),
      setPaused: vi.fn(),
    }
    playback.api = api
    playback.apis.push(api)
    return api
  })
  return { initPlayback: playback.init, QUALITY_PRESETS: { low: { label: 'Low' }, mid: { label: 'Mid' }, high: { label: 'High' } } }
})
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: { configured: () => true } }))
/**
 * 布局档位 / 指针 mock：手机形态用例把 `layout.compact` 打开，即可验证「工具条收窄、
 * 相机与阵容搬进显示面板」这套紧凑呈现；宽档用例保持 false（桌面不得回归）。
 */
const layout = vi.hoisted(() => ({ compact: false, portrait: false }))
/** 全屏能力桩的调用计数（happy-dom 无 Fullscreen API，用于断言确实调用了 requestFullscreen） */
const fullscreenCalls = { request: 0 }
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return {
    usePointer: () => ({ coarse: computed(() => false) }),
    useBreakpoint: () => ({
      tier: computed(() => (layout.compact ? 'compact' : 'expanded')),
      isCompact: computed(() => layout.compact),
      isExpanded: computed(() => !layout.compact),
    }),
  }
})
/**
 * 手机形态来自 `usePlaybackPhoneForm`（宽度 <768 **或** 触屏且视口高 ≤500），
 * 不是纯宽度断点——手机全屏横屏后内宽可 >768，仍必须保持手机呈现。
 */
vi.mock('../composables/usePlaybackPhoneForm.js', async () => {
  const { computed } = await import('vue')
  return { usePlaybackPhoneForm: () => ({ isPhone: computed(() => layout.compact) }) }
})
/** 竖屏判据（与 2D 共用 usePlaybackPortraitViewport）：手机竖屏 = compact + portrait，
 *  手机横屏 / 全屏横屏 = compact 但不是 portrait。 */
vi.mock('../composables/usePlaybackPortraitViewport.js', async () => {
  const { computed } = await import('vue')
  return { usePlaybackPortraitViewport: () => ({ isPortrait: computed(() => layout.portrait) }) }
})
// 唯一 reactive 主题源：给 HUD 阵营色一个可依赖的 profile ref
vi.mock('../composables/useUiProfile.js', async () => {
  const { ref } = await import('vue')
  return { uiProfile: ref('showcase'), useUiProfile: () => ({ uiProfile: ref('showcase') }) }
})
const translate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: translate, te: () => false }),
}))

/** WebGL 模拟：'webgl2' | 'none' */
function mockWebGL(level) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (name) {
    return level === 'webgl2' && name === 'webgl2' ? { getExtension: () => ({ loseContext() {} }) } : null
  })
}

const mkFile = (name) => new File(['x'], name)

/** props 变化后的 flush：watcher 是 post-flush（要等模板刷新出 stage 节点） */
async function flush() {
  await nextTick()
  await nextTick()
}

/** 待开播 → 按「开始」：解析与资产加载都发生在这一步之后（画质先定型） */
async function start(wrapper) {
  await wrapper.get('[data-test="replay3d-start"]').trigger('click')
  await flush()
}

function mountPane(props = {}) {
  const states = new WeakMap()
  const getState = file => {
    if (!states.has(file)) states.set(file, shallowReactive({ canonical: null, sceneState: 'idle' }))
    return states.get(file)
  }
  const playbackSession = {
    getState,
    loadScene: async file => {
      getState(file).canonical = await canonical.load(file)
      getState(file).sceneState = 'ready'
      return {}
    },
  }
  return mount(Replay3DPane, {
    props: { file: mkFile('battle.wotbreplay'), active: true, playbackSession, ...props },
    global: { mocks: { $t: translate } },
  })
}

// 两边约束都要：main 新增的连通性前置状态（离线直接挂载不得初始化远端 loader）
// + 本分支逐例重置模块后动态 import（呈现偏好是持久化的，必须每例干净）。
//
// 顺序有讲究：`vi.resetModules()` 之后 mock 工厂还没跑，`connectivityState.state` 仍是
// null——必须先 await dynamic import 触发工厂，再设状态值（直接设 .value 会炸
// "Cannot set properties of null"）。
beforeEach(async () => {
  canonical.load.mockReset().mockResolvedValue({ dataset: null, reloadTelemetry: null })
  canonical.portrait.mockReset().mockResolvedValue(null)
  layout.compact = false
  playback.api = null
  playback.apis.length = 0
  playback.init?.mockClear()
  // 呈现偏好是持久化的：逐例清空，否则「显示」面板用例的改动会渗到后续用例
  localStorage.clear()
  vi.resetModules()
  Replay3DPane = (await import('./Replay3DPane.vue')).default
  // 工厂已运行：把连通性复位到在线（离线用例随后在自身 it 内覆写）
  if (connectivityState.state) connectivityState.state.value = 'online'
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('Replay3DPane', () => {
  it('3D完整详情按canonical账号与时间投影，包含肖像装备物资道具且seek不泄露未来', async () => {
    mockWebGL('webgl2')
    const dataset = makeBattlePlaybackDataset()
    const track = dataset.vehicles[0]
    track.positionSegments = [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 5,
      samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 5, x: 5, y: 0 }] }]
    track.healthTransitions.push({ timeSec: 10, currentHp: 1400, displayCapacityHp: 1500, knowledge: 'CURRENT' })
    track.damageLosses = [{ fromSec: 9, toSec: 10, hpLoss: 100, attackerAccountId: 2001, attackerReliable: true }]
    track.loadout = { consumables: ['repairkit', null, null], provisions: ['food', null, null], equipmentIds: ['rammer'], consumableWireCodes: [] }
    track.consumableTransitions = [{ timeSec: 8, consumableSlot: 0, state: 'COOLDOWN', logicalItemId: 'repairkit' }]
    dataset.events.push({ type: 'KILL', timeSec: 12, accountId: 1001, targetAccountId: 2001 })
    canonical.load.mockResolvedValue({ dataset, clock: { startRaw: 42 }, reloadTelemetry: null })
    canonical.portrait.mockResolvedValue('/portrait.png')
    const wrapper = mountPane()
    await start(wrapper)
    const store = playback.api.store
    store.time = 54 // canonical 12; never subtract the render-grid startTime instead
    store.startTime = 0
    store.roster = { team1: [{ eid: 7, accountId: 1001, tankId: 1, team: 1, nick: 'Scene name', tank: 'Scene tank', hp: 999, maxHp: 999 }], team2: [], unknown: [] }
    await flush()
    await wrapper.get('.team-lane .pl').trigger('click')
    await flush()
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selectedTrack').accountId).toBe(1001)
    expect(details.props('currentTime')).toBe(12)
    await vi.waitFor(() => expect(details.props('selectedPortraitUrl')).toBe('/portrait.png'))
    expect(details.props('selLastKnownSec')).toBe(5)
    expect(details.props('health')).toEqual({ currentHp: 1400, maxHp: 1500 })
    expect(details.props('selCurStats')).toEqual({ dealt: 400, received: 100, kills: 1 })
    expect(details.props('selDamageLog')).toHaveLength(2)
    for (const group of ['equipment', 'provisions', 'consumables']) expect(details.find(`[data-test="v2-inspector-${group}"]`).exists()).toBe(true)
    expect(details.find('.v2-chip-state').exists()).toBe(true)
    store.time = 47
    await nextTick()
    expect(details.find('.v2-chip-state').exists()).toBe(false)
    store.time = 51
    await nextTick()
    expect(details.props('selCurStats')).toEqual({ dealt: 0, received: 0, kills: 0 })
    expect(details.props('selDamageLog')).toEqual([])
    store.time = 54
    await nextTick()
    expect(details.props('selCurStats').dealt).toBe(400)
    wrapper.unmount()
  })

  it('换文件时迟到canonical结果不得覆盖新场详情', async () => {
    mockWebGL('webgl2')
    let finishOld
    canonical.load.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const nextDataset = makeBattlePlaybackDataset()
    nextDataset.vehicles[0].playerName = 'New battle'
    canonical.load.mockResolvedValue({ dataset: nextDataset, clock: { startRaw: 10 }, reloadTelemetry: null })
    const wrapper = mountPane()
    await start(wrapper)
    expect(canonical.load).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ file: mkFile('next.wotbreplay') })
    await start(wrapper)
    playback.api.store.time = 10
    playback.api.store.roster = { team1: [{ eid: 77, accountId: 1001, team: 1, nick: 'New battle', tank: 'Maus' }], team2: [], unknown: [] }
    await flush()
    await wrapper.get('.team-lane .pl').trigger('click')
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selectedTrack').playerName).toBe('New battle')
    finishOld({ dataset: makeBattlePlaybackDataset(), clock: { startRaw: 42 }, reloadTelemetry: null })
    await flush()
    expect(details.props('selectedTrack').playerName).toBe('New battle')
    expect(details.props('currentTime')).toBe(0)
    wrapper.unmount()
  })

  it('scene starts with canonical pending and the open Details automatically enriches later', async () => {
    mockWebGL('webgl2')
    const state = shallowReactive({ canonical: null, canonicalError: null, canonicalState: 'loading', sceneState: 'ready' })
    const session = { loadScene: vi.fn().mockResolvedValue({}), getState: () => state }
    const wrapper = mountPane({ playbackSession: session })
    await start(wrapper)
    const store = playback.api.store
    expect(store.hasData).toBe(true)
    expect(state.canonicalState).toBe('loading')
    store.time = 54
    store.roster = { team1: [{ eid: 7, accountId: 1001, team: 1, nick: 'Scene player', tank: 'Maus', hp: 100, maxHp: 1500 }], team2: [], unknown: [] }
    await flush()
    await wrapper.get('.team-lane .pl').trigger('click')
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selectedState').vehicle.playerName).toBe('Scene player')
    expect(details.props('health')).toEqual({ currentHp: 100, maxHp: 1500 })
    expect(details.props('selectedTrack')).toBeNull()
    expect(details.props('selCurStats')).toBeNull()
    expect(details.props('selDamageLog')).toEqual([])
    const dataset = makeBattlePlaybackDataset({ events: [
      { timeSec: 10, kind: 'DAMAGE', attackerAccountId: 1001, victimAccountId: 2001, amount: 400, visibility: 'OBSERVED' },
    ] })
    state.canonical = { dataset, clock: { startRaw: 42 }, reloadTelemetry: null }
    state.canonicalState = 'ready'
    await flush()
    expect(details.props('selectedTrack').accountId).toBe(1001)
    expect(details.props('selCurStats').dealt).toBe(400)
    expect(details.props('selDamageLog')).toHaveLength(1)
    expect(details.props('currentTime')).toBe(12)
    expect(session.loadScene).toHaveBeenCalledTimes(1)
    state.canonical = null
    state.canonicalState = 'error'
    state.canonicalError = new Error('AI failed')
    await flush()
    expect(store.hasData).toBe(true)
    expect(details.props('selectedState').vehicle.playerName).toBe('Scene player')
    expect(details.props('selCurStats')).toBeNull()
    wrapper.unmount()
  })

  it('a successful 2D retry updates retained 3D Details without reloading the scene', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const shared = shallowReactive({ canonical: null })
    playback.api.store.playbackSession = shared
    playback.api.store.roster = { team1: [{ eid: 7, accountId: 1001, team: 1, nick: 'A', tank: 'Maus' }], team2: [], unknown: [] }
    await flush()
    await wrapper.get('.team-lane .pl').trigger('click')
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selectedTrack')).toBeNull()
    await wrapper.setProps({ active: false })
    shared.canonical = { dataset: makeBattlePlaybackDataset(), clock: { startRaw: 42 }, reloadTelemetry: null }
    await wrapper.setProps({ active: true })
    expect(details.props('selectedTrack').accountId).toBe(1001)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('canonical缺失时不为3D详情伪造统计或inspect track', async () => {
    mockWebGL('webgl2')
    canonical.load.mockResolvedValue({ dataset: null, clock: null })
    const wrapper = mountPane()
    await start(wrapper)
    playback.api.store.roster = { team1: [{ eid: 7, accountId: 1001, team: 1, nick: 'A', tank: 'Maus', hp: 100, maxHp: 100 }], team2: [], unknown: [] }
    await flush()
    await wrapper.get('.team-lane .pl').trigger('click')
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selCurStats')).toBeNull()
    expect(details.props('selectedTrack')).toBeNull()
    expect(details.find('[data-test="pb-sb-dealt"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['offline', 'unknown', 'degraded', 'service-unavailable'])('never initializes a remote loader on a %s direct mount', async (state) => {
    connectivityState.state.value = state
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    expect(playback.init).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="replay3d-connectivity"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('disconnect destroys the remote session; reconnect initializes once with the retained file', async () => {
    mockWebGL('webgl2')
    const file = mkFile('kept.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    await start(wrapper)
    const oldApi = playback.api
    connectivityState.state.value = 'offline'
    await flush()
    expect(oldApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.props('file')).toStrictEqual(file)
    connectivityState.state.value = 'online'
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    expect(playback.api.loadData).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    connectivityState.state.value = 'online'
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('reconnect while the retained 3D pane is hidden defers new assets until activation', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    connectivityState.state.value = 'offline'
    await flush()
    await wrapper.setProps({ active: false })
    connectivityState.state.value = 'online'
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ active: true })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('不支持 WebGL：不初始化场景，显示说明', () => {
    mockWebGL('none')
    const wrapper = mountPane()
    expect(playback.init).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="scene3d-unsupported"]').text()).toContain('scene3d.webgl_unavailable')
    wrapper.unmount()
  })

  it('没有文件 / 被工作台阻断时不初始化场景，也不自己开文件选择器', () => {
    mockWebGL('webgl2')
    const empty = mountPane({ file: null })
    expect(playback.init).not.toHaveBeenCalled()
    expect(empty.get('[data-testid="replay3d-empty"]').text()).toBe('agentReplay.no_file')
    expect(empty.find('input[type="file"]').exists()).toBe(false)
    empty.unmount()

    const blocked = mountPane({ blockedReason: 'workspace.single_replay_required' })
    expect(blocked.get('[data-testid="replay3d-blocked"]').text()).toBe('workspace.single_replay_required')
    blocked.unmount()
  })

  it('有文件先停在待开播；按开始才用工作台派生文件加载一次；同一文件不重复解析', async () => {
    mockWebGL('webgl2')
    const file = mkFile('battle.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(1)
    // 待开播：画质尚未定型，所以既不解析也不拉资产
    expect(playback.api.loadData).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="replay3d-pending"]').text()).toContain('battle.wotbreplay')
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file }))
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flush()
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('解析所有权：换文件 / 撤下 / 卸载会真正 abort 在途解析（signal 透传给内核 source）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    const firstSignal = playback.api.loadData.mock.calls[0][0].signal
    expect(firstSignal.aborted).toBe(false)

    // 换文件：reset 撤下旧场景的同时，旧解析任务必须被 abort（不再占 Worker 队列）
    const next = mkFile('b2.wotbreplay')
    await wrapper.setProps({ file: next })
    await flush()
    expect(firstSignal.aborted).toBe(true)

    // 按「开始」→ 新解析拿到**新** signal（未 abort）
    await start(wrapper)
    const secondSignal = playback.api.loadData.mock.calls[1][0].signal
    expect(secondSignal).not.toBe(firstSignal)
    expect(secondSignal.aborted).toBe(false)

    // 卸载：在途解析一并撤下
    wrapper.unmount()
    expect(secondSignal.aborted).toBe(true)
  })

  it('换目标回放 → 先撤下上一场（内核 reset）回到待开播，按开始才解析新文件', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    playback.api.store.hasData = true
    await nextTick()

    const next = mkFile('b2.wotbreplay')
    await wrapper.setProps({ file: next })
    await flush()
    // 撤下旧场景：否则旧场景继续呈现，还会压住待开播面板（用户永远看着上一场）
    expect(playback.api.reset).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    expect(playback.api.store.hasData).toBe(false)
    expect(wrapper.get('[data-test="replay3d-pending"]').text()).toContain('b2.wotbreplay')

    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'local', file: next }))
    wrapper.unmount()
  })

  it('active 闸门：切走 setPaused(true)、切回 setPaused(false)，且不销毁场景', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    expect(playback.api.setPaused).toHaveBeenLastCalledWith(false)
    playback.api.setPaused.mockClear()
    await wrapper.setProps({ active: false })
    expect(playback.api.setPaused).toHaveBeenCalledWith(true)
    expect(playback.api.destroy).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    expect(playback.api.setPaused).toHaveBeenLastCalledWith(false)
    wrapper.unmount()
    expect(playback.api.destroy).toHaveBeenCalledTimes(1)
  })

  it('解析中为不确定进度，资产阶段显示资产进度；失败后可重试同一文件或关闭', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const { store } = playback.api

    let finish
    // 首次解析（按「开始」触发的这一次）保持挂起：加载状态由场景层拥有，
    // 所以 mock 也要按场景契约翻转 loading / hasData。
    playback.api.loadData.mockImplementationOnce(() => {
      store.hasData = false
      store.loading = true
      return new Promise((resolve) => { finish = resolve })
        .finally(() => { store.loading = false })   // 场景契约：加载结束必落下 loading
    })
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(wrapper.get('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.parsing')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()

    store.assetStage = true
    store.assetProgress = 0.3
    await nextTick()
    expect(wrapper.get('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.loading_assets')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('30')

    store.err = 'bad replay'
    store.assetStage = false
    finish()
    await flush()
    expect(wrapper.get('[data-testid="scene3d-error"]').text()).toContain('agentReplay.error_load')
    await wrapper.get('[data-testid="scene3d-retry"]').trigger('click')
    await flush()
    expect(playback.api.loadData).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'local', file: wrapper.props('file') }))

    store.err = 'still bad'
    await nextTick()
    await wrapper.get('[data-testid="scene3d-dismiss"]').trigger('click')
    expect(store.err).toBe('')
    expect(wrapper.find('[data-testid="scene3d-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Recorder 在 Team 2：己方在左、敌方在右，颜色和标题跟随视角', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.friendlyTeam = 2
    // 名册条目的真实形状来自 playbackScene 的 buildRoster（身份字段 + 当前时刻的 hp/maxHp）
    store.roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T-62A', hp: 975, maxHp: 1950, dead: false, followed: false }],
      team2: [{ eid: 2, team: 2, nick: 'B', tank: 'Maus', hp: 1500, maxHp: 3000, dead: false, followed: false }],
      unknown: [{ eid: 3, team: null, nick: 'C', tank: '', hp: 100, maxHp: 0, dead: false, followed: false }],
    }
    document.documentElement.style.setProperty('--color-team-1', 'rgb(1, 2, 3)')
    document.documentElement.style.setProperty('--color-team-2', 'rgb(4, 5, 6)')
    // ally / enemy 是**记录者视角**别名：把两者设成完全不同的值，
    // 名册若（错误地）按视角取色就会立刻显形
    document.documentElement.style.setProperty('--color-team-ally', 'rgb(9, 9, 9)')
    document.documentElement.style.setProperty('--color-team-enemy', 'rgb(8, 8, 8)')
    await nextTick()
    expect(wrapper.get('.side-left .team2').exists()).toBe(true)
    expect(wrapper.get('.side-right .team1').exists()).toBe(true)
    expect(wrapper.get('.side-left .pl').attributes('style')).toContain('--color-team-ally')
    expect(wrapper.get('.side-right .pl').attributes('style')).toContain('--color-team-enemy')
    // 车道结构下 DOM 顺序是 team1 → unknown → team2：按各自面板取点，不依赖全局序
    const dots = (sel) => wrapper.findAll(`${sel} .pl .dot`)
    expect(dots('.team1')).toHaveLength(1)
    expect(dots('.team1')[0].attributes('style')).toContain('--color-team-enemy')
    expect(dots('.team2')).toHaveLength(1)
    expect(dots('.team2')[0].attributes('style')).toContain('--color-team-ally')
    // 未知阵营既不并入队伍 1 也不并入队伍 2（用中性色）
    expect(dots('.team-unknown')).toHaveLength(1)
    expect(dots('.team-unknown')[0].attributes('style')).not.toContain('rgb(1, 2, 3)')
    expect(dots('.team-unknown')[0].attributes('style')).not.toContain('rgb(4, 5, 6)')
    // 分组标题三语（未知阵营独立一段）
    expect(wrapper.findAll('.team h3').map(h => h.text())).toEqual([
      'recon.map.team_friendly', 'agentReplay.teamUnknown', 'recon.map.team_enemy',
    ])
    for (const p of ['--color-team-1', '--color-team-2', '--color-team-ally', '--color-team-enemy']) {
      document.documentElement.style.removeProperty(p)
    }
    wrapper.unmount()
  })

  it('名册每行显示 HP 数值与百分比（血条不是唯一信息），随 store 投影变化，阵亡 = 0 / 0%', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.roster = {
      team1: [
        { eid: 1, team: 1, nick: 'A', tank: 'Kranvagn', hp: 1950, maxHp: 1950, dead: false, followed: false },
        { eid: 2, team: 1, nick: 'B', tank: 'SPHT', hp: 824, maxHp: 1950, dead: false, followed: false },
      ],
      team2: [{ eid: 3, team: 2, nick: 'C', tank: 'Chieftain', hp: 0, maxHp: 2000, dead: true, followed: false }],
      unknown: [],
    }
    await nextTick()
    const nums = (sel) => wrapper.findAll(`${sel} [data-test="roster-hp-text"]`).map(n => n.text())
    // exact 呈现：条内只写 `current / max`，不再重复百分比后缀
    expect(nums('.team1')).toEqual(['1950 / 1950', '824 / 1950'])
    // 阵亡行读作 `0 / max`（有量程时信息更完整），不保留“最后一个非零 HP”
    expect(nums('.team2')).toEqual(['0 / 2000'])

    // 状态在时刻：store 投影变化后行内数值同步（HP 不只有血条）
    store.roster.team1[0].hp = 1200
    await nextTick()
    expect(nums('.team1')).toEqual(['1200 / 1950', '824 / 1950'])

    // 无可信上限 → unknown（`—`，unknown ≠ 0），不是 0%
    store.roster.team1[1].maxHp = 0
    await nextTick()
    expect(nums('.team1')[1]).toBe('—')
    expect(wrapper.findAll('.team1 [data-test="roster-hp"]')[1].classes()).toContain('hp-mode-unknown')
    wrapper.unmount()
  })

  it('阵容在左右两条侧边车道上（team1/team2 各一车道，unknown 归左车道常驻底部）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T-62A', hp: 975, maxHp: 1950, dead: false, followed: false }],
      team2: [{ eid: 2, team: 2, nick: 'B', tank: 'Maus', hp: 3000, maxHp: 3000, dead: false, followed: false }],
      unknown: [],
    }
    await nextTick()
    // 两条车道都是 pb-root 直接子级；面板在车道**内部**（车道定界，面板不再各自绝对定位散挂）
    const lanes = wrapper.findAll('.roster-surface > .team-lane')
    expect(lanes.map(l => l.classes())).toEqual([['team-lane', 'side-left'], ['team-lane', 'side-right']])
    const left = lanes[0]
    const team1 = wrapper.get('.team1')
    const team2 = wrapper.get('.team2')
    // 行由 2D / 3D 共用的 PlaybackRoster 渲染：名册容器是车道的**直接子级**，队伍面板
    // 挂在名册容器里——同一个组件同时服务 2D 的三段式车道与 3D 的物理队伍车道。
    // （用结构断言而不是节点同一性：happy-dom 下 Wrapper 的节点身份比较与布局契约无关。）
    expect(left.element.firstElementChild.dataset.test).toBe('pb-shell-roster')
    expect(lanes[1].element.firstElementChild.dataset.test).toBe('pb-shell-roster')
    for (const team of [team1, team2]) {
      expect(team.element.parentElement.classList.contains('pb-roster')).toBe(true)
    }
    expect(team1.text()).toContain('A')
    expect(team2.text()).toContain('B')
    // unknown 非空才渲染，且渲染在**左车道**里（team1 之后）——绝不进中央 / 右车道
    expect(wrapper.find('.team-unknown').exists()).toBe(false)
    store.roster.unknown = [{ eid: 3, team: null, nick: 'C', tank: '', hp: 100, maxHp: 100, dead: false, followed: false }]
    await nextTick()
    const unknown = wrapper.get('.team-unknown')
    // unknown 与 team1 同属左车道的那一个名册容器，且排在 team1 之后
    expect(unknown.element.parentElement.classList.contains('pb-roster')).toBe(true)
    expect(unknown.element.parentElement).toBe(team1.element.parentElement)
    expect(unknown.text()).toContain('C')

    // 未就绪时车道与面板都不渲染（与 HUD 其余部分同口径）
    store.hasData = false
    await nextTick()
    expect(wrapper.findAll('.team-lane')).toHaveLength(0)
    wrapper.unmount()
  })

  it('播放传输控件是 2D / 3D 共用的那一套（同一组 data-test 契约）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    playback.api.store.hasData = true
    playback.api.store.duration = 300
    await nextTick()
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-speed-current"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-time"]').exists()).toBe(true)
    // Renderer-specific tools live exclusively in the shared Display surface.
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('播放条 / 顶栏 / 详情与 2D 同一战斗时钟：canonical clock 优先，场景按同一 resolver 推出的时钟兜底', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const store = playback.api.store
    store.hasData = true
    // 场景时间轴含准备阶段（t_start = 0.97、END = 293.82）；战斗时钟：开战在原始 11.0s，打了 282s
    store.startTime = 0.97
    store.duration = 293.82
    store.battleClock = { startRaw: 11, durationSec: 282 }
    store.time = 272.9
    await nextTick()
    const transport = wrapper.getComponent({ name: 'PlaybackTransport' })
    expect(transport.props('startTime')).toBe(11)
    expect(transport.props('duration')).toBe(293)
    // 与 2D 同一个读数：已播放 = 原始时间 − 开战（261.9s → 04:22），总长 = 282s（04:42）
    expect(wrapper.get('[data-test="pb-time"]').text()).toBe('04:22 / 04:42')
    expect(wrapper.get('[data-test="pb-hud-time"]').text()).toBe('04:22')

    // 工作台 canonical 就绪后以它为准（与 2D / 详情完全同一个原点）
    store.playbackSession = shallowReactive({ canonical: { dataset: null, clock: { startRaw: 11.3, durationSec: 282 }, reloadTelemetry: null } })
    await nextTick()
    expect(transport.props('startTime')).toBe(11.3)
    expect(wrapper.get('[data-test="pb-hud-time"]').text()).toBe('04:22')

    // 两者都没有：退回场景原始时间轴（不伪造开战时刻）
    store.playbackSession = null
    store.battleClock = null
    store.time = 100.97
    await nextTick()
    expect(transport.props('startTime')).toBe(0.97)
    expect(transport.props('duration')).toBe(293.82)
    expect(wrapper.get('[data-test="pb-hud-time"]').text()).toBe('01:40')
    wrapper.unmount()
  })

  it('共享标签偏好推给场景：enabled + 四行开关，面板改动即时下发', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    // 建场景时补推一次（内核在 initPlayback 之后才有 setLabelPrefs）
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith({
      enabled: true, showPlayerName: false, showTankName: true, showHp: true, showReload: true,
    })
    // 工具条只在 HUD 有数据时渲染
    playback.api.store.hasData = true
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await nextTick()
    wrapper.findComponent({ name: 'PlaybackVehicleLabels3D' }).vm.setLabels([{ eid: 1, playerName: 'Recorder昵称', tankName: 'Maus', friendly: true }])
    await nextTick()
    expect(wrapper.find('[data-test="pb-label-player"]').exists()).toBe(false)
    await wrapper.get('[data-testid="disp-player"]').setValue(true)
    await nextTick()
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith({
      enabled: true, showPlayerName: true, showTankName: true, showHp: true, showReload: true,
    })
    expect(wrapper.get('[data-test="pb-label-player"]').text()).toBe('Recorder昵称')
    await wrapper.get('[data-testid="disp-player"]').setValue(false)
    expect(wrapper.find('[data-test="pb-label-player"]').exists()).toBe(false)
    await wrapper.get('[data-testid="disp-player"]').setValue(true)
    await wrapper.get('[data-testid="disp-hp"]').setValue(false)
    await nextTick()
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith({
      enabled: true, showPlayerName: true, showTankName: true, showHp: false, showReload: true,
    })
    wrapper.unmount()
  })

  it('bounds transient kill events independently of persistent HUD content', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.killfeed = Array.from({ length: 6 }, (_, id) => ({ id, kill: true, killer: `K${id}`, victim: `V${id}` }))
    await nextTick()
    expect(wrapper.get('[data-test="replay3d-killfeed"]').findAll('.kf')).toHaveLength(3)
    expect(wrapper.get('[data-test="replay3d-killfeed"]').text()).toContain('K5')
    expect(wrapper.get('[data-test="replay3d-killfeed"]').text()).not.toContain('K0')
    expect(wrapper.get('[data-test="pb-hud"]').find('.killfeed').exists()).toBe(false)
    wrapper.unmount()
  })

  it('显示面板可分别开关战场 UI 分块（顶栏 / 阵容 / 击杀流 / 基地条）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.baseViews = [{ id: 'A', owner: 'friendly', progress: 0.5 }]
    store.killfeed = [{ id: 1, kill: true, killer: 'K', victim: 'V' }]
    store.roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T', hp: 1, maxHp: 2, dead: false, followed: false }],
      team2: [], unknown: [],
    }
    await nextTick()
    expect(wrapper.find('.topbar').exists()).toBe(true)
    expect(wrapper.find('.killfeed').exists()).toBe(true)
    expect(wrapper.find('.base-status').exists()).toBe(true)
    expect(wrapper.find('.team-lane').exists()).toBe(true)

    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await nextTick()
    expect(wrapper.get('[data-testid="display-toggle"]').attributes('aria-expanded')).toBe('true')
    await wrapper.get('[data-testid="disp-topbar"]').setValue(false)
    await wrapper.get('[data-testid="disp-killfeed"]').setValue(false)
    await wrapper.get('[data-testid="disp-base"]').setValue(false)
    await wrapper.get('[data-testid="disp-roster"]').setValue(false)
    await nextTick()
    expect(wrapper.find('.topbar').exists()).toBe(false)
    expect(wrapper.find('.killfeed').exists()).toBe(false)
    expect(wrapper.find('.base-status').exists()).toBe(false)
    expect(wrapper.find('.team-lane').exists()).toBe(false)
    // 底部传输控件不属于"战场 UI"分块：仍可操作
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
    wrapper.unmount()
  })

  /**
   * 手机竖屏呈现（真机 blocker）：常驻控件只能占「时间轴 + 一行高频按钮」。
   *
   * 这些用例断言**行为 / 不变量**，不锁像素：
   *   · 工具条整行在紧凑档不常驻（`display:none` 由 CSS 承担，DOM 仍在但不可见）；
   *   · 二级控件（相机 / 阵容 / 画质）改在「显示」面板里，且可开可关；
   *   · 开关面板**不重建场景**（同一 sceneApi 实例，session 不重置）。
   */
  describe('手机竖屏：二级控件收进「显示」面板', () => {
    const roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T', hp: 1, maxHp: 2, dead: false, followed: false }],
      team2: [], unknown: [],
    }

    it('紧凑档与宽档共享 Display 相机设置；两档都没有「打开名册」按钮', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      const compactPane = mountPane()
      const compactStore = playback.api.store
      compactStore.hasData = true
      compactStore.roster = roster
      await nextTick()
      await compactPane.get('[data-testid="display-toggle"]').trigger('click')
      // Both forms disclose camera and presentation preferences from Gear.
      expect(compactPane.find('[data-testid="display-panel"] .dp-camera').exists()).toBe(true)
      // 名册没有临时面入口：唯一开关是 disp-roster 呈现偏好
      expect(compactPane.find('[data-testid="disp-roster"]').exists()).toBe(true)
      compactPane.unmount()

      layout.compact = false
      const widePane = mountPane()
      const wideStore = playback.api.store
      wideStore.hasData = true
      wideStore.roster = roster
      await nextTick()
      await widePane.get('[data-testid="display-toggle"]').trigger('click')
      // Wide form uses the same secondary camera surface.
      expect(widePane.find('[data-testid="display-panel"] .dp-camera').exists()).toBe(true)
      expect(widePane.find('[data-testid="roster-toggle-compact"]').exists()).toBe(false)
      expect(widePane.find('[data-testid="roster-toggle"]').exists()).toBe(false)
      widePane.unmount()
      layout.compact = false
    })

    it('紧凑档：面板可开、可关、可关掉即恢复无遮挡；开合不得重建场景或重置会话', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      const wrapper = mountPane()
      await start(wrapper)
      const apiAfterStart = playback.api
      expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)

      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="display-close"]').exists()).toBe(true)
      // 面板只是覆盖层：不改变 playback session 身份，也不重建场景
      expect(playback.api).toBe(apiAfterStart)
      expect(playback.init).toHaveBeenCalledTimes(1)
      expect(playback.api.reset).not.toHaveBeenCalled()

      await wrapper.get('[data-testid="display-close"]').trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
      expect(playback.api).toBe(apiAfterStart)
      expect(playback.init).toHaveBeenCalledTimes(1)
      wrapper.unmount()
      layout.compact = false
    })

    it('紧凑档：相机模式在面板里切换，走同一个 setCam（不新建移动端相机状态）', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      const wrapper = mountPane()
      await start(wrapper)
      const { store } = playback.api
      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      await nextTick()
      const options = wrapper.get('[data-testid="display-panel"] .dp-camera').findAll('button')
      expect(options.length).toBeGreaterThan(1)
      await options[1].trigger('click')
      expect(playback.api.setCam).toHaveBeenCalled()
      // 场景仍是同一个实例（切相机 ≠ 重建）
      expect(store.speed).toBe(1)
      wrapper.unmount()
      layout.compact = false
    })

    it('紧凑档：画质是只读徽标，与工具条共用同一个 qualityBadge 来源', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      const wrapper = mountPane()
      const { store } = playback.api
      store.hasData = true
      await nextTick()
      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      await nextTick()
      const badge = wrapper.get('[data-testid="display-panel"] .dp-quality')
      expect(badge.text().length).toBeGreaterThan(0)
      wrapper.unmount()
      layout.compact = false
    })
  })

  /**
   * 3D 全屏：与 2D 同一套产品语义（composables/usePlaybackFullscreen），
   * 且**纯呈现 / 生命周期切换**——场景、解析、时间、倍速、相机、跟随目标、偏好都不重置。
   */
  describe('3D 全屏（与 2D 同语义）', () => {
    /**
     * Fullscreen 能力桩：happy-dom **不提供** `requestFullscreen`，而能力探测读的是
     * 真实元素上的方法。所以任何期望看到全屏按钮的用例都必须先装上它——以前靠
     * `v-if="fullscreenSupported"`（函数对象恒真）侥幸通过，现在探测正确了，就必须显式声明能力。
     */
    const withRequestFullscreen = (available, fn) => {
      fullscreenCalls.request = 0
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      const proto = Object.getPrototypeOf(document.createElement('div'))
      const saved = Object.getOwnPropertyDescriptor(proto, 'requestFullscreen')
      if (available) {
        Object.defineProperty(proto, 'requestFullscreen', {
          value: function requestFullscreen() {
            fullscreenCalls.request++
            Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true })
            document.dispatchEvent(new Event('fullscreenchange'))
            return Promise.resolve()
          },
          configurable: true, writable: true,
        })
      } else {
        Object.defineProperty(proto, 'requestFullscreen', { value: undefined, configurable: true, writable: true })
      }
      return Promise.resolve()
        .then(fn)
        .finally(() => {
          if (saved) Object.defineProperty(proto, 'requestFullscreen', saved)
          else delete proto.requestFullscreen
        })
    }

    it('全屏是主操作：常驻在传输控件行里，不在「显示」面板内（一键直达）', async () => {
      await withRequestFullscreen(true, async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane()
        const { store } = playback.api
        store.hasData = true
        await nextTick()
        const btn = wrapper.get('[data-testid="playback-fullscreen"]')
        // 它必须在面板**之外**（面板是二级设置，不允许把全屏藏进去）
        await wrapper.get('[data-testid="display-toggle"]').trigger('click')
        expect(wrapper.get('[data-testid="display-panel"]').element.contains(btn.element)).toBe(false)
        expect(btn.attributes('aria-pressed')).toBe('false')
        wrapper.unmount()
      })
    })

    /**
     * BLOCKER 2A：这条用例以前是**假阳**——它写的是 `playback.api.hasData = true`，
     * 而真实响应式状态在 `playback.api.store.hasData`。于是 `.controls` 从未渲染，
     * 全屏按钮无论如何都不存在，用例对错误的实现（`v-if="fullscreenSupported"`，
     * 函数对象恒真）也照样通过。
     *
     * 现在两条都**先证明控件确实渲染**（`[data-test=pb-controls]` / `pb-play` 存在），
     * 再只对全屏动作做断言。不支持的那条对错误实现必然失败：函数对象为真 → 按钮仍会渲染。
     */
    describe('全屏能力探测（控件确实渲染后才断言）', () => {
      const mountReady = async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane()
        playback.api.store.hasData = true
        await nextTick()
        return wrapper
      }

      it('requestFullscreen 可用 → 控件渲染且全屏动作存在', async () => {
        await withRequestFullscreen(true, async () => {
          const wrapper = await mountReady()
          // 先证明控件确实渲染（否则下面的断言什么都证明不了）
          expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
          expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
          expect(wrapper.find('[data-testid="playback-fullscreen"]').exists()).toBe(true)
          wrapper.unmount()
        })
      })

      it('requestFullscreen 不可用 → 控件照常渲染，但全屏动作不存在（不画假按钮）', async () => {
        await withRequestFullscreen(false, async () => {
          const wrapper = await mountReady()
          // 关键：控件**确实渲染了**，所以"没有全屏按钮"只能归因于能力探测
          expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
          expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
          expect(wrapper.find('[data-testid="playback-fullscreen"]').exists()).toBe(false)
          wrapper.unmount()
        })
      })

      it('能力在挂载后可用时也会出现（computed 跟随 target）', async () => {
        await withRequestFullscreen(false, async () => {
          const wrapper = await mountReady()
          expect(wrapper.find('[data-testid="playback-fullscreen"]').exists()).toBe(false)
          // 运行中恢复能力（等价于探测读到的元素变了）→ 重新渲染后按钮出现
          const proto = Object.getPrototypeOf(document.createElement('div'))
          Object.defineProperty(proto, 'requestFullscreen', {
            value: function requestFullscreen() { return Promise.resolve() },
            configurable: true, writable: true,
          })
          const remounted = await mountReady()
          expect(remounted.find('[data-testid="playback-fullscreen"]').exists()).toBe(true)
          wrapper.unmount()
          remounted.unmount()
        })
      })
    })

    it('进入 / 退出全屏不重建场景、不重解析、不重置时间·倍速·相机·偏好', async () => {
      // 能力必须在**挂载前**就位：探测在渲染时求值，之后才装上的按钮不会出现
      await withRequestFullscreen(true, async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane()
        await start(wrapper)
        const api = playback.api
        const { store } = api
        store.hasData = true
        store.time = 42
        store.speed = 4
        store.cam = 'follow'
        const rootEl = wrapper.get('.pb-root').element
        Object.defineProperty(document, 'exitFullscreen', {
          configurable: true,
          value: vi.fn(() => {
            Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
            document.dispatchEvent(new Event('fullscreenchange'))
            return Promise.resolve()
          }),
        })
        await nextTick()
        const initCallsBefore = playback.init.mock.calls.length
        // start() 之后解析已经发生一次（那是播放器启动，不是全屏造成的）；全屏往返不得再增
        const loadCallsBefore = api.loadData.mock.calls.length
        await wrapper.get('[data-testid="playback-fullscreen"]').trigger('click')
        await nextTick()
        expect(fullscreenCalls.request).toBe(1)
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('true')
        // 会话原封不动
        expect(playback.init.mock.calls.length).toBe(initCallsBefore)
        expect(api.reset).not.toHaveBeenCalled()
        expect(api.loadData.mock.calls.length).toBe(loadCallsBefore)
        expect(store.time).toBe(42)
        expect(store.speed).toBe(4)
        expect(store.cam).toBe('follow')
        // 退出：同一会话继续，状态依旧
        await wrapper.get('[data-testid="playback-fullscreen"]').trigger('click')
        await nextTick()
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('false')
        expect(playback.init.mock.calls.length).toBe(initCallsBefore)
        expect(store.time).toBe(42)
        expect(store.speed).toBe(4)
        expect(store.cam).toBe('follow')
        wrapper.unmount()
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      })
    })

    it('外部退出全屏（ESC / 系统手势）后状态同步回 false', async () => {
      await withRequestFullscreen(true, async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane()
        playback.api.store.hasData = true
        await nextTick()
        await wrapper.get('[data-testid="playback-fullscreen"]').trigger('click')
        await nextTick()
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('true')
        // 外部退出：不经过我们的 toggle
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
        document.dispatchEvent(new Event('fullscreenchange'))
        await nextTick()
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('false')
        wrapper.unmount()
      })
    })
  })

  /**
   * 需求 13：名册**不得**是嵌套滚动盒；行点击 = 跟随 + 选中 + 详情。
   */
  describe('名册：无嵌套滚动 + 行点击语义', () => {
    const roster = {
      team1: [
        { eid: 11, team: 1, nick: 'Alpha', tank: 'Kranvagn', hp: 1800, maxHp: 1950, dead: false, followed: false, color: 'c1' },
        { eid: 12, team: 1, nick: 'Bravo', tank: 'E 75', hp: 0, maxHp: 1900, dead: true, followed: false, color: 'c1' },
      ],
      team2: [{ eid: 21, team: 2, nick: 'Enemy', tank: 'T-62A', hp: 900, maxHp: 2000, dead: false, followed: true, color: 'c2' }],
      unknown: [],
    }

    it('队面板不得是独立滚动容器（常规名册必须一屏看全）', () => {
      const src = readFileSync(resolve(here, 'Replay3DPane.vue'), 'utf8')
      // .team 是视觉面板：不得带 overflow 滚动（旧实现 overflow-y: auto 造成两个小滚动盒）
      const teamBlock = /\.team \{([\s\S]*?)\}/.exec(src)?.[1] ?? ''
      expect(teamBlock).not.toContain('overflow')
      // 车道本身（基础规则）不是滚动盒；三段式里的 overflow 只是病态数据的兜底，
      // 正常 7v7 不出现滚动条由浏览器门禁（roster-geometry-*）在真实布局里断言。
      const laneBlock = /\n\.team-lane \{([\s\S]*?)\}/.exec(src)?.[1] ?? ''
      expect(laneBlock).not.toContain('overflow')
      // 临时名册面整套规则已不存在
      expect(src).not.toMatch(/\.roster-surface\.transient|rosterTransient|rosterConstrained/)
    })

    it('点一行只选中并显示共享详情，相机跟随保持独立', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const rows = wrapper.findAll('.team-lane .pl')
      expect(rows.length).toBe(3)
      // 详情面初始不存在
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(false)
      await rows[0].trigger('click')
      // 跟随（相机动作）
      expect(api.setFollow).not.toHaveBeenCalled()
      expect(api.setCam).not.toHaveBeenCalled()
      // 选中（行状态）
      expect(rows[0].classes()).toContain('selected')
      // 详情面出现且内容对应该行
      const details = wrapper.get('[data-testid="replay3d-details"]')
      expect(details.get('[data-test="pb-sb-tank"]').text()).toBe('Kranvagn')
      expect(details.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      expect(details.get('[data-test="pb-sb-hp"]').text()).toContain('1800')
      expect(details.find('[data-test="pb-sb-dealt"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('scene selection opens shared details; Free/Top preserve selection and Follow is explicit', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const onVehicleSelect = playback.init.mock.calls.at(-1)[3].onVehicleSelect
      onVehicleSelect(11)
      await nextTick()
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      expect(api.setFollow).not.toHaveBeenCalled()
      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      for (const mode of ['top', 'free']) {
        await wrapper.get(`[data-testid="display-panel"] [data-value="${mode}"]`).trigger('click')
        expect(api.setCam).toHaveBeenLastCalledWith(mode)
        api.store.cam = mode
        await nextTick()
        expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      }
      await wrapper.get('[data-testid="display-panel"] [data-value="follow"]').trigger('click')
      expect(api.setFollow).toHaveBeenCalledExactlyOnceWith(11)
      onVehicleSelect(21)
      await nextTick()
      expect(api.setFollow).toHaveBeenCalledTimes(1)
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Enemy')
      wrapper.unmount()
    })

    it('场景点选带真实事件时按点击原点定详情落位（不抛错、不误判左右）', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const onVehicleSelect = playback.init.mock.calls.at(-1)[3].onVehicleSelect
      const root = wrapper.get('[data-testid="replay3d-root"]').element
      // 场景 canvas 上的一次真实点选：事件由 playbackScene 透传，target 既不是左车道也不是右车道，
      // 落位只能按 clientX 相对 workspace 的位置判定（这条路径曾引用未定义变量而在真实点击时抛错）。
      const canvas = document.createElement('canvas')
      root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 })
      onVehicleSelect(21, { target: canvas, clientX: 900 })
      await nextTick()
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Enemy')
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(true)
      onVehicleSelect(11, { target: canvas, clientX: 40 })
      await nextTick()
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      wrapper.unmount()
    })

    it('手机横屏 / 全屏横屏：Team 1 | Stage | Team 2 常驻两侧车道（不需要 Display → Roster）', async () => {
      layout.compact = true
      layout.portrait = false
      mockWebGL('webgl2')
      const wrapper = mountPane()
      await start(wrapper)
      const api = playback.api
      api.store.roster = roster
      await nextTick()
      const root = wrapper.get('.pb-root')
      expect(root.classes()).toEqual(expect.arrayContaining(['phone-form', 'roster-side']))
      expect(root.classes()).not.toContain('portrait-flow')
      // 两条物理车道直接可见：左 = Team 1，右 = Team 2
      expect(wrapper.get('[data-testid="replay3d-lane-left"]').find('.team1').exists()).toBe(true)
      expect(wrapper.get('[data-testid="replay3d-lane-right"]').find('.team2').exists()).toBe(true)
      expect(wrapper.get('.roster-surface').isVisible()).toBe(true)
      // 紧凑行：信息不减
      const row = wrapper.get('[data-testid="replay3d-lane-left"] .pl')
      expect(wrapper.get('[data-testid="replay3d-lane-left"] [data-test="pb-shell-roster"]').classes()).toContain('pb-roster-compact')
      expect(row.get('[data-test="pb-roster-tank"]').text()).toBe('Kranvagn')
      expect(row.get('[data-test="roster-hp-text"]').text()).toBe('1800 / 1950')
      // 传输控件照常存在（名册与控件不互斥）
      expect(wrapper.find('.controls').exists()).toBe(true)
      wrapper.unmount()
      layout.compact = false
    })

    it('手机竖屏：纵向流（HUD / Stage / 传输控件 / 详情 inline / Team 1 / Team 2），没有浮层名册', async () => {
      layout.compact = true
      layout.portrait = true
      mockWebGL('webgl2')
      const wrapper = mountPane()
      await start(wrapper)
      const api = playback.api
      api.store.roster = roster
      await nextTick()
      const root = wrapper.get('.pb-root')
      expect(root.classes()).toContain('portrait-flow')
      expect(root.classes()).not.toContain('roster-side')
      // 名册直接在流里（不是 transient 浮层），行仍是完整信息
      expect(wrapper.get('.roster-surface').isVisible()).toBe(true)
      expect(wrapper.find('.roster-surface.transient').exists()).toBe(false)
      const rows = wrapper.findAll('.team-lane .pl')
      expect(rows).toHaveLength(3)
      expect(rows[0].get('[data-test="pb-roster-tank"]').text()).toBe('Kranvagn')
      expect(rows[0].get('[data-test="roster-hp-text"]').text()).toBe('1800 / 1950')
      // 竖屏名册不是紧凑密度（纵向空间够用），也不做纵向铺满
      expect(wrapper.get('[data-test="pb-shell-roster"]').classes()).not.toContain('pb-roster-compact')
      expect(wrapper.get('[data-test="pb-shell-roster"]').classes()).not.toContain('pb-roster-fill')
      // 详情是同一个共享组件的 inline 呈现
      await rows[0].trigger('click')
      const details = wrapper.get('[data-testid="replay3d-details"]')
      expect(details.attributes('data-presentation')).toBe('inline')
      expect(details.find('[data-test="pb-sb-drag"]').exists()).toBe(false)
      wrapper.unmount()
      layout.compact = false
      layout.portrait = false
    })

    it('名册关闭（uiPrefs.showRoster=false）：两条车道消失；数据、选中、详情、跟随与播放都保留', async () => {
      layout.compact = true
      mockWebGL('webgl2')
      const wrapper = mountPane()
      await start(wrapper)
      const api = playback.api
      api.store.roster = roster
      api.store.time = 45
      await nextTick()
      playback.init.mock.calls.at(-1)[3].onVehicleSelect(11)
      await nextTick()
      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      await wrapper.get('[data-testid="disp-roster"]').setValue(false)
      expect(wrapper.find('.roster-surface').exists()).toBe(false)
      expect(wrapper.get('.pb-root').classes()).not.toContain('roster-side')
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      expect(api.store.roster).toEqual(roster)
      expect(api.store.time).toBe(45)
      expect(api.setFollow).not.toHaveBeenCalled()
      await wrapper.get('[data-testid="disp-roster"]').setValue(true)
      expect(wrapper.get('[data-testid="replay3d-lane-left"] .pl').classes()).toContain('selected')
      expect(api.loadData).toHaveBeenCalledTimes(1)
      expect(playback.init).toHaveBeenCalledTimes(1)
      wrapper.unmount()
      layout.compact = false
    })

    it('详情 × 只关详情：选中保留、跟随 / 相机 / 时间不动；再点同一台或另一台重新打开同一个窗', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      api.store.time = 30
      await nextTick()
      const rowOf = (nick) => wrapper.findAll('.team-lane .pl').find((r) => r.text().includes(nick))
      await rowOf('Alpha').trigger('click')
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      await wrapper.get('[data-test="pb-sb-close"]').trigger('click')
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(false)
      expect(rowOf('Alpha').classes()).toContain('selected')
      expect(api.setFollow).not.toHaveBeenCalled()
      expect(api.setCam).not.toHaveBeenCalled()
      expect(api.store.time).toBe(30)
      // 名册与详情互不影响：两条车道一直都在
      expect(wrapper.find('[data-testid="replay3d-lane-right"]').exists()).toBe(true)
      await rowOf('Alpha').trigger('click')
      expect(wrapper.findAll('[data-testid="replay3d-details"]')).toHaveLength(1)
      // 点 Team 2：同一个窗换内容，Team 2 车道仍在
      await rowOf('Enemy').trigger('click')
      expect(wrapper.findAll('[data-testid="replay3d-details"]')).toHaveLength(1)
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Enemy')
      expect(wrapper.find('[data-testid="replay3d-lane-right"]').exists()).toBe(true)
      expect(rowOf('Enemy').classes()).toContain('selected')
      expect(rowOf('Enemy').classes()).toContain('followed')
      expect(rowOf('Alpha').classes()).not.toContain('selected')
      wrapper.unmount()
    })

    it('selected 与 followed 是彼此独立的状态（可分别成立）', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const rows = wrapper.findAll('.team-lane .pl')
      // 敌军队那行本来就是 followed（相机跟随），且未被选中
      const enemy = rows.find((r) => r.text().includes('Enemy'))
      expect(enemy.classes()).toContain('followed')
      expect(enemy.classes()).not.toContain('selected')
      // 选中另一行：选中变化不改变既有 followed 状态
      await rows[0].trigger('click')
      expect(rows[0].classes()).toContain('selected')
      expect(enemy.classes()).toContain('followed')
      wrapper.unmount()
    })

    it('详情面可关闭，且阵亡行显示击毁状态', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const rows = wrapper.findAll('.team-lane .pl')
      await rows[1].trigger('click')   // Bravo（dead）
      expect(wrapper.get('[data-test="pb-sb-state"]').text()).toBe('recon.map.playback.state_destroyed')
      await wrapper.get('[data-test="pb-sb-close"]').trigger('click')
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(false)
      wrapper.unmount()
    })
  })

  it('H closes an open Display panel and preserves the result for UI restoration', async () => {    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const { store } = playback.api
    store.banner = { outcome: 'win' }
    await nextTick()
    expect(wrapper.get('.banner').text()).toBe('agentReplay.banner_win')
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="show-all-ui"]').exists()).toBe(true)
    expect(wrapper.find('.banner').exists()).toBe(false)
    expect(store.banner).toEqual({ outcome: 'win' })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="display-toggle"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.banner').text()).toBe('agentReplay.banner_win')
    wrapper.unmount()
  })

  it('button hide and H restore share the full UI transition', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    playback.api.store.banner = { outcome: 'lose' }
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await wrapper.get('[data-testid="hide-all-ui"]').trigger('click')
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.find('.banner').exists()).toBe(false)
    expect(wrapper.get('[data-testid="show-all-ui"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.get('.banner').text()).toBe('agentReplay.banner_lose')
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('隐藏全部 UI：HUD / 阵容 / 击杀流 / 标签全部让位，且永远可以恢复（按钮或 H 键）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.killfeed = [{ id: 1, kill: true, killer: 'K', victim: 'V' }]
    store.roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T', hp: 1, maxHp: 2, dead: false, followed: false }],
      team2: [], unknown: [],
    }
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await nextTick()
    await wrapper.get('[data-testid="hide-all-ui"]').trigger('click')
    await nextTick()

    expect(wrapper.find('.topbar').exists()).toBe(false)
    expect(wrapper.find('.killfeed').exists()).toBe(false)
    expect(wrapper.find('.team-lane').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="display-toggle"]').exists()).toBe(false)
    // 标签整层关掉（场景侧 enabled:false）
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))

    // 常驻恢复入口
    const restore = wrapper.get('[data-testid="show-all-ui"]')
    await restore.trigger('click')
    await nextTick()
    expect(wrapper.find('.topbar').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)

    // H 键等效（window 级监听）
    const pane = wrapper.findComponent(Replay3DPane)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(false)

    // 输入控件聚焦时不劫持：happy-dom 的合成 KeyboardEvent 不带 target，
    // 所以直接按真实形状（target = INPUT）驱动同一个处理函数。
    const keyEvent = (target, key = 'h') => ({ key, target, preventDefault: vi.fn() })
    const before = wrapper.find('[data-testid="show-all-ui"]').exists()
    pane.vm.onUiToggleKeydown(keyEvent({ tagName: 'INPUT', isContentEditable: false }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(before)
    pane.vm.onUiToggleKeydown(keyEvent({ tagName: 'BUTTON', isContentEditable: false }))
    pane.vm.onUiToggleKeydown(keyEvent({ tagName: 'DIV', isContentEditable: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(before)
    // 普通元素上仍然生效
    pane.vm.onUiToggleKeydown(keyEvent({ tagName: 'DIV', isContentEditable: false }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(!before)
    wrapper.unmount()
  })
})

/**
 * 场景生命周期不变量：sceneApi 存在 ⟺ 活的 stage DOM ∧ file ∧ !blocked ∧ WebGL。
 * 这三种变化的产品语义必须分开：active=false 只停帧；file/blocked 变化会销毁场景。
 */
describe('Replay3DPane 场景生命周期', () => {
  it('Test A — file → null 销毁旧场景；给新 file 时在新 stage 上重建，按开始后解析新文件', async () => {
    mockWebGL('webgl2')
    const fileA = mkFile('a.wotbreplay')
    const wrapper = mountPane({ file: fileA })
    await flush()
    const firstApi = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
    expect(firstApi.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file: fileA }))

    // file=null：模板移除 .pb-root（stage 变成游离节点）→ 必须销毁场景，不能继续往它上面画
    await wrapper.setProps({ file: null })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.pb-root').exists()).toBe(false)
    expect(wrapper.find('.scene').exists()).toBe(false)
    expect(wrapper.get('[data-testid="replay3d-empty"]').exists()).toBe(true)

    // 新文件：必须是一次**全新的** initPlayback；新场景先待开播，按开始才解析
    const fileB = mkFile('b.wotbreplay')
    await wrapper.setProps({ file: fileB })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    const secondApi = playback.api
    expect(secondApi).not.toBe(firstApi)
    expect(secondApi.loadData).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)
    await start(wrapper)
    expect(secondApi.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file: fileB }))
    // 新场景必须挂在**当前**的 stage 节点上，而不是那个已被移除的旧节点
    expect(wrapper.find('.scene').exists()).toBe(true)
    expect(playback.init.mock.calls[1][0]).toBe(wrapper.get('.scene').element)

    wrapper.unmount()
  })

  it('Test B — blocked 非空销毁场景；解除阻断后重建，按开始后重新解析同一文件', async () => {
    mockWebGL('webgl2')
    const file = mkFile('a.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    const firstApi = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
    expect(firstApi.loadData).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ blockedReason: 'workspace.single_replay_required' })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="replay3d-blocked"]').text()).toBe('workspace.single_replay_required')
    expect(wrapper.find('.scene').exists()).toBe(false)

    await wrapper.setProps({ blockedReason: '' })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    expect(playback.api).not.toBe(firstApi)
    expect(playback.api.loadData).not.toHaveBeenCalled()
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file }))

    wrapper.unmount()
  })

  it('Test C — active=false 只停帧：不销毁、不重建、不重解析；切回只恢复', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
    expect(api.loadData).toHaveBeenCalledTimes(1)
    api.setPaused.mockClear()

    await wrapper.setProps({ active: false })
    await flush()
    expect(api.setPaused).toHaveBeenCalledWith(true)
    expect(api.destroy).not.toHaveBeenCalled()
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(api.loadData).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ active: true })
    await flush()
    expect(api.setPaused).toHaveBeenLastCalledWith(false)
    expect(api.destroy).not.toHaveBeenCalled()
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(api.loadData).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('卸载销毁且只销毁一次', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    wrapper.unmount()
    expect(api.destroy).toHaveBeenCalledTimes(1)
  })

  it('无 WebGL 时不建场景，也不因 file 变化而建', async () => {
    mockWebGL('none')
    const wrapper = mountPane()
    await flush()
    expect(playback.init).not.toHaveBeenCalled()
    await wrapper.setProps({ file: mkFile('b.wotbreplay') })
    await flush()
    expect(playback.init).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

/**
 * 就绪态（store.hasData）契约：它是 HUD 与播放传输的 authoritative gate
 * （`usePlaybackTransport({ isReady: () => store.hasData })`），因此必须在
 * 「新会话被接受」与「会话终止」两个时点落下，绝不能让上一场的 ready 泄漏到新会话。
 */
describe('Replay3DPane 就绪态（hasData）', () => {
  /** 让下一次加载保持挂起（按场景契约翻转 loading / hasData），返回完成句柄 */
  function pendNextLoad(api) {
    let settle
    api.loadData.mockImplementationOnce(() => {
      const store = api.store
      store.hasData = false
      store.loading = true
      return new Promise((resolve) => {
        settle = () => { store.loading = false; store.hasData = true; resolve() }
      })
    })
    return () => settle?.()
  }

  it('A：file=null 销毁会话后就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)      // 按开始后的加载已完成

    await wrapper.setProps({ file: null })
    await flush()
    expect(api.destroy).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    expect(api.store.loading).toBe(false)
    wrapper.unmount()
  })

  it('B：被工作台阻断时就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    await wrapper.setProps({ blockedReason: 'workspace.single_replay_required' })
    await flush()
    expect(api.destroy).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    wrapper.unmount()
  })

  it('C：换文件先撤下上一场（reset）；新加载窗口不得继承上一场的 ready', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    // 换场：撤下旧场景（内核 reset）→ 回到待开播，ready 不得留在屏幕上
    await wrapper.setProps({ file: mkFile('b.wotbreplay') })
    await flush()
    expect(api.reset).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)

    // 新加载窗口：HUD / 播放传输都不得按 ready 渲染
    const settle = pendNextLoad(api)
    await start(wrapper)
    expect(api.store.loading).toBe(true)
    expect(api.store.hasData).toBe(false)
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)

    settle()
    await flush()
    expect(api.store.hasData).toBe(true)
    expect(api.store.loading).toBe(false)
    wrapper.unmount()
  })

  it('卸载销毁会话后就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    wrapper.unmount()
    expect(api.store.hasData).toBe(false)
  })
})

/**
 * 待开播画质闸门：内核 `startPlayback()` 是**惰性**创建渲染器并据当前档位定型首帧，
 * 所以画质必须在解析 + 拉资产之前选定——不能事后在「加载中」里切档
 * （生产内核在 DATA 就位后切档会走「已在播放 → 整页重载」分支，那是另一条路径）。
 */
describe('Replay3DPane 待开播画质闸门', () => {
  it('待开播先给画质档位并交出文件名；未按开始不解析', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: mkFile('battle.wotbreplay') })
    await flush()
    const pending = wrapper.get('[data-test="replay3d-pending"]')
    expect(pending.text()).toContain('battle.wotbreplay')
    expect(pending.text()).toContain('agentReplay.start')
    const quality = pending.get('[data-testid="replay3d-quality"]')
    expect(quality.findAll('button').map(b => b.attributes('data-value'))).toEqual(['low', 'mid', 'high'])

    // 档位选择直接交内核（画质定型在渲染器创建之前）
    await quality.get('button[data-value="low"]').trigger('click')
    expect(playback.api.setQuality).toHaveBeenCalledWith('low')
    expect(playback.api.loadData).not.toHaveBeenCalled()

    await start(wrapper)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('档位文案走 i18n（agentReplay.q_*），不直接用预设里的固定 label', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const quality = wrapper.get('[data-testid="replay3d-quality"]')
    // 预设 label 是上游固定中文（低/中/高）；界面必须取三语 key，
    // 否则 en / ru 界面会混入中文（用户实测反馈）
    expect(quality.findAll('button').map(b => b.text()))
      .toEqual(['agentReplay.q_low', 'agentReplay.q_mid', 'agentReplay.q_high'])
    expect(quality.text()).not.toContain('Low')
    // 相机档位同理（在就绪态里：工具栏只在 HUD 有数据时渲染）
    playback.api.store.hasData = true
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    const cams = wrapper.get('[data-testid="display-panel"] [role="radiogroup"]')
    expect(cams.findAll('button').map(b => b.attributes('data-value'))).toEqual(['free', 'top', 'follow'])
    expect(cams.text()).toContain('agentReplay.cam_free')
    wrapper.unmount()
  })

  it('损坏 / 无文件名也不炸：卡片按兜底名呈现', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: { name: '', size: 0 } })
    await flush()
    expect(wrapper.get('[data-test="replay3d-pending"]').text()).toContain('replay')
    wrapper.unmount()
  })
})

/**
 * 顶栏双方总血量（与上游 3D 视图同布局：数值 + 色条夹住比分）。
 * 面板只渲染**阵营视角**字段：`hpFriend/hpEnemy` 与 `scoreFriend/scoreEnemy` 的映射在场景层
 * （teamHpTotals / perspectiveScore），HUD 不得再按 physical score1/score2 或 t1/t2 分组猜。
 */
describe('Replay3DPane 顶栏双方血量', () => {
  it('整数值 + 原始百分比色条 + 视角比分；标题给取整百分比', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    // 顶栏计时与 2D 同口径：开战起算（战斗时钟原点 startRaw = 10 → 210 - 10 = 200s = 03:20）
    store.battleClock = { startRaw: 10, durationSec: 280 }
    store.time = 210
    store.hpFriend = 12345; store.hpFriendMax = 20000; store.hpFriendPct = 61.725
    store.hpEnemy = 800; store.hpEnemyMax = 15000; store.hpEnemyPct = 5.333
    store.scoreFriend = 2; store.scoreEnemy = 1
    await nextTick()

    const hp = wrapper.get('[data-test="pb-hp-bars"]')
    expect(hp.text()).toContain('12345 / 20000')
    expect(hp.text()).toContain('800 / 15000')
    // 血量不缩写（§11：禁止 12.3k）；己方在左、敌方在右
    expect(hp.text()).not.toContain('12.3k')
    expect(hp.get('[data-test="pb-hp-fill-friendly"]').attributes('style')).toContain('width: 61.7%')
    expect(hp.get('[data-test="pb-hp-fill-enemy"]').attributes('style')).toContain('width: 5.3%')
    expect(wrapper.get('[data-test="pb-hud-time"]').text()).toBe('03:20')
    // 比分取视角字段（不是 score1/score2）
    expect(wrapper.get('[data-test="pb-hud-score"]').text()).toBe('2 : 1')
    wrapper.unmount()
  })

  it('已死一方的空血上限不产生 NaN 文案（0 / 0 也照常渲染）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.hpFriend = NaN; store.hpFriendMax = null; store.hpFriendPct = NaN
    await nextTick()
    expect(wrapper.get('[data-test="pb-hp-bars"]').text()).toContain('0 / 0')
    expect(wrapper.get('[data-test="pb-hp-bars"]').text()).not.toContain('NaN')
    wrapper.unmount()
  })
})
