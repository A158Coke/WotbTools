// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import AiReviewPanel from './AiReviewPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: { value: 'zh' } })
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: { value: { realm_access: { roles: ['wotbtools-user'] } } },
    token: () => 'test-token',
    ensureToken: vi.fn().mockResolvedValue(true),
    login: vi.fn(),
  })
}))

/** AI 复盘 Workspace 布局所有权：.ai-review-panel 是唯一 width owner，
 *  Action / Error / Streaming / Analysis Result 全部作为其子节点共享同一宽度契约。 */
describe('AiReviewPanel workspace layout ownership', () => {
  function mountPanel(file) {
    return mount(AiReviewPanel, {
      props: { file },
      global: {
        mocks: { $t: key => key },
        stubs: {
          AnalysisResultPanel: {
            props: ['result'],
            template: '<div class="result-stub">{{ result.analysis }}</div>'
          }
        }
      }
    })
  }

  it('.ai-review-panel 存在且包含 .ai-action-row（Action 与 Result 同属一个父容器）', () => {
    const wrapper = mountPanel({ name: 'a.wotbreplay' })
    const panel = wrapper.find('.ai-review-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.find('.ai-action-row').exists()).toBe(true)
    expect(panel.find('.ai-action-row .lg').exists()).toBe(true)
  })

  it('Streaming 面板与 Analysis Result 都是 .ai-review-panel 的子节点（共享同一 width owner）', async () => {
    const wrapper = mountPanel({ name: 'a.wotbreplay' })
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
    const wrapper = mountPanel(null)
    expect(wrapper.find('.ws-note').exists()).toBe(true)
    expect(wrapper.find('.ai-action-row').exists()).toBe(false)
  })
})

// ---- plan §36–§37：Dataset 路径发送 processingJobId+sourceId JSON（不再上传 replay）----

describe('AiReviewPanel dataset request', () => {
  function mountDatasetPanel(overrides = {}) {
    return mount(AiReviewPanel, {
      props: {
        file: { name: 'a.wotbreplay' },
        processingJobId: 'p1',
        sourceId: 'r0',
        ...overrides
      },
      global: {
        mocks: { $t: key => key },
        stubs: {
          ReplayAnalysisAction: {
            props: ['analyzing'],
            template: '<button class="dataset-analyze" @click="$emit(&apos;analyze&apos;)">analyze</button>'
          }
        }
      }
    })
  }

  function sseResponse() {
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => ({ done: true }),
          releaseLock: () => {}
        })
      }
    }
  }

  it('发送 JSON dataset 引用（processingJobId/sourceId/lang/correlationId）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse())
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()

    await wrapper.find('.dataset-analyze').trigger('click')
    await nextTick()
    await nextTick()

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/replay/analyze')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(options.body)
    expect(body.processingJobId).toBe('p1')
    expect(body.sourceId).toBe('r0')
    expect(body.lang).toBe('zh')
    expect(typeof body.correlationId).toBe('string')
    vi.unstubAllGlobals()
  })

  it('无 dataset 引用时拒绝发起请求并显示准备态（不裸抛 DATASET_UNAVAILABLE，BLOCKER A）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse())
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel({ processingJobId: null, sourceId: null })

    await wrapper.find('.dataset-analyze').trigger('click')
    await nextTick()
    await nextTick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('.error').exists()).toBe(false)
    expect(wrapper.find('[data-test="ai-dataset-status"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-dataset-status"]').text()).toContain('workspace.dataset_preparing')
    vi.unstubAllGlobals()
  })

  it('后端返回 JOB_NOT_FOUND（dataset 过期）→ 触发 dataset-recover、不显示裸错误码', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'JOB_NOT_FOUND'
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()

    await wrapper.find('.dataset-analyze').trigger('click')
    await nextTick()
    await nextTick()
    await flushPromises()

    expect(wrapper.emitted('dataset-recover')).toBeTruthy()
    expect(wrapper.emitted('dataset-recover')[0][0]).toBe('JOB_NOT_FOUND')
    expect(wrapper.find('.error').exists()).toBe(false)
    expect(wrapper.vm.analyzing).toBe(false)
    vi.unstubAllGlobals()
  })
})

// ---- BLOCKER 1.1：Dataset identity 必须进入 AI request ownership ----

describe('AiReviewPanel Dataset identity ownership（BLOCKER 1.1）', () => {
  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function mountDatasetPanel(overrides = {}) {
    return mount(AiReviewPanel, {
      props: {
        file: { name: 'a.wotbreplay' },
        processingJobId: 'pA',
        sourceId: 'r0',
        ...overrides
      },
      global: {
        mocks: { $t: key => key },
        stubs: {
          ReplayAnalysisAction: {
            props: ['analyzing'],
            template: '<button class="dataset-analyze" @click="$emit(&apos;analyze&apos;)">analyze</button>'
          },
          AnalysisResultPanel: {
            props: ['result'],
            template: '<div class="result-stub">{{ result.analysis }}</div>'
          }
        }
      }
    })
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

  const sseEvent = (event, data) => {
    const encoder = new TextEncoder()
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  it('Dataset identity 切换后：旧 A 的迟到 done 不得写 analysisResult / partialAnalysis', async () => {
    const sse = controllableSse()
    const fetchMock = vi.fn().mockResolvedValue(sse)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()

    await wrapper.find('.dataset-analyze').trigger('click')
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)

    // Dataset identity 切到 B（file + processingJobId 一起变）
    await wrapper.setProps({ file: { name: 'b.wotbreplay' }, processingJobId: 'pB', sourceId: 'r0' })
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

  it('identity 切换后：旧 A 的迟到错误不得污染新 Dataset', async () => {
    const dA = deferred()
    const fetchMock = vi.fn().mockReturnValue(dA.promise)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()

    await wrapper.find('.dataset-analyze').trigger('click')
    await nextTick()
    await wrapper.setProps({ processingJobId: 'pB', sourceId: 'r0' })
    await nextTick()

    dA.reject(new Error('OLD_A_ERROR'))
    await flushPromises()
    expect(wrapper.vm.error).toBe('', 'stale A 的错误不得污染新 Dataset')
    expect(wrapper.vm.analysisResult).toBeNull()
    vi.unstubAllGlobals()
  })

  it('identity 切换后新 Dataset 可立即发起分析；旧 finally 不覆盖新 loading', async () => {
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
    const wrapper = mountDatasetPanel()

    await wrapper.find('.dataset-analyze').trigger('click') // A 在途
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)

    await wrapper.setProps({ processingJobId: 'pB', sourceId: 'r1' }) // Dataset 切 B
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(false)

    await wrapper.find('.dataset-analyze').trigger('click') // B 发起
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)
    const analyzeCalls = fetchMock.mock.calls.filter(([u]) => String(u) === '/api/replay/analyze')
    expect(analyzeCalls.length).toBe(2)
    const [, options] = analyzeCalls[1]
    expect(JSON.parse(options.body).processingJobId).toBe('pB')

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

// ---- BLOCKER 2：每次 AI analysis 独立 run context（timer/correlationId/controller 所有权）----

describe('AiReviewPanel per-run context（BLOCKER 2）', () => {
  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function mountDatasetPanel(overrides = {}) {
    return mount(AiReviewPanel, {
      props: {
        file: { name: 'a.wotbreplay' },
        processingJobId: 'pA',
        sourceId: 'r0',
        ...overrides
      },
      global: {
        mocks: { $t: key => key },
        stubs: {
          ReplayAnalysisAction: {
            props: ['analyzing'],
            template: '<button class="dataset-analyze" @click="$emit(&apos;analyze&apos;)">analyze</button>'
          },
          AnalysisResultPanel: {
            props: ['result'],
            template: '<div class="result-stub">{{ result.analysis }}</div>'
          }
        }
      }
    })
  }

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

  const sseEvent = (event, data) => {
    const encoder = new TextEncoder()
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  /** analyze/cancel 路由 mock：cancel 恒返回 ok，analyze 按顺序返回可控 SSE。 */
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

  function analyzeCalls(fetchMock) {
    return fetchMock.mock.calls.filter(([u]) => String(u) === '/api/replay/analyze')
  }

  it('stale A finally 不得清 B timeout：B deadline 仍触发、cancel 用 B correlationId、显示 B 超时', async () => {
    vi.useFakeTimers()
    const sseA = controllableSse()
    const sseB = controllableSse()
    const fetchMock = routedFetch(sseA, sseB)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()

    await wrapper.find('.dataset-analyze').trigger('click') // A
    await nextTick()
    const aCorr = JSON.parse(analyzeCalls(fetchMock)[0][1].body).correlationId

    await wrapper.setProps({ processingJobId: 'pB', sourceId: 'r0' }) // A 被 cancel（watcher）
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(false)

    await wrapper.find('.dataset-analyze').trigger('click') // B 启动（B timer 已安装）
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)
    const bCorr = JSON.parse(analyzeCalls(fetchMock)[1][1].body).correlationId
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
    const cancelUrls = fetchMock.mock.calls
      .filter(([u]) => String(u).includes('/api/replay/analyze/cancel'))
      .map(([u]) => String(u))
    expect(cancelUrls.some(u => u.includes(encodeURIComponent(bCorr)))).toBe(true,
      'B 的 timeout cancel 必须使用 B correlationId')
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('stale A 的 cancel/timeout 只操作 A 自己的 correlationId，绝不 cancel B', async () => {
    vi.useFakeTimers()
    const sseA = controllableSse()
    const sseB = controllableSse()
    const fetchMock = routedFetch(sseA, sseB)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()

    await wrapper.find('.dataset-analyze').trigger('click') // A
    await nextTick()
    const aCorr = JSON.parse(analyzeCalls(fetchMock)[0][1].body).correlationId

    await wrapper.setProps({ processingJobId: 'pB', sourceId: 'r0' }) // watcher 只 cancel A
    await nextTick()
    await wrapper.find('.dataset-analyze').trigger('click') // B
    await nextTick()
    const bCorr = JSON.parse(analyzeCalls(fetchMock)[1][1].body).correlationId

    // B 活跃期间：A 不得触发任何 B_ID 的 cancel（A 只能操作 A_ID）
    const cancelUrlsBefore = fetchMock.mock.calls
      .filter(([u]) => String(u).includes('/api/replay/analyze/cancel'))
      .map(([u]) => String(u))
    expect(cancelUrlsBefore.some(u => u.includes(encodeURIComponent(aCorr)))).toBe(true,
      'A 的 cancel（watcher 触发）使用 A correlationId')
    expect(cancelUrlsBefore.some(u => u.includes(encodeURIComponent(bCorr)))).toBe(false,
      'A 不得在 B 活跃时 cancel B')

    // 推进 B 自身 deadline：只有 B 自己触发 cancel（A 的 timer 已在切换时 clear）
    await vi.advanceTimersByTimeAsync(1_100_000)
    sseB._release({ done: false, value: new TextEncoder().encode('') })
    await flushPromises()

    const cancelUrls = fetchMock.mock.calls
      .filter(([u]) => String(u).includes('/api/replay/analyze/cancel'))
      .map(([u]) => String(u))
    expect(cancelUrls.filter(u => u.includes(encodeURIComponent(bCorr))).length).toBeGreaterThan(0,
      'B 的 timeout cancel 使用 B correlationId')
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})
