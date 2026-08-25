// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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
        active: true,
        loginView: 'replay'
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
})
