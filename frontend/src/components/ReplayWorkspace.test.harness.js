// @vitest-environment happy-dom

import { computed, h, KeepAlive, ref, toRaw } from 'vue'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises as flushVue, mount } from '@vue/test-utils'

/** 能力面板是异步组件：每次 flush 同时等动态 import 完成。 */
export async function flushPromises() {
  await flushVue()
  await vi.dynamicImportSettled()
  await flushVue()
}
import { useError } from '../composables/useError.js'
import { useConnectivityNotice } from '../composables/useConnectivityNotice.js'
import { useReplaySession } from '../composables/useReplaySession.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY, REPLACE_DECLINED } from '../shared/onboarding.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { createShellChrome } from '../app/shellChrome.js'
import { loadOfficialDemo, OFFICIAL_DEMO } from '../replay-local/demo.js'
import { useConfirmHost } from '../composables/useConfirm.js'
import ReplayWorkspace from './ReplayWorkspace.vue'
import { resetViewerClocks, viewerClocks } from '../scene/playback/viewerClockSync.js'
import FileDrop from './FileDrop.vue'

// useReplay mock 返回的可变 state 占位：每次 beforeEach 用 buildState() 以真实 Vue ref 重建。
const hold = vi.hoisted(() => ({ state: null }))
const authState = vi.hoisted(() => ({ authenticated: null, isAdmin: null, login: vi.fn() }))
const nav = vi.hoisted(() => ({ navigate: null }))

// 手机横屏沉浸态的三个输入（形态 / 朝向 / 触屏）：以真实 ref 驱动，不依赖 matchMedia 仿真。
const formState = vi.hoisted(() => ({ isPhone: null, isPortrait: null, coarse: null }))
vi.mock('../composables/usePlaybackPhoneForm.ts', async () => {
  const { ref } = await import('vue')
  formState.isPhone = ref(false)
  return { usePlaybackPhoneForm: () => ({ isPhone: formState.isPhone }) }
})
vi.mock('../composables/usePlaybackPortraitViewport.ts', async () => {
  const { ref } = await import('vue')
  formState.isPortrait = ref(false)
  return { usePlaybackPortraitViewport: () => ({ isPortrait: formState.isPortrait }) }
})
vi.mock('../composables/useBreakpoint.js', async (importOriginal) => {
  const { ref } = await import('vue')
  formState.coarse = ref(false)
  return { ...(await importOriginal()), usePointer: () => ({ coarse: formState.coarse }) }
})

const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref, watch } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  // 与生产一致：whenSettled 在 settled 变 true（且同一同步块里写入的状态已提交）后才 resolve。
  const whenSettled = () => new Promise((resolve) => {
    if (connectivityState.settled.value) return resolve()
    const stop = watch(connectivityState.settled, (value) => {
      if (!value) return
      stop()
      resolve()
    })
  })
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled }) }
})

vi.mock('../composables/useReplay.js', () => ({
  useReplay: () => hold.state,
  chooseInitialResultTab: () => 'aggregate',
}))
// 数据 / 2D 匿名可用；3D / shots 在工作台挂载边界要求登录。
vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  authState.authenticated = ref(true)
  authState.isAdmin = ref(false)
  return {
    useAuth: () => ({
      authenticated: authState.authenticated,
      isAdmin: authState.isAdmin,
      login: authState.login,
    }),
  }
})
vi.mock('./ReplayPage.vue', () => ({
  default: {
    name: 'ReplayPageMock',
    props: ['embedded', 'replayContext', 'workspaceContext', 'active'],
    template: '<div data-test="data-pane" />',
  },
}))
// 四个能力面板都是异步组件（审计 PF-02）：测试只验证工作台的编排与 props 接线
export function paneMock(name, testid) {
  return {
    __esModule: true,
    default: {
      name,
      props: ['file', 'active', 'blockedReason', 'navigate', 'playbackSession', 'autoFullscreenToken', 'seekTo', 'seekRequest', 'pendingSeek'],
      template: `<div data-test="${testid}" data-testid="${testid}" data-pane-ready="true">{{ file && file.name }}|{{ blockedReason }}|{{ active }}</div>`,
    },
  }
}
vi.mock('./BattlePlaybackPanel.vue', () => paneMock('BattlePlaybackPanelMock', 'ws-playback-pane'))
vi.mock('./Replay3DPane.vue', () => paneMock('Replay3DPaneMock', 'ws-3d-pane'))
vi.mock('./ReplayShotsPane.vue', () => paneMock('ReplayShotsPaneMock', 'ws-shots-pane'))
vi.mock('./ReplayEventStreamPane.vue', () => paneMock('ReplayEventStreamPaneMock', 'ws-event-stream'))
vi.mock('./AiReviewWorkspacePane.vue', () => paneMock('AiReviewPaneMock', 'ws-ai-pane'))
vi.mock('./ReplayProcessingPanel.vue', () => ({
  default: {
    name: 'ReplayProcessingPanelMock',
    props: ['analysis', 'result'],
    emits: ['cancel', 'dismiss'],
    template: '<div data-test="processing">{{ analysis.phase }}</div>',
  },
}))
vi.mock('./RemoveConfirmModal.vue', () => ({ default: { template: '<div data-test="modal" />' } }))
const nativeImportState = vi.hoisted(() => ({ onPendingFile: null, onReadError: null, isReady: null, retry: vi.fn(), importing: { value: false } }))
vi.mock('../composables/useNativeReplayImport.js', () => ({
  useNativeReplayImport: (opts) => {
    nativeImportState.onPendingFile = opts?.onPendingFile ?? null
    nativeImportState.isReady = opts?.isReady ?? null
    nativeImportState.onReadError = opts?.onReadError ?? null
    return { consumePendingWhenReady: nativeImportState.retry, importing: nativeImportState.importing }
  },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k, te: () => true, locale: { value: 'en' } }) }))

/** 以真实 Vue ref/函数构造 useReplay 返回物（保证 files/resp/analysis/selectionRevision 响应式）。 */
export function buildState() {
  const session = useReplaySession()
  return {
    ...session,
    session,
    updateFiles: vi.fn((next) => {
      session.replaceSelection(next)
    }),
    updateDemoFile: vi.fn(file => session.replaceDemoSelection(file)),
    analyze: vi.fn(() => {
      session.error.value = ''
      return Promise.resolve({ completed: true })
    }),
    changeFiles: vi.fn(async (next) => {
      session.changeSelection(next)
      return { completed: true }
    }),
    cancelAnalysis: vi.fn(),
    exportExcel: vi.fn(),
    askRemoveFile: vi.fn(),
    cancelRemove: vi.fn(),
    confirmRemove: vi.fn(),
  }
}

export const replayStateRef = { current: null }

export function mountWorkspace(capability = 'data', { authenticated = true, navigate = vi.fn(), attached = false, onboarding = null, shellChrome = null } = {}) {
  authState.authenticated.value = authenticated
  nav.navigate = navigate
  return mount(ReplayWorkspace, {
    props: { initialCapability: capability },
    attachTo: attached ? document.body : undefined,
    global: {
      provide: { [NAVIGATE_VIEW_KEY]: navigate, [ONBOARDING_KEY]: onboarding, [DIALOG_INLINE_KEY]: true, ...(shellChrome ? { [SHELL_CHROME_KEY]: shellChrome } : {}) },
      mocks: { $t: (k) => k },
    },
  })
}

/** 能力按钮：data-cap 是稳定契约（深链、浏览器 gate 与测试共用）。
 *  2026-11-19：2D/3D/事件流合并为「回放」入口，内部能力键仍在测试里使用。 */
export const TAB_KEY = { playback: 'replay', '3d': 'replay', events: 'replay' }
export const tab = (wrapper, cap) => wrapper.get(`[data-testid="ws-tab"][data-cap="${TAB_KEY[cap] || cap}"]`)
export const capKeys = (wrapper) => wrapper.findAll('[data-testid="ws-tab"]').map(t => t.attributes('data-cap'))

/** 切能力：2D/3D 现在在统一回放面板内切换（2D = 回放标签 + 2D 模式；3D = 回放标签 + 3D 模式）。 */
export async function switchTo(wrapper, cap) {
  await tab(wrapper, cap).trigger('click')
  await flushPromises()
  if (cap === 'playback' || cap === '3d') {
    const mode = wrapper.find(`[data-testid="viewer-mode-${cap === '3d' ? '3d' : '2d'}"]`)
    if (mode.exists() && mode.attributes('aria-checked') !== 'true') {
      await mode.trigger('click')
      await flushPromises()
    }
  }
}

export function withBattles(count) {
  replayStateRef.current.files.value = Array.from({ length: count }, (_, i) => new File(['x'], `f${i}.wotbreplay`))
  replayStateRef.current.resp.value = {
    leagueMode: false,
    aggregate: [{ a: 1 }],
    battles: Array.from({ length: count }, (_, i) => ({ sourceId: `r${i}`, mapName: 'Lagoon', players: [] })),
  }
}

export const demoBytes = readFileSync(new NodeURL(`../../../common/assets${OFFICIAL_DEMO.path}`, import.meta.url))
export function serveDemo() {
  const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => demoBytes.buffer.slice(demoBytes.byteOffset, demoBytes.byteOffset + demoBytes.byteLength) }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
export function analyzeDemo() {
  replayStateRef.current.analyze.mockImplementation(async () => {
    replayStateRef.current.session.commitReadyResult({ battles: [{ sourceId: 'r0', sourceName: replayStateRef.current.files.value[0].name, mapName: 'rift', players: [] }], aggregate: [] })
    replayStateRef.current.analysis.value = { phase: 'ready', done: 1, total: 1, failure: null }
    return { completed: true }
  })
}
export function guideContext() {
  return { guideActive: computed(() => true), registerWorkspace: vi.fn(), openDirectory: vi.fn(), sampleOpened: vi.fn() }
}
/** 空列表（或教学中）在页面上；Ready 态的示例入口在管理弹层里。 */
export async function clickDemo(wrapper) {
  if (!wrapper.find('[data-testid="workspace-demo"]').exists()) {
    await wrapper.get('[data-testid="collection-trigger"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="collection-demo"]').trigger('click')
    return
  }
  await wrapper.get('[data-testid="workspace-demo"]').trigger('click')
}
export const demoIdle = (wrapper) => {
  const button = wrapper.find('[data-testid="workspace-demo"]')
  return !button.exists() || !button.element.disabled
}
/** FileDrop 把通过校验的 selection 交给工作台：真实入口，选择即加载。 */
export async function choose(wrapper, files) {
  wrapper.findComponent(FileDrop).vm.$emit('update:files', files)
  await flushPromises()
}
// Vue's queue flush does not await Node's real WebCrypto hash of the bundled sample.
export async function waitForDemoReady(wrapper) {
  await vi.waitFor(() => {
    expect(replayStateRef.current.analysis.value.phase).toBe('ready')
    expect(demoIdle(wrapper)).toBe(true)
  }, { timeout: 4000 })
  await flushPromises()
}
export const testState = { hold, authState, nav, formState, connectivityState, nativeImportState, replayStateRef }
export { computed, h, KeepAlive, ref, toRaw } from 'vue'
export { mount } from '@vue/test-utils'
export { useConfirmHost } from '../composables/useConfirm.js'
export { resetViewerClocks, viewerClocks } from '../scene/playback/viewerClockSync.js'
export { loadOfficialDemo, OFFICIAL_DEMO } from '../replay-local/demo.js'
export { createShellChrome } from '../app/shellChrome.js'
export { useReplaySession } from '../composables/useReplaySession.js'
export { useError } from '../composables/useError.js'
export { useConnectivityNotice } from '../composables/useConnectivityNotice.js'
export { ONBOARDING_KEY, REPLACE_DECLINED } from '../shared/onboarding.js'
export { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
export { DIALOG_INLINE_KEY } from '../shared/dialog.js'

/** 每个工作台用例的干净起点：原 ReplayWorkspace.test.js beforeEach 抽出，拆分 suite 共用。 */
export function resetWorkspaceTestState() {
  connectivityState.state.value = 'online'
  connectivityState.settled.value = true
  useConnectivityNotice().close()
  replayStateRef.current = buildState()
  hold.state = replayStateRef.current
  authState.authenticated.value = true
  authState.isAdmin.value = false
  authState.login = vi.fn()
  const { error: globalError, showError } = useError()
  showError.value = false
  globalError.value = ''
  vi.clearAllMocks()
  resetViewerClocks()
}

export function installWorkspaceTestLifecycle() {
  afterEach(() => {
    vi.unstubAllGlobals()
    useConfirmHost().settle(false)
  })
}
