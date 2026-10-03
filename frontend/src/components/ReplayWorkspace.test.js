// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises as flushVue, mount } from '@vue/test-utils'

/** 能力面板是异步组件：每次 flush 同时等动态 import 完成。 */
async function flushPromises() {
  await flushVue()
  await vi.dynamicImportSettled()
  await flushVue()
}
import { useError } from '../composables/useError.js'
import { useReplaySession } from '../composables/useReplaySession.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import ReplayWorkspace from './ReplayWorkspace.vue'

// useReplay mock 返回的可变 state 占位：每次 beforeEach 用 buildState() 以真实 Vue ref 重建。
const hold = vi.hoisted(() => ({ state: null }))
const authState = vi.hoisted(() => ({ authenticated: null, isAdmin: null, login: vi.fn() }))
const nav = vi.hoisted(() => ({ navigate: null }))

vi.mock('../composables/useReplay.js', () => ({
  useReplay: () => hold.state,
  chooseInitialResultTab: () => 'aggregate',
}))
// 服务器没有 parser：工作台不等登录（无 auth gating），useAuth 只用于管理员能力开关。
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
    props: ['embedded', 'replayContext', 'workspaceContext'],
    template: '<div data-test="data-pane" />',
  },
}))
// 四个能力面板都是异步组件（审计 PF-02）：测试只验证工作台的编排与 props 接线
function paneMock(name, testid) {
  return {
    __esModule: true,
    default: {
      name,
      props: ['file', 'active', 'blockedReason', 'navigate'],
      template: `<div data-test="${testid}" data-testid="${testid}">{{ file && file.name }}|{{ blockedReason }}|{{ active }}</div>`,
    },
  }
}
vi.mock('./BattlePlaybackPanel.vue', () => paneMock('BattlePlaybackPanelMock', 'ws-playback-pane'))
vi.mock('./Replay3DPane.vue', () => paneMock('Replay3DPaneMock', 'ws-3d-pane'))
vi.mock('./ReplayShotsPane.vue', () => paneMock('ReplayShotsPaneMock', 'ws-shots-pane'))
vi.mock('./AiReviewWorkspacePane.vue', () => paneMock('AiReviewPaneMock', 'ws-ai-pane'))
vi.mock('./FileDrop.vue', () => ({
  default: {
    name: 'FileDropMock',
    props: ['files', 'allowFolder'],
    emits: ['update:files', 'preview'],
    template: '<button data-test="drop" :data-allow-folder="String(allowFolder)">drop</button>',
  },
}))
vi.mock('./ReplayProcessingPanel.vue', () => ({
  default: {
    name: 'ReplayProcessingPanelMock',
    props: ['analysis', 'result'],
    emits: ['cancel', 'dismiss'],
    template: '<div data-test="processing">{{ analysis.phase }}</div>',
  },
}))
vi.mock('./RemoveConfirmModal.vue', () => ({ default: { template: '<div data-test="modal" />' } }))
const nativeImportState = vi.hoisted(() => ({ onPendingFile: null, onReadError: null, isReady: null, retry: vi.fn() }))
vi.mock('../composables/useNativeReplayImport.js', () => ({
  useNativeReplayImport: (opts) => {
    nativeImportState.onPendingFile = opts?.onPendingFile ?? null
    nativeImportState.isReady = opts?.isReady ?? null
    nativeImportState.onReadError = opts?.onReadError ?? null
    return { consumePendingWhenReady: nativeImportState.retry }
  },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k, te: () => true, locale: { value: 'en' } }) }))

/** 以真实 Vue ref/函数构造 useReplay 返回物（保证 files/resp/analysis/selectionRevision 响应式）。 */
function buildState() {
  const session = useReplaySession()
  return {
    ...session,
    session,
    updateFiles: vi.fn((next) => {
      session.replaceSelection(next)
    }),
    analyze: vi.fn(() => {
      session.error.value = ''
      return Promise.resolve({ completed: true })
    }),
    cancelAnalysis: vi.fn(),
    dismissAnalysis: vi.fn(),
    exportExcel: vi.fn(),
    parsedFiles: vi.fn(() => []),
    askRemoveFile: vi.fn(),
    cancelRemove: vi.fn(),
    confirmRemove: vi.fn(),
  }
}

let replayState = null

function mountWorkspace(capability = 'data', { authenticated = true, navigate = vi.fn() } = {}) {
  authState.authenticated.value = authenticated
  nav.navigate = navigate
  return mount(ReplayWorkspace, {
    props: { initialCapability: capability },
    global: {
      provide: { [NAVIGATE_VIEW_KEY]: navigate },
      mocks: { $t: (k) => k },
    },
  })
}

/** 能力按钮：data-cap 是稳定契约（深链、浏览器 gate 与测试共用） */
const tab = (wrapper, cap) => wrapper.get(`[data-testid="ws-tab"][data-cap="${cap}"]`)
const capKeys = (wrapper) => wrapper.findAll('[data-testid="ws-tab"]').map(t => t.attributes('data-cap'))

async function switchTo(wrapper, cap) {
  await tab(wrapper, cap).trigger('click')
  await flushPromises()
}

function withBattles(count) {
  replayState.files.value = Array.from({ length: count }, (_, i) => new File(['x'], `f${i}.wotbreplay`))
  replayState.resp.value = {
    leagueMode: false,
    aggregate: [{ a: 1 }],
    battles: Array.from({ length: count }, (_, i) => ({ sourceId: `r${i}`, mapName: 'Lagoon', players: [] })),
  }
}

describe('ReplayWorkspace', () => {
  it('shows native read failures in the replay error surface and retries without starting analysis', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    nativeImportState.retry.mockClear()
    nativeImportState.onReadError()
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-error"]').text()).toContain('workspace.native_replay_read_failed')
    await wrapper.get('[data-testid="ws-native-retry"]').trigger('click')
    expect(nativeImportState.retry).toHaveBeenCalledTimes(1)
    expect(replayState.analyze).not.toHaveBeenCalled()
    await nativeImportState.onPendingFile(new File(['replay'], 'a.wotbreplay'), { pendingId: 'pending-a' })
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-native-retry"]').exists()).toBe(false)
    nativeImportState.onReadError('native-client-upgrade-required')
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-error"]').text()).toContain('workspace.native_client_upgrade_required')
    expect(wrapper.find('[data-testid="ws-native-retry"]').exists()).toBe(false)
    wrapper.unmount()
  })

  beforeEach(() => {
    replayState = buildState()
    hold.state = replayState
    authState.authenticated.value = true
    authState.isAdmin.value = false
    authState.login = vi.fn()
    const { error: globalError, showError } = useError()
    showError.value = false
    globalError.value = ''
    vi.clearAllMocks()
  })

  it('普通用户只少了 3D / 射击；管理员五个能力齐全', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    expect(capKeys(wrapper)).toEqual(['data', 'playback', 'ai'])
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
    wrapper.unmount()

    authState.isAdmin.value = true
    const admin = mountWorkspace('data')
    await flushPromises()
    expect(capKeys(admin)).toEqual(['data', 'playback', '3d', 'shots', 'ai'])
    admin.unmount()
    authState.isAdmin.value = false
  })

  it('AI 不是 admin-only：普通用户也能切到 AI 复盘', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountWorkspace('data')
    await flushPromises()
    await switchTo(wrapper, 'ai')
    expect(wrapper.find('[data-test="ws-ai-pane"]').exists()).toBe(true)
    expect(tab(wrapper, 'ai').classes()).toContain('is-active')
    wrapper.unmount()
  })

  it('能力面板首次进入才挂载（按需拆包），切走只隐藏、不销毁', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    expect(wrapper.find('[data-test="ws-playback-pane"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ws-3d-pane"]').exists()).toBe(false)
    await switchTo(wrapper, 'playback')
    expect(wrapper.find('[data-test="ws-playback-pane"]').exists()).toBe(true)
    await switchTo(wrapper, 'data')
    expect(wrapper.find('[data-test="ws-playback-pane"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ws-playback"]').element.style.display).toBe('none')
    wrapper.unmount()
  })

  it('选中一次文件：data → 2D → 3D → 射击 → AI 全过程不重新选文件、selection identity 不变', async () => {
    authState.isAdmin.value = true
    withBattles(4)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const revision = replayState.selectionRevision.value
    const files = replayState.files.value

    for (const cap of ['playback', '3d', 'shots', 'ai', 'data', '3d']) {
      await switchTo(wrapper, cap)
      expect(replayState.files.value).toBe(files)
      expect(replayState.selectionRevision.value).toBe(revision)
      expect(replayState.updateFiles).not.toHaveBeenCalled()
    }
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('f0.wotbreplay')
    await switchTo(wrapper, 'shots')
    expect(wrapper.get('[data-test="ws-shots-pane"]').text()).toContain('f0.wotbreplay')
    wrapper.unmount()
    authState.isAdmin.value = false
  })

  it('切走 3D 时面板收到 active=false（停渲染但保留会话），切回 active=true', async () => {
    authState.isAdmin.value = true
    withBattles(1)
    const wrapper = mountWorkspace('3d')
    await flushPromises()
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|true')
    await switchTo(wrapper, 'data')
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|false')
    await switchTo(wrapper, '3d')
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|true')
    wrapper.unmount()
    authState.isAdmin.value = false
  })

  it('能力切换写 URL（router owner）：五个能力各自的 view', async () => {
    authState.isAdmin.value = true
    const navigate = vi.fn()
    const wrapper = mountWorkspace('data', { navigate })
    await flushPromises()
    const expected = {
      playback: 'battle-playback',
      '3d': 'agent-replay',
      shots: 'agent-shots',
      ai: 'ai-review',
      data: 'replay',
    }
    for (const [cap, view] of Object.entries(expected)) {
      navigate.mockClear()
      await switchTo(wrapper, cap)
      expect(navigate).toHaveBeenCalledWith(view)
    }
    wrapper.unmount()
    authState.isAdmin.value = false
  })

  it('深链初始能力：3d / shots / playback / ai 各自直达', async () => {
    authState.isAdmin.value = true
    withBattles(1)
    for (const cap of ['3d', 'shots', 'playback', 'ai']) {
      const wrapper = mountWorkspace(cap)
      await flushPromises()
      expect(tab(wrapper, cap).classes()).toContain('is-active')
      expect(wrapper.get(`[data-testid="ws-${cap}"]`).element.style.display).not.toBe('none')
      wrapper.unmount()
    }
    authState.isAdmin.value = false
  })

  it('多文件未选场次：3D / 射击 / 2D / AI 收到同一份阻断原因（本机只解析单场）', async () => {
    authState.isAdmin.value = true
    withBattles(3)
    const wrapper = mountWorkspace('3d')
    await flushPromises()
    // resp 落库会归一化 currentBattleId：先清掉选中场次，模拟"多文件但还没挑哪一场"
    wrapper.findComponent({ name: 'ReplayPageMock' }).props('workspaceContext').currentBattleId.value = null
    await flushPromises()
    for (const cap of ['3d', 'shots', 'playback', 'ai']) {
      await switchTo(wrapper, cap)
      expect(wrapper.get(`[data-test="ws-${cap}-pane"]`).text()).toContain('workspace.single_replay_required')
    }
    wrapper.unmount()
    authState.isAdmin.value = false
  })

  it('四个单场能力共用 workspace 的 selectBattle：选 #2 后都拿 f2', async () => {
    authState.isAdmin.value = true
    withBattles(3)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    // 数据模式的选择器在 ReplayPage 工具栏里（此处为 mock），它调用的就是 workspaceContext.selectBattle
    wrapper.findComponent({ name: 'ReplayPageMock' }).props('workspaceContext').selectBattle('r2')
    await flushPromises()
    for (const cap of ['playback', '3d', 'shots', 'ai']) {
      await switchTo(wrapper, cap)
      expect(wrapper.get(`[data-test="ws-${cap}-pane"]`).text()).toContain('f2.wotbreplay')
    }
    wrapper.unmount()
    authState.isAdmin.value = false
  })

  it('没有 auth gating：未登录也立即渲染投放区与数据面板，不请求登录', async () => {
    const wrapper = mountWorkspace('data', { authenticated: false })
    expect(wrapper.find('[data-testid="ws-auth-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="drop"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-data"]').exists()).toBe(true)
    await flushPromises()
    expect(authState.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('FileDrop allowFolder 只在数据能力打开（单场能力一次只收一份回放）', async () => {
    authState.isAdmin.value = true
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountWorkspace('data')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'FileDropMock' }).props('allowFolder')).toBe(true)
    for (const cap of ['playback', '3d', 'shots', 'ai']) {
      await switchTo(wrapper, cap)
      expect(wrapper.findComponent({ name: 'FileDropMock' }).props('allowFolder')).toBe(false)
    }
    wrapper.unmount()
    authState.isAdmin.value = false
  })

  it('FileDrop preview → analyze；ProcessingPanel 拿 analysis + result 并转发 cancel / dismiss', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    replayState.analysis.value = { phase: 'parsing', done: 1, total: 2, failure: null }
    await flushPromises()

    wrapper.findComponent({ name: 'FileDropMock' }).vm.$emit('preview')
    await flushPromises()
    expect(replayState.analyze).toHaveBeenCalledTimes(1)

    const panel = wrapper.findComponent({ name: 'ReplayProcessingPanelMock' })
    expect(panel.props('analysis')).toEqual({ phase: 'parsing', done: 1, total: 2, failure: null })
    expect(panel.props('result')).toBeNull()
    panel.vm.$emit('cancel')
    panel.vm.$emit('dismiss')
    expect(replayState.cancelAnalysis).toHaveBeenCalledTimes(1)
    expect(replayState.dismissAnalysis).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('Playback 主动选择新 single replay → updateFiles 收到仅该 replay', async () => {
    withBattles(34)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const single = new File(['x'], 'single.wotbreplay')
    wrapper.findComponent({ name: 'FileDropMock' }).vm.$emit('update:files', [single])
    await flushPromises()
    expect(replayState.updateFiles).toHaveBeenCalledWith([single])
    wrapper.unmount()
  })

  it('Data page 通过显式 props 消费 Workspace 唯一 replay/session owner', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const dataVm = wrapper.findComponent({ name: 'ReplayPageMock' })
    expect(dataVm.props('embedded')).toBe(true)
    expect(dataVm.props('replayContext')).toBe(replayState)
    expect(dataVm.props('workspaceContext')).toBeTruthy()
    wrapper.unmount()
  })

  it('Android pending import：挂载即消费（isReady 恒 true），替换 selection 并本机分析 exactly once', async () => {
    nativeImportState.onPendingFile = null
    const wrapper = mountWorkspace('playback', { authenticated: false })
    await flushPromises()
    expect(nativeImportState.isReady()).toBe(true)
    expect(nativeImportState.retry).toHaveBeenCalledTimes(1)

    const file = new File(['x'], 'a.wotbreplay')
    await expect(nativeImportState.onPendingFile(file, { pendingId: 'pending-uuid-1' })).resolves.toBe(true)
    await flushPromises()
    expect(replayState.updateFiles).toHaveBeenCalledWith([file])
    expect(replayState.analyze).toHaveBeenCalledTimes(1)
    // 导入总是切回数据模式展示结果
    expect(tab(wrapper, 'data').classes()).toContain('is-active')
    wrapper.unmount()
  })

  it.each([
    [{ completed: false, reason: 'ENGINE_UNAVAILABLE' }, false],
    [{ completed: false, reason: 'ALREADY_ACTIVE' }, false],
    [{ completed: false, reason: 'SUPERSEDED' }, false],
    [{ completed: true }, true],
  ])('Android pending replay ACK 只看 completed：%j → %s', async (result, ack) => {
    replayState.analyze.mockResolvedValueOnce(result)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    await expect(nativeImportState.onPendingFile(new File(['x'], 'a.wotbreplay'))).resolves.toBe(ack)
    wrapper.unmount()
  })

  it('键盘：方向键 / Home / End 在能力间移动并激活（canonical SegmentedControl 的 radiogroup 模型）', async () => {
    authState.isAdmin.value = true
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const group = wrapper.get('[role="radiogroup"]')
    await group.trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(tab(wrapper, 'ai').classes()).toContain('is-active')
    await group.trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(tab(wrapper, 'shots').classes()).toContain('is-active')
    await group.trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(tab(wrapper, 'data').classes()).toContain('is-active')
    // ARIA 单选组语义：选中项 aria-checked=true；只有选中项在 Tab 顺序里
    expect(tab(wrapper, 'data').attributes('role')).toBe('radio')
    expect(tab(wrapper, 'data').attributes('aria-checked')).toBe('true')
    expect(tab(wrapper, 'ai').attributes('aria-checked')).toBe('false')
    expect(tab(wrapper, 'data').attributes('tabindex')).toBe('0')
    expect(tab(wrapper, 'ai').attributes('tabindex')).toBe('-1')
    // 视觉 / 键盘行为归 canonical 组件：adapter 不再自带选项样式与状态机
    expect(wrapper.find('.capability-option').exists()).toBe(false)
    expect(wrapper.get('.segmented').classes()).toContain('is-scrollable')
    wrapper.unmount()
    authState.isAdmin.value = false
  })

  it('Case2（生产）：data READY → 3D → data，resp/files/analysis 保留、无空状态', async () => {
    authState.isAdmin.value = true
    withBattles(1)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    expect(replayState.resp.value).toBeTruthy()
    await switchTo(wrapper, '3d')
    expect(replayState.resp.value).toBeTruthy()
    expect(replayState.files.value.length).toBe(1)
    await switchTo(wrapper, 'data')
    expect(replayState.resp.value).toBeTruthy()
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
    wrapper.unmount()
    authState.isAdmin.value = false
  })
})
