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
const AI_REVIEWS_URL = '/api/ai/reviews'
const { analyzeCalls, cancelCalls, cancelUrl } = createRequestHelpers(AI_REVIEWS_URL)

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

    expect(wrapper.vm.failure.message).toBe('recon.errors.AI_TIMEOUT', 'B 的 timeout 语义必须保留')
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
