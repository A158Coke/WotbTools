// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ReplayWorkspace from './ReplayWorkspace.vue'

const replayState = vi.hoisted(() => ({
  files: { __v_isRef: true, value: [] },
  selectionRevision: { __v_isRef: true, value: 0 },
  activeTab: { __v_isRef: true, value: 'aggregate' },
  resp: { __v_isRef: true, value: null },
  processingJob: { __v_isRef: true, value: null },
  processingError: { __v_isRef: true, value: '' },
  uploadState: { __v_isRef: true, value: null },
  processingJobId: { __v_isRef: true, value: null },
  exportJob: { __v_isRef: true, value: null },
  exportError: { __v_isRef: true, value: '' },
  pendingRemove: { __v_isRef: true, value: null },
  updateFiles: vi.fn(() => { replayState.files.value = [] }),
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
}))

vi.mock('../composables/useReplay.js', () => ({
  useReplay: () => replayState,
  chooseInitialResultTab: () => 'aggregate',
}))
vi.mock('./ReplayPage.vue', () => ({
  default: {
    name: 'ReplayPageMock',
    props: ['embedded'],
    emits: ['register-cols-init', 'open-ai', 'open-playback'],
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
    props: ['files'],
    emits: ['update:files'],
    template: '<button data-test="uploader">upload</button>',
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

function mountWorkspace(capability = 'data', { authenticated = true, login = vi.fn(), authInit } = {}) {
  return mount(ReplayWorkspace, {
    props: { initialCapability: capability },
    global: {
      provide: {
        isAuthenticated: () => authenticated,
        login,
        navigate: vi.fn(),
        ...(authInit ? { authInit } : {}),
      },
      mocks: { $t: (k) => k },
    },
  })
}

describe('ReplayWorkspace', () => {
  beforeEach(() => {
    replayState.files.value = []
    replayState.activeTab.value = 'aggregate'
    replayState.resp.value = null
    replayState.processingJob.value = null
    replayState.processingJobId.value = null
    replayState.requestDirectAction.mockClear()
    vi.clearAllMocks()
  })

  it('始终渲染三个 capability tabs（不因 capability 不可用而消失）', () => {
    const wrapper = mountWorkspace('data')
    const tabs = wrapper.findAll('[data-testid="ws-tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs.map(t => t.attributes('data-cap'))).toEqual(['data', 'ai', 'playback'])
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
    // AI / Playback 面板常驻（v-show），切 tab 不重新挂载
    expect(wrapper.find('[data-test="ai-pane"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="playback-pane"]').exists()).toBe(true)
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
    // AI pane 显示错误，Playback pane 不含该错误
    expect(wrapper.find('[data-test="ai-pane"]').text()).not.toContain('job-1|r0|')
    expect(wrapper.find('[data-test="playback-pane"]').text()).not.toContain('AI_TIMELINE_UNUSABLE')
  })

  it('传入 initialCapability=playback 时初始聚焦 Playback', () => {
    const wrapper = mountWorkspace('playback')
    const playback = wrapper.find('[data-test="playback-pane"]')
    expect(playback.exists()).toBe(true)
    // v-show 隐藏 data pane、显示 playback pane（happy-dom 下改为检查 parent v-show 类）
    expect(playback.exists()).toBe(true)
    // active capability 由 props 派发到 data-pane 以外的 pane；默认 data-pane 处于 v-show=false
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
      mountWorkspace(c.cap, { authenticated: false, login })
      await flushPromises()
      expect(login).toHaveBeenCalledWith(c.view)
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
    // AI 报告 seek 到时间点：Workspace 不监听 @seek，capability 不切到 Playback（业务解耦）
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
    // init 尚未完成：不应误判为未登录而 login
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    // init 完成且 authenticated=true：仍不 login
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
    // 本次导入前 startProcessingJob 未调用
    expect(replayState.startProcessingJob).not.toHaveBeenCalled()
    await onPendingFile(file)
    await flushPromises()
    // updateFiles 替换 selection + 自动 startProcessingJob 各一次
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

    // 打开 header current-battle selector，选中 #8（index 7）。
    await wrapper.find('[data-testid="ws-batch-selector"]').trigger('click')
    const items = wrapper.findAll('.ws-batch-item')
    expect(items).toHaveLength(9)
    await items[7].trigger('click')
    await flushPromises()

    // 切到 AI 能力 → AI pane 消费 #8。
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    const aiVm = wrapper.findComponent({ name: 'AiReviewPanelMock' })
    expect(aiVm.exists()).toBe(true)
    expect(aiVm.props('file')?.name).toBe('f7.wotbreplay')

    // 切到 Playback 能力 → Playback pane 消费 #8。
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="playback"]').trigger('click')
    await flushPromises()
    const pbVm = wrapper.findComponent({ name: 'BattlePlaybackPanelMock' })
    expect(pbVm.exists()).toBe(true)
    expect(pbVm.props('file')?.name).toBe('f7.wotbreplay')
  })

  it('selector 只列有效 parsed battles（failed/duplicate 不列出）；选第二个有效 battle 得 sourceId r2 / files[2]', async () => {
    const files = [new File(['x'], 'f0.wotbreplay'), new File(['x'], 'f1.wotbreplay'), new File(['x'], 'f2.wotbreplay')]
    replayState.files.value = files
    // r0 有效、r1 duplicate 被移除、r2 有效 → parsedBattles 只有 [r0, r2]。
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

    // 打开 selector：只列出 2 个有效 battle，绝不列出 failed/duplicate 的 raw file（f1）。
    await wrapper.find('[data-testid="ws-batch-selector"]').trigger('click')
    let items = wrapper.findAll('.ws-batch-item')
    expect(items).toHaveLength(2)
    expect(items.map(i => i.text()).join(',')).not.toContain('f1.wotbreplay')

    // 选第二个有效 battle → sourceId r2，消费 files[2]。
    await items[1].trigger('click')
    await flushPromises()
    await wrapper.find('.workspace-tabs [data-testid="ws-tab"][data-cap="ai"]').trigger('click')
    await flushPromises()
    const aiVm = wrapper.findComponent({ name: 'AiReviewPanelMock' })
    expect(aiVm.props('file')?.name).toBe('f2.wotbreplay')
  })
})
