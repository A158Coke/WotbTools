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

describe('AdminUsersPage applied-state consistency while offline', () => {
  let wrapper

  function mountPage() {
    return mount(AdminUsersPage, { global: { mocks: { $t: i18n.translate }, provide: { [DIALOG_INLINE_KEY]: true } } })
  }

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
      rowId: rows(wrapper)[0].find('.cell-mono').text(),
      size: wrapper.find('.admin-pagination select').element.value,
      segment: wrapper.find('.segmented-option.is-active').attributes('data-value'),
    }
  }

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

    const local = wrapper.find('[data-testid="admin-segment-local"]')
    expect(local.attributes('disabled')).toBeDefined()
    local.element.removeAttribute('disabled')
    local.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('.segmented-option.is-active').attributes('data-value')).toBe('keycloak')
    expect(rows(wrapper)[0].find('.cell-mono').text()).toBe(before.rowId)
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
    await wrapper.find('[data-testid="admin-search-input"]').setValue('draft-query')
    await wrapper.find('[data-testid="admin-search-btn"]').trigger('click')
    await flushPromises()
    expect(api.searchUsers).not.toHaveBeenCalled()

    await goOnline()
    await flushPromises()
    await flushPromises()

    expect(api.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('.admin-page-info').text()).toBe('admin.pageInfo(page=1,total=3,items=60)')
    expect(rows(wrapper)[0].find('.cell-mono').text()).toBe('kc-keycloak-p0')

    await wrapper.find('[data-testid="admin-search-btn"]').trigger('click')
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledTimes(1)
    expect(api.searchUsers).toHaveBeenCalledWith('draft-query', expect.objectContaining({ page: 0 }))
  })
})
