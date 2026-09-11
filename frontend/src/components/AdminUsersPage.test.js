// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminUsersPage from './AdminUsersPage.vue'

const api = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  getUser: vi.fn(),
  deleteUsers: vi.fn()
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(true),
    ensureToken: vi.fn().mockResolvedValue(true),
    login: vi.fn(),
  })
}))

vi.mock('../utils/api-boost.js', () => ({
  adminSearchUsers: api.searchUsers,
  adminGetUser: api.getUser,
  adminDeleteUsers: api.deleteUsers
}))

vi.mock('../composables/useError.js', () => ({ useError: () => ({ show: vi.fn() }) }))

vi.mock('../utils/display.js', () => ({
  apiErrorLabel: (_t, _te, error) => (error?.code ? 'err:' + error.code : 'api-error'),
  apiErrorCodeLabel: (_t, _te, code) => (code ? 'code:' + code : '')
}))

// t(key, params) → "key(k=v,...)"：断言时同时锁定 key 与插值参数。
const i18n = vi.hoisted(() => ({
  translate: (key, params) => (params
    ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`
    : key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.translate, te: () => true })
}))

/** AdminUserListItem fixture（Keycloak segment 默认：无本地资料）。 */
function kcUser(keycloakUserId, overrides = {}) {
  return {
    keycloakUserId,
    keycloakUsername: `${keycloakUserId}-name`,
    keycloakEmail: `${keycloakUserId}@example.com`,
    keycloakEnabled: true,
    profileId: null,
    displayName: null,
    wotbAccountId: null,
    wotbNickname: null,
    wotbServer: null,
    profileCreatedAt: null,
    hasLocalProfile: false,
    keycloakUserMissing: false,
    ...overrides
  }
}

function pageResult(items, page, size, totalItems, totalPages) {
  return { items, page, size, totalItems, totalPages }
}

describe('AdminUsersPage', () => {
  let wrapper

  beforeEach(() => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a'), kcUser('kc-b')], options.page, options.size, 2, 1)
    ))
    api.deleteUsers.mockResolvedValue({ requested: 2, deleted: 2, failed: 0, results: [] })
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  function mountPage() {
    return mount(AdminUsersPage, { global: { mocks: { $t: i18n.translate } } })
  }

  function rows() {
    return wrapper.findAll('.admin-table tbody tr')
  }

  it('uses real server-side pagination instead of fetching one big page', async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser(`kc-page-${options.page}`)], options.page, options.size, 60, 3)
    ))
    wrapper = mountPage()
    await flushPromises()

    // 首次加载：page 0-based、默认每页 25，绝不出现 limit 式大页请求。
    expect(api.searchUsers).toHaveBeenCalledWith('', {
      segment: 'keycloak', idpAlias: '', page: 0, size: 25
    })
    expect(wrapper.find('.admin-page-info').text())
      .toBe('admin.pageInfo(page=1,total=3,items=60)')

    const [prev, next] = wrapper.findAll('.admin-pagination button')
    expect(prev.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'keycloak', idpAlias: '', page: 1, size: 25
    })
    expect(wrapper.find('.admin-page-info').text())
      .toBe('admin.pageInfo(page=2,total=3,items=60)')

    await wrapper.findAll('.admin-pagination button')[0].trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'keycloak', idpAlias: '', page: 0, size: 25
    })

    // 每页数量变化 → 回到第一页重新请求。
    await wrapper.find('.admin-pagination select').setValue('50')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'keycloak', idpAlias: '', page: 0, size: 50
    })
  })

  it('resets to page 0 when the search query changes', async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a')], options.page, options.size, 60, 3)
    ))
    wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.admin-pagination button')[1].trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', expect.objectContaining({ page: 1 }))

    await wrapper.find('.admin-search input').setValue('foo')
    await wrapper.find('.admin-search button').trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('foo', expect.objectContaining({ page: 0 }))
  })

  it('selects the current page, shows the count and deletes the batch behind one DELETE confirmation', async () => {
    wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.admin-bulk-bar').exists()).toBe(false)

    // 表头 checkbox = 全选当前页。
    const headCheckbox = wrapper.find('.admin-table thead input[type="checkbox"]')
    await headCheckbox.setValue(true)
    expect(rows().every(row => row.find('input[type="checkbox"]').element.checked)).toBe(true)
    expect(wrapper.find('.admin-selected').text()).toBe('admin.selectedCount(count=2)')

    // 取消一行 → 计数跟随（partial selection 时不勾表头）。
    await rows()[1].find('input[type="checkbox"]').setValue(false)
    expect(wrapper.find('.admin-selected').text()).toBe('admin.selectedCount(count=1)')
    expect(headCheckbox.element.checked).toBe(false)

    await wrapper.find('.admin-bulk-bar .btn-danger').trigger('click')
    expect(api.deleteUsers).not.toHaveBeenCalled()
    const modal = wrapper.find('.bulk-confirm-modal')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('admin.bulkConfirmText(count=1)')

    // 未输入 DELETE 前不可提交。
    const confirmButton = modal.find('.modal-actions .btn-danger')
    expect(confirmButton.attributes('disabled')).toBeDefined()
    await modal.find('.admin-confirm-input').setValue('DELET')
    expect(confirmButton.attributes('disabled')).toBeDefined()
    await modal.find('.admin-confirm-input').setValue('DELETE')
    expect(confirmButton.attributes('disabled')).toBeUndefined()

    await confirmButton.trigger('click')
    await flushPromises()
    expect(api.deleteUsers).toHaveBeenCalledTimes(1)
    expect(api.deleteUsers.mock.calls[0][1]).toBe(true)
    expect(api.deleteUsers.mock.calls[0][0]).toEqual(['kc-a'])
    // 删除完成后 reload 当前页。
    expect(api.searchUsers).toHaveBeenCalledTimes(2)
  })

  it('reports per-user results and keeps failed rows selected', async () => {
    api.deleteUsers.mockResolvedValue({
      requested: 2,
      deleted: 1,
      failed: 1,
      results: [
        { userId: 'kc-a', deleted: true },
        { userId: 'kc-b', deleted: false, errorCode: 'USER_HAS_DEPENDENCIES' }
      ]
    })
    wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.admin-table thead input[type="checkbox"]').setValue(true)
    await wrapper.find('.admin-bulk-bar .btn-danger').trigger('click')
    await wrapper.find('.bulk-confirm-modal .admin-confirm-input').setValue('DELETE')
    await wrapper.find('.bulk-confirm-modal .modal-actions .btn-danger').trigger('click')
    await flushPromises()

    const modal = wrapper.find('.bulk-confirm-modal')
    expect(modal.text()).toContain('admin.bulkSummary(requested=2,deleted=1,failed=1)')
    expect(modal.text()).toContain('admin.bulkFailures')
    expect(modal.text()).toContain('kc-b')
    expect(modal.text()).toContain('code:USER_HAS_DEPENDENCIES')
    // 失败项保留选择以便重试，成功项移出选择集。
    expect(wrapper.find('.admin-selected').text()).toBe('admin.selectedCount(count=1)')

    await modal.find('.modal-actions .btn-sm').trigger('click')
    expect(wrapper.find('.bulk-confirm-modal').exists()).toBe(false)
  })

  it('falls back to the last valid page when the current page disappears after a bulk delete', async () => {
    const requestedPages = []
    api.searchUsers.mockImplementation((_query, options) => {
      requestedPages.push(options.page)
      // 删除前 3 页；删除后只剩 1 页 5 条 —— 第 3 页已不存在。
      return Promise.resolve(requestedPages.length <= 3
        ? pageResult([kcUser(`kc-${options.page}`)], options.page, options.size, 60, 3)
        : pageResult([kcUser('kc-last')], 0, options.size, 5, 1))
    })
    wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.admin-pagination button')[1].trigger('click')
    await flushPromises()
    await wrapper.findAll('.admin-pagination button')[1].trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', expect.objectContaining({ page: 2 }))

    await wrapper.find('.admin-table thead input[type="checkbox"]').setValue(true)
    await wrapper.find('.admin-bulk-bar .btn-danger').trigger('click')
    await wrapper.find('.bulk-confirm-modal .admin-confirm-input').setValue('DELETE')
    await wrapper.find('.bulk-confirm-modal .modal-actions .btn-danger').trigger('click')
    await flushPromises()

    // 先按 page=2 重新加载，发现 totalPages=1 后回落到最后一个有效页 page=0。
    expect(requestedPages.slice(-2)).toEqual([2, 0])
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=1,total=1,items=5)')
    expect(wrapper.findAll('.admin-pagination button')[0].attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.admin-pagination button')[1].attributes('disabled')).toBeDefined()
  })

  it('switches to the local profile segment and never sends an IdP alias there', async () => {
    wrapper = mountPage()
    await flushPromises()

    const idpInput = wrapper.find('.admin-filters input')
    expect(idpInput.attributes('disabled')).toBeUndefined()
    await idpInput.setValue('juhe-qq')
    await idpInput.trigger('keyup.enter')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'keycloak', idpAlias: 'juhe-qq', page: 0, size: 25
    })

    await wrapper.find('.admin-filters select').setValue('local')
    await flushPromises()
    // local segment：IdP 输入禁用、值清空，请求不带 idpAlias（否则后端 400）。
    expect(idpInput.attributes('disabled')).toBeDefined()
    expect(idpInput.element.value).toBe('')
    expect(wrapper.find('.admin-filter-hint').text()).toBe('admin.idpAliasKeycloakOnly')
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'local', idpAlias: '', page: 0, size: 25
    })
  })

  it('marks Keycloak-only and orphan rows and blocks detail for a missing Keycloak user', async () => {
    api.searchUsers.mockResolvedValue(pageResult([
      kcUser('kc-only'),
      kcUser('kc-orphan', {
        profileId: 9,
        displayName: 'Orphan',
        wotbAccountId: 100,
        wotbNickname: 'OrphanNick',
        wotbServer: 'CN',
        hasLocalProfile: true,
        keycloakUserMissing: true
      })
    ], 0, 25, 2, 1))
    wrapper = mountPage()
    await flushPromises()

    const badges = wrapper.findAll('.admin-table .badge')
    expect(badges.map(badge => badge.text())).toEqual(['admin.noLocalProfile', 'admin.kcUserMissing'])
    expect(badges[1].classes()).toContain('badge-warn')

    // 孤儿绑定：删除仍可用（释放唯一槽位），详情不可用（Keycloak 侧已无该用户）。
    const actions = rows()[1].findAll('.cell-actions button')
    expect(actions[0].attributes('disabled')).toBeDefined()
    expect(actions[0].attributes('title')).toBe('admin.detailUnavailable')
    expect(actions[1].attributes('disabled')).toBeUndefined()
    expect(rows()[0].findAll('.cell-actions button')[0].attributes('disabled')).toBeUndefined()
  })
})
