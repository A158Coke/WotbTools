// @vitest-environment happy-dom

import { gunzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AiReviewPanel from './AiReviewPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key, params) => key === 'errors.diagnostic_id' ? `diagnostic:${params.id}` : key,
    te: key => key.startsWith('errors.'),
    locale: { value: 'zh' }
  })
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: { value: { realm_access: { roles: ['wotbtools-user'] } } },
    token: () => 'test-token',
    ensureToken: vi.fn().mockResolvedValue(true),
    login: vi.fn(),
  })
}))

/** AI Review transport 端点（`/api/ai/**` 由 api/ai-review.ts 拥有）。 */
const AI_REVIEWS_URL = '/api/ai/reviews'
/**
 * 契约 locale：mock 的 UI locale 是 'zh'，`toAiReviewLocale` 收敛为白名单值 'zh-CN'。
 * 断言该值即证明组件发出的是 wire 契约 locale，而不是原样透传 UI locale。
 */
const AI_WIRE_LOCALE = 'zh-CN'

/** 客户端 AI 输入（battle + canonical projection）——两个 identity（A / B）用于 run ownership 测试。 */
const projectionA = { battle: { id: 'battle-A' }, projection: { id: 'proj-A' } }
const projectionB = { battle: { id: 'battle-B' }, projection: { id: 'proj-B' } }

/**
 * 统一的挂载 helper：
 *  - ReplayAnalysisAction 被替换为保留相同 DOM 契约（.ai-action > .lg）的 stub，
 *    使「Action 与 Result 同属 .ai-review-panel」布局断言与点击驱动测试共用同一 mount；
 *  - AnalysisResultPanel 同样 stub 以暴露 .result-stub。
 */
function mountPanel(props = {}) {
  return mount(AiReviewPanel, {
    props: { file: { name: 'a.wotbreplay' }, ...props },
    global: {
      mocks: {
        $t: (key, params) => key === 'errors.diagnostic_id' ? `diagnostic:${params.id}` : key
      },
      stubs: {
        ReplayAnalysisAction: {
          props: ['analyzing', 'disabled'],
          emits: ['analyze', 'cancel'],
          template: '<div class="ai-action">'
            + '<button class="lg ai-analyze" :disabled="analyzing || disabled" @click="$emit(&apos;analyze&apos;)">analyze</button>'
            + '<button v-if="analyzing" class="cancel ai-cancel" type="button" @click="$emit(&apos;cancel&apos;)">cancel</button>'
            + '</div>'
        },
        AnalysisResultPanel: {
          props: ['result'],
          template: '<div class="result-stub">{{ result.analysis }}</div>'
        }
      }
    }
  })
}

/** `/api/ai/reviews` 的请求调用（排除 cancel 端点）。 */
function analyzeCalls(fetchMock) {
  return fetchMock.mock.calls.filter(([u]) => String(u) === AI_REVIEWS_URL)
}

/** cancel 端点的请求 URL 列表（cancel 是 path 参数：/api/ai/reviews/{correlationId}/cancel）。 */
function cancelCalls(fetchMock) {
  return fetchMock.mock.calls
    .filter(([u]) => String(u).includes('/cancel'))
    .map(([u]) => String(u))
}

const cancelUrl = correlationId => `${AI_REVIEWS_URL}/${encodeURIComponent(correlationId)}/cancel`

/** 请求体以 gzip Blob 发送：解压回原样 JSON */
const requestBody = async call => JSON.parse(gunzipSync(new Uint8Array(await call[1].body.arrayBuffer())).toString('utf8'))

/** 空 SSE 响应（立即 done）。 */
function emptySseResponse() {
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
        releaseLock: () => {}
      })
    }
  }
}

const sseFrame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const sseEvent = (event, data) => new TextEncoder().encode(sseFrame(event, data))

/** 按帧顺序喂给 reader 的 SSE 响应：帧用完后返回 done。 */
function sseFromFrames(...frames) {
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (index < frames.length
          ? { done: false, value: new TextEncoder().encode(frames[index++]) }
          : { done: true, value: undefined }),
        releaseLock: () => {}
      })
    }
  }
}

/** AI 复盘 Workspace 布局所有权：.ai-review-panel 是唯一 width owner，
 *  Action / Error / Streaming / Analysis Result 全部作为其子节点共享同一宽度契约。 */
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

    // 流式状态：.streaming-panel 渲染在 .ai-review-panel 内部
    wrapper.vm.analyzing = true
    await nextTick()
    expect(panel.find('.streaming-panel').exists()).toBe(true)
    expect(wrapper.find('.streaming-panel').element.parentElement.classList.contains('ai-review-panel')).toBe(true)

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

// ---- 客户端投影路径：POST /api/ai/reviews，body 恰为 AiReviewRequestV2（gzip，不上传回放）----

describe('AiReviewPanel projection request', () => {
  it('请求体恰为 AiReviewRequestV2：结算事实 + canonical 投影，gzip 发送（无回放字节 / dataset 引用）', async () => {
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
      schemaVersion: 2,
      locale: AI_WIRE_LOCALE,
      correlationId: expect.any(String),
      battle: projectionA.battle,
      projection: projectionA.projection,
    })
    // dataset 时代的 wire shape 不得回归：键集精确等于契约字段。
    expect(Object.keys(body).sort()).toEqual([
      'battle', 'correlationId', 'locale', 'projection', 'schemaVersion',
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
    [502, 'AI_REVIEW_SCHEMA_FAILED', 'errors.ai_review_schema_failed'],
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
    await vi.waitFor(() => expect(wrapper.vm.error).toContain(messageKey))
    expect(wrapper.vm.error).toContain(`err-${status}`)
    vi.unstubAllGlobals()
  })

  it('展示并支持复制 SSE canonical error ID，同时保留用户可读错误文案', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    vi.stubGlobal('navigator', { clipboard })
    const wrapper = mountPanel({ projection: projectionA })
    wrapper.vm.error = 'errors.ai_review_grounding_failed'
    wrapper.vm.errorId = 'corr-123'
    await nextTick()

    const errorPanel = wrapper.find('[data-test="ai-error"]')
    expect(errorPanel.text()).toContain('errors.ai_review_grounding_failed')
    expect(errorPanel.text()).toContain('diagnostic:corr-123')
    await errorPanel.find('button').trigger('click')
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

    expect(wrapper.vm.error).toContain('errors.ai_review_grounding_failed')
    expect(wrapper.vm.errorId).toBe('corr-123')
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

    expect(wrapper.vm.error).toBe('recon.errors.AI_TIMEOUT')
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
    expect(wrapper.find('.error').exists()).toBe(false)
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
    expect(status.find('.stream-spinner').exists()).toBe(true)
    expect(wrapper.find('.ai-projection-error').exists()).toBe(false)
  })

  it('projectionError 存在 → 展示该已本地化文案并带 ai-projection-error class（不再显示 spinner）', () => {
    const wrapper = mountPanel({ projection: null, projectionError: 'errors.replay_parse_failed' })
    const status = wrapper.find('[data-test="ai-projection-status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toBe('errors.replay_parse_failed')
    expect(status.find('.ai-projection-error').exists()).toBe(true)
    expect(status.find('.stream-spinner').exists()).toBe(false)
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
    expect(wrapper.vm.error).toContain('errors.ai_timeline_unusable')
    expect(wrapper.vm.error).toContain('diagnostic:corr-404')
    expect(wrapper.vm.errorId).toBe('corr-404')
    expect(wrapper.find('[data-test="ai-error"]').text()).toContain('errors.ai_timeline_unusable')
    expect(wrapper.vm.analyzing).toBe(false)
    // 投影（dataset identity）已由本地解析层拥有：组件不得再发 recover 事件。
    expect(wrapper.emitted('dataset-recover')).toBeFalsy()
    expect(wrapper.emitted('seek')).toBeFalsy()
    vi.unstubAllGlobals()
  })
})

// ---- 投影 identity 必须进入 AI request ownership ----

describe('AiReviewPanel projection identity ownership', () => {
  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  /** 可控 SSE 响应：reader.read() 的 resolve 时机由测试精确控制（deferred，不用 sleep）。 */
  function controllableSse() {
    const queue = []
    let waiting = null
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            if (queue.length) {
              return Promise.resolve(queue.shift())
            }
            return new Promise(res => { waiting = res })
          },
          releaseLock: () => {}
        })
      },
      _release: (value) => {
        if (waiting) {
          const w = waiting
          waiting = null
          w(value)
        } else {
          queue.push(value)
        }
      }
    }
  }

  it('投影 identity 切换后：旧 A 的迟到 done 不得写 analysisResult / partialAnalysis', async () => {
    const sse = controllableSse()
    const fetchMock = vi.fn().mockResolvedValue(sse)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)

    // 投影 identity 切到 B（file + projection 一起变）
    await wrapper.setProps({ file: { name: 'b.wotbreplay' }, projection: projectionB })
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(false, 'identity 切换后旧请求必须作废，新 generation 可开始')

    // 旧 A 的 SSE 迟到事件：done 载荷不得写回
    sse._release({ done: false, value: sseEvent('done', { analysis: 'OLD A RESULT', preBattleSection: '' }) })
    sse._release({ done: true, value: undefined })
    await flushPromises()

    expect(wrapper.vm.analysisResult).toBeNull('旧 A 的 analysisResult 不得写回')
    expect(wrapper.vm.partialAnalysis).toBe('')
    expect(wrapper.vm.progressStage).toBe('', '旧 A 的迟到事件不得写 progressStage')
    expect(wrapper.vm.error).toBe('')
    vi.unstubAllGlobals()
  })

  it('identity 切换后：旧 A 的迟到错误不得污染新投影', async () => {
    const dA = deferred()
    const fetchMock = vi.fn().mockReturnValue(dA.promise)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    await wrapper.setProps({ projection: projectionB })
    await nextTick()

    dA.reject(new Error('OLD_A_ERROR'))
    await flushPromises()
    expect(wrapper.vm.error).toBe('', 'stale A 的错误不得污染新投影')
    expect(wrapper.vm.analysisResult).toBeNull()
    vi.unstubAllGlobals()
  })

  it('identity 切换后新投影可立即发起分析；旧 finally 不覆盖新 loading', async () => {
    const sseA = controllableSse()
    const sseB = controllableSse()
    let analyzeCall = 0
    const fetchMock = vi.fn((url) => {
      if (String(url).includes('/cancel')) {
        return Promise.resolve({ ok: true, status: 200 })
      }
      analyzeCall++
      return Promise.resolve(analyzeCall === 1 ? sseA : sseB)
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click') // A 在途
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)

    await wrapper.setProps({ projection: projectionB }) // 投影切 B
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(false)

    await wrapper.find('.ai-analyze').trigger('click') // B 发起
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)
    const calls = analyzeCalls(fetchMock)
    expect(calls.length).toBe(2)
    const body = await requestBody(calls[1])
    expect(body.battle).toEqual(projectionB.battle)
    expect(body.projection).toEqual(projectionB.projection)

    // 旧 A 流迟到收尾（done:true，无事件）：不得清掉 B 的 analyzing/结果
    sseA._release({ done: true, value: undefined })
    await flushPromises()
    expect(wrapper.vm.analyzing).toBe(true, '旧 A 的 finally 不得覆盖新 generation 的 loading')
    expect(wrapper.vm.analysisResult).toBeNull()

    // B 正常完成
    sseB._release({ done: false, value: sseEvent('done', { analysis: 'B RESULT' }) })
    sseB._release({ done: true, value: undefined })
    await flushPromises()
    expect(wrapper.vm.analysisResult).toEqual({ analysis: 'B RESULT', preBattleSection: undefined })
    expect(wrapper.vm.analyzing).toBe(false)
    vi.unstubAllGlobals()
  })
})

// ---- 每次 AI analysis 独立 run context（timer/correlationId/controller 所有权）----

describe('AiReviewPanel per-run context', () => {
  function controllableSse() {
    const queue = []
    let waiting = null
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            if (queue.length) {
              return Promise.resolve(queue.shift())
            }
            return new Promise(res => { waiting = res })
          },
          releaseLock: () => {}
        })
      },
      _release: (value) => {
        if (waiting) {
          const w = waiting
          waiting = null
          w(value)
        } else {
          queue.push(value)
        }
      }
    }
  }

  /** 路由 mock：cancel 恒返回 ok，analyze（/api/ai/reviews）按顺序返回可控 SSE。 */
  function routedFetch(...sseResponses) {
    let analyzeCall = 0
    return vi.fn((url) => {
      if (String(url).includes('/cancel')) {
        return Promise.resolve({ ok: true, status: 200 })
      }
      const sse = sseResponses[analyzeCall]
      analyzeCall++
      return Promise.resolve(sse)
    })
  }

  it('stale A finally 不得清 B timeout：B deadline 仍触发、cancel 用 B correlationId、显示 B 超时', async () => {
    vi.useFakeTimers()
    const sseA = controllableSse()
    const sseB = controllableSse()
    const fetchMock = routedFetch(sseA, sseB)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click') // A
    await nextTick()
    const aCorr = (await requestBody(analyzeCalls(fetchMock)[0])).correlationId

    await wrapper.setProps({ projection: projectionB }) // A 被 cancel（watcher）
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(false)

    await wrapper.find('.ai-analyze').trigger('click') // B 启动（B timer 已安装）
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)
    const bCorr = (await requestBody(analyzeCalls(fetchMock)[1])).correlationId
    expect(bCorr).not.toBe(aCorr)

    // A 的 async unwind 最后执行（fetch resolve + stream 收尾 → A finally）：
    // 不得 clear B 的 timeoutTimer。
    sseA._release({ done: false, value: sseEvent('done', { analysis: 'OLD' }) })
    sseA._release({ done: true, value: undefined })
    await flushPromises()

    // 推进到 B deadline：B timeout 必须触发（即使 A finally 已跑过）
    await vi.advanceTimersByTimeAsync(1_100_000)
    sseB._release({ done: false, value: new TextEncoder().encode('') }) // 唤醒流循环检查墙钟 deadline
    await flushPromises()

    expect(wrapper.vm.error).toBe('recon.errors.AI_TIMEOUT', 'B 的 timeout 语义必须保留')
    expect(wrapper.vm.analyzing).toBe(false)
    const urls = cancelCalls(fetchMock)
    expect(urls).toContain(cancelUrl(bCorr))
    // cancel 是 path 参数，不是退役的 ?correlationId= query 形式。
    expect(urls.every(u => !u.includes('?'))).toBe(true)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('stale A 的 cancel/timeout 只操作 A 自己的 correlationId，绝不 cancel B', async () => {
    vi.useFakeTimers()
    const sseA = controllableSse()
    const sseB = controllableSse()
    const fetchMock = routedFetch(sseA, sseB)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click') // A
    await nextTick()
    const aCorr = (await requestBody(analyzeCalls(fetchMock)[0])).correlationId

    await wrapper.setProps({ projection: projectionB }) // watcher 只 cancel A
    await nextTick()
    await wrapper.find('.ai-analyze').trigger('click') // B
    await nextTick()
    const bCorr = (await requestBody(analyzeCalls(fetchMock)[1])).correlationId

    // B 活跃期间：A 不得触发任何 B_ID 的 cancel（A 只能操作 A_ID）
    const urlsBefore = cancelCalls(fetchMock)
    expect(urlsBefore).toContain(cancelUrl(aCorr))
    expect(urlsBefore).not.toContain(cancelUrl(bCorr))

    // 推进 B 自身 deadline：只有 B 自己触发 cancel（A 的 timer 已在切换时 clear）
    await vi.advanceTimersByTimeAsync(1_100_000)
    sseB._release({ done: false, value: new TextEncoder().encode('') })
    await flushPromises()

    const urls = cancelCalls(fetchMock)
    expect(urls).toContain(cancelUrl(bCorr))
    // A 的 timeout timer 已在 identity 切换时清除：整场只 cancel 一次 A。
    expect(urls.filter(u => u === cancelUrl(aCorr)).length).toBe(1)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})
