// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminUsersPage from './AdminUsersPage.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { ConnectivityState } from '../platform/connectivity.js'
import { useConnectivity } from '../composables/useConnectivity.js'
import { useConnectivityNotice } from '../composables/useConnectivityNotice.js'

async function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flushPromises()
}

const api = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  getUser: vi.fn(),
  deleteUsers: vi.fn()
}))

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

const i18n = vi.hoisted(() => ({
  translate: (key, params) => (params
    ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`
    : key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.translate, te: () => true })
}))

function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

async function goOnline() {
  setOnline(true)
  useConnectivity().stop()
  await useConnectivity().start()
}

function goOffline() {
  setOnline(false)
  window.dispatchEvent(new Event('offline'))
}

function setConnectivityState(state) {
  useConnectivity().setStateForTest(state)
}

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
    expect(auth.ensureToken).not.toHaveBeenCalled()
    expect(auth.login).not.toHaveBeenCalled()
  }

  beforeEach(async () => {
    api.searchUsers.mockImplementation((_query, options) => Promise.resolve(
      pageResult([kcUser('kc-a'), kcUser('kc-b')], options.page, options.size, 2, 1)
    ))
    api.deleteUsers.mockResolvedValue({ requested: 1, deleted: 1, failed: 0, results: [{ userId: 'kc-a', deleted: true }] })
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

  it('offline mount issues zero login, zero token refresh and zero admin API, and shows the notice', async () => {
    setOnline(false)
    useConnectivity().stop()
    await useConnectivity().start()
    useConnectivityNotice().close()

    wrapper = mountPage()
    await flushPromises()

    expectZeroBackendWork()
    expect(wrapper.find('[data-testid="admin-connectivity-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('featureOffline.adminUsers')
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
    await wrapper.get('[data-testid=admin-page-size] [data-value="50"]').trigger('click')
    await wrapper.find('.admin-page-next').trigger('click')
    const jumpInput = wrapper.find('.admin-page-jump input')
    const jumpGo = wrapper.find('.admin-page-go')
    expect(jumpInput.attributes('disabled')).toBeDefined()
    expect(jumpGo.attributes('disabled')).toBeDefined()
    jumpInput.element.removeAttribute('disabled')
    jumpGo.element.removeAttribute('disabled')
    await jumpInput.setValue('3')
    jumpGo.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

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

    expect(api.getUser).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="admin-detail-drawer"] [data-testid="admin-danger-start"]').attributes('disabled')).toBeDefined()
  })

  it('single delete TOCTOU: a dialog opened online but confirmed offline sends nothing', async () => {
    await goOnline()
    wrapper = mountPage()
    await flushPromises()

    await rows(wrapper)[0].find('[data-testid="admin-row-open"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="admin-danger-start"]').trigger('click')
    await wrapper.find('[data-testid="admin-danger-input"]').setValue('DELETE')
    expect(wrapper.find('[data-testid="admin-danger-confirm"]').attributes('disabled')).toBeUndefined()

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

    expect(rows(wrapper).length).toBe(1)
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=2,total=3,items=60)')
    expect(wrapper.find('.admin-bulk-summary').text()).toBe('admin.selectedCount(count=1)')
    expect(wrapper.find('[data-testid="admin-connectivity-unavailable"]').exists()).toBe(true)
    expect(api.searchUsers).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.admin-page-prev').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-page-next').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-page-jump input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.admin-page-go').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid=admin-page-size] [data-value="50"]').attributes('disabled')).toBeDefined()
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

    expect(api.searchUsers).toHaveBeenCalledTimes(1)
    expect(api.deleteUsers).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="admin-connectivity-unavailable"]').exists()).toBe(false)

    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)
  })
})

