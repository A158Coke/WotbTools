// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key, params) => key === 'errors.diagnostic_id' ? `诊断 ID：${params.id}` : key,
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
    authenticated: { value: true }
  })
}))

/** Phase 7：Dataset 路径读 cached map-overview，不重新上传 replay。 */
describe('BattlePlaybackPanel dataset request', () => {
  function mountDatasetPanel() {
    return mount(BattlePlaybackPanel, {
      props: {
        file: { name: 'a.wotbreplay' },
        processingJobId: 'p1',
        sourceId: 'r0',
        active: true
      },
      global: {
        mocks: { $t: key => key },
        stubs: {
          MapOverview: { template: '<div class="map-stub" />' },
          BattlePlayback: { template: '<div data-test="pb-stub" />' }
        }
      }
    })
  }

  it('发送 JSON dataset 引用（processingJobId/sourceId）到 /api/replay/map-overview', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ mapCode: 'holland' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()

    // active=true + file 就绪 → 自动加载；等待请求发出
    await new Promise(r => setTimeout(r, 20))
    await new Promise(r => setTimeout(r, 20))

    const calls = fetchMock.mock.calls.filter(([u]) => String(u) === '/api/replay/map-overview')
    expect(calls.length).toBe(1)
    const [url, options] = calls[0]
    expect(url).toBe('/api/replay/map-overview')
    expect(options.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(options.body)
    expect(body.processingJobId).toBe('p1')
    expect(body.sourceId).toBe('r0')
    vi.unstubAllGlobals()
  })

  it('V2 dataset capability=PARTIAL → 展示确定性降级提示（诚实标注，不猜测未观测事实）', async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ mapCode: 'holland' }) })
      }
      if (String(url) === '/api/replay/battle-playback-v2') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ durationSec: 0, mapCode: null, friendlyTeam: null, recorderAccountId: null, arenaBonusType: null, capability: 'PARTIAL', limitations: ['BATTLE_RELATIVE_TIME_UNAVAILABLE'], vehicles: [], events: [], pointsSamples: [], baseStates: [] })
        })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    const note = wrapper.find('[data-test="pb-capability-partial"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('recon.playback.partial')
    vi.unstubAllGlobals()
  })

  it('V2 invalid response missing required metadata → 显式 INVALID_RESPONSE error', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => String(url) === '/api/replay/battle-playback-v2'
      ? Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            durationSec: 0, friendlyTeam: null, recorderAccountId: null, arenaBonusType: null,
            capability: 'PARTIAL', limitations: [], vehicles: [], events: [], pointsSamples: [], baseStates: []
          })
        })
      : Promise.resolve({ ok: true, status: 204 })))
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    const error = wrapper.find('[data-test="pb-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('errors.invalid_response')
    expect(error.text()).not.toContain('errors.unknown_error')
    // INVALID_RESPONSE（retryable=false）也必须提供手动「重试加载」入口。
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('V2 204 → 显式 UNAVAILABLE（不静默隐藏 Playback），无 retry', async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ mapCode: 'holland' }) })
      }
      if (String(url) === '/api/replay/battle-playback-v2') {
        return Promise.resolve({ ok: false, status: 204 })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-unavailable"]').text()).toContain('recon.playback.unavailable')
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('Blocker 2：MapOverview 可用 + V2 204 → PRIMARY 显示 unavailable，secondary 地图仍可用', async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ mapCode: 'holland' }) })
      }
      if (String(url) === '/api/replay/battle-playback-v2') {
        return Promise.resolve({ ok: false, status: 204 })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-unavailable"]').exists()).toBe(true)
    // 切到 secondary 地图鸟瞰：map-overview artifact 存在 → 必须仍可用
    await wrapper.find('[data-test="pb-view-map"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-stub').exists()).toBe(true, 'secondary 地图鸟瞰必须仍可用')
    vi.unstubAllGlobals()
  })

  it('V2 200 capability=PARTIAL → 按 current contract 接受响应', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('battle-playback-v2')
      ? Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            capability: 'PARTIAL',
            limitations: ['TIMELINE_UNAVAILABLE'],
            vehicles: [], events: [], pointsSamples: [], baseStates: [], durationSec: 0,
            mapCode: null, friendlyTeam: null, recorderAccountId: null, arenaBonusType: null
          })
        })
      : Promise.resolve({ ok: true, status: 204 })))
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-capability-partial"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('V2 500 → 显式 ERROR + retry（确定性原因，不吞掉）', async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ mapCode: 'holland' }) })
      }
      if (String(url) === '/api/replay/battle-playback-v2') {
        return Promise.resolve({ ok: false, status: 500, text: async () => 'DATASET_UNAVAILABLE' })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('V2 canonical 403 → 权限错误且不显示 retry', async () => {
    const canonical = JSON.stringify({
      errorCode: 'AUTH_FORBIDDEN', errorMsg: null, status: 403, id: 'err-403',
      retryable: false, details: {}, timestamp: '2026-08-30T15:30:00Z'
    })
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('battle-playback-v2')
      ? Promise.resolve({ ok: false, status: 403, text: async () => canonical })
      : Promise.resolve({ ok: true, status: 204 })))
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').text()).toContain('errors.auth_forbidden')
    expect(wrapper.find('[data-test="pb-error"]').text()).toContain('err-403')
    // 手动恢复入口不绑定 retryable：ERROR 态 + datasetReady → 始终提供「重试加载」。
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('V2 canonical 401 → session error, not generic playback failure', async () => {
    const canonical = JSON.stringify({
      errorCode: 'AUTH_UNAUTHENTICATED', errorMsg: null, status: 401, id: 'err-401',
      retryable: false, details: {}, timestamp: '2026-08-30T15:30:00Z'
    })
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('battle-playback-v2')
      ? Promise.resolve({ ok: false, status: 401, text: async () => canonical })
      : Promise.resolve({ ok: true, status: 204 })))
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').text()).toContain('errors.auth_unauthenticated')
    expect(wrapper.find('[data-test="pb-error"]').text()).toContain('err-401')
    // 手动恢复入口不绑定 retryable：ERROR 态 + datasetReady → 始终提供「重试加载」。
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('V2 network failure → network error + retry', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('battle-playback-v2')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve({ ok: true, status: 204 })))
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').text()).toContain('errors.network_error')
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('Blocker 2：V2 FULL + MapOverview 204 → PRIMARY Battle Playback 仍渲染（不依赖 map-overview artifact）', async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        return Promise.resolve({ ok: false, status: 204 })
      }
      if (String(url) === '/api/replay/battle-playback-v2') {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            capability: 'FULL', limitations: [], vehicles: [], events: [], pointsSamples: [], baseStates: [], durationSec: 0,
            mapCode: 'holland', friendlyTeam: 1, recorderAccountId: 1001, arenaBonusType: 1
          })
        })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    // PRIMARY playback 必须渲染（V2 为权威），尽管 map-overview 204
    expect(wrapper.find('[data-test="pb-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-capability-partial"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-unavailable"]').exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('Blocker 2：V2 PARTIAL + MapOverview 204 → PARTIAL 降级提示 + Battle Playback 仍渲染', async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        return Promise.resolve({ ok: false, status: 204 })
      }
      if (String(url) === '/api/replay/battle-playback-v2') {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            capability: 'PARTIAL', limitations: ['BATTLE_RELATIVE_TIME_UNAVAILABLE'], vehicles: [], events: [], pointsSamples: [], baseStates: [], durationSec: 0,
            mapCode: 'holland', friendlyTeam: 1, recorderAccountId: 1001, arenaBonusType: 1
          })
        })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-capability-partial"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-stub"]').exists()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('无 dataset 引用时拒绝发起请求并显示准备态（不裸抛 DATASET_UNAVAILABLE）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BattlePlaybackPanel, {
      props: { file: { name: 'a.wotbreplay' }, processingJobId: null, sourceId: null, active: true },
      global: {
        mocks: { $t: key => key },
        stubs: {
          MapOverview: { template: '<div class="map-stub" />' },
          BattlePlayback: { template: '<div data-test="pb-stub" />' }
        }
      }
    })

    await new Promise(r => setTimeout(r, 20))
    await new Promise(r => setTimeout(r, 20))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="map-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="map-dataset-status"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="map-dataset-status"]').text()).toContain('workspace.dataset_preparing')
    vi.unstubAllGlobals()
  })

  it('datasetError 非空 → 不显示 spinner、显示失败文案（与 PREPARING 明确区分）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BattlePlaybackPanel, {
      props: {
        file: { name: 'a.wotbreplay' }, processingJobId: null, sourceId: null,
        datasetError: 'workspace.dataset_prepare_failed', active: true
      },
      global: {
        mocks: { $t: key => key },
        stubs: {
          MapOverview: { template: '<div class="map-stub" />' },
          BattlePlayback: { template: '<div data-test="pb-stub" />' }
        }
      }
    })

    await new Promise(r => setTimeout(r, 20))
    await new Promise(r => setTimeout(r, 20))

    expect(fetchMock).not.toHaveBeenCalled()
    const status = wrapper.find('[data-test="map-dataset-status"]')
    expect(status.exists()).toBe(true)
    expect(status.find('.map-status-spinner').exists()).toBe(false, 'FAILURE 状态不得显示 spinner')
    expect(status.text()).toContain('workspace.dataset_prepare_failed')
    expect(status.find('.map-dataset-error').exists()).toBe(true, 'FAILURE 应使用错误色文案')
    vi.unstubAllGlobals()
  })

  it('retryable=true ERROR → 始终显示「重试加载」并保留 retryable 语义', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('battle-playback-v2')
      ? Promise.resolve({ ok: false, status: 500, text: async () => 'DATASET_UNAVAILABLE' })
      : Promise.resolve({ ok: true, status: 204 })))
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-error"]').attributes('data-retryable')).toBe('true')
    vi.unstubAllGlobals()
  })

  it('retryable=false INVALID_RESPONSE → 同样显示「重试加载」', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => String(url) === '/api/replay/battle-playback-v2'
      ? Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            durationSec: 0, friendlyTeam: null, recorderAccountId: null, arenaBonusType: null,
            capability: 'PARTIAL', limitations: [], vehicles: [], events: [], pointsSamples: [], baseStates: []
          })
        })
      : Promise.resolve({ ok: true, status: 204 })))
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-error"]').text()).toContain('errors.invalid_response')
    // retryable=false 也提供手动恢复入口；retryable 语义保留在 data-retryable 上。
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-error"]').attributes('data-retryable')).toBe('false')
    vi.unstubAllGlobals()
  })

  it('datasetReady=false → 不显示无效「重试加载」按钮', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BattlePlaybackPanel, {
      props: { file: { name: 'a.wotbreplay' }, processingJobId: null, sourceId: null, active: true },
      global: {
        mocks: { $t: key => key },
        stubs: {
          MapOverview: { template: '<div class="map-stub" />' },
          BattlePlayback: { template: '<div data-test="pb-stub" />' }
        }
      }
    })
    await new Promise(r => setTimeout(r, 20))
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-error"]').exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('点击 retry → ERROR → LOADING → FULL（重试只重新读取当前 dataset）', async () => {
    let v2Call = 0
    let resolveRetry
    const retryPromise = new Promise(resolve => { resolveRetry = resolve })
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/battle-playback-v2') {
        v2Call++
        if (v2Call === 1) {
          // 首次：contract validation 失败 → INVALID_RESPONSE（retryable=false）
          return Promise.resolve({
            ok: true, status: 200,
            json: async () => ({
              durationSec: 0, friendlyTeam: null, recorderAccountId: null, arenaBonusType: null,
              capability: 'PARTIAL', limitations: [], vehicles: [], events: [], pointsSamples: [], baseStates: []
            })
          })
        }
        return retryPromise
      }
      return Promise.resolve({ ok: true, status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)

    // 点击 retry → LOADING（重试期间按钮消失，避免重复点击）
    await wrapper.find('[data-test="pb-retry"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(false)

    // 重试成功 → FULL
    resolveRetry({
      ok: true, status: 200,
      json: async () => ({
        capability: 'FULL', limitations: [], vehicles: [], events: [], pointsSamples: [],
        baseStates: [], durationSec: 0, mapCode: 'holland', friendlyTeam: 1, recorderAccountId: 1001, arenaBonusType: 1
      })
    })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-error"]').exists()).toBe(false)
    expect(v2Call).toBe(2)
    vi.unstubAllGlobals()
  })

  it('连续失败 → 再次 ERROR 且「重试加载」按钮重新出现', async () => {
    let v2Call = 0
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/battle-playback-v2') {
        v2Call++
        // 每次都 contract validation 失败 → ERROR（retryable=false）
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            durationSec: 0, friendlyTeam: null, recorderAccountId: null, arenaBonusType: null,
            capability: 'PARTIAL', limitations: [], vehicles: [], events: [], pointsSamples: [], baseStates: []
          })
        })
      }
      return Promise.resolve({ ok: true, status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountDatasetPanel()
    await new Promise(r => setTimeout(r, 30))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)

    // 点击 retry → LOADING → 再次失败 → ERROR + 按钮重新出现
    await wrapper.find('[data-test="pb-retry"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-retry"]').exists()).toBe(true)
    expect(v2Call).toBe(2)
    vi.unstubAllGlobals()
  })
})

// ---- effective Dataset identity（file + processingJobId + sourceId）变化必须真正 reset ----

describe('BattlePlaybackPanel Dataset identity reset', () => {
  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function mountPanel(props = {}) {
    return mount(BattlePlaybackPanel, {
      props: {
        file: { name: 'a.wotbreplay' },
        processingJobId: 'p1',
        sourceId: 'r0',
        active: true,
        ...props
      },
      global: {
        mocks: { $t: key => key },
        stubs: { MapOverview: { template: '<div class="map-stub" />' } }
      }
    })
  }

  function mapRequests(fetchMock) {
    return fetchMock.mock.calls.filter(([u]) => String(u) === '/api/replay/map-overview')
  }

  it('已加载 A 地图后 Dataset identity 切 B：清空 A 并自动加载 B（不被 mapLoaded 阻塞）', async () => {
    const dA = deferred()
    const dB = deferred()
    let mapCall = 0
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        mapCall++
        return mapCall === 1 ? dA.promise : dB.promise
      }
      // V2 dataset：返回 204（timeline 不可用 → null，走 legacy）
      return Promise.resolve({ ok: true, status: 204, json: async () => null })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel()

    dA.resolve({ ok: true, status: 200, json: async () => ({ mapCode: 'A' }) })
    await flushPromises()
    expect(wrapper.vm.mapOverview).toEqual({ mapCode: 'A' })
    expect(wrapper.vm.mapLoaded).toBe(true)

    // Dataset identity 变化（同一文件）→ 必须真正 reset 并加载 B
    await wrapper.setProps({ processingJobId: 'p2', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.mapOverview).toBeNull('旧 A map 必须清空')
    expect(wrapper.vm.mapLoaded).toBe(false, '旧 mapLoaded 不得阻塞新 Dataset 加载')
    expect(wrapper.vm.mapError).toBe('')
    const requests = mapRequests(fetchMock)
    expect(requests.length).toBe(2)
    expect(JSON.parse(requests[1][1].body).processingJobId).toBe('p2')

    dB.resolve({ ok: true, status: 200, json: async () => ({ mapCode: 'B' }) })
    await flushPromises()
    expect(wrapper.vm.mapOverview).toEqual({ mapCode: 'B' })
    vi.unstubAllGlobals()
  })

  it('file + Dataset 同一次变化只发一次请求（单一 effective identity watcher）', async () => {
    const dA = deferred()
    const dB = deferred()
    let mapCall = 0
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        mapCall++
        return mapCall === 1 ? dA.promise : dB.promise
      }
      return Promise.resolve({ ok: true, status: 204, json: async () => null })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPanel()

    dA.resolve({ ok: true, status: 200, json: async () => ({ mapCode: 'A' }) })
    await flushPromises()
    expect(wrapper.vm.mapOverview).toEqual({ mapCode: 'A' })

    // file 与 dataset 同一次 setProps：只触发一次 reset + 一次新请求
    await wrapper.setProps({ file: { name: 'b.wotbreplay' }, processingJobId: 'p3', sourceId: 'r0' })
    await flushPromises()
    const requests = mapRequests(fetchMock)
    expect(requests.length).toBe(2, 'A + B 各一次，B 不得因 file/dataset 双 watcher 重复请求')
    expect(JSON.parse(requests[1][1].body).processingJobId).toBe('p3')
    vi.unstubAllGlobals()
  })
})
