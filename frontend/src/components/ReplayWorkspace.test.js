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
const authState = vi.hoisted(() => ({
  authenticated: null,
  loginInFlight: null,
  authInitState: null,
  login: vi.fn(),
  retryAuth: vi.fn(),
  initPromise: Promise.resolve(true),
}))

vi.mock('../composables/useReplay.js', () => ({
  useReplay: () => hold.state,
  chooseInitialResultTab: () => 'aggregate',
}))
vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  authState.authenticated = ref(true)
  authState.loginInFlight = ref(false)
  authState.authInitState = ref('authenticated')
  authState.isAdmin = ref(false)
  return {
    useAuth: () => ({
      initPromise: authState.initPromise,
      authenticated: authState.authenticated,
      loginInFlight: authState.loginInFlight,
      authInitState: authState.authInitState,
      login: authState.login,
      retryAuth: authState.retryAuth,
      isAdmin: authState.isAdmin,
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
    props: ['file', 'processingJobId', 'sourceId', 'datasetError'],
    template: '<div data-test="ai-pane">{{ processingJobId }}|{{ sourceId }}|{{ datasetError }}</div>',
  },
}))
// __esModule：BattlePlaybackPanel 在工作台里是异步组件（审计 PF-02），Vue 需要它来解包 default
vi.mock('./BattlePlaybackPanel.vue', () => ({
  __esModule: true,
  default: {
    name: 'BattlePlaybackPanelMock',
    props: ['file', 'processingJobId', 'sourceId', 'active', 'seekTo', 'datasetError'],
    template: '<div data-test="playback-pane">{{ processingJobId }}|{{ sourceId }}|{{ datasetError }}</div>',
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
vi.mock('./ReplayProcessingPanel.vue', () => ({ default: { template: '<div data-test="processing" />' } }))
vi.mock('./ReplayTaskCard.vue', () => ({ default: { template: '<div data-test="task" />' } }))
vi.mock('./RemoveConfirmModal.vue', () => ({ default: { template: '<div data-test="modal" />' } }))
const nativeImportState = vi.hoisted(() => ({ onPendingFile: null, onReadError: null, retry: vi.fn() }))
vi.mock('../composables/useNativeReplayImport.js', () => ({
  useNativeReplayImport: (opts) => {
    nativeImportState.onPendingFile = opts?.onPendingFile ?? null
    nativeImportState.onReadError = opts?.onReadError ?? null
    return { consumePendingWhenReady: nativeImportState.retry }
  },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k, te: () => true, locale: { value: 'en' } }) }))

/** 以真实 Vue ref/函数构造 useReplay 返回物（保证 files/resp/processingJobId/selectionRevision 响应式）。 */
function buildState() {
  const session = useReplaySession()
  return {
    ...session,
    session,
    updateFiles: vi.fn((next) => {
      session.replaceSelection(next)
    }),
    startProcessingJob: vi.fn(() => {
      session.error.value = ''
      return Promise.resolve({ accepted: true, jobId: 'job-1' })
    }),
    cancelProcessing: vi.fn(),
    dismissProcessingJob: vi.fn(),
    requestDirectAction: vi.fn(() => Promise.resolve({ processingJobId: 'job-1', sourceId: 'r0' })),
    askRemoveFile: vi.fn(),
    cancelRemove: vi.fn(),
    confirmRemove: vi.fn(),
    cancelExportJob: vi.fn(),
    downloadExportResult: vi.fn(),
    dismissExportJob: vi.fn(),
  }
}

let replayState = null
let mountGeneration = 0

function mountWorkspace(capability = 'data', { authenticated = true, login = vi.fn(() => Promise.resolve()), authInit } = {}) {
  const currentMount = ++mountGeneration
  authState.authenticated.value = authenticated
  authState.loginInFlight.value = false
  authState.login = login
  authState.initPromise = authInit || Promise.resolve(authenticated)
  authState.authInitState.value = authInit
    ? 'initializing'
    : (authenticated ? 'authenticated' : 'unauthenticated')
  authState.retryAuth = vi.fn(() => {
    authState.authInitState.value = 'initializing'
    authState.authenticated.value = false
    const retry = Promise.resolve(authenticated)
    retry.then((result) => {
      if (currentMount !== mountGeneration) return
      authState.authenticated.value = result
      authState.authInitState.value = result ? 'authenticated' : 'unauthenticated'
    })
    return retry
  })
  if (authInit) {
    Promise.resolve(authInit).then((result) => {
      if (currentMount !== mountGeneration) return
      const nextAuthenticated = typeof result === 'boolean' ? result : authenticated
      authState.authenticated.value = nextAuthenticated
      authState.authInitState.value = nextAuthenticated ? 'authenticated' : 'unauthenticated'
    }).catch(() => {
      if (currentMount !== mountGeneration) return
      authState.authInitState.value = 'failed'
    })
  }
  return mount(ReplayWorkspace, {
    props: { initialCapability: capability },
    global: {
      provide: { [NAVIGATE_VIEW_KEY]: vi.fn() },
      mocks: { $t: (k) => k },
    },
  })
}

describe('ReplayWorkspace', () => {
  it('shows native read failures in the replay error surface and retries without starting processing', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    nativeImportState.retry.mockClear()
    nativeImportState.onReadError()
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-error"]').text()).toContain('workspace.native_replay_read_failed')
    await wrapper.get('[data-testid="ws-native-retry"]').trigger('click')
    expect(nativeImportState.retry).toHaveBeenCalledTimes(1)
    expect(replayState.startProcessingJob).not.toHaveBeenCalled()
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
    authState.loginInFlight.value = false
    authState.login = vi.fn(() => Promise.resolve())
    authState.initPromise = Promise.resolve(true)
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

  it('切到 AI 能力时只显示维护提示，不准备 Dataset 或挂载 AI 面板', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'job-1'
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-ai"]').text()).toContain('workspace.ai_title')
    expect(wrapper.find('[data-test="ai-pane"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(false)
    expect(replayState.requestDirectAction).not.toHaveBeenCalled()
  })

  it('AI 维护页不隐藏 Playback tab，也不准备 Dataset', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'job-1'
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-pane"]').exists()).toBe(false)
    expect(replayState.requestDirectAction).not.toHaveBeenCalled()
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
    replayState.processingJobId.value = 'job-1'
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    const aiPanelVm = wrapper.findComponent({ name: 'AiReviewPanelMock' })
    expect(aiPanelVm.exists()).toBe(false)
    await flushPromises()
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').classes()).toContain('is-active')
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').classes()).not.toContain('is-active')
  })

  it('auth init 完成后 authenticated=true 时 login 不被调用（SSO/session 用户不被打断）', async () => {
    let resolveInit
    const authInit = new Promise((r) => { resolveInit = r })
    const login = vi.fn()
    const wrapper = mountWorkspace('ai', { authenticated: true, login, authInit })
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    resolveInit()
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    // Case D：已认证 → 不发起登录重定向，直接渲染 replay workspace
    expect(wrapper.find('[data-testid="ws-auth-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-auth-required"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('AI 维护页未登录时不自动发起 login', async () => {
    let resolveInit
    const authInit = new Promise((r) => { resolveInit = r })
    const login = vi.fn()
    const wrapper = mountWorkspace('ai', { authenticated: false, login, authInit })
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    resolveInit()
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ws-ai"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('Case E：auth init 未完成时 replay 业务 UI 不可用，也不能发起 processing', async () => {
    let resolveInit
    const authInit = new Promise((r) => { resolveInit = r })
    const wrapper = mountWorkspace('data', { authenticated: false, login: vi.fn(), authInit })
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-auth-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-data"]').exists()).toBe(false)
    expect(replayState.startProcessingJob).not.toHaveBeenCalled()
    resolveInit()
    await flushPromises()
    wrapper.unmount()
  })

  it('Case G：auth init reject exits checking and exposes retry/login recovery actions', async () => {
    const authInit = Promise.reject(new Error('AUTH_INIT_FAILED'))
    const login = vi.fn(() => Promise.resolve())
    const wrapper = mountWorkspace('data', { authenticated: false, login, authInit })
    await flushPromises()

    expect(wrapper.find('[data-testid="ws-auth-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-auth-failed"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-auth-retry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-login-recovery"]').exists()).toBe(true)
    expect(login).not.toHaveBeenCalled()

    await wrapper.find('[data-testid="ws-login-recovery"]').trigger('click')
    await flushPromises()
    expect(login).toHaveBeenCalledWith('replay')
    wrapper.unmount()
  })

  it('Case H：watchdog failure recovery retries auth without exposing replay UI', async () => {
    let rejectInit
    const authInit = new Promise((_, reject) => { rejectInit = reject })
    const wrapper = mountWorkspace('data', { authenticated: false, authInit })
    rejectInit(new Error('AUTH_INIT_WATCHDOG_TIMEOUT'))
    await flushPromises()

    expect(wrapper.find('[data-testid="ws-auth-failed"]').exists()).toBe(true)
    await wrapper.find('[data-testid="ws-auth-retry"]').trigger('click')
    await flushPromises()
    expect(authState.retryAuth).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="ws-auth-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-auth-required"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('Case F：未登录时 FileUploader / processing / capability 面板都不可用', async () => {
    const wrapper = mountWorkspace('data', { authenticated: false, login: vi.fn() })
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-auth-required"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="processing"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-data"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-ai"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-playback"]').exists()).toBe(false)
    expect(replayState.startProcessingJob).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // design-language §10 / 审计 PG-03：未登录时显示说明卡，不自动跳转登录页；点击登录才发起，并回到当前能力。
  it('Case A：未登录进入可用能力时显示登录说明卡，点击后才请求登录', async () => {
    const cases = [
      { cap: 'data', view: 'replay' },
      { cap: 'playback', view: 'battle-playback' },
    ]
    for (const c of cases) {
      const login = vi.fn()
      const wrapper = mountWorkspace(c.cap, { authenticated: false, login })
      await flushPromises()
      expect(login).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="ws-auth-required"]').exists()).toBe(true)
      await wrapper.get('[data-testid="ws-login"]').trigger('click')
      await flushPromises()
      expect(login).toHaveBeenCalledWith(c.view)
      wrapper.unmount()
    }
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

  it('Case B/C：AI 维护页免登录，Playback 仍能重新发起 login', async () => {
    const login = vi.fn(() => Promise.reject(new Error('AUTH_NAVIGATION_FAILED')))
    const wrapper = mountWorkspace('data', { authenticated: false, login })
    await flushPromises()
    // 挂载时不自动登录（说明卡 + 登录按钮）
    expect(login).not.toHaveBeenCalled()

    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ws-ai"]').exists()).toBe(true)

    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenLastCalledWith('battle-playback')

    wrapper.unmount()
  })

  // 用户主动发起的登录失败必须可观测：以前 requestLogin 用 `.catch(() => {})` 全吞，
  // 用户点了「战局回放」页面什么都没变，只能反复点——这正是「点了完全没反应」的来源。
  it('用户主动点击 capability 且 login 失败 → 走统一 GlobalErrorDialog（不再 silent swallow）', async () => {
    const { error: globalError, showError } = useError()
    const login = vi.fn(() => Promise.reject(new Error('AUTH_NAVIGATION_FAILED')))
    const wrapper = mountWorkspace('data', { authenticated: false, login })
    await flushPromises()
    // 挂载时不发起登录，也就不会有错误弹窗：说明卡本身就是可重试的可见表面。
    expect(login).not.toHaveBeenCalled()
    expect(showError.value).toBe(false)

    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    expect(login).toHaveBeenLastCalledWith('battle-playback')
    expect(showError.value).toBe(true)
    expect(globalError.value).toBe('workspace.login_failed')
    wrapper.unmount()
  })

  it('login 正常发起时不显示任何错误（redirect 流程不受影响）', async () => {
    const { showError } = useError()
    const login = vi.fn(() => Promise.resolve())
    const wrapper = mountWorkspace('data', { authenticated: false, login })
    await flushPromises()

    await wrapper.find('[data-testid="ws-login"]').trigger('click')
    await flushPromises()

    expect(login).toHaveBeenCalledTimes(1)
    expect(showError.value).toBe(false)
    wrapper.unmount()
  })

  it('Android pending File 导入后自动 startProcessingJob exactly once（不重复建 Job）', async () => {
    nativeImportState.onPendingFile = null
    mountWorkspace('data', { authenticated: true })
    await flushPromises()
    const onPendingFile = nativeImportState.onPendingFile
    expect(onPendingFile).toBeTypeOf('function')
    const file = new File(['x'], 'a.wotbreplay')
    const pending = { pendingId: 'pending-uuid-1', name: 'a.wotbreplay', uri: 'content://p', size: 1 }
    expect(replayState.startProcessingJob).not.toHaveBeenCalled()
    await expect(onPendingFile(file, pending)).resolves.toBe(true)
    await flushPromises()
    expect(replayState.updateFiles).toHaveBeenCalledWith([file])
    expect(replayState.startProcessingJob).toHaveBeenCalledTimes(1)
    // pending identity 必须作为 operationId 传给 server（跨 process death 重放拿回同一个 job）
    expect(replayState.startProcessingJob).toHaveBeenCalledWith({ operationId: 'pending-uuid-1' })
  })

  it('Android pending replay 未被 server 受理时不 ACK（回调返回 false）', async () => {
    replayState.startProcessingJob.mockResolvedValueOnce({ accepted: false, reason: 'REQUEST_FAILED' })
    mountWorkspace('data', { authenticated: true })
    await flushPromises()
    const file = new File(['x'], 'a.wotbreplay')
    await expect(nativeImportState.onPendingFile(file)).resolves.toBe(false)
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
    replayState.processingJobId.value = 'job-1'
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
    replayState.processingJobId.value = 'job-1'
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
    replayState.processingJobId.value = 'job-1'
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
    replayState.processingJobId.value = 'job-1'
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

  it('Case1（生产）：playback tab 上传单 replay → READY 后自动 prepare + 显示，无需切 tab', async () => {
    let resolveRA
    replayState.requestDirectAction.mockImplementation(() => new Promise((res) => { resolveRA = res }))
    const file = new File(['x'], 'a.wotbreplay')
    replayState.files.value = []
    replayState.resp.value = null
    replayState.processingJobId.value = null
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    replayState.updateFiles([file])
    await flushPromises()
    expect(replayState.requestDirectAction).toHaveBeenCalledTimes(1)
    replayState.processingJobId.value = 'job-1'
    replayState.resp.value = { leagueMode: false, aggregate: [], battles: [{ sourceId: 'r0', mapName: 'Lagoon', players: [] }] }
    await flushPromises()
    resolveRA({ processingJobId: 'job-1', sourceId: 'r0' })
    await flushPromises()
    const pb = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(pb.props('processingJobId')).toBe('job-1')
    expect(pb.props('sourceId')).toBe('r0')
    expect(replayState.requestDirectAction).toHaveBeenCalledTimes(1)
  })

  it('Case2（生产）：data READY → playback → data，resp/files/processingJobId 保留、无空状态', async () => {
    const file = new File(['x'], 'a.wotbreplay')
    replayState.files.value = [file]
    replayState.processingJobId.value = 'job-1'
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
    expect(replayState.processingJobId.value).toBe('job-1')
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
  })

  it('currentBattleId 跨 capability 保持（data → playback → data 不丢选中单场）', async () => {
    const files = [new File(['x'], 'f0.wotbreplay'), new File(['x'], 'f1.wotbreplay'), new File(['x'], 'f2.wotbreplay')]
    replayState.files.value = files
    replayState.processingJobId.value = 'job-1'
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
})
