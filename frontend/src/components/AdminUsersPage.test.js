// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminUsersPage from './AdminUsersPage.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { ConnectivityState } from '../platform/connectivity.js'
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

vi.mock('../utils/api.js', () => ({
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

/** 离线用浏览器事件驱动；unknown / degraded / service-unavailable 直接注入状态。 */
function goOffline() {
  setOnline(false)
  window.dispatchEvent(new Event('offline'))
}

function setConnectivityState(state) {
  useConnectivity().setStateForTest(state)
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

/** 表格数据行（两个 describe 共用）。 */
function rows(wrapper) {
  return wrapper.findAll('.admin-table tbody tr')
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
    const confirmButton = modal.find('.dialog-actions .btn-danger')
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
    await wrapper.find('.bulk-confirm-modal .dialog-actions .btn-danger').trigger('click')
    await flushPromises()

    const modal = wrapper.find('.bulk-confirm-modal')
    expect(modal.text()).toContain('admin.bulkSummary(requested=2,deleted=1,failed=1)')
    expect(modal.text()).toContain('admin.bulkFailures')
    expect(modal.text()).toContain('kc-b')
    expect(modal.text()).toContain('code:USER_HAS_DEPENDENCIES')
    // 失败项保留选择以便重试，成功项移出选择集。
    expect(wrapper.find('.admin-selected').text()).toBe('admin.selectedCount(count=1)')

    await modal.find('.dialog-actions .btn-sm').trigger('click')
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
    await wrapper.find('.bulk-confirm-modal .dialog-actions .btn-danger').trigger('click')
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
    await idpInput.setValue('qq')
    await idpInput.trigger('keyup.enter')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'keycloak', idpAlias: 'qq', page: 0, size: 25
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

  // —— PG-09 / PG-10：详情与删除确认统一 AppDialog；操作列与复选框在手机上可达 ——
  it('opens user detail in an accessible dialog and closes it with Escape', async () => {
    api.getUser.mockResolvedValue({ profile: null, keycloak: { id: 'kc-a', username: 'kc-a-name', email: 'a@example.com', enabled: true }, warnings: [] })
    wrapper = mountPage()
    await flushPromises()

    await rows()[0].findAll('.cell-actions button')[0].trigger('click')
    await flushPromises()
    const dialog = wrapper.find('.detail-modal')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.text()).toContain('kc-a-name')

    await dialog.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.detail-modal').exists()).toBe(false)
  })

  it('confirms a single delete in a danger dialog that Escape cancels without calling the API', async () => {
    wrapper = mountPage()
    await flushPromises()

    await rows()[0].find('.cell-actions .btn-danger').trigger('click')
    const dialog = wrapper.find('.confirm-modal')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.classes()).toContain('is-danger')
    await dialog.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(api.deleteUsers).not.toHaveBeenCalled()
  })

  it('keeps the action column sticky and wraps checkboxes in an enlarged hit area', async () => {
    wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.admin-table thead th.cell-actions').exists()).toBe(true)
    for (const row of rows()) {
      expect(row.find('td.cell-actions').exists()).toBe(true)
      expect(row.find('td.cell-check label.check-hit input[type="checkbox"]').exists()).toBe(true)
    }
  })
})

/**
 * PR #467 review blocker：Admin Users 整体是 ONLINE_REQUIRED，且门禁必须**先于认证**。
 *
 * 不变量：非-online ⇒ 0 次 login()、0 次 token refresh 网络路径、0 次 admin API，
 * 并且立刻给出统一 connectivity notice（offline 用功能文案，unknown/degraded/
 * service-unavailable 用各自的 connectivityNotice 文案 —— 不谎称「你离线」）。
 */
describe('AdminUsersPage connectivity gating', () => {
  let wrapper

  function mountPage() {
    return mount(AdminUsersPage, { global: { mocks: { $t: i18n.translate }, provide: { [DIALOG_INLINE_KEY]: true } } })
  }

  function expectZeroBackendWork() {
    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(api.getUser).not.toHaveBeenCalled()
    expect(api.deleteUsers).not.toHaveBeenCalled()
    // 门禁在认证之前：既不 ensureToken（无 token refresh 网络路径）也不 login（不跳登录页）。
    expect(auth.ensureToken).not.toHaveBeenCalled()
    expect(auth.login).not.toHaveBeenCalled()
  }

  beforeEach(async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a'), kcUser('kc-b')], options.page, options.size, 2, 1)
    ))
    api.deleteUsers.mockResolvedValue({ requested: 1, deleted: 1, failed: 0, results: [{ userId: 'kc-a', deleted: true }] })
    auth.ensureToken.mockResolvedValue(true)
    // 先真正启动一次来源（否则 setStateForTest 没有 store 可注入），每个用例再自行改状态。
    await goOnline()
    useConnectivityNotice().close()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
    useConnectivity().stop()
    useConnectivityNotice().close()
    setOnline(true)
  })

  it('offline mount issues zero login, zero token refresh and zero admin API, and shows the notice', async () => {
    setOnline(false)
    useConnectivity().stop()
    await useConnectivity().start()
    useConnectivityNotice().close()

    wrapper = mountPage()
    await flushPromises()

    expectZeroBackendWork()
    // 中性状态可见（不是 error 态），文案来自 capability 模型。
    expect(wrapper.find('[data-testid="admin-connectivity-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('featureOffline.adminUsers')
    // 用户点击时立刻得到统一提示，而不是等超时后的 generic error。
    expect(useConnectivityNotice().visible.value).toBe(true)
    expect(useConnectivityNotice().notice.value.messageKey).toBe('featureOffline.adminUsers')
  })

  it.each([
    [ConnectivityState.UNKNOWN, 'connectivityNotice.unknown'],
    [ConnectivityState.DEGRADED, 'connectivityNotice.degraded'],
    [ConnectivityState.SERVICE_UNAVAILABLE, 'connectivityNotice.serviceUnavailable'],
  ])('%s mount issues zero requests and never claims the user is offline', async (state, messageKey) => {
    setConnectivityState(state)
    useConnectivityNotice().close()

    wrapper = mountPage()
    await flushPromises()

    expectZeroBackendWork()
    expect(wrapper.text()).toContain(messageKey)
    expect(wrapper.text()).not.toContain('featureOffline.adminUsers')
    expect(useConnectivityNotice().notice.value.messageKey).toBe(messageKey)
  })

  it('online unauthenticated keeps the existing auth behavior (ensureToken then login)', async () => {
    await goOnline()
    auth.ensureToken.mockResolvedValue(false)

    wrapper = mountPage()
    await flushPromises()

    expect(auth.ensureToken).toHaveBeenCalledTimes(1)
    expect(auth.login).toHaveBeenCalledTimes(1)
    expect(api.searchUsers).not.toHaveBeenCalled()
  })

  it('online authenticated loads the first page exactly once', async () => {
    await goOnline()
    wrapper = mountPage()
    await flushPromises()

    expect(auth.ensureToken).toHaveBeenCalledTimes(1)
    expect(auth.login).not.toHaveBeenCalled()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)
    expect(api.searchUsers).toHaveBeenCalledWith('', {
      segment: 'keycloak', idpAlias: '', page: 0, size: 25
    })
  })

  it('offline search / segment / IdP alias / page size / pagination never reach the backend', async () => {
    await goOnline()
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a')], options.page, options.size, 60, 3)
    ))
    wrapper = mountPage()
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)

    goOffline()
    await flushPromises()
    api.searchUsers.mockClear()
    auth.ensureToken.mockClear()

    await wrapper.find('.admin-search input').setValue('foo')
    await wrapper.find('.admin-search button').trigger('click')
    await wrapper.find('.admin-filters input').setValue('qq')
    await wrapper.find('.admin-filters input').trigger('keyup.enter')
    await wrapper.find('.admin-filters select').setValue('local')
    await wrapper.find('.admin-pagination select').setValue('50')
    await wrapper.findAll('.admin-pagination button')[1].trigger('click')
    await flushPromises()

    // 掉线后所有会改可见行集合的动作都没有 backend 出口（也不再走 token 路径）。
    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(auth.ensureToken).not.toHaveBeenCalled()
  })

  it('offline detail never calls adminGetUser', async () => {
    await goOnline()
    wrapper = mountPage()
    await flushPromises()

    goOffline()
    await flushPromises()
    api.getUser.mockClear()

    await rows(wrapper)[0].findAll('.cell-actions button')[0].trigger('click')
    await flushPromises()

    expect(api.getUser).not.toHaveBeenCalled()
    expect(wrapper.find('.detail-modal').exists()).toBe(false)
  })

  it('single delete TOCTOU: a dialog opened online but confirmed offline sends nothing', async () => {
    await goOnline()
    wrapper = mountPage()
    await flushPromises()

    // 在线时打开删除确认框并输入 DELETE。
    await rows(wrapper)[0].find('.cell-actions .btn-danger').trigger('click')
    const modal = wrapper.find('.confirm-modal')
    await modal.find('.admin-confirm-input').setValue('DELETE')
    expect(modal.find('.dialog-actions .btn-danger').attributes('disabled')).toBeUndefined()

    // 确认前掉线。
    goOffline()
    await flushPromises()
    api.deleteUsers.mockClear()

    await wrapper.find('.confirm-modal .dialog-actions .btn-danger').trigger('click')
    await flushPromises()

    expect(api.deleteUsers).not.toHaveBeenCalled()
    expect(useConnectivityNotice().notice.value.messageKey).toBe('featureOffline.adminUsers')
  })

  it('bulk delete TOCTOU: a batch dialog opened online but confirmed offline sends nothing', async () => {
    await goOnline()
    wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.admin-table thead input[type="checkbox"]').setValue(true)
    await wrapper.find('.admin-bulk-bar .btn-danger').trigger('click')
    await wrapper.find('.bulk-confirm-modal .admin-confirm-input').setValue('DELETE')

    goOffline()
    await flushPromises()
    api.deleteUsers.mockClear()

    await wrapper.find('.bulk-confirm-modal .dialog-actions .btn-danger').trigger('click')
    await flushPromises()

    expect(api.deleteUsers).not.toHaveBeenCalled()
    expect(useConnectivityNotice().notice.value.messageKey).toBe('featureOffline.adminUsers')
  })

  it('keeps already loaded rows, selection and pagination across a disconnect', async () => {
    await goOnline()
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser(`kc-p${options.page}`)], options.page, options.size, 60, 3)
    ))
    wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.admin-pagination button')[1].trigger('click')
    await flushPromises()
    await wrapper.find('.admin-table thead input[type="checkbox"]').setValue(true)
    expect(wrapper.find('.admin-selected').text()).toBe('admin.selectedCount(count=1)')

    goOffline()
    await flushPromises()

    // 掉线不清空数据 / 不登出 / 不整页重载：只挡住新的 ONLINE_REQUIRED 动作。
    expect(rows(wrapper).length).toBe(1)
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=2,total=3,items=60)')
    expect(wrapper.find('.admin-selected').text()).toBe('admin.selectedCount(count=1)')
    expect(wrapper.find('[data-testid="admin-connectivity-unavailable"]').exists()).toBe(true)
    expect(api.searchUsers).toHaveBeenCalledTimes(2)
    // 会改变 server-backed 结果集的控件在非-online 时不可用，避免「显示改了、数据没改」。
    const paginationButtons = wrapper.findAll('.admin-pagination button')
    expect(paginationButtons[0].attributes('disabled')).toBeDefined()
    expect(paginationButtons[1].attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-pagination select').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-search button').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-filters select').attributes('disabled')).toBeDefined()
  })

  it('reconnect after an offline mount loads once and never replays a destructive action', async () => {
    setOnline(false)
    useConnectivity().stop()
    await useConnectivity().start()
    useConnectivityNotice().close()
    wrapper = mountPage()
    await flushPromises()
    expectZeroBackendWork()

    await goOnline()
    await flushPromises()
    await flushPromises()

    // 只补一次列表；不重放删除 / 批量删除。
    expect(api.searchUsers).toHaveBeenCalledTimes(1)
    expect(api.deleteUsers).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="admin-connectivity-unavailable"]').exists()).toBe(false)

    // 重复的 online 通知（重连抖动）不得形成请求风暴。
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)
  })
})

/**
 * review P2：非-online 时，会改变 server-backed 结果集的动作必须**先门禁、后改状态**。
 *
 * 不变量：applied state（rows / page / size / segment / selection）永远与最后一次成功加载一致。
 * 即使控件被程序化地绕过 disabled（setValue 会先摘掉 disabled），handler 也必须回滚，而不是留下
 * 「UI 显示已改、数据没改」的假 applied 状态。
 */
describe('AdminUsersPage applied-state consistency while offline', () => {
  let wrapper

  function mountPage() {
    return mount(AdminUsersPage, { global: { mocks: { $t: i18n.translate }, provide: { [DIALOG_INLINE_KEY]: true } } })
  }

  /** 三页 fixture：行 id 带上 segment 与 page，便于断言「rows 真的没变」。 */
  function threePageSearchImpl() {
    return (_query, options) => Promise.resolve(pageResult(
      [kcUser(`kc-${options.segment}-p${options.page}`)],
      options.page, options.size, 60, 3
    ))
  }

  beforeEach(async () => {
    api.searchUsers.mockImplementation(threePageSearchImpl())
    api.deleteUsers.mockResolvedValue({ requested: 1, deleted: 1, failed: 0, results: [] })
    auth.ensureToken.mockResolvedValue(true)
    await goOnline()
    useConnectivityNotice().close()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
    useConnectivity().stop()
    useConnectivityNotice().close()
    setOnline(true)
  })

  function appliedText() {
    return {
      pageInfo: wrapper.find('.admin-page-info').text(),
      // keycloakUserId 列（与 keycloakUsername 同格的 .cell-mono）。
      rowId: rows(wrapper)[0].find('.cell-mono').text(),
      size: wrapper.find('.admin-pagination select').element.value,
      segment: wrapper.find('.admin-filters select').element.value,
    }
  }

  /**
   * 选择框的真实浏览器语义：先改 value，再冒泡派发 change。
   * happy-dom 下 `wrapper.setValue()` 对 select 不会派发 change（已实测），因此这里显式派发，
   * 同时覆盖「程序化绕过 disabled」这条路径 —— handler 必须回滚而不是留下假 applied 状态。
   */
  async function chooseOption(selector, value) {
    const select = wrapper.find(selector)
    select.element.value = value
    select.element.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
  }

  it('CASE A: offline next-page click keeps the applied page and rows', async () => {
    wrapper = mountPage()
    await flushPromises()
    const before = appliedText()
    expect(before.pageInfo).toBe('admin.pageInfo(page=1,total=3,items=60)')
    expect(before.rowId).toBe('kc-keycloak-p0')

    goOffline()
    await flushPromises()
    api.searchUsers.mockClear()

    // 正常路径：按钮 disabled（浏览器不会派发 click）；这里摘掉 disabled 再点击，等于绕过控件层
    // 直接调用 handler，证明「门禁」本身也守住了 applied page —— 否则 UI 会显示 page=2 而 rows
    // 还是第 1 页。（happy-dom 对 disabled 元素不会派发 click，因此必须先摘掉。）
    const next = wrapper.findAll('.admin-pagination button')[1]
    expect(next.attributes('disabled')).toBeDefined()
    next.element.removeAttribute('disabled')
    next.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('.admin-page-info').text()).toBe(before.pageInfo)
    expect(rows(wrapper)[0].find('.cell-mono').text()).toBe(before.rowId)
  })

  it('CASE B: offline page-size change reverts to the applied size', async () => {
    wrapper = mountPage()
    await flushPromises()
    const before = appliedText()
    expect(before.size).toBe('25')

    goOffline()
    await flushPromises()
    api.searchUsers.mockClear()

    // 程序化绕过 disabled（模拟无障碍 / 脚本调用）：handler 仍必须保持 applied state。
    await chooseOption('.admin-pagination select', '50')

    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('.admin-pagination select').element.value).toBe('25')
    expect(wrapper.find('.admin-page-info').text()).toBe(before.pageInfo)
    expect(rows(wrapper)[0].find('.cell-mono').text()).toBe(before.rowId)
  })

  it('CASE C: offline segment change reverts to the applied segment', async () => {
    wrapper = mountPage()
    await flushPromises()
    const before = appliedText()
    expect(before.segment).toBe('keycloak')

    goOffline()
    await flushPromises()
    api.searchUsers.mockClear()

    await chooseOption('.admin-filters select', 'local')

    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('.admin-filters select').element.value).toBe('keycloak')
    expect(rows(wrapper)[0].find('.cell-mono').text()).toBe(before.rowId)
    // 仍是 keycloak 段：IdP 输入不被清空、也不被禁用。
    expect(wrapper.find('.admin-filters input').attributes('disabled')).toBeUndefined()
  })

  it('CASE D: offline search submit and row actions are unavailable', async () => {
    wrapper = mountPage()
    await flushPromises()
    const before = appliedText()

    goOffline()
    await flushPromises()
    api.searchUsers.mockClear()
    api.getUser.mockClear()

    expect(wrapper.find('.admin-search button').attributes('disabled')).toBeDefined()
    await wrapper.find('.admin-search button').trigger('click')
    for (const button of rows(wrapper)[0].findAll('.cell-actions button')) {
      expect(button.attributes('disabled')).toBeDefined()
      await button.trigger('click')
    }
    await flushPromises()

    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(api.getUser).not.toHaveBeenCalled()
    expect(api.deleteUsers).not.toHaveBeenCalled()
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.admin-page-info').text()).toBe(before.pageInfo)
    expect(rows(wrapper)[0].find('.cell-mono').text()).toBe(before.rowId)
  })

  it('CASE E: a draft search query is never treated as applied after reconnect', async () => {
    wrapper = mountPage()
    await flushPromises()
    api.searchUsers.mockClear()

    goOffline()
    await flushPromises()
    // 草稿输入允许继续编辑，但它不是已应用条件：提交被门禁挡住。
    await wrapper.find('.admin-search input').setValue('draft-query')
    await wrapper.find('.admin-search button').trigger('click')
    await flushPromises()
    expect(api.searchUsers).not.toHaveBeenCalled()

    await goOnline()
    await flushPromises()
    await flushPromises()

    // reconnect 后不得自动把草稿当成已应用查询。
    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=1,total=3,items=60)')
    expect(rows(wrapper)[0].find('.cell-mono').text()).toBe('kc-keycloak-p0')

    // 用户显式提交后才生效。
    await wrapper.find('.admin-search button').trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)
    expect(api.searchUsers).toHaveBeenCalledWith('draft-query', expect.objectContaining({ page: 0 }))
  })
})
