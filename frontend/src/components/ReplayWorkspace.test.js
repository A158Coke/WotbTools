// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises as flushVue, mount } from '@vue/test-utils'

/** 2D 回放面板是异步组件：每次 flush 同时等动态 import 完成。 */
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

vi.mock('../composables/useReplay.js', () => ({
  useReplay: () => hold.state,
  chooseInitialResultTab: () => 'aggregate',
}))
// 服务器没有 parser：工作台不等登录（无 auth gating），useAuth 只用于管理员模式开关。
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
    emits: ['open-ai', 'open-playback'],
    template: '<div data-test="data-pane" />',
  },
}))
vi.mock('./AiReviewPanel.vue', () => ({
  default: {
    name: 'AiReviewPanelMock',
    props: ['file'],
    template: '<div data-test="ai-pane" />',
  },
}))
// __esModule：BattlePlaybackPanel 在工作台里是异步组件（审计 PF-02），Vue 需要它来解包 default
vi.mock('./BattlePlaybackPanel.vue', () => ({
  __esModule: true,
  default: {
    name: 'BattlePlaybackPanelMock',
    props: ['file', 'active', 'seekTo', 'blockedReason'],
    template: '<div data-test="playback-pane">{{ file && file.name }}|{{ blockedReason }}</div>',
  },
}))
vi.mock('./FileUploader.vue', () => ({
  default: {
    name: 'FileUploaderMock',
    props: ['files', 'allowFolder'],
    emits: ['update:files'],
    template: '<button data-test="uploader" :data-allow-folder="String(allowFolder)">upload</button>',
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

function mountWorkspace(capability = 'data', { authenticated = true } = {}) {
  authState.authenticated.value = authenticated
  return mount(ReplayWorkspace, {
    props: { initialCapability: capability },
    global: {
      provide: { [NAVIGATE_VIEW_KEY]: vi.fn() },
      mocks: { $t: (k) => k },
    },
  })
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
    authState.login = vi.fn()
    const { error: globalError, showError } = useError()
    showError.value = false
    globalError.value = ''
    vi.clearAllMocks()
  })

  it('始终渲染三个 capability tabs（不因 capability 不可用而消失）', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const tabs = wrapper.findAll('[data-testid="ws-tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs.map(t => t.attributes('data-cap'))).toEqual(['data', 'playback', 'ai'])
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-pane"]').exists()).toBe(false)
    // 审计 PF-02：2D 回放面板首次进入时才挂载（代码块按需加载），之后切走只隐藏、保留状态
    expect(wrapper.find('[data-test="playback-pane"]').exists()).toBe(false)
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="playback-pane"]').exists()).toBe(true)
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="data"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="playback-pane"]').exists()).toBe(true)
  })

  it('Data page 通过显式 props 消费 Workspace 唯一 replay/session owner', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const dataVm = wrapper.findComponent({ name: 'ReplayPageMock' })
    expect(dataVm.props('embedded')).toBe(true)
    expect(dataVm.props('replayContext')).toBe(replayState)
    expect(dataVm.props('workspaceContext')).toBeTruthy()
  })

  it('切到 AI 能力时只显示维护提示，不分析或挂载 AI 面板', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-ai"]').text()).toContain('workspace.ai_title')
    expect(wrapper.find('[data-test="ai-pane"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(false)
    expect(replayState.analyze).not.toHaveBeenCalled()
  })

  it('AI 维护页不隐藏 Playback tab，也不触发分析', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-pane"]').exists()).toBe(false)
    expect(replayState.analyze).not.toHaveBeenCalled()
  })

  it('传入 initialCapability=playback 时初始聚焦 Playback', async () => {
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const playback = wrapper.find('[data-test="playback-pane"]')
    expect(playback.exists()).toBe(true)
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
  })

  it('AI 维护页不挂载复盘面板，且不切到 Playback', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    const aiPanelVm = wrapper.findComponent({ name: 'AiReviewPanelMock' })
    expect(aiPanelVm.exists()).toBe(false)
    await flushPromises()
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').classes()).toContain('is-active')
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').classes()).not.toContain('is-active')
  })

  it('Case F：未登录时 FileUploader / 数据面板可用，没有登录门禁', async () => {
    const login = vi.fn()
    const wrapper = mountWorkspace('data', { authenticated: false, login })
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-auth-required"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-data"]').exists()).toBe(true)
    expect(login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('Case A：未登录切到 2D 回放直接进入，不请求登录', async () => {
    const login = vi.fn()
    const wrapper = mountWorkspace('data', { authenticated: false, login })
    await flushPromises()
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="playback-pane"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('AI 维护页提供跳到数据 / 2D 回放的入口', async () => {
    const wrapper = mountWorkspace('ai')
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-ai-go-data"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-ai-go-playback"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('3D / 射击分析模式只对管理员显示，且导航到对应页面', async () => {
    const plain = mountWorkspace('data')
    await flushPromises()
    expect(plain.findAll('[data-testid="ws-tab"]').map(tab => tab.attributes('data-cap'))).toEqual(['data', 'playback', 'ai'])
    plain.unmount()

    authState.isAdmin.value = true
    const admin = mountWorkspace('data')
    await flushPromises()
    expect(admin.findAll('[data-testid="ws-tab"]').map(tab => tab.attributes('data-cap'))).toEqual(['data', 'playback', '3d', 'shots', 'ai'])
    authState.isAdmin.value = false
    admin.unmount()
  })

  /** 数据模式的场次选择器在 ReplayPage 工具栏里（此处为 mock），它调用的就是 workspaceContext.selectBattle。 */
  async function selectInData(wrapper, sourceId) {
    wrapper.findComponent({ name: 'ReplayPageMock' }).props('workspaceContext').selectBattle(sourceId)
    await flushPromises()
  }

  async function openPlaybackPicker(wrapper) {
    await wrapper.get('[data-testid="playback-battle-picker"]').trigger('click')
    await flushPromises()
    return wrapper.findAll('[data-testid="battle-picker-option"]')
  }

  it('回归：选 #8 → 经 AI 维护页切到 Playback 仍消费 #8', async () => {
    const files = Array.from({ length: 9 }, (_, i) => new File(['x'], `f${i}.wotbreplay`))
    replayState.files.value = files
    replayState.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: Array.from({ length: 9 }, (_, i) => ({ sourceId: `r${i}`, mapName: 'Lagoon', players: [] })),
    }
    const wrapper = mountWorkspace('data')
    await flushPromises()
    await selectInData(wrapper, 'r7')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-ai"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AiReviewPanelMock' }).exists()).toBe(false)
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    const pbVm = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(pbVm.exists()).toBe(true)
    expect(pbVm.props('file')?.name).toBe('f7.wotbreplay')
  })

  it('2D 回放的场次选择器只列有效 parsed battles（failed/duplicate 不列出）；选第二个有效 battle 得 sourceId r2 / files[2]', async () => {
    const files = [new File(['x'], 'f0.wotbreplay'), new File(['x'], 'f1.wotbreplay'), new File(['x'], 'f2.wotbreplay')]
    replayState.files.value = files
    replayState.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: [
        { sourceId: 'r0', mapName: 'Lagoon', players: [] },
        { sourceId: 'r2', mapName: 'Desert', players: [] },
      ],
    }
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const items = await openPlaybackPicker(wrapper)
    expect(items.map(i => i.attributes('data-value'))).toEqual(['r0', 'r2'])
    await items[1].trigger('click')
    await flushPromises()
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    const playbackVm = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(playbackVm.props('file')?.name).toBe('f2.wotbreplay')
  })

  it('布局：无顶部能力状态标记；数据模式的场次选择在 ReplayPage 工具栏，工作台只给 2D 回放渲染选择器', async () => {
    const files = [
      new File(['x'], 'f0.wotbreplay'),
      new File(['x'], 'f1.wotbreplay'),
    ]
    replayState.files.value = files
    replayState.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: [
        { sourceId: 'r0', mapName: 'Lagoon', players: [] },
        { sourceId: 'r1', mapName: 'Desert', players: [] },
      ],
    }
    const wrapper = mountWorkspace('data')
    await flushPromises()
    expect(wrapper.find('[data-test="cap-base"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="cap-ai"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="cap-playback"]').exists()).toBe(false)
    // 选择器在 v-show 的 2D 回放面板里：数据模式下存在但不可见
    expect(wrapper.find('[data-testid="ws-playback"]').element.style.display).toBe('none')
    expect(wrapper.find('[data-testid="ws-playback"] [data-testid="playback-battle-picker"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-data"] [data-testid="playback-battle-picker"]').exists()).toBe(false)
  })

  it('Data → FileUploader allowFolder=true；AI 无上传器；Playback allowFolder=false', async () => {
    const files = [new File(['x'], 'a.wotbreplay')]
    replayState.files.value = files
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const uploader = wrapper.findComponent({ name: 'FileUploaderMock' })
    expect(uploader.props('allowFolder')).toBe(true)

    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(false)

    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'FileUploaderMock' }).props('allowFolder')).toBe(false)
  })

  it('已有 34-file batch → 切 AI 维护页：selection 不变且不挂载 AI 面板', async () => {
    const files = Array.from({ length: 34 }, (_, i) => new File(['x'], `f${i}.wotbreplay`))
    replayState.files.value = files
    replayState.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: Array.from({ length: 34 }, (_, i) => ({ sourceId: `r${i}`, mapName: 'Lagoon', players: [] })),
    }
    const wrapper = mountWorkspace('data')
    await flushPromises()
    await selectInData(wrapper, 'r7')
    expect(replayState.files.value.length).toBe(34)
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(replayState.files.value.length).toBe(34)
    expect(wrapper.find('[data-testid="ws-ai"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AiReviewPanelMock' }).exists()).toBe(false)
  })

  it('Playback 主动选择新 single replay → updateFiles 收到仅该 replay', async () => {
    replayState.files.value = Array.from({ length: 34 }, (_, i) => new File(['x'], `f${i}.wotbreplay`))
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const single = new File(['x'], 'single.wotbreplay')
    const uploader = wrapper.findComponent({ name: 'FileUploaderMock' })
    uploader.vm.$emit('update:files', [single])
    await flushPromises()
    expect(replayState.updateFiles).toHaveBeenCalledWith([single])
  })

  it('Case2（生产）：data READY → playback → data，resp/files/analysis 保留、无空状态', async () => {
    const file = new File(['x'], 'a.wotbreplay')
    replayState.files.value = [file]
    replayState.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: [{ sourceId: 'r0', mapName: 'Lagoon', players: [] }],
    }
    const wrapper = mountWorkspace('data')
    await flushPromises()
    expect(replayState.resp.value).toBeTruthy()
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    expect(replayState.resp.value).toBeTruthy()
    expect(replayState.files.value.length).toBe(1)
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="data"]').trigger('click')
    await flushPromises()
    expect(replayState.resp.value).toBeTruthy()
    expect(replayState.files.value.length).toBe(1)
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
  })

  it('currentBattleId 跨 capability 保持（data → playback → data 不丢选中单场）', async () => {
    const files = [new File(['x'], 'f0.wotbreplay'), new File(['x'], 'f1.wotbreplay'), new File(['x'], 'f2.wotbreplay')]
    replayState.files.value = files
    replayState.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: [
        { sourceId: 'r0', mapName: 'A', players: [] },
        { sourceId: 'r2', mapName: 'B', players: [] },
      ],
    }
    const wrapper = mountWorkspace('data')
    await flushPromises()
    await selectInData(wrapper, 'r2')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    const pb = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(pb.props('file')?.name).toBe('f2.wotbreplay')
    expect(wrapper.get('[data-testid="playback-battle-picker"]').attributes('aria-label')).toContain('workspace.battle_n')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="data"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ReplayPageMock' }).props('workspaceContext').currentBattleId.value).toBe('r2')
  })

  it('没有 auth gating：未登录也立即渲染上传器 / 数据面板，不显示 ws-auth-loading，不请求登录', async () => {
    const wrapper = mountWorkspace('data', { authenticated: false })
    // 不等任何 auth promise：首帧即可用
    expect(wrapper.find('[data-testid="ws-auth-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-data"]').exists()).toBe(true)
    await flushPromises()
    expect(authState.login).not.toHaveBeenCalled()
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
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="data"]').classes()).toContain('is-active')
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

  it('FileUploader preview → analyze；ProcessingPanel 拿 analysis + result 并转发 cancel / dismiss', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    replayState.analysis.value = { phase: 'parsing', done: 1, total: 2, failure: null }
    await flushPromises()

    wrapper.findComponent({ name: 'FileUploaderMock' }).vm.$emit('preview')
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

  it('2D 回放：单文件直接传 file；多文件未选场次 → blockedReason=single_replay_required、file=null', async () => {
    const single = new File(['x'], 'only.wotbreplay')
    replayState.files.value = [single]
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    let pb = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(pb.props('file')?.name).toBe('only.wotbreplay')
    expect(pb.props('blockedReason')).toBe('')
    expect(pb.props('active')).toBe(true)

    replayState.updateFiles([new File(['x'], 'f0.wotbreplay'), new File(['y'], 'f1.wotbreplay')])
    await flushPromises()
    pb = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(pb.props('file')).toBeNull()
    expect(pb.props('blockedReason')).toBe('workspace.single_replay_required')
    wrapper.unmount()
  })
})
