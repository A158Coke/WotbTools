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

  it('无 dataset 引用时拒绝发起请求并提示（不再回退 multipart，BLOCKER A）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse())
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel({ processingJobId: null, sourceId: null })

    await wrapper.find('.dataset-analyze').trigger('click')
    await nextTick()
    await nextTick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('.error').text()).toContain('DATASET_UNAVAILABLE')
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
