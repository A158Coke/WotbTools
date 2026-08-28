// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: { value: 'zh' } })
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

/** Phase 7（plan §39/§88）：Dataset 路径读 cached map-overview，不重新上传 replay。 */
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
          MapOverview: { template: '<div class="map-stub" />' }
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

  it('无 dataset 引用时拒绝发起请求并显示准备态（不裸抛 DATASET_UNAVAILABLE，BLOCKER B）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BattlePlaybackPanel, {
      props: { file: { name: 'a.wotbreplay' }, processingJobId: null, sourceId: null, active: true },
      global: {
        mocks: { $t: key => key },
        stubs: { MapOverview: { template: '<div class="map-stub" />' } }
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
        stubs: { MapOverview: { template: '<div class="map-stub" />' } }
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
})

// ---- BLOCKER 1.2：effective Dataset identity（file + processingJobId + sourceId）变化必须真正 reset ----

describe('BattlePlaybackPanel Dataset identity reset（BLOCKER 1.2）', () => {
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
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => dA.promise)
      .mockImplementationOnce(() => dB.promise)
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
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => dA.promise)
      .mockImplementationOnce(() => dB.promise)
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
