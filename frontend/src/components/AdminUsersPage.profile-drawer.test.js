// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminUsersPage from './AdminUsersPage.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
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

  it('switches to the local profile segment and never sends an IdP alias there', async () => {
    wrapper = mountPage()
    await flushPromises()

    const idpInput = wrapper.find('[data-testid="admin-idp-input"]')
    expect(idpInput.attributes('disabled')).toBeUndefined()
    await idpInput.setValue('qq')
    await idpInput.trigger('keyup.enter')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenLastCalledWith('', {
      segment: 'keycloak', idpAlias: 'qq', page: 0, size: 25
    })

    await wrapper.find('[data-testid="admin-segment-local"]').trigger('click')
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

    const badges = wrapper.findAll('.admin-table .admin-list-badge')
    expect(badges.map(badge => badge.text())).toEqual(['admin.noLocalProfile', 'admin.kcUserMissing'])
    expect(badges[1].classes()).toContain('is-warning')

    // 孤儿绑定：抽屉能打开并显示列表行字段与说明，但不向 Keycloak 拉详情；删除仍可用（释放唯一槽位）。
    await rows()[1].find('[data-testid="admin-row-open"]').trigger('click')
    await flushPromises()
    const drawer = wrapper.find('[data-testid="admin-detail-drawer"]')
    expect(drawer.exists()).toBe(true)
    expect(drawer.text()).toContain('admin.detailUnavailable')
    expect(drawer.text()).toContain('OrphanNick')
    expect(api.getUser).not.toHaveBeenCalled()
    expect(drawer.find('[data-testid="admin-danger-start"]').attributes('disabled')).toBeUndefined()
  })

  it('a local profile without a game account is shown as unbound, not bound (same rule as the profile page)', async () => {
    api.searchUsers.mockResolvedValue(pageResult([
      kcUser('kc-profile-only', { profileId: 3, displayName: 'test', hasLocalProfile: true, wotbAccountId: null }),
      kcUser('kc-bound', { profileId: 4, displayName: 'Bound', hasLocalProfile: true, wotbAccountId: 3115055801, wotbNickname: 'Nick', wotbServer: 'CN' }),
    ], 0, 25, 2, 1))
    wrapper = mountPage()
    await flushPromises()
    expect(rows()[0].text()).toContain('admin.unbound')
    expect(rows()[0].text()).not.toContain('admin.bound')
    expect(rows()[1].text()).toContain('admin.bound')
    expect(rows()[1].text()).not.toContain('admin.unbound')
  })

  // —— 点行在右侧详情抽屉打开（AppSheet side="end"），不再弹模态框；危险操作在抽屉底部 ——
  async function openDrawer(index = 0) {
    await rows()[index].find('[data-testid="admin-row-open"]').trigger('click')
    await flushPromises()
  }

  it('opens user detail in an accessible right drawer when a row is clicked and closes it with Escape', async () => {
    api.getUser.mockResolvedValue({ profile: null, keycloak: { id: 'kc-a', username: 'kc-a-name', email: 'a@example.com', enabled: true }, warnings: [] })
    wrapper = mountPage()
    await flushPromises()

    // 点整行（非行内控件）与点主列按钮是同一个动作。
    await rows()[0].find('td.admin-list-muted').trigger('click')
    await flushPromises()
    const drawer = wrapper.find('[data-testid="admin-detail-drawer"]')
    expect(drawer.attributes('role')).toBe('dialog')
    expect(drawer.classes()).toContain('is-end')
    expect(api.getUser).toHaveBeenCalledWith('kc-a')
    expect(drawer.text()).toContain('kc-a-name')

    await pressEscape()
    expect(wrapper.find('[data-testid="admin-detail-drawer"]').exists()).toBe(false)
  })

  it('does not open the drawer when a row checkbox is clicked', async () => {
    wrapper = mountPage()
    await flushPromises()
    await rows()[0].find('input[type="checkbox"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="admin-detail-drawer"]').exists()).toBe(false)
  })

  it('keeps single delete at the bottom of the drawer: two steps, DELETE required, Escape cancels without calling the API', async () => {
    wrapper = mountPage()
    await flushPromises()
    await openDrawer()

    const drawer = () => wrapper.find('[data-testid="admin-detail-drawer"]')
    expect(drawer().find('[data-testid="admin-danger-input"]').exists()).toBe(false)
    await drawer().find('[data-testid="admin-danger-start"]').trigger('click')
    const confirm = () => drawer().find('[data-testid="admin-danger-confirm"]')
    expect(confirm().attributes('disabled')).toBeDefined()
    await drawer().find('[data-testid="admin-danger-input"]').setValue('DELET')
    expect(confirm().attributes('disabled')).toBeDefined()
    await drawer().find('[data-testid="admin-danger-input"]').setValue('DELETE')
    expect(confirm().attributes('disabled')).toBeUndefined()
    expect(api.deleteUsers).not.toHaveBeenCalled()

    await pressEscape()
    expect(drawer().exists()).toBe(false)
    expect(api.deleteUsers).not.toHaveBeenCalled()
  })

  it('deletes the opened user through the drawer danger zone', async () => {
    api.deleteUsers.mockResolvedValue({ requested: 1, deleted: 1, failed: 0, results: [{ userId: 'kc-b', deleted: true }] })
    wrapper = mountPage()
    await flushPromises()
    await openDrawer(1)

    const drawer = () => wrapper.find('[data-testid="admin-detail-drawer"]')
    await drawer().find('[data-testid="admin-danger-start"]').trigger('click')
    await drawer().find('[data-testid="admin-danger-input"]').setValue('DELETE')
    await drawer().find('[data-testid="admin-danger-confirm"]').trigger('click')
    await flushPromises()
    expect(api.deleteUsers).toHaveBeenCalledTimes(1)
    expect(api.deleteUsers).toHaveBeenCalledWith(['kc-b'], true)
    expect(drawer().text()).toContain('admin.deleted')
  })

  it('makes every row keyboard-reachable and wraps checkboxes in an enlarged hit area', async () => {
    wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.admin-table thead th.cell-check input[type="checkbox"]').exists()).toBe(true)
    for (const row of rows()) {
      expect(row.find('td.cell-primary button.admin-list-open').exists()).toBe(true)
      expect(row.find('td.cell-check label.admin-list-check input[type="checkbox"]').exists()).toBe(true)
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
