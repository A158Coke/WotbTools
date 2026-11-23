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
export const here = dirname(fileURLToPath(import.meta.url))
let Replay3DPane

const canonical = vi.hoisted(() => ({ load: vi.fn(), portrait: vi.fn() }))
vi.mock('../platform/screenForm.js', () => ({ forcedLandscapeDevice: async () => 'android-phone-app' }))
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
      setBattleMarkers: vi.fn(),   // 战场快捷标记开关（owner = markerPrefs.battleMarkers → 场景）
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
const layout = vi.hoisted(() => ({ compact: false, portrait: false }))
/** 全屏能力桩的调用计数（happy-dom 无 Fullscreen API，用于断言确实调用了 requestFullscreen） */
export const fullscreenCalls = { request: 0 }
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
export const translate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: translate, te: () => false }),
}))

/** WebGL 模拟：'webgl2' | 'none' */
export function mockWebGL(level) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (name) {
    return level === 'webgl2' && name === 'webgl2' ? { getExtension: () => ({ loseContext() {} }) } : null
  })
}

export const mkFile = (name) => new File(['x'], name)

/** props 变化后的 flush：watcher 是 post-flush（要等模板刷新出 stage 节点） */
export async function flush() {
  await nextTick()
  await nextTick()
}

/** 待开播 → 按「开始」：解析与资产加载都发生在这一步之后（画质先定型） */
export async function start(wrapper) {
  await wrapper.get('[data-test="replay3d-start"]').trigger('click')
  await flush()
}

/** 打开共享详情：**场景点选**路径（名单点击已改为「跟随」，不再开详情）。
 *  取最近一次 initPlayback 注入的 onVehicleSelect（生产契约同款入口）。 */
export async function openDetailsViaScene(eid) {
  const onVehicleSelect = playback.init.mock.calls.at(-1)[3].onVehicleSelect
  onVehicleSelect(eid)
  await flush()
}

export function mountPane(props = {}) {
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
export const testState = { canonical, playback, layout, connectivityState }

export function paneComponent() { return Replay3DPane }

export function installPaneTestLifecycle() {
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
}

export { nextTick, ref, shallowReactive } from 'vue'
export { mount } from '@vue/test-utils'
export { readFileSync } from 'node:fs'
export { fileURLToPath } from 'node:url'
export { dirname, resolve } from 'node:path'
export { makeBattlePlaybackDataset } from '../test/playbackV2TestUtil.js'
export { default as zh } from '../locales/zh.json'
export { default as en } from '../locales/en.json'
export { default as ru } from '../locales/ru.json'
