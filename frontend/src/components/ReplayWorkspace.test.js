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
import { useConnectivityNotice } from '../composables/useConnectivityNotice.js'
import { useReplaySession } from '../composables/useReplaySession.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import ReplayWorkspace from './ReplayWorkspace.vue'
import FileDrop from './FileDrop.vue'

// useReplay mock 返回的可变 state 占位：每次 beforeEach 用 buildState() 以真实 Vue ref 重建。
const hold = vi.hoisted(() => ({ state: null }))
const authState = vi.hoisted(() => ({ authenticated: null, isAdmin: null, login: vi.fn() }))
const nav = vi.hoisted(() => ({ navigate: null }))

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
      props: ['file', 'active', 'blockedReason', 'navigate', 'playbackSession'],
      template: `<div data-test="${testid}" data-testid="${testid}">{{ file && file.name }}|{{ blockedReason }}|{{ active }}</div>`,
    },
  }
}
vi.mock('./BattlePlaybackPanel.vue', () => paneMock('BattlePlaybackPanelMock', 'ws-playback-pane'))
vi.mock('./Replay3DPane.vue', () => paneMock('Replay3DPaneMock', 'ws-3d-pane'))
vi.mock('./ReplayShotsPane.vue', () => paneMock('ReplayShotsPaneMock', 'ws-shots-pane'))
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

function mountWorkspace(capability = 'data', { authenticated = true, navigate = vi.fn(), attached = false } = {}) {
  authState.authenticated.value = authenticated
  nav.navigate = navigate
  return mount(ReplayWorkspace, {
    props: { initialCapability: capability },
    attachTo: attached ? document.body : undefined,
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
  it('parsed single-battle views collapse files without remounting playback or hiding analysis failures', async () => {
    withBattles(2)
    const wrapper = mountWorkspace('playback', { attached: true })
    await flushPromises()
    const pane = wrapper.get('[data-test="ws-playback-pane"]').element
    const controls = () => wrapper.get('[data-testid="workspace-file-controls"]')
    const toggle = () => wrapper.get('[data-testid="workspace-files-toggle"]')
    expect(controls().isVisible()).toBe(false)
    expect(toggle().attributes('aria-expanded')).toBe('false')
    await toggle().trigger('click')
    expect(controls().isVisible()).toBe(true)
    await toggle().trigger('click')
    expect(controls().isVisible()).toBe(false)
    expect(wrapper.get('[data-test="ws-playback-pane"]').element).toBe(pane)
    expect(replayState.analyze).not.toHaveBeenCalled()
    replayState.loading.value = true
    await flushPromises()
    expect(controls().isVisible()).toBe(true)
    expect(toggle().element.disabled).toBe(true)
    replayState.loading.value = false
    replayState.error.value = 'parse failure'
    await flushPromises()
    expect(controls().isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="ws-error"]').text()).toContain('parse failure')
    replayState.error.value = ''
    await switchTo(wrapper, 'data')
    expect(controls().isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="workspace-files-toggle"]').exists()).toBe(false)
    expect(replayState.files.value).toHaveLength(2)
    wrapper.unmount()
  })

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
    connectivityState.state.value = 'online'
    connectivityState.settled.value = true
    useConnectivityNotice().close()
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

  it.each(['3d', 'ai'])('offline deep link keeps %s discoverable but never mounts its online pane', async (cap) => {
    connectivityState.state.value = 'offline'
    authState.isAdmin.value = true
    withBattles(1)
    const file = replayState.files.value[0]
    const wrapper = mountWorkspace(cap, { authenticated: false })
    await flushPromises()
    expect(capKeys(wrapper)).toEqual(['data', 'playback', '3d', 'shots', 'ai'])
    // 匿名 + 离线：连通性提示优先于登录门禁，且不触发任何 login。
    expect(wrapper.find(`[data-testid="ws-${cap}-connectivity"]`).exists()).toBe(true)
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="ws-${cap}-pane"]`).exists()).toBe(false)
    expect(authState.login).not.toHaveBeenCalled()
    // 本地能力（2D / 射击）在离线 + 未登录时仍可用；射击是登录门禁，不是连通性门禁。
    await switchTo(wrapper, 'playback')
    expect(wrapper.find('[data-test="ws-playback-pane"]').exists()).toBe(true)
    await switchTo(wrapper, 'shots')
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ws-shots-pane"]').exists()).toBe(false)
    expect(replayState.files.value[0]).toBe(file)
    wrapper.unmount()
  })

  it.each(['3d', 'ai'])('offline %s pane shows connectivity (not the auth gate) even when authenticated', async (cap) => {
    connectivityState.state.value = 'offline'
    authState.isAdmin.value = true
    withBattles(1)
    const wrapper = mountWorkspace(cap)
    await flushPromises()
    expect(wrapper.find(`[data-testid="ws-${cap}-connectivity"]`).exists()).toBe(true)
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="ws-${cap}-pane"]`).exists()).toBe(false)
    wrapper.unmount()
  })

  it('reconnect activates a blocked pane once; disconnect preserves the replay and disables its active props', async () => {
    connectivityState.state.value = 'offline'
    authState.isAdmin.value = true
    withBattles(1)
    const file = replayState.files.value[0]
    const wrapper = mountWorkspace('3d')
    await flushPromises()
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(wrapper.findAll('[data-test="ws-3d-pane"]')).toHaveLength(1)
    connectivityState.state.value = 'offline'
    await flushPromises()
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('false')
    expect(replayState.files.value[0]).toBe(file)
    expect(replayState.analyze).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // 冷启动深链（?view=ai-review / ?view=agent-replay）：连通性首次检测未完成时，占位 UNKNOWN
  // 不是结论 —— 不得出现任何连通性提示，也不得提前挂载需要网络的面板或落到登录门禁。
  it.each(['ai', '3d'])('cold-start deep link to %s shows no connectivity verdict until detection settles ONLINE', async (cap) => {
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    withBattles(1)
    const wrapper = mountWorkspace(cap)
    await flushPromises()
    expect(wrapper.find(`[data-testid="ws-${cap}-connectivity"]`).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('connectivityNotice.')
    expect(wrapper.text()).not.toContain('featureOffline.')
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="ws-${cap}-pane"]`).exists()).toBe(false)
    expect(useConnectivityNotice().notice.value).toBe(null)

    // 首次检测结果 ONLINE（生产中 settled 与状态在同一个同步块里提交）。
    connectivityState.settled.value = true
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(wrapper.find(`[data-testid="ws-${cap}-connectivity"]`).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('connectivityNotice.')
    const pane = wrapper.get(`[data-test="ws-${cap}-pane"]`)
    expect(pane.text()).toContain('true')
    // 深链入口的门禁补判按真实 ONLINE 进行：全局 connectivity 提示（AppShell 弹层）也不得出现。
    expect(useConnectivityNotice().notice.value).toBe(null)
    wrapper.unmount()
  })

  it('cold-start anonymous 3d deep link reaches the login gate only after detection settles ONLINE', async () => {
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    withBattles(1)
    const wrapper = mountWorkspace('3d', { authenticated: false })
    await flushPromises()
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-3d-connectivity"]').exists()).toBe(false)

    connectivityState.settled.value = true
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-3d-connectivity"]').exists()).toBe(false)
    expect(authState.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // settle 后的真实结论必须照常显示。UNKNOWN → UNKNOWN 时连通性值不变，只有 settled
  // false → true 能驱动 UI 从「暂未下结论」切到真实 unknown 提示（锁死 settled 必须是响应式）。
  it.each([
    ['unknown', 'connectivityNotice.unknown'],
    ['offline', 'featureOffline.aiReview'],
  ])('cold-start ai deep link settling %s shows the real connectivity banner', async (result, messageKey) => {
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    withBattles(1)
    const wrapper = mountWorkspace('ai')
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-ai-connectivity"]').exists()).toBe(false)

    connectivityState.settled.value = true
    connectivityState.state.value = result
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-ai-connectivity"]').text()).toContain(messageKey)
    expect(wrapper.find('[data-test="ws-ai-pane"]').exists()).toBe(false)
    // 深链入口被拒绝的门禁在 settle 后按真实结论补提示一次。
    expect(useConnectivityNotice().notice.value).toMatchObject({ messageKey })
    wrapper.unmount()
  })

  it.each([
    ['anonymous', false, false],
    ['authenticated normal user', true, false],
    ['admin', true, true],
  ])('%s sees the same five capabilities', async (_, authenticated, isAdmin) => {
    authState.isAdmin.value = isAdmin
    const wrapper = mountWorkspace('data', { authenticated })
    await flushPromises()
    expect(capKeys(wrapper)).toEqual(['data', 'playback', '3d', 'shots', 'ai'])
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it.each([
    ['3d', 'agent-replay'],
    ['shots', 'agent-shots'],
  ])('anonymous %s deep link gates before mounting; login restores selected replay', async (capability, view) => {
    withBattles(1)
    const files = replayState.files.value
    const revision = replayState.selectionRevision.value
    const wrapper = mountWorkspace(capability, { authenticated: false })
    await flushPromises()
    expect(tab(wrapper, capability).classes()).toContain('is-active')
    expect(wrapper.get('[data-testid="capability-auth-gate"]').text()).toContain(
      capability === '3d' ? 'workspace.login_required_3d' : 'workspace.login_required_shots')
    expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(false)
    expect(replayState.analyze).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="capability-login"]').trigger('click')
    expect(authState.login).toHaveBeenCalledWith(view)
    expect(nav.navigate).not.toHaveBeenCalled()
    authState.authenticated.value = true
    await flushPromises()
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.get(`[data-test="ws-${capability}-pane"]`).text()).toContain('f0.wotbreplay')
    expect(replayState.files.value).toBe(files)
    expect(replayState.selectionRevision.value).toBe(revision)
    expect(replayState.updateFiles).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    ['3d', false], ['3d', true], ['shots', false], ['shots', true],
  ])('logout removes %s pane (hidden=%s) without clearing replay session', async (capability, hidden) => {
    withBattles(1)
    const files = replayState.files.value
    const result = replayState.resp.value
    const revision = replayState.selectionRevision.value
    const wrapper = mountWorkspace(capability)
    await flushPromises()
    expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(true)
    if (hidden) await switchTo(wrapper, 'data')
    authState.authenticated.value = false
    await flushPromises()
    expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(false)
    await switchTo(wrapper, capability)
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(false)
    expect(replayState.files.value).toBe(files)
    expect(replayState.resp.value).toBe(result)
    expect(replayState.selectionRevision.value).toBe(revision)
    expect(replayState.updateFiles).not.toHaveBeenCalled()
    wrapper.unmount()
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

  it('2D and 3D receive the same workspace playback session owner', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const owner = wrapper.getComponent({ name: 'BattlePlaybackPanelMock' }).props('playbackSession')
    expect(owner.loadScene).toBeTypeOf('function')
    expect(owner.loadCanonical).toBeTypeOf('function')
    await switchTo(wrapper, '3d')
    expect(wrapper.getComponent({ name: 'Replay3DPaneMock' }).props('playbackSession')).toBe(owner)
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
  })

  it('切走 3D 时面板收到 active=false（停渲染但保留会话），切回 active=true', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('3d')
    await flushPromises()
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|true')
    await switchTo(wrapper, 'data')
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|false')
    await switchTo(wrapper, '3d')
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|true')
    wrapper.unmount()
  })

  it('能力切换写 URL（router owner）：五个能力各自的 view', async () => {
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
  })

  it('深链初始能力：3d / shots / playback / ai 各自直达', async () => {
    withBattles(1)
    for (const cap of ['3d', 'shots', 'playback', 'ai']) {
      const wrapper = mountWorkspace(cap)
      await flushPromises()
      expect(tab(wrapper, cap).classes()).toContain('is-active')
      expect(wrapper.get(`[data-testid="ws-${cap}"]`).element.style.display).not.toBe('none')
      wrapper.unmount()
    }
  })

  it('多文件未选场次：3D / 射击 / 2D / AI 收到同一份阻断原因（本机只解析单场）', async () => {
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
  })

  it('四个单场能力共用 workspace 的 selectBattle：选 #2 后都拿 f2', async () => {
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
  })

  it('匿名数据能力立即渲染投放区与数据面板，不请求登录', async () => {
    const wrapper = mountWorkspace('data', { authenticated: false })
    expect(wrapper.find('[data-testid="ws-auth-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="select-files-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-data"]').exists()).toBe(true)
    await flushPromises()
    expect(authState.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('anonymous 2D capability mounts with selected replay without requesting login', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback', { authenticated: false })
    await flushPromises()
    expect(wrapper.get('[data-test="ws-playback-pane"]').text()).toContain('f0.wotbreplay')
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(authState.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('数据与 2D/3D 共用批量导入，射击与 AI 保留单文件入口', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountWorkspace('data')
    await flushPromises()
    for (const cap of ['data', 'playback', '3d', 'shots', 'ai']) {
      await switchTo(wrapper, cap)
      const batchImport = ['data', 'playback', '3d'].includes(cap)
      expect(wrapper.get('[data-testid="select-files-input"]').element.multiple).toBe(batchImport)
      expect(wrapper.find('[data-testid="select-folder-input"]').exists()).toBe(batchImport)
    }
    wrapper.unmount()
  })

  it.each(['playback', '3d'])('%s 直接批量选文件、解析并切局；追加去重后可重新解析和清空', async (cap) => {
    const wrapper = mountWorkspace(cap, { attached: true })
    await flushPromises()
    const a = new File(['a'], 'a.wotbreplay')
    const b = new File(['b'], 'b.wotbreplay')
    const c = new File(['c'], 'c.wotbreplay')
    const pickerId = cap === '3d' ? 'replay3d-battle-picker' : 'playback-battle-picker'
    const pane = () => wrapper.get(`[data-test="ws-${cap}-pane"]`)
    // 只替代分析结果边界；上传控件、Workspace、session 和场次选择器都使用真实实现。
    replayState.analyze.mockImplementation(async () => {
      replayState.session.commitReadyResult({
        leagueMode: false,
        aggregate: [],
        battles: replayState.files.value.map((file, i) => ({
          sourceId: `r${i}`, sourceName: file.name, mapName: 'Lagoon', players: [],
        })),
      })
      return { completed: true }
    })
    const pick = async (testId, files) => {
      const input = wrapper.get(`[data-testid="${testId}"]`)
      expect(input.element.multiple).toBe(true)
      Object.defineProperty(input.element, 'files', { value: files, configurable: true })
      await input.trigger('change')
      await flushPromises()
    }
    const analyze = async () => {
      await wrapper.findComponent(FileDrop).findAll('button')
        .find(button => button.text().includes('action.preview')).trigger('click')
      await flushPromises()
    }

    await pick('select-files-input', [b, a])
    expect(replayState.files.value).toEqual([a, b])
    expect(replayState.analyze).not.toHaveBeenCalled()
    expect(pane().text()).toContain('workspace.single_replay_required')
    await analyze()
    expect(replayState.analyze).toHaveBeenCalledTimes(1)
    expect(tab(wrapper, cap).classes()).toContain('is-active')
    expect(pane().text()).toContain('a.wotbreplay')
    await wrapper.get(`[data-testid="${pickerId}"]`).trigger('click')
    await wrapper.get('[data-testid="battle-picker-option"][data-value="r1"]').trigger('click')
    await flushPromises()
    expect(pane().text()).toContain('b.wotbreplay')
    expect(replayState.analyze).toHaveBeenCalledTimes(1)

    expect(wrapper.get('[data-testid="workspace-file-controls"]').isVisible()).toBe(false)
    await wrapper.get('[data-testid="workspace-files-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="workspace-file-controls"]').isVisible()).toBe(true)
    await pick('compact-add-files-input', [b, c])
    expect(replayState.files.value).toEqual([a, b, c])
    expect(replayState.resp.value).toBeNull()
    expect(replayState.currentTargetFile.value).toBeNull()
    expect(pane().text()).not.toContain('b.wotbreplay')
    await analyze()
    await wrapper.get(`[data-testid="${pickerId}"]`).trigger('click')
    expect(wrapper.findAll('[data-testid="battle-picker-option"]')).toHaveLength(3)
    await wrapper.get('[data-testid="battle-picker-option"][data-value="r2"]').trigger('click')
    await flushPromises()
    expect(pane().text()).toContain('c.wotbreplay')

    await wrapper.get('[data-testid="compact-clear"]').trigger('click')
    expect(replayState.files.value).toHaveLength(3)
    await wrapper.get('[data-testid="compact-clear-confirm"]').trigger('click')
    await flushPromises()
    expect(replayState.files.value).toEqual([])
    expect(replayState.currentTargetFile.value).toBeNull()
    expect(wrapper.find(`[data-testid="${pickerId}"]`).exists()).toBe(false)
    expect(pane().text()).not.toContain('.wotbreplay')
    wrapper.unmount()
  })

  it('FileDrop preview → analyze；ProcessingPanel 拿 analysis + result 并转发 cancel / dismiss', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    replayState.analysis.value = { phase: 'parsing', done: 1, total: 2, failure: null }
    await flushPromises()

    wrapper.findComponent(FileDrop).vm.$emit('preview')
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

  it('上传区的 selection 变更交给工作台唯一 session owner', async () => {
    withBattles(34)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const single = new File(['x'], 'single.wotbreplay')
    wrapper.findComponent(FileDrop).vm.$emit('update:files', [single])
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
  })

  it('Case2（生产）：data READY → 3D → data，resp/files/analysis 保留、无空状态', async () => {
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
  })
})
