// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminUsersPage from './AdminUsersPage.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { ConnectivityState } from '../platform/connectivity.js'
import { useConnectivity } from '../composables/useConnectivity.js'
import { useConnectivityNotice } from '../composables/useConnectivityNotice.js'

// Reka 的 Esc 由 document 级监听处理（最上层对话框响应）
async function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flushPromises()
}

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

    await wrapper.find('[data-testid="admin-search-input"]').setValue('foo')
    await wrapper.find('[data-testid="admin-search-btn"]').trigger('click')
    await wrapper.find('[data-testid="admin-idp-input"]').setValue('qq')
    await wrapper.find('[data-testid="admin-idp-input"]').trigger('keyup.enter')
    await wrapper.find('[data-testid="admin-segment-local"]').trigger('click')
    await wrapper.find('.admin-pagination select').setValue('50')
    await wrapper.find('.admin-page-next').trigger('click')
    // 跳页控件本身 disabled；再绕过 disabled 直接派发输入 / click，handler 的门禁仍必须挡住。
    const jumpInput = wrapper.find('.admin-page-jump input')
    const jumpGo = wrapper.find('.admin-page-go')
    expect(jumpInput.attributes('disabled')).toBeDefined()
    expect(jumpGo.attributes('disabled')).toBeDefined()
    jumpInput.element.removeAttribute('disabled')
    jumpGo.element.removeAttribute('disabled')
    await jumpInput.setValue('3')
    jumpGo.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

    await rows(wrapper)[0].find('[data-testid="admin-row-open"]').trigger('click')
    await flushPromises()

    // 抽屉可以显示列表行已有的字段，但详情请求被门禁挡住；删除入口不可用。
    expect(api.getUser).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="admin-detail-drawer"] [data-testid="admin-danger-start"]').attributes('disabled')).toBeDefined()
  })

  it('single delete TOCTOU: a dialog opened online but confirmed offline sends nothing', async () => {
    await goOnline()
    wrapper = mountPage()
    await flushPromises()

    // 在线时打开抽屉、展开删除确认并输入 DELETE。
    await rows(wrapper)[0].find('[data-testid="admin-row-open"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="admin-danger-start"]').trigger('click')
    await wrapper.find('[data-testid="admin-danger-input"]').setValue('DELETE')
    expect(wrapper.find('[data-testid="admin-danger-confirm"]').attributes('disabled')).toBeUndefined()

    // 确认前掉线。
    goOffline()
    await flushPromises()
    api.deleteUsers.mockClear()

    await wrapper.find('[data-testid="admin-danger-confirm"]').trigger('click')
    await flushPromises()

    expect(api.deleteUsers).not.toHaveBeenCalled()
    expect(useConnectivityNotice().notice.value.messageKey).toBe('featureOffline.adminUsers')
  })

  it('bulk delete TOCTOU: a batch dialog opened online but confirmed offline sends nothing', async () => {
    await goOnline()
    wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.admin-table thead input[type="checkbox"]').setValue(true)
    await wrapper.find('[data-testid="admin-bulk-delete"]').trigger('click')
    await wrapper.find('.bulk-confirm-modal .admin-confirm-input').setValue('DELETE')

    goOffline()
    await flushPromises()
    api.deleteUsers.mockClear()

    await wrapper.find('.bulk-confirm-modal .bulk-confirm').trigger('click')
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
    await wrapper.find('.admin-page-next').trigger('click')
    await flushPromises()
    await wrapper.find('.admin-table thead input[type="checkbox"]').setValue(true)
    expect(wrapper.find('.admin-bulk-summary').text()).toBe('admin.selectedCount(count=1)')

    goOffline()
    await flushPromises()

    // 掉线不清空数据 / 不登出 / 不整页重载：只挡住新的 ONLINE_REQUIRED 动作。
    expect(rows(wrapper).length).toBe(1)
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=2,total=3,items=60)')
    expect(wrapper.find('.admin-bulk-summary').text()).toBe('admin.selectedCount(count=1)')
    expect(wrapper.find('[data-testid="admin-connectivity-unavailable"]').exists()).toBe(true)
    expect(api.searchUsers).toHaveBeenCalledTimes(2)
    // 会改变 server-backed 结果集的控件在非-online 时不可用，避免「显示改了、数据没改」。
    expect(wrapper.find('.admin-page-prev').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-page-next').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-page-jump input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-page-go').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-pagination select').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="admin-search-btn"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="admin-segment-local"]').attributes('disabled')).toBeDefined()
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
