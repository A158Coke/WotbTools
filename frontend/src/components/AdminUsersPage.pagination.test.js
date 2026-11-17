// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminUsersPage from './AdminUsersPage.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { useConnectivity } from '../composables/useConnectivity.js'
import { useConnectivityNotice } from '../composables/useConnectivityNotice.js'

const api = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  getUser: vi.fn(),
  deleteUsers: vi.fn()
}))

// login / ensureToken 必须可断言：离线时页面**不允许**走到认证路径（既不 refresh 也不跳登录）。
const auth = vi.hoisted(() => ({
  ensureToken: vi.fn(() => Promise.resolve(true)),
  login: vi.fn()
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(true),
    ensureToken: auth.ensureToken,
    login: auth.login,
  })
}))

vi.mock('../api/admin-users.js', () => ({
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

/**
 * 连通性夹具：AdminUsersPage 是 ONLINE_REQUIRED，本套件用**真实** connectivity store
 * （只替换 navigator.onLine），从而验证「门禁 → 认证 → backend」的真实顺序。
 */
function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

async function goOnline() {
  setOnline(true)
  useConnectivity().stop()
  await useConnectivity().start()
}

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

  beforeEach(async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a'), kcUser('kc-b')], options.page, options.size, 2, 1)
    ))
    api.deleteUsers.mockResolvedValue({ requested: 2, deleted: 2, failed: 0, results: [] })
    auth.ensureToken.mockResolvedValue(true)
    // 默认在线：绝大多数用例测的是页面行为，不是连通性。
    await goOnline()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
    useConnectivity().stop()
    useConnectivityNotice().close()
    setOnline(true)
  })

  function mountPage() {
    return mount(AdminUsersPage, { global: { mocks: { $t: i18n.translate }, provide: { [DIALOG_INLINE_KEY]: true } } })
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

    const prev = wrapper.find('.admin-page-prev')
    const next = wrapper.find('.admin-page-next')
    expect(prev.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'keycloak', idpAlias: '', page: 1, size: 25
    })
    expect(wrapper.find('.admin-page-info').text())
      .toBe('admin.pageInfo(page=2,total=3,items=60)')

    await wrapper.find('.admin-page-prev').trigger('click')
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

  // 指定页跳转：UI 页码 1-based → 后端 page 0-based，一次直达目标页（不加载中间页）
  it('jumps straight to the requested page with 1-based input mapped to 0-based backend page', async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser(`kc-page-${options.page}`)], options.page, options.size, 6000, 120)
    ))
    wrapper = mountPage()
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)

    const input = wrapper.find('.admin-page-jump input')
    await input.setValue('20')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(2)
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'keycloak', idpAlias: '', page: 19, size: 25,
    })
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=20,total=120,items=6000)')
    expect(input.element.value).toBe('')

    // UI 第 1 页 → 后端 page=0
    await input.setValue('1')
    await wrapper.find('.admin-page-go').trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', expect.objectContaining({ page: 0 }))
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=1,total=120,items=6000)')
  })

  it('ignores blank / out-of-range / non-integer / current-page jump input', async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a')], options.page, options.size, 6000, 120)
    ))
    wrapper = mountPage()
    await flushPromises()
    const input = wrapper.find('.admin-page-jump input')
    const go = wrapper.find('.admin-page-go')

    for (const raw of ['', '0', '121', '2.5', 'abc']) {
      await input.setValue(raw)
      await input.trigger('keydown.enter')
      await go.trigger('click')
      await flushPromises()
      expect(api.searchUsers).toHaveBeenCalledTimes(1)
    }

    // 当前页（UI 第 1 页）不重复请求
    await input.setValue('1')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)
  })

  it('clears the current-page selection when jumping to another page', async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a'), kcUser('kc-b')], options.page, options.size, 6000, 120)
    ))
    wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.admin-table thead input[type="checkbox"]').setValue(true)
    expect(wrapper.find('.admin-bulk-summary').text()).toBe('admin.selectedCount(count=2)')

    const input = wrapper.find('.admin-page-jump input')
    await input.setValue('3')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(api.searchUsers).toHaveBeenLastCalledWith('', expect.objectContaining({ page: 2 }))
    expect(wrapper.find('.admin-bulk-bar').exists()).toBe(false)
  })

  it('resets to page 0 when the search query changes', async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a')], options.page, options.size, 60, 3)
    ))
    wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.admin-page-next').trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', expect.objectContaining({ page: 1 }))

    await wrapper.find('[data-testid="admin-search-input"]').setValue('foo')
    await wrapper.find('[data-testid="admin-search-btn"]').trigger('click')
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
    expect(wrapper.find('.admin-bulk-summary').text()).toBe('admin.selectedCount(count=2)')

    // 取消一行 → 计数跟随（partial selection 时不勾表头）。
    await rows()[1].find('input[type="checkbox"]').setValue(false)
    expect(wrapper.find('.admin-bulk-summary').text()).toBe('admin.selectedCount(count=1)')
    expect(headCheckbox.element.checked).toBe(false)

    await wrapper.find('[data-testid="admin-bulk-delete"]').trigger('click')
    expect(api.deleteUsers).not.toHaveBeenCalled()
    const modal = wrapper.find('.bulk-confirm-modal')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('admin.bulkConfirmText(count=1)')

    // 未输入 DELETE 前不可提交。
    const confirmButton = modal.find('.bulk-confirm')
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
    await wrapper.find('[data-testid="admin-bulk-delete"]').trigger('click')
    await wrapper.find('.bulk-confirm-modal .admin-confirm-input').setValue('DELETE')
    await wrapper.find('.bulk-confirm-modal .bulk-confirm').trigger('click')
    await flushPromises()

    const modal = wrapper.find('.bulk-confirm-modal')
    expect(modal.text()).toContain('admin.bulkSummary(requested=2,deleted=1,failed=1)')
    expect(modal.text()).toContain('admin.bulkFailures')
    expect(modal.text()).toContain('kc-b')
    expect(modal.text()).toContain('code:USER_HAS_DEPENDENCIES')
    // 失败项保留选择以便重试，成功项移出选择集。
    expect(wrapper.find('.admin-bulk-summary').text()).toBe('admin.selectedCount(count=1)')

    await modal.find('.bulk-cancel').trigger('click')
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
    await wrapper.find('.admin-page-next').trigger('click')
    await flushPromises()
    await wrapper.find('.admin-page-next').trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', expect.objectContaining({ page: 2 }))

    await wrapper.find('.admin-table thead input[type="checkbox"]').setValue(true)
    await wrapper.find('[data-testid="admin-bulk-delete"]').trigger('click')
    await wrapper.find('.bulk-confirm-modal .admin-confirm-input').setValue('DELETE')
    await wrapper.find('.bulk-confirm-modal .bulk-confirm').trigger('click')
    await flushPromises()

    // 先按 page=2 重新加载，发现 totalPages=1 后回落到最后一个有效页 page=0。
    expect(requestedPages.slice(-2)).toEqual([2, 0])
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=1,total=1,items=5)')
    expect(wrapper.find('.admin-page-prev').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-page-next').attributes('disabled')).toBeDefined()
  })

})
