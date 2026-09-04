// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { useReplaySession } from '../composables/useReplaySession.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import ReplayWorkspace from './ReplayWorkspace.vue'

// useReplay mock 返回的可变 state 占位：每次 beforeEach 用 buildState() 以真实 Vue ref 重建。
const hold = vi.hoisted(() => ({ state: null }))
const authState = vi.hoisted(() => ({
  authenticated: true,
  login: vi.fn(),
  initPromise: Promise.resolve(true),
}))

vi.mock('../composables/useReplay.js', () => ({
  useReplay: () => hold.state,
  chooseInitialResultTab: () => 'aggregate',
}))
vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: authState.initPromise,
    isAuthenticated: () => authState.authenticated,
    login: (...args) => authState.login(...args),
  }),
}))
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
vi.mock('./BattlePlaybackPanel.vue', () => ({
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
const nativeImportState = vi.hoisted(() => ({ onPendingFile: null }))
vi.mock('../composables/useNativeReplayImport.js', () => ({
  useNativeReplayImport: (opts) => {
    nativeImportState.onPendingFile = opts?.onPendingFile ?? null
    return { consumePendingWhenReady: vi.fn(() => Promise.resolve(false)) }
  },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k, te: () => true }) }))

/** 以真实 Vue ref/函数构造 useReplay 返回物（保证 files/resp/processingJobId/selectionRevision 响应式）。 */
function buildState() {
  const session = useReplaySession()
  return {
    ...session,
    session,
    updateFiles: vi.fn((next) => {
      session.replaceSelection(next)
    }),
    startProcessingJob: vi.fn(),
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

function mountWorkspace(capability = 'data', { authenticated = true, login = vi.fn(), authInit } = {}) {
  authState.authenticated = authenticated
  authState.login = login
  authState.initPromise = authInit || Promise.resolve(authenticated)
  return mount(ReplayWorkspace, {
    props: { initialCapability: capability },
    global: {
      provide: { [NAVIGATE_VIEW_KEY]: vi.fn() },
      mocks: { $t: (k) => k },
    },
  })
}

describe('ReplayWorkspace', () => {
  beforeEach(() => {
    replayState = buildState()
    hold.state = replayState
    authState.authenticated = true
    authState.login = vi.fn()
    authState.initPromise = Promise.resolve(true)
    vi.clearAllMocks()
  })

  it('始终渲染三个 capability tabs（不因 capability 不可用而消失）', () => {
    const wrapper = mountWorkspace('data')
    const tabs = wrapper.findAll('[data-testid="ws-tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs.map(t => t.attributes('data-cap'))).toEqual(['data', 'ai', 'playback'])
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-pane"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="playback-pane"]').exists()).toBe(true)
  })

  it('Data page 通过显式 props 消费 Workspace 唯一 replay/session owner', () => {
    const wrapper = mountWorkspace('data')
    const dataVm = wrapper.findComponent({ name: 'ReplayPageMock' })
    expect(dataVm.props('embedded')).toBe(true)
    expect(dataVm.props('replayContext')).toBe(replayState)
    expect(dataVm.props('workspaceContext')).toBeTruthy()
  })

  it('切到 AI 能力时准备 Dataset 引用（同一 source，不重传）', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'job-1'
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="ai-pane"]').text()).toContain('job-1|r0|')
    expect(replayState.requestDirectAction).toHaveBeenCalled()
  })

  it('AI 与 Playback 状态隔离：AI 失败不隐藏 Playback tab，也不写 Playback 错误', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'job-1'
    replayState.requestDirectAction.mockRejectedValueOnce(new Error('AI_TIMELINE_UNUSABLE'))
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-pane"]').text()).not.toContain('job-1|r0|')
    expect(wrapper.find('[data-test="playback-pane"]').text()).not.toContain('AI_TIMELINE_UNUSABLE')
  })

  it('传入 initialCapability=playback 时初始聚焦 Playback', () => {
    const wrapper = mountWorkspace('playback')
    const playback = wrapper.find('[data-test="playback-pane"]')
    expect(playback.exists()).toBe(true)
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
  })

  it('未登录进入任意 replay capability（data/ai/playback）都自动跳 Keycloak 并回原 capability', async () => {
    const cases = [
      { cap: 'data', view: 'replay' },
      { cap: 'ai', view: 'ai-review' },
      { cap: 'playback', view: 'battle-playback' },
    ]
    for (const c of cases) {
      const login = vi.fn()
      const wrapper = mountWorkspace(c.cap, { authenticated: false, login })
      await flushPromises()
      expect(login).toHaveBeenCalledWith(c.view)
      wrapper.unmount()
    }
  })

  it('AI 与 Playback 无业务耦合：AI seek 事件不影响 capability（不切到 Playback）', async () => {
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'job-1'
    const wrapper = mountWorkspace('data')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    const aiPanelVm = wrapper.findComponent({ name: 'AiReviewPanelMock' })
    expect(aiPanelVm.exists()).toBe(true)
    aiPanelVm.vm.$emit('seek', 123)
    await flushPromises()
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').classes()).toContain('active')
    expect(wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').classes()).not.toContain('active')
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
    wrapper.unmount()
  })

  it('auth init 完成后 authenticated=false 时仅调用一次 login', async () => {
    let resolveInit
    const authInit = new Promise((r) => { resolveInit = r })
    const login = vi.fn()
    const wrapper = mountWorkspace('ai', { authenticated: false, login, authInit })
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    resolveInit()
    await flushPromises()
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith('ai-review')
    wrapper.unmount()
  })

  it('Android pending File 导入后自动 startProcessingJob exactly once（不重复建 Job）', async () => {
    nativeImportState.onPendingFile = null
    mountWorkspace('data', { authenticated: true })
    await flushPromises()
    const onPendingFile = nativeImportState.onPendingFile
    expect(onPendingFile).toBeTypeOf('function')
    const file = new File(['x'], 'a.wotbreplay')
    expect(replayState.startProcessingJob).not.toHaveBeenCalled()
    await onPendingFile(file)
    await flushPromises()
    expect(replayState.updateFiles).toHaveBeenCalledWith([file])
    expect(replayState.startProcessingJob).toHaveBeenCalledTimes(1)
  })

  it('回归：选 #8（header selector）→ 切 AI / Playback 均消费 #8（选中单场持久，不随视图切换丢失）', async () => {
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
    await wrapper.find('[data-testid="ws-batch-selector"]').trigger('click')
    const items = wrapper.findAll('.ws-batch-item')
    expect(items).toHaveLength(9)
    await items[7].trigger('click')
    await flushPromises()
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    const aiVm = wrapper.findComponent({ name: 'AiReviewPanelMock' })
    expect(aiVm.exists()).toBe(true)
    expect(aiVm.props('file')?.name).toBe('f7.wotbreplay')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    const pbVm = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(pbVm.exists()).toBe(true)
    expect(pbVm.props('file')?.name).toBe('f7.wotbreplay')
  })

  it('selector 只列有效 parsed battles（failed/duplicate 不列出）；选第二个有效 battle 得 sourceId r2 / files[2]', async () => {
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
    const wrapper = mountWorkspace('data')
    await flushPromises()
    await wrapper.find('[data-testid="ws-batch-selector"]').trigger('click')
    const items = wrapper.findAll('.ws-batch-item')
    expect(items).toHaveLength(2)
    expect(items.map(i => i.text()).join(',')).not.toContain('f1.wotbreplay')
    await items[1].trigger('click')
    await flushPromises()
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    const aiVm = wrapper.findComponent({ name: 'AiReviewPanelMock' })
    expect(aiVm.props('file')?.name).toBe('f2.wotbreplay')
  })

  it('布局：header 无 batch-selector / top capability status flags；source section 承载批次 + 当前回放 selector', async () => {
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
    expect(wrapper.find('.workspace-header [data-testid="ws-batch-selector"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="cap-base"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="cap-ai"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="cap-playback"]').exists()).toBe(false)
    expect(wrapper.find('.replay-source').exists()).toBe(true)
    expect(wrapper.find('.replay-source [data-testid="ws-batch-selector"]').exists()).toBe(true)
    expect(wrapper.find('.replay-source').text()).toContain('workspace.batch_count')
  })

  it('Data → FileUploader allowFolder=true；AI / Playback → allowFolder=false', async () => {
    const files = [new File(['x'], 'a.wotbreplay')]
    replayState.files.value = files
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const uploader = wrapper.findComponent({ name: 'FileUploaderMock' })
    expect(uploader.props('allowFolder')).toBe(true)

    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(uploader.props('allowFolder')).toBe(false)

    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    expect(uploader.props('allowFolder')).toBe(false)
  })

  it('已有 34-file batch → 切 AI：files.length 仍 34、currentBattleId 不变、AI 消费当前 battle', async () => {
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
    await wrapper.find('[data-testid="ws-batch-selector"]').trigger('click')
    await wrapper.findAll('.ws-batch-item')[7].trigger('click')
    await flushPromises()
    expect(replayState.files.value.length).toBe(34)
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    expect(replayState.files.value.length).toBe(34)
    const aiVm = wrapper.findComponent({ name: 'AiReviewPanelMock' })
    expect(aiVm.props('file')?.name).toBe('f7.wotbreplay')
  })

  it('AI / Playback 主动选择新 single replay → updateFiles 收到仅该 replay（replace，不 merge 原 batch）', async () => {
    replayState.files.value = Array.from({ length: 34 }, (_, i) => new File(['x'], `f${i}.wotbreplay`))
    const wrapper = mountWorkspace('ai')
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
    await wrapper.find('[data-testid="ws-batch-selector"]').trigger('click')
    await wrapper.findAll('.ws-batch-item')[1].trigger('click')
    await flushPromises()
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    const pb = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(pb.props('file')?.name).toBe('f2.wotbreplay')
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="data"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-batch-selector"]').exists()).toBe(true)
  })
})
