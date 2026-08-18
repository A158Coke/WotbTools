// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import HoFAdminPage from './HoFAdminPage.vue'

const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve(undefined))
}))

const hofAdminApi = vi.hoisted(() => ({
  hofAdminList: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofAdminAudit: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofAdminDelete: vi.fn(() => Promise.resolve(undefined)),
  hofAdminDownload: vi.fn(() => Promise.resolve(undefined))
}))

let roles = ['HoF-admin']
let authenticated = true

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(authenticated),
    tokenParsed: ref(roles.length ? { realm_access: { roles } } : null),
    login: api.login
  })
}))

vi.mock('../utils/api.js', () => hofAdminApi)
vi.mock('../utils/helpers.js', () => ({ mapLabel: () => '' }))
vi.mock('../utils/display.js', () => ({ apiErrorLabel: (t, te, e) => (e?.code ? 'err:' + e.code : 'api-error') }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: k => k, te: () => true, locale: ref('zh') }) }))

describe('HoFAdminPage', () => {
  beforeEach(() => {
    roles = ['HoF-admin']
    authenticated = true
    vi.clearAllMocks()
  })

  function mountPage() {
    return mount(HoFAdminPage, { global: { mocks: { $t: k => k } } })
  }

  it('HoF-admin sees admin content and loads records', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.hof-admin-denied').exists()).toBe(false)
    expect(hofAdminApi.hofAdminList).toHaveBeenCalled()
  })

  it('wotbtools-admin sees admin content', async () => {
    roles = ['wotbtools-admin']
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.hof-admin-denied').exists()).toBe(false)
    expect(hofAdminApi.hofAdminList).toHaveBeenCalled()
  })

  it('normal user sees denied state and no admin API call', async () => {
    roles = ['wotbtools-user']
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.hof-admin-denied').exists()).toBe(true)
    expect(hofAdminApi.hofAdminList).not.toHaveBeenCalled()
  })

  it('anonymous triggers login before rendering admin content', async () => {
    authenticated = false
    roles = []
    const wrapper = mountPage()
    await flushPromises()
    expect(api.login).toHaveBeenCalledWith('hof-admin')
    expect(hofAdminApi.hofAdminList).not.toHaveBeenCalled()
  })

  it('delete requires confirmation then calls delete API', async () => {
    hofAdminApi.hofAdminList.mockResolvedValue({
      items: [{
        id: 7, arenaId: 'a1', accountId: 111, nickname: 'Player1', tankId: 6481, tankName: 'FV4005',
        battleType: 'RANDOM', arenaBonusType: 1, damageDealt: 5000, mapName: 'rockfield',
        version: '11.18.0', battleTime: null, createdAt: '2024-01-01T00:00:00Z',
        replayHash: 'h', replayFileName: 'x.wotbreplay', replaySize: 100,
        replayUploadedBy: 'up-sub', replayAvailable: true
      }],
      page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    // 单击垃圾桶 → 弹确认，绝不立即执行删除
    await wrapper.findAll('.actions .danger')[0].trigger('click')
    expect(hofAdminApi.hofAdminDelete).not.toHaveBeenCalled()
    expect(wrapper.find('.hof-delete-modal').exists()).toBe(true)
    // 确认 → 调用删除 API
    await wrapper.findAll('.modal-actions .danger')[0].trigger('click')
    expect(hofAdminApi.hofAdminDelete).toHaveBeenCalledWith(7)
  })
})
