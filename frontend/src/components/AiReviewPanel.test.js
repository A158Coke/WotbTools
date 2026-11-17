// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import AiReviewPanel from './AiReviewPanel.vue'
import {
  AI_REVIEWS_URL, AI_WIRE_LOCALE, projectionA, mountAiReviewPanel, requestBody,
  emptySseResponse, sseFrame, sseFromFrames,
} from '../test/AiReviewPanelTestHelpers.js'

const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key, params) => key === 'errors.diagnostic_id' ? `diagnostic:${params.id}` : key,
    te: key => key.startsWith('errors.'),
    locale: { value: 'zh' }
  })
}))

/** 角色由测试改写：`tokenParsed` 是 ref，组件只读 `realm_access.roles`。 */
const authToken = ref({ realm_access: { roles: ['wotbtools-user'] } })

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: authToken,
    token: () => 'test-token',
    ensureToken: vi.fn().mockResolvedValue(true),
    login: vi.fn(),
  })
}))

const mountPanel = (props = {}) => mountAiReviewPanel(mount, AiReviewPanel, props)

describe('AiReviewPanel workspace layout ownership', () => {
  it('.ai-review-panel 存在且包含 .ai-action-row（Action 与 Result 同属一个父容器）', () => {
    const wrapper = mountPanel()
    const panel = wrapper.find('.ai-review-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.find('.ai-action-row').exists()).toBe(true)
    expect(panel.find('.ai-action-row .lg').exists()).toBe(true)
  })

  it('Streaming 面板与 Analysis Result 都是 .ai-review-panel 的子节点（共享同一 width owner）', async () => {
    const wrapper = mountPanel()
    const panel = wrapper.find('.ai-review-panel')

    // 流式状态：.ai-streaming 渲染在 .ai-review-panel 内部
    wrapper.vm.analyzing = true
    await nextTick()
    expect(panel.find('.ai-streaming').exists()).toBe(true)
    expect(wrapper.find('.ai-streaming').element.parentElement.classList.contains('ai-review-panel')).toBe(true)
    expect(panel.find('.stream-spinner').exists()).toBe(true)

    // 结果状态：AnalysisResultPanel 渲染在 .ai-review-panel 内部
    wrapper.vm.analyzing = false
    wrapper.vm.analysisResult = { analysis: '复盘正文' }
    await nextTick()
    expect(panel.find('.result-stub').exists()).toBe(true)
    expect(panel.find('.result-stub').text()).toContain('复盘正文')
    expect(wrapper.find('.result-stub').element.parentElement.classList.contains('ai-review-panel')).toBe(true)
  })

  it('未选择文件时显示空态提示（不渲染 AI 布局）', () => {
    const wrapper = mountPanel({ file: null })
    expect(wrapper.find('.ws-note').exists()).toBe(true)
    expect(wrapper.find('.ai-action-row').exists()).toBe(false)
  })

  it('capability=AVAILABLE_WITH_LIMITED_TIMELINE → 展示受限时间轴降级提示（不猜测未观测事实）', async () => {
    const wrapper = mountPanel()
    wrapper.vm.analysisResult = { analysis: '复盘正文', capability: 'AVAILABLE_WITH_LIMITED_TIMELINE' }
    await nextTick()
    const note = wrapper.find('[data-test="ai-capability-limited"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('recon.capability_limited')
  })
})

// ---- 客户端投影路径：POST /api/ai/reviews，body 恰为 AiReviewRequest（gzip，不上传回放）----

describe('AiReviewPanel projection request', () => {
  it('请求体恰为 AiReviewRequest：结算事实 + canonical 投影，gzip 发送（无回放字节 / dataset 引用）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptySseResponse())
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(AI_REVIEWS_URL)
    expect(url).not.toContain('?')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.headers['Content-Encoding']).toBe('gzip')
    const body = await requestBody(fetchMock.mock.calls[0])
    expect(body).toEqual({
      locale: AI_WIRE_LOCALE,
      correlationId: expect.any(String),
      battle: projectionA.battle,
      projection: projectionA.projection,
    })
    // dataset 时代的 wire shape 不得回归：键集精确等于契约字段。
    expect(Object.keys(body).sort()).toEqual([
      'battle', 'correlationId', 'locale', 'projection',
    ])
    expect(body).not.toHaveProperty('processingJobId')
    expect(body).not.toHaveProperty('sourceId')
    expect(body).not.toHaveProperty('lang')
    vi.unstubAllGlobals()
  })

  it.each([
    [401, 'AUTH_UNAUTHENTICATED', 'errors.auth_unauthenticated'],
    [403, 'AUTH_FORBIDDEN', 'errors.auth_forbidden'],
    [429, 'RATE_LIMITED', 'errors.rate_limited'],
    [503, 'SERVICE_UNAVAILABLE', 'errors.service_unavailable'],
    [504, 'UPSTREAM_TIMEOUT', 'errors.upstream_timeout'],
    [500, 'INTERNAL_ERROR', 'errors.internal_error'],
    [502, 'AI_REVIEW_SCHEMA_FAILED', 'recon.errors.AI_REVIEW_SCHEMA_FAILED'],
  ])('HTTP %s renders the canonical AI error category', async (status, code, messageKey) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: async () => JSON.stringify({
        errorCode: code, errorMsg: null, status, id: `err-${status}`,
        retryable: status === 429 || status >= 500, details: {}, timestamp: '2026-08-30T15:30:00Z'
      })
    }))
    const wrapper = mountPanel({ projection: projectionA })
    await wrapper.find('.ai-analyze').trigger('click')
    await vi.waitFor(() => expect(wrapper.vm.failure).toBeTruthy())
    expect(wrapper.vm.failure.message).toContain(messageKey)
    expect(wrapper.vm.failure.id).toBe(`err-${status}`)
    vi.unstubAllGlobals()
  })

  it('展示并支持复制 SSE canonical error ID，同时保留用户可读错误文案', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    vi.stubGlobal('navigator', { clipboard })
    const wrapper = mountPanel({ projection: projectionA })
    wrapper.vm.failure = {
      kind: 'upstream', code: 'AI_REVIEW_GROUNDING_FAILED', id: 'corr-123',
      message: 'recon.errors.AI_REVIEW_GROUNDING_FAILED',
    }
    await nextTick()

    const errorPanel = wrapper.find('[data-test="ai-error"]')
    expect(errorPanel.text()).toContain('recon.errors.AI_REVIEW_GROUNDING_FAILED')
    expect(errorPanel.text()).toContain('diagnostic:corr-123')
    await errorPanel.find('.ai-failure-copy').trigger('click')
    await flushPromises()
    expect(clipboard.writeText).toHaveBeenCalledWith('corr-123')
    expect(errorPanel.text()).toContain('errors.diagnostic_id_copied')
    vi.unstubAllGlobals()
  })

  it('保留 SSE canonical error 的用户文案与 correlationId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseFromFrames(
      sseFrame('error', { id: 'corr-123', errorCode: 'AI_REVIEW_GROUNDING_FAILED', errorMsg: null })
    )))
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click')
    await flushPromises()

    expect(wrapper.vm.failure.message).toContain('recon.errors.AI_REVIEW_GROUNDING_FAILED')
    expect(wrapper.vm.failure.id).toBe('corr-123')
    vi.unstubAllGlobals()
  })

  it('pre-response deadline abort renders AI_TIMEOUT instead of generic cancellation', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes('/cancel')) return Promise.resolve({ ok: true, status: 200 })
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const aborted = new Error('aborted before headers')
          aborted.name = 'AbortError'
          reject(aborted)
        }, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click')
    await vi.advanceTimersByTimeAsync(1_100_000)
    await flushPromises()

    expect(wrapper.vm.failure.kind).toBe('timeout')
    expect(wrapper.vm.failure.message).toBe('recon.errors.AI_TIMEOUT')
    expect(wrapper.vm.analyzing).toBe(false)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('无 projection 引用时拒绝发起请求并显示准备态（不裸抛错误码）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptySseResponse())
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: null })

    // UI 层：投影未就绪时 Analyze 按钮禁用
    const button = wrapper.find('.ai-analyze')
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
    // 状态机层：即使直接调用动作，ready guard 也必须拒绝
    await wrapper.vm.runAnalyze()
    await nextTick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.vm.analyzing).toBe(false)
    expect(wrapper.find('[data-test="ai-error"]').exists()).toBe(false)
    const status = wrapper.find('[data-test="ai-projection-status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('workspace.dataset_preparing')
    vi.unstubAllGlobals()
  })
})

// ---- 投影就绪状态：本地解析/投影生命周期，不是 AI 模型错误 ----

describe('AiReviewPanel projection readiness', () => {
  it('projection 为 null → 渲染 ai-projection-status 准备态（workspace.dataset_preparing）', () => {
    const wrapper = mountPanel({ projection: null })
    const status = wrapper.find('[data-test="ai-projection-status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('workspace.dataset_preparing')
    expect(wrapper.find('.ai-projection-error').exists()).toBe(false)
  })

  it('projectionError 存在 → 展示该已本地化文案并提供重建投影动作', async () => {
    const wrapper = mountPanel({ projection: null, projectionError: 'errors.replay_parse_failed' })
    const status = wrapper.find('[data-test="ai-projection-status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('errors.replay_parse_failed')
    expect(status.classes()).toContain('is-danger')
    await wrapper.find('[data-testid="ai-projection-retry"]').trigger('click')
    expect(wrapper.emitted('rebuild-projection')).toHaveLength(1)
  })

  it('投影准备中 → info 语气（不是错误）', () => {
    const wrapper = mountPanel({ projection: null })
    expect(wrapper.find('[data-test="ai-projection-status"]').classes()).toContain('is-info')
  })

  it('projection 就绪后不再渲染准备态状态块', () => {
    const wrapper = mountPanel({ projection: projectionA })
    expect(wrapper.find('[data-test="ai-projection-status"]').exists()).toBe(false)
    expect(wrapper.find('.ai-action-row').exists()).toBe(true)
  })

  it('SSE error 事件 → 展示本地化错误与 diagnostic id；AI 不再拥有 dataset lease（不 emit dataset-recover）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseFromFrames(
      sseFrame('error', { id: 'corr-404', errorCode: 'AI_TIMELINE_UNUSABLE', errorMsg: null })
    )))
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click')
    await flushPromises()

    // 用户可见文案被本地化，且诊断 ID 可用于排障。
    expect(wrapper.vm.failure.message).toContain('errors.ai_timeline_unusable')
    expect(wrapper.vm.failure.id).toBe('corr-404')
    expect(wrapper.find('[data-test="ai-error"]').text()).toContain('errors.ai_timeline_unusable')
    expect(wrapper.vm.analyzing).toBe(false)
    // 投影（dataset identity）已由本地解析层拥有：组件不得再发 recover 事件。
    expect(wrapper.emitted('dataset-recover')).toBeFalsy()
    expect(wrapper.emitted('seek')).toBeFalsy()
    vi.unstubAllGlobals()
  })
})

it('offline Analyze issues zero requests; reconnect requires another explicit Analyze action', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  connectivityState.state.value = 'offline'
  const wrapper = mountPanel({ projection: projectionA })
  await wrapper.find('.ai-analyze').trigger('click')
  await flushPromises()
  expect(fetchMock).not.toHaveBeenCalled()
  connectivityState.state.value = 'online'
  await flushPromises()
  expect(fetchMock).not.toHaveBeenCalled()
  wrapper.unmount()
  vi.unstubAllGlobals()
})
