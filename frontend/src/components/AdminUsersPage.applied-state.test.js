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
      segment: wrapper.find('.segmented-option.is-active').attributes('data-value'),
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
    const next = wrapper.find('.admin-page-next')
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

    // 分段按钮 disabled；摘掉后直接派发 click，等于绕过控件层，handler 的门禁仍必须守住已应用的数据源。
    const local = wrapper.find('[data-testid="admin-segment-local"]')
    expect(local.attributes('disabled')).toBeDefined()
    local.element.removeAttribute('disabled')
    local.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('.segmented-option.is-active').attributes('data-value')).toBe('keycloak')
    expect(rows(wrapper)[0].find('.cell-mono').text()).toBe(before.rowId)
    // 仍是 keycloak 段：IdP 输入不被清空、也不被禁用。
    expect(wrapper.find('[data-testid="admin-idp-input"]').attributes('disabled')).toBeUndefined()
  })

  it('CASE D: offline search submit and row actions are unavailable', async () => {
    wrapper = mountPage()
    await flushPromises()
    const before = appliedText()

    goOffline()
    await flushPromises()
    api.searchUsers.mockClear()
    api.getUser.mockClear()

    expect(wrapper.find('[data-testid="admin-search-btn"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="admin-search-btn"]').trigger('click')
    // 行仍可点开抽屉（显示已加载的字段），但不请求详情，删除入口不可用。
    await rows(wrapper)[0].find('[data-testid="admin-row-open"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="admin-danger-start"]').attributes('disabled')).toBeDefined()

    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(api.getUser).not.toHaveBeenCalled()
    expect(api.deleteUsers).not.toHaveBeenCalled()
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
    await wrapper.find('[data-testid="admin-search-input"]').setValue('draft-query')
    await wrapper.find('[data-testid="admin-search-btn"]').trigger('click')
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
    await wrapper.find('[data-testid="admin-search-btn"]').trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)
    expect(api.searchUsers).toHaveBeenCalledWith('draft-query', expect.objectContaining({ page: 0 }))
  })
})
