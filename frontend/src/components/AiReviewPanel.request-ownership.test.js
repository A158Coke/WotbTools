// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import AiReviewPanel from './AiReviewPanel.vue'
import {
  projectionA, projectionB, mountAiReviewPanel, createRequestHelpers, requestBody, sseEvent,
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
const AI_REVIEWS_URL = '/api/ai/reviews'
const { analyzeCalls, cancelCalls, cancelUrl } = createRequestHelpers(AI_REVIEWS_URL)


describe('AiReviewPanel projection identity ownership', () => {
  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
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

  it('投影 identity 切换后：旧 A 的迟到 done 不得写 analysisResult / partialAnalysis', async () => {
    const sse = controllableSse()
    const fetchMock = vi.fn().mockResolvedValue(sse)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel({ projection: projectionA })

    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)

    await wrapper.setProps({ file: { name: 'b.wotbreplay' }, projection: projectionB })
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(false, 'identity 切换后旧请求必须作废，新 generation 可开始')

    sse._release({ done: false, value: sseEvent('done', { analysis: 'OLD A RESULT', preBattleSection: '' }) })
    sse._release({ done: true, value: undefined })
    await flushPromises()

    expect(wrapper.vm.analysisResult).toBeNull('旧 A 的 analysisResult 不得写回')
    expect(wrapper.vm.partialAnalysis).toBe('')
    expect(wrapper.vm.progressStage).toBe('', '旧 A 的迟到事件不得写 progressStage')
    expect(wrapper.vm.failure).toBeNull()
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
    expect(wrapper.vm.failure).toBeNull('stale A 的错误不得污染新投影')
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

    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)

    await wrapper.setProps({ projection: projectionB })
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(false)

    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)
    const calls = analyzeCalls(fetchMock)
    expect(calls.length).toBe(2)
    const body = await requestBody(calls[1])
    expect(body.battle).toEqual(projectionB.battle)
    expect(body.projection).toEqual(projectionB.projection)

    sseA._release({ done: true, value: undefined })
    await flushPromises()
    expect(wrapper.vm.analyzing).toBe(true, '旧 A 的 finally 不得覆盖新 generation 的 loading')
    expect(wrapper.vm.analysisResult).toBeNull()

    sseB._release({ done: false, value: sseEvent('done', { analysis: 'B RESULT' }) })
    sseB._release({ done: true, value: undefined })
    await flushPromises()
    expect(wrapper.vm.analysisResult).toEqual({ analysis: 'B RESULT', preBattleSection: undefined })
    expect(wrapper.vm.analyzing).toBe(false)
    vi.unstubAllGlobals()
  })
})


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

    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    const aCorr = (await requestBody(analyzeCalls(fetchMock)[0])).correlationId

    await wrapper.setProps({ projection: projectionB })
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(false)

    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    expect(wrapper.vm.analyzing).toBe(true)
    const bCorr = (await requestBody(analyzeCalls(fetchMock)[1])).correlationId
    expect(bCorr).not.toBe(aCorr)

    sseA._release({ done: false, value: sseEvent('done', { analysis: 'OLD' }) })
    sseA._release({ done: true, value: undefined })
    await flushPromises()

    await vi.advanceTimersByTimeAsync(1_100_000)
    sseB._release({ done: false, value: new TextEncoder().encode('') })
    await flushPromises()

    expect(wrapper.vm.failure.message).toBe('recon.errors.AI_TIMEOUT', 'B 的 timeout 语义必须保留')
    expect(wrapper.vm.analyzing).toBe(false)
    const urls = cancelCalls(fetchMock)
    expect(urls).toContain(cancelUrl(bCorr))
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

    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    const aCorr = (await requestBody(analyzeCalls(fetchMock)[0])).correlationId

    await wrapper.setProps({ projection: projectionB })
    await nextTick()
    await wrapper.find('.ai-analyze').trigger('click')
    await nextTick()
    const bCorr = (await requestBody(analyzeCalls(fetchMock)[1])).correlationId

    const urlsBefore = cancelCalls(fetchMock)
    expect(urlsBefore).toContain(cancelUrl(aCorr))
    expect(urlsBefore).not.toContain(cancelUrl(bCorr))

    await vi.advanceTimersByTimeAsync(1_100_000)
    sseB._release({ done: false, value: new TextEncoder().encode('') })
    await flushPromises()

    const urls = cancelCalls(fetchMock)
    expect(urls).toContain(cancelUrl(bCorr))
    expect(urls.filter(u => u === cancelUrl(aCorr)).length).toBe(1)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})
