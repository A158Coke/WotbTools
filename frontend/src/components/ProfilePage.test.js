// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import ProfilePage from './ProfilePage.vue'

let currentProfile = null
const tokenRef = ref(null)
let syncImpl = () => Promise.resolve(null)

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
    tokenParsed: tokenRef
  })
}))

vi.mock('../utils/api-boost.js', () => ({
  getUserProfile: () => Promise.resolve(currentProfile),
  createUserProfile: () => Promise.resolve(currentProfile),
  syncUserWotbAccountFromLogin: () => syncImpl(),
  updateUserWotbAccount: () => Promise.resolve(currentProfile),
  deleteUserWotbAccount: () => Promise.resolve(currentProfile),
  getMyBoosterProfile: () => Promise.reject(new Error('no-booster')),
  updateMyBoosterAvailability: () => Promise.resolve({}),
  getMyBoosterAssignments: () => Promise.resolve([]),
  getUserHofRecords: () => Promise.resolve([]),
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
    tokenRef.value = null
    syncImpl = () => Promise.resolve(null)
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

  it('WG JWT with empty profile hides manual entry and shows sync failed state', async () => {
    tokenRef.value = {
      wotb_region: 'ASIA',
      wotb_account_id: '572253806',
      wotb_nickname: 'Chrd_CokeCake',
      wotb_verified: true
    }
    currentProfile = {
      wotbAccountSource: 'MANUAL',
      wotbServer: 'CN',
      wotbAccountId: null,
      wotbNickname: null,
      displayName: 'ChrdA158Coke'
    }
    syncImpl = () => Promise.reject(new Error('SYNC_FAILED'))

    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).not.toContain('profile.setAccount')
    expect(wrapper.text()).not.toContain('profile.edit')
    expect(wrapper.text()).not.toContain('profile.unbind')
    expect(wrapper.text()).not.toContain('profile.wotbNotBound')
    expect(wrapper.text()).toContain('profile.wgSyncFailed')
    expect(wrapper.text()).toContain('profile.wgSyncRetry')
  })

  it('WG JWT sync failure can be retried', async () => {
    tokenRef.value = {
      wotb_region: 'ASIA',
      wotb_account_id: '572253806',
      wotb_nickname: 'Chrd_CokeCake',
      wotb_verified: 'true'
    }
    currentProfile = {
      wotbAccountSource: 'MANUAL',
      wotbServer: 'CN',
      wotbAccountId: null,
      wotbNickname: null,
      displayName: 'ChrdA158Coke'
    }
    let calls = 0
    syncImpl = () => {
      calls += 1
      return calls === 1
        ? Promise.reject(new Error('SYNC_FAILED'))
        : Promise.resolve({
            wotbAccountSource: 'WARGAMING',
            wotbServer: 'ASIA',
            wotbAccountId: 572253806,
            wotbNickname: 'Chrd_CokeCake',
            displayName: 'ChrdA158Coke'
          })
    }

    const wrapper = mountProfile()
    await flushPromises()
    expect(wrapper.text()).toContain('profile.wgSyncFailed')

    await wrapper.find('button.btn-ghost.btn-sm').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('profile.wgSyncFailed')
    expect(wrapper.text()).toContain('profile.serverAsia')
    expect(wrapper.text()).toContain('profile.verifiedBadge')
    expect(wrapper.text()).toContain('572253806')
  })

  it('EU/NA WG JWT with empty profile also hides manual entry', async () => {
    for (const region of ['EU', 'NA']) {
      tokenRef.value = {
        wotb_region: region,
        wotb_account_id: '572253806',
        wotb_nickname: 'Chrd_CokeCake',
        wotb_verified: true
      }
      currentProfile = {
        wotbAccountSource: 'MANUAL',
        wotbServer: 'CN',
        wotbAccountId: null,
        wotbNickname: null,
        displayName: 'ChrdA158Coke'
      }
      syncImpl = () => Promise.reject(new Error('SYNC_FAILED'))

      const wrapper = mountProfile()
      await flushPromises()

      expect(wrapper.text()).not.toContain('profile.setAccount')
      expect(wrapper.text()).toContain('profile.wgSyncFailed')
      wrapper.unmount()
    }
  })
})