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

import zh from '../locales/zh.json'

import en from '../locales/en.json'

import ru from '../locales/ru.json'


// 源码级守卫用（CSS 结构契约：名册不得是嵌套滚动盒等）
const here = dirname(fileURLToPath(import.meta.url))

let Replay3DPane


const canonical = vi.hoisted(() => { globalThis.__replay3dPaneTest ||= {}; return globalThis.__replay3dPaneTest.canonical ||= { load: vi.fn(), portrait: vi.fn() } })

vi.mock('../platform/screenForm.js', () => ({ forcedLandscapeDevice: async () => 'android-phone-app' }))

vi.mock('../vehicle-portraits/runtime.js', () => ({ loadVehiclePortrait: canonical.portrait }))

const playback = vi.hoisted(() => { globalThis.__replay3dPaneTest ||= {}; return globalThis.__replay3dPaneTest.playback ||= { api: null, init: null, apis: [] } })

/**
 * 模拟 `playbackScene.initPlayback` 的**真实契约**：加载状态与就绪状态由场景层唯一持有
 * （见 frontend/src/scene/playbackScene.js 的 loadData / teardownSession / reset）。
 * 组件层不再镜像这些状态，所以 mock 必须自己承担，否则测试会验证一个不存在的 owner。
 */
const connectivityState = vi.hoisted(() => { globalThis.__replay3dPaneTest ||= {}; return globalThis.__replay3dPaneTest.connectivityState ||= { state: null } })

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
      // 真实引擎：canonical clock 到达时重定 [START, END] 并发布到 store.startTime / duration
      setBattleClock: vi.fn((clock) => { if (clock) store.startTime = clock.startRaw }),
      seekBy: vi.fn(),
      setSpeed: vi.fn(),
      seekTime: vi.fn(),
      setCam: vi.fn(),
      setFollow: vi.fn(),
      setFlySpeed: vi.fn(),   // 真实契约：useSceneFlyControls 的 1–6 速率键写场景（数字键用例会触到）
      setGlb: vi.fn(),
      setLabelPrefs: vi.fn(),
      setQuality: vi.fn(),
      setContactShadows: vi.fn((on) => { store.contactShadows = !!on }),
      setPaused: vi.fn(),
      setAnnotations: vi.fn(),
      setAnnotationInteraction: vi.fn(),
      setAnnotationsVisible: vi.fn(),
    }
    playback.api = api
    playback.apis.push(api)
    return api
  })
  return { initPlayback: playback.init, QUALITY_PRESETS: { low: { label: 'Low' }, mid: { label: 'Mid' }, high: { label: 'High' }, ultra: { label: 'Ultra' } } }
})

vi.mock('../scene/assetProvider.js', () => ({ assetProvider: { configured: () => true } }))

/**
 * 布局档位 / 指针 mock：手机形态用例把 `layout.compact` 打开，即可验证「工具条收窄、
 * 相机与阵容搬进显示面板」这套紧凑呈现；宽档用例保持 false（桌面不得回归）。
 */
const layout = vi.hoisted(() => { globalThis.__replay3dPaneTest ||= {}; return globalThis.__replay3dPaneTest.layout ||= { compact: false, portrait: false } })

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
vi.mock('../composables/usePlaybackPhoneForm.ts', async () => {
  const { computed } = await import('vue')
  return { usePlaybackPhoneForm: () => ({ isPhone: computed(() => layout.compact) }) }
})

/** 竖屏判据（与 2D 共用 usePlaybackPortraitViewport）：手机竖屏 = compact + portrait，
 *  手机横屏 / 全屏横屏 = compact 但不是 portrait。 */
vi.mock('../composables/usePlaybackPortraitViewport.ts', async () => {
  const { computed } = await import('vue')
  return { usePlaybackPortraitViewport: () => ({ isPortrait: computed(() => layout.portrait) }) }
})

// 唯一 reactive 主题源：给 HUD 阵营色一个可依赖的 profile ref
vi.mock('../composables/useUiProfile.js', async () => {
  const { ref } = await import('vue')
  return { uiProfile: ref('summer'), useUiProfile: () => ({ uiProfile: ref('summer') }) }
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


/** 打开共享详情：**场景点选**路径（名单点击已改为「跟随」，不再开详情）。
 *  取最近一次 initPlayback 注入的 onVehicleSelect（生产契约同款入口）。 */
async function openDetailsViaScene(eid) {
  const onVehicleSelect = playback.init.mock.calls.at(-1)[3].onVehicleSelect
  onVehicleSelect(eid)
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
  layout.portrait = false
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
describe('Replay3DPane 待开播画质闸门', () => {
  it('待开播先给画质档位并交出文件名；未按开始不解析', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: mkFile('battle.wotbreplay') })
    await flush()
    const pending = wrapper.get('[data-test="replay3d-pending"]')
    expect(pending.text()).toContain('battle.wotbreplay')
    expect(pending.text()).toContain('agentReplay.start')
    const quality = pending.get('[data-testid="replay3d-quality"]')
    expect(quality.findAll('button').map(b => b.attributes('data-value'))).toEqual(['low', 'mid', 'high', 'ultra'])

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
      .toEqual(['agentReplay.q_low', 'agentReplay.q_mid', 'agentReplay.q_high', 'agentReplay.q_ultra'])
    expect(quality.text()).not.toContain('Low')
    // 相机档位同理（就绪态直接陈列在控制条；2026-10-05 从 Display 面板移出）
    playback.api.store.hasData = true
    await nextTick()
    const cams = wrapper.get('[data-testid="replay3d-camera"]')
    // 俯视是持续模式（旋转中心 = 地图中心），与自由并列；录像者档位暂不支持
    expect(cams.findAll('button').map(b => b.attributes('data-value'))).toEqual(['free', 'top', 'recorder'])
    expect(cams.text()).toContain('agentReplay.cam_free')
    expect(cams.text()).toContain('agentReplay.cam_sandbox')
    expect(wrapper.get('[data-testid="replay3d-top-view"]').text()).toBe('agentReplay.cam_top')
    // 沙盘是模式，俯视是动作：两个入口走不同的相机命令
    await cams.get('[data-value="top"]').trigger('click')
    expect(playback.api.setCam).toHaveBeenLastCalledWith('top')
    const recorder = cams.get('[data-value="recorder"]')
    expect(recorder.attributes('disabled')).toBeDefined()
    expect(recorder.attributes('title')).toBe('agentReplay.cam_recorder_unsupported')
    playback.api.store.recorderCameraStatus = 'loading'
    await nextTick()
    expect(recorder.attributes('title')).toBe('agentReplay.cam_recorder_loading')
    playback.api.store.recorderCameraStatus = 'ready'
    await nextTick()
    expect(recorder.attributes('title')).toBe('agentReplay.cam_recorder_dead')
    playback.api.store.recorderModeUnknown = true
    await nextTick()
    expect(recorder.attributes('title')).toBe('agentReplay.cam_recorder_unsupported')
    playback.api.store.recorderModeUnknown = false
    playback.api.store.recorderViewAvailable = true
    await nextTick()
    expect(recorder.attributes('disabled')).toBeUndefined()
    await recorder.trigger('click')
    expect(playback.api.setCam).toHaveBeenLastCalledWith('recorder')
    playback.api.store.cam = 'recorder'
    await nextTick()
    expect(wrapper.get('[data-testid="replay3d-drawing-entry"]').attributes('disabled')).toBeDefined()
    playback.api.setFollow.mockClear()
    playback.init.mock.calls.at(-1)[3].onVehicleSelect(11)
    expect(playback.api.setFollow).not.toHaveBeenCalled()
    playback.api.store.cam = 'free'
    playback.api.store.recorderViewAvailable = false
    playback.api.store.recorderCameraStatus = 'idle'
    await nextTick()
    playback.api.store.cam = 'free'
    await nextTick()
    await wrapper.get('[data-testid="replay3d-top-view"]').trigger('click')
    expect(playback.api.setCam).toHaveBeenCalledWith('top-view')
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

describe('Replay3DPane 顶栏双方血量', () => {
  it('整数值 + 原始百分比色条 + 视角比分；标题给取整百分比', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    // 顶栏计时与 2D 同口径：开战起算（引擎发布的原点 startTime = 10 → 210 - 10 = 200s = 03:20）
    store.startTime = 10
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

describe('Replay3DPane 3D annotation wiring', () => {
  async function openDrawing({ playing = false } = {}) {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    playback.api.store.playing = playing
    await nextTick()
    await wrapper.get('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    return wrapper
  }

  function sceneOptions() {
    return playback.init.mock.calls.at(-1)[3]
  }

  it('opens with pen without touching transport and exposes only pen/eraser plus shared actions', async () => {
    const wrapper = await openDrawing({ playing: true })
    const api = playback.api
    expect(api.store.playing).toBe(true)
    expect(api.setPlaying).not.toHaveBeenCalledWith(false)
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: true, tool: 'pen', width: 3, eraserWidth: 16,
    }))
    const panel = wrapper.get('[data-test="replay3d-annotations"]')
    expect(panel.find('[data-test="pb-annot-pen"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-eraser"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-undo"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-redo"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-clear"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-toggle"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-close"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-toolbar"]').classes()).toContain('pb-annot-compact')
    expect(panel.find('[data-test="pb-annot-width"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-eraser-radius"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-colors"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-select"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-route"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-arrow"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-LT"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-MT"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-HT"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-TD"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows only the current tool slider in the compact 3D toolbar', async () => {
    const wrapper = await openDrawing()
    const panel = wrapper.get('[data-test="replay3d-annotations"]')
    expect(panel.find('[data-test="pb-annot-width"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-eraser-radius"]').exists()).toBe(false)

    await panel.find('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    expect(panel.find('[data-test="pb-annot-width"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-colors"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-eraser-radius"]').exists()).toBe(true)

    await panel.find('[data-test="pb-annot-pen"]').trigger('click')
    await flush()
    expect(panel.find('[data-test="pb-annot-width"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-colors"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-eraser-radius"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('pen/eraser activation and exit never change playback state', async () => {
    const playingWrapper = await openDrawing({ playing: true })
    const playingApi = playback.api
    await playingWrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    expect(playingApi.store.playing).toBe(true)
    await playingWrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flush()
    expect(playingApi.store.playing).toBe(true)
    expect(playingApi.setPlaying).not.toHaveBeenCalledWith(false)
    playingWrapper.unmount()

    const pausedWrapper = await openDrawing({ playing: false })
    const pausedApi = playback.api
    await pausedWrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    expect(pausedApi.store.playing).toBe(false)
    await pausedWrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flush()
    expect(pausedApi.store.playing).toBe(false)
    expect(pausedApi.setPlaying).not.toHaveBeenCalledWith(true)
    pausedWrapper.unmount()
  })

  it('keeps Drawing out of the shared transport and opens it from the 3D tool-row', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const toolrow = wrapper.get('[data-testid="replay3d-toolrow"]')
    expect(toolrow.find('[data-testid="replay3d-drawing-entry"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="pb-controls"]').find('[data-testid="replay3d-drawing-entry"]').exists()).toBe(false)

    await toolrow.find('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="replay3d-toolrow"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="pb-controls"]').find('[data-testid="replay3d-drawing-entry"]').exists()).toBe(false)

    await wrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="replay3d-toolrow"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('commits one annotation through the scene callback and supports undo/redo/clear', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])
    expect(wrapper.find('[data-test="pb-annot-clear"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-redo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])

    await wrapper.get('[data-test="pb-annot-clear"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])
    wrapper.unmount()
  })

  it('keeps optional surfaceY through commit / undo / redo', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = {
      type: 'pen', color: '#ff4d4f', width: 1.2,
      points: [{ x: 0, y: 0, surfaceY: 8 }, { x: 10, y: 0, surfaceY: 8 }],
    }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])

    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-redo"]').trigger('click')
    await flush()
    const restored = api.setAnnotations.mock.calls.at(-1)[0]
    expect(restored[0].points.every((p) => Number.isFinite(p.surfaceY))).toBe(true)
    expect(restored[0]).toEqual(annotation)
    wrapper.unmount()
  })

  it('eraser split keeps finite surfaceY on both generated endpoints', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = {
      type: 'pen', color: '#ff4d4f', width: 1.2,
      points: [{ x: 0, y: 0, surfaceY: 8 }, { x: 10, y: 0, surfaceY: 12 }],
    }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    await wrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    sceneOptions().onAnnotationErase({ points: [{ x: 5, y: 0, surfaceY: 10 }], radius: 1 })
    await flush()
    const pieces = api.setAnnotations.mock.calls.at(-1)[0]
    expect(pieces).toHaveLength(2)
    for (const piece of pieces) {
      expect(piece.points.every((p) => Number.isFinite(p.surfaceY))).toBe(true)
    }
    expect(pieces[0].points.at(-1).surfaceY).toBeGreaterThan(8)
    expect(pieces[0].points.at(-1).surfaceY).toBeLessThan(12)
    wrapper.unmount()
  })

  it('eraser callback applies semantically and adds one history entry', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    await wrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'eraser' }))
    const before = api.setAnnotations.mock.calls.length
    sceneOptions().onAnnotationErase({ points: [{ x: 0.5, y: 0.5 }], radius: 10 })
    await flush()
    expect(api.setAnnotations.mock.calls.length).toBe(before + 1)
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])
    wrapper.unmount()
  })

  it('visibility toggle never changes history and does not reproject', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    const projections = api.setAnnotations.mock.calls.length
    await wrapper.get('[data-test="pb-annot-toggle"]').trigger('click')
    await flush()
    expect(api.setAnnotationsVisible).toHaveBeenLastCalledWith(false)
    expect(api.setAnnotations.mock.calls.length).toBe(projections)
    await wrapper.get('[data-test="pb-annot-toggle"]').trigger('click')
    await flush()
    expect(api.setAnnotationsVisible).toHaveBeenLastCalledWith(true)
    expect(api.setAnnotations.mock.calls.length).toBe(projections)
    wrapper.unmount()
  })

  it('close keeps committed annotations and disables interaction; reopen restores them', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    const projections = api.setAnnotations.mock.calls.length
    await wrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(false)
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, tool: null }))
    expect(api.setAnnotations.mock.calls.length).toBe(projections)
    await wrapper.get('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-undo"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('opening Display or collapsing controls closes drawing mode', async () => {
    const wrapper = await openDrawing()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(false)

    await wrapper.get('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(true)
    await wrapper.get('[data-testid="replay3d-controls-toggle"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('changing the replay file clears history and closes drawing mode', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    await wrapper.setProps({ file: mkFile('next.wotbreplay') })
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(false)
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    wrapper.unmount()
  })
})
