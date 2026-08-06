// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import ProfilePage from './ProfilePage.vue'

let currentProfile = null

const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve(undefined)),
  logout: vi.fn(() => Promise.resolve(undefined))
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(true),
    login: api.login,
    logout: api.logout,
    isAuthenticated: () => true,
    initError: ref(null),
    tokenParsed: ref(null)
  })
}))

vi.mock('../utils/api-boost.js', () => ({
  getUserProfile: () => Promise.resolve(currentProfile),
  createUserProfile: () => Promise.resolve(currentProfile),
  syncUserWotbAccountFromLogin: () => Promise.resolve(null),
  updateUserWotbAccount: () => Promise.resolve(currentProfile),
  deleteUserWotbAccount: () => Promise.resolve(currentProfile),
  getMyBoosterProfile: () => Promise.reject(new Error('no-booster')),
  updateMyBoosterAvailability: () => Promise.resolve({}),
  getMyBoosterAssignments: () => Promise.resolve([]),
  getUserLeaderboardRecords: () => Promise.resolve([]),
  getUnreadNotificationCount: () => Promise.resolve({ count: 0 }),
  listNotifications: () => Promise.resolve([]),
  markAllNotificationsRead: () => Promise.resolve(),
  markNotificationRead: () => Promise.resolve()
}))

vi.mock('../utils/helpers.js', () => ({
  mapLabel: () => ''
}))

vi.mock('../utils/display.js', () => ({
  apiErrorLabel: () => 'api-error',
  enumLabel: () => '--'
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: key => key,
    te: () => true
  })
}))

function mountProfile() {
  return mount(ProfilePage, {
    global: { mocks: { $t: key => key } }
  })
}

function wargamingProfile(server, accountId) {
  return {
    wotbAccountSource: 'WARGAMING',
    wotbServer: server,
    wotbAccountId: accountId,
    wotbNickname: 'PlayerOne',
    displayName: 'PlayerOne'
  }
}

describe('ProfilePage Wargaming regions', () => {
  beforeEach(() => {
    currentProfile = null
  })

  it('ASIA WARGAMING profile shows Asia server and is read-only', async () => {
    currentProfile = wargamingProfile('ASIA', 123)
    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).toContain('profile.serverAsia')
    expect(wrapper.text()).not.toContain('profile.serverCn')
    expect(wrapper.text()).toContain('profile.sourceWargaming')
    expect(wrapper.text()).toContain('profile.verifiedBadge')
    expect(wrapper.text()).not.toContain('profile.edit')
    expect(wrapper.text()).not.toContain('profile.unbind')
    expect(wrapper.text()).not.toContain('profile.setAccount')
  })

  it('EU WARGAMING profile shows Europe server and is read-only', async () => {
    currentProfile = wargamingProfile('EU', 123)
    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).toContain('profile.serverEu')
    expect(wrapper.text()).not.toContain('profile.serverCn')
    expect(wrapper.text()).not.toContain('profile.edit')
    expect(wrapper.text()).not.toContain('profile.unbind')
  })

  it('NA WARGAMING profile shows North America server and is read-only', async () => {
    currentProfile = wargamingProfile('NA', 123)
    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).toContain('profile.serverNa')
    expect(wrapper.text()).not.toContain('profile.serverCn')
    expect(wrapper.text()).not.toContain('profile.edit')
    expect(wrapper.text()).not.toContain('profile.unbind')
  })

  it('WARGAMING source with non-ASIA server still blocks edit and unbind', async () => {
    currentProfile = { ...wargamingProfile('NA', 123), wotbServer: 'EU' }
    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).toContain('profile.serverEu')
    expect(wrapper.text()).not.toContain('profile.edit')
    expect(wrapper.text()).not.toContain('profile.unbind')
  })

  it('CN MANUAL profile shows China server and stays editable', async () => {
    currentProfile = {
      wotbAccountSource: 'MANUAL',
      wotbServer: 'CN',
      wotbAccountId: 1001,
      wotbNickname: 'CNName',
      displayName: 'CN Player'
    }
    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).toContain('profile.serverCn')
    expect(wrapper.text()).toContain('profile.sourceUserFilled')
    expect(wrapper.text()).toContain('profile.edit')
    expect(wrapper.text()).toContain('profile.unbind')
  })

  it('CN MANUAL profile without bound account offers the set-account button', async () => {
    currentProfile = {
      wotbAccountSource: 'MANUAL',
      wotbServer: 'CN',
      wotbAccountId: null,
      wotbNickname: null,
      displayName: 'CN Player'
    }
    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).toContain('profile.setAccount')
    expect(wrapper.text()).not.toContain('profile.serverAsia')
    expect(wrapper.text()).not.toContain('profile.serverEu')
    expect(wrapper.text()).not.toContain('profile.serverNa')
  })
})
