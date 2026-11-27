// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import AiReviewPanel from './AiReviewPanel.vue'
import {
  projectionA, mountAiReviewPanel, emptySseResponse, sseFrame, sseFromFrames,
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


describe('AiReviewPanel failure states', () => {
  it.each([
    [503, 'AI_REVIEW_BUSY', 'busy', 'recon.errors.AI_REVIEW_BUSY'],
    [502, 'AI_UPSTREAM_UNAVAILABLE', 'upstream', 'errors.ai_upstream_unavailable'],
    [502, 'AI_NOT_CONFIGURED', 'not_configured', 'recon.errors.AI_NOT_CONFIGURED'],
  ])('HTTP %s %s → kind=%s 文案=%s', async (status, code, kind, messageKey) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: async () => JSON.stringify({
        errorCode: code, errorMsg: null, status, id: `err-${status}`,
        retryable: false, details: {}, timestamp: '2026-08-30T15:30:00Z'
      })
    }))
    const wrapper = mountPanel({ projection: projectionA })
    await wrapper.find('.ai-analyze').trigger('click')
    await vi.waitFor(() => expect(wrapper.vm.failure).toBeTruthy())
    expect(wrapper.vm.failure.kind).toBe(kind)
    expect(wrapper.vm.failure.message).toContain(messageKey)
    vi.unstubAllGlobals()
  })

  it('网络不可达 → upstream 失败态，并声明其它分析功能不受影响', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const wrapper = mountPanel({ projection: projectionA })
    await wrapper.find('.ai-analyze').trigger('click')
    await vi.waitFor(() => expect(wrapper.vm.failure).toBeTruthy())
    expect(wrapper.vm.failure.kind).toBe('upstream')
    const banner = wrapper.find('[data-test="ai-error"]')
    expect(banner.text()).toContain('errors.network_error')
    expect(banner.text()).toContain('recon.failure_scope_note')
    vi.unstubAllGlobals()
  })

  it('成功响应但未收到 done（断流）→ 返回格式异常，不静默成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptySseResponse()))
    const wrapper = mountPanel({ projection: projectionA })
    await wrapper.find('.ai-analyze').trigger('click')
    await flushPromises()
    expect(wrapper.vm.failure.kind).toBe('malformed')
    expect(wrapper.vm.failure.message).toBe('recon.errors.AI_RESPONSE_INVALID')
    expect(wrapper.vm.analysisResult).toBeNull()
    vi.unstubAllGlobals()
  })

  it('用户取消 → 中性 info 失败态，不是错误；可重试', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      if (String(url).includes('/cancel')) return Promise.resolve({ ok: true, status: 200 })
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const aborted = new Error('aborted')
          aborted.name = 'AbortError'
          reject(aborted)
        }, { once: true })
      })
    }))
    const wrapper = mountPanel({ projection: projectionA })
    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    await wrapper.find('.ai-cancel').trigger('click')
    await flushPromises()

    expect(wrapper.vm.failure.kind).toBe('cancelled')
    expect(wrapper.vm.failure.message).toBe('recon.cancelled')
    expect(wrapper.find('[data-testid="ai-retry"]').exists()).toBe(false)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('未归类的原始运行时错误不进入 UI：只显示 canonical 文案，原文进 console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mountPanel({ projection: projectionA })
    const run = {
      controller: new AbortController(), correlationId: 'corr-raw', startedAt: Date.now(),
      timeoutTimer: null, cancelRequested: false, timedOut: false,
    }
    const failure = wrapper.vm.__classify(new Error('Component is missing template or render function'), run)

    expect(failure.kind).toBe('client')
    expect(failure.message).toBe('recon.errors.AI_CLIENT_ERROR')
    expect(failure.message).not.toContain('missing template')
    expect(failure.id).toBe('')
    expect(warn).toHaveBeenCalled()

    wrapper.vm.failure = failure
    await nextTick()
    const banner = wrapper.find('[data-test="ai-error"]')
    expect(banner.text()).toContain('recon.errors.AI_CLIENT_ERROR')
    expect(banner.text()).not.toContain('missing template')
    warn.mockRestore()
  })

  it('已登录但缺 realm role → 显式权限态，不渲染 Analyze、不发请求、不给重试', async () => {
    authToken.value = { realm_access: { roles: ['some-other-role'] } }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })
    await nextTick()

    const permission = wrapper.find('[data-testid="ai-permission-required"]')
    expect(permission.exists()).toBe(true)
    expect(permission.text()).toContain('recon.permission_missing')
    expect(wrapper.find('.ai-action-row').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    authToken.value = { realm_access: { roles: ['wotbtools-admin'] } }
    await nextTick()
    expect(wrapper.find('.ai-action-row').exists()).toBe(true)
    authToken.value = { realm_access: { roles: ['wotbtools-user'] } }
    vi.unstubAllGlobals()
  })

  it('失败后已到达的部分正文不丢弃，但明确标注不完整', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseFromFrames(
      sseFrame('call2_token', { delta: '已生成的一半' }),
      sseFrame('error', { id: 'corr-9', errorCode: 'AI_UPSTREAM_UNAVAILABLE', errorMsg: null }),
    )))
    const wrapper = mountPanel({ projection: projectionA })
    await wrapper.find('.ai-analyze').trigger('click')
    await flushPromises()

    const partial = wrapper.find('[data-testid="ai-partial"]')
    expect(partial.exists()).toBe(true)
    expect(partial.text()).toContain('已生成的一半')
    expect(partial.text()).toContain('recon.partial_incomplete')
    vi.unstubAllGlobals()
  })

  it('完成后只保留格式化报告，不再并列显示原始流正文', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseFromFrames(
      sseFrame('call2_token', { delta: '## 复盘\n**关键转折**' }),
      sseFrame('done', { analysis: '## 复盘\n**关键转折**', preBattleSection: '' }),
    )))
    const wrapper = mountPanel({ projection: projectionA })
    await wrapper.find('.ai-analyze').trigger('click')
    await flushPromises()
    expect(wrapper.find('.result-stub').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-partial"]').exists()).toBe(false)
    vi.unstubAllGlobals()
  })
})
