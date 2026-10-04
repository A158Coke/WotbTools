// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computed, ref } from 'vue'
import ProfilePage from './ProfilePage.vue'
import { useConnectivity } from '../composables/useConnectivity.js'
import { resetBusinessUserBootstrap, useBusinessUserBootstrap } from '../composables/useBusinessUserBootstrap.js'
import { useConnectivityNotice } from '../composables/useConnectivityNotice.js'

const confirmDialog = vi.hoisted(() => ({ confirm: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../composables/useConfirm.js', () => ({ confirm: confirmDialog.confirm }))


let currentProfile = null
let profileFailures = 0
const tokenRef = ref(null)
let syncImpl = () => Promise.resolve(null)

const api = vi.hoisted(() => ({
  authenticated: true,
  login: vi.fn(() => Promise.resolve(undefined)),
  logout: vi.fn(() => Promise.resolve(undefined))
}))

const authFlag = ref(true)
// 身份驱动代数（与生产 useAuth 同规则）：未登录→已登录、已登录→未登录、A→B（sub 变化）各前进一次。
// 测试用 signInAs()/signOut() 改变会话身份，而不是手工 +1（review blocker 2 的测试口径）。
let projectedIdentityKey = null
let identityEpoch = 0
function projectIdentity(isAuthed, parsedToken) {
  const key = isAuthed ? `sub:${parsedToken?.sub ?? 'unknown'}` : null
  if (key !== projectedIdentityKey) {
    projectedIdentityKey = key
    identityEpoch += 1
  }
}
function signInAs(sub = 'user-a') {
  tokenRef.value = { ...(tokenRef.value || {}), sub }
  api.authenticated = true
  projectIdentity(true, tokenRef.value)
}
function signOut() {
  api.authenticated = false
  tokenRef.value = null
  projectIdentity(false, null)
}
// 让 mock 的 authenticated 具备**响应式**语义（真实 useAuth 是 ref）：组件的
// computed / watcher 才能观察到登录 / 登出翻转。既有 `api.authenticated = X`
// 的写法保持不变（getter/setter 转发到 authFlag）。
Object.defineProperty(api, 'authenticated', {
  get: () => authFlag.value,
  set: (value) => { authFlag.value = value },
  configurable: true,
})
vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(api.authenticated),
    login: api.login,
    logout: api.logout,
    isAuthenticated: () => api.authenticated,
    authenticated: authFlag,
    authEpoch: () => identityEpoch,
    initError: ref(null),
    tokenParsed: tokenRef,
    displayName: computed(() => tokenRef.value?.displayName || tokenRef.value?.preferred_username || '')
  })
}))

const userApi = vi.hoisted(() => ({
  ensureUserProfile: vi.fn(() => Promise.resolve(null)),
  getUserProfile: vi.fn(() => Promise.resolve(null)),
  syncUserWotbAccountFromLogin: vi.fn(() => Promise.resolve(null)),
  updateUserWotbAccount: vi.fn(() => Promise.resolve(null)),
  deleteUserWotbAccount: vi.fn(() => Promise.resolve(null)),
  getUserHofRecords: vi.fn(() => Promise.resolve([])),
  verifyUserWotbAccountFromReplay: vi.fn(() => Promise.resolve(null))
}))

vi.mock('../utils/api-user.js', () => ({
  // 全局 bootstrap 才是 profile ensure 的 owner；页面只等待其结果。
  ensureUserProfile: userApi.ensureUserProfile,
  getUserProfile: (...args) =>
    (profileFailures-- > 0 ? Promise.reject(new Error('boom')) : userApi.getUserProfile(...args)),
  syncUserWotbAccountFromLogin: () => userApi.syncUserWotbAccountFromLogin(),
  updateUserWotbAccount: (...args) => userApi.updateUserWotbAccount(...args),
  deleteUserWotbAccount: (...args) => userApi.deleteUserWotbAccount(...args),
  getUserHofRecords: (...args) => userApi.getUserHofRecords(...args),
  verifyUserWotbAccountFromReplay: (...args) => userApi.verifyUserWotbAccountFromReplay(...args)
}))

// 「用回放验证账号」：本机解析回放拿录像者 accountId（服务器没有 parser），再交服务端比对。
const verifyApi = vi.hoisted(() => ({
  replayRecorderAccountId: vi.fn(),
  verifyUserWotbAccountFromReplay: vi.fn()
}))
vi.mock('../replay-local/submissionFacts.js', () => ({
  replayRecorderAccountId: verifyApi.replayRecorderAccountId
}))

const hundredApi = vi.hoisted(() => ({
  hofHundredMyStatus: vi.fn(),
  hofHundredCancel: vi.fn()
}))

vi.mock('../utils/api.js', () => ({
  hofHundredMyStatus: hundredApi.hofHundredMyStatus,
  hofHundredCancel: hundredApi.hofHundredCancel
}))

vi.mock('../utils/helpers.js', () => ({
  mapLabel: () => ''
}))

vi.mock('../utils/display.js', () => ({
  apiErrorLabel: (t, te, error) => (error?.code ? `api-error:${error.code}` : 'api-error')
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: key => key,
    te: () => true
  })
}))

const mountedWrappers = []

function mountProfile() {
  const wrapper = mount(ProfilePage, {
    global: { mocks: { $t: key => key } }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

/** 连通性默认在线：ProfilePage 的 backend 动作现在都过 capability 门禁。 */
function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

beforeEach(async () => {
  useConnectivity().stop()
  setOnline(true)
  await useConnectivity().start()
})

afterEach(() => {
  // 卸载本轮挂载的组件：否则它们残留的 connectivity watcher 会在后续测试里继续发请求。
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  useConnectivity().stop()
  useConnectivityNotice().close()
  setOnline(true)
})

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
    userApi.getUserProfile.mockImplementation(() => Promise.resolve(currentProfile))
    userApi.ensureUserProfile.mockImplementation(() => Promise.resolve(currentProfile))
    userApi.syncUserWotbAccountFromLogin.mockImplementation(() => syncImpl())
    userApi.updateUserWotbAccount.mockImplementation(() => Promise.resolve(currentProfile))
    userApi.deleteUserWotbAccount.mockImplementation(() => Promise.resolve(currentProfile))
    userApi.getUserHofRecords.mockResolvedValue([])
    userApi.verifyUserWotbAccountFromReplay.mockImplementation((...args) => verifyApi.verifyUserWotbAccountFromReplay(...args))
    hundredApi.hofHundredMyStatus.mockReset().mockResolvedValue({ current: [], pending: [], rejected: [] })
    hundredApi.hofHundredCancel.mockReset()
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

  it('CN MANUAL profile without replay verification shows the upload hint', async () => {
    currentProfile = {
      wotbAccountSource: 'MANUAL',
      wotbServer: 'CN',
      wotbAccountId: 1001,
      wotbNickname: 'CNName',
      wotbAccountVerifiedAt: null,
      displayName: 'CN Player'
    }
    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).toContain('profile.notVerified')
    expect(wrapper.text()).toContain('profile.notVerifiedHint')
    expect(wrapper.text()).not.toContain('profile.verifiedBadge')
  })

  it('CN MANUAL profile verified by its own replay shows the verified badge only', async () => {
    currentProfile = {
      wotbAccountSource: 'MANUAL',
      wotbServer: 'CN',
      wotbAccountId: 1001,
      wotbNickname: 'CNName',
      wotbAccountVerifiedAt: '2026-03-03T03:03:03Z',
      displayName: 'CN Player'
    }
    const wrapper = mountProfile()
    await flushPromises()

    expect(wrapper.text()).toContain('profile.verifiedBadge')
    expect(wrapper.text()).not.toContain('profile.notVerified')
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

  it('shows hundred current/pending/rejected sections and withdraw calls the cancel API', async () => {
    currentProfile = wargamingProfile('ASIA', 123)
    hundredApi.hofHundredMyStatus.mockResolvedValue({
      current: [{
        id: 1,
        vehicleId: 777,
        vehicleName: 'Object 277',
        status: 'CURRENT',
        approvedAverageDamage: 3200,
        approvedBattleCount: 100,
        submittedAt: '2024-01-01T00:00:00Z',
        approvedAt: '2024-01-10T00:00:00Z'
      }],
      pending: [{
        id: 2,
        vehicleId: 268,
        vehicleName: 'Jagdpanzer E 100',
        status: 'PENDING',
        claimedAverageDamage: 3400,
        claimedBattleCount: 100,
        submittedAt: '2024-02-01T00:00:00Z'
      }, {
        id: 4,
        vehicleId: 385,
        vehicleName: 'Progetto 65',
        status: 'PENDING',
        claimedAverageDamage: 3500,
        claimedBattleCount: 120,
        approvedAverageDamage: 4101,
        approvedBattleCount: 188,
        submittedAt: '2024-02-02T00:00:00Z'
      }],
      rejected: [{
        id: 3,
        vehicleId: 62,
        vehicleName: 'T110E5',
        status: 'REJECTED',
        claimedAverageDamage: 2999,
        claimedBattleCount: 100,
        submittedAt: '2024-03-01T00:00:00Z',
        rejectReason: 'INSUFFICIENT_PROOF',
        rejectReasonText: 'Screenshot unclear'
      }]
    })
    hundredApi.hofHundredCancel.mockResolvedValue({ id: 2, status: 'CANCELLED' })

    const wrapper = mountProfile()
    await flushPromises()

    // current + pending + rejected sections render
    expect(wrapper.text()).toContain('hundred.profileTitle')
    expect(wrapper.text()).toContain('hundred.currentRecords')
    expect(wrapper.text()).toContain('Object 277')
    expect(wrapper.text()).toContain('hundred.currentPending')
    expect(wrapper.text()).toContain('Jagdpanzer E 100')
    expect(wrapper.text()).toContain('Progetto 65')
    expect(wrapper.text()).toContain((4101).toLocaleString())
    expect(wrapper.text()).toContain('188')
    expect(wrapper.text()).not.toContain((3500).toLocaleString())
    expect(wrapper.text()).toContain('hundred.reviewStatus')
    expect(wrapper.text()).toContain('hundred.recentRejected')
    expect(wrapper.text()).toContain('INSUFFICIENT_PROOF')
    expect(wrapper.text()).toContain('Screenshot unclear')

    // withdraw triggers cancel API and refreshes status
    const withdrawButton = wrapper.findAll('button').find(b => b.text().includes('hundred.withdraw'))
    expect(withdrawButton).toBeTruthy()
    await withdrawButton.trigger('click')
    await flushPromises()

    expect(hundredApi.hofHundredCancel).toHaveBeenCalledWith(2)
    expect(hundredApi.hofHundredMyStatus).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('hundred.withdrawSuccess')
    vi.unstubAllGlobals()
  })
})

describe('ProfilePage as the account page', () => {
  beforeEach(() => {
    api.authenticated = true
    api.login.mockClear()
    api.logout.mockClear()
    profileFailures = 0
    currentProfile = null
    tokenRef.value = null
    hundredApi.hofHundredMyStatus.mockReset().mockResolvedValue({ current: [], pending: [], rejected: [] })
  })

  it('shows a sign-in card instead of redirecting when signed out', async () => {
    api.authenticated = false
    const wrapper = mountProfile()
    await flushPromises()
    expect(wrapper.find('[data-testid="profile-signed-out"]').exists()).toBe(true)
    expect(api.login).not.toHaveBeenCalled()
  })

  it('signs in from the card and returns to the account page', async () => {
    api.authenticated = false
    const wrapper = mountProfile()
    await flushPromises()
    await wrapper.get('[data-testid="profile-login"]').trigger('click')
    expect(api.login).toHaveBeenCalledWith('profile')
  })

  it('retries loading the profile (not a login) when a signed-in load fails', async () => {
    profileFailures = 1
    currentProfile = wargamingProfile('ASIA', 1001)
    const wrapper = mountProfile()
    await flushPromises()
    await wrapper.get('[data-testid="profile-retry"]').trigger('click')
    await flushPromises()
    expect(api.login).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="profile-logout"]').exists()).toBe(true)
  })

  it('logs out from the account page', async () => {
    currentProfile = wargamingProfile('ASIA', 1001)
    const wrapper = mountProfile()
    await flushPromises()
    await wrapper.get('[data-testid="profile-logout"]').trigger('click')
    expect(api.logout).toHaveBeenCalled()
  })
})

describe('ProfilePage verify with replay', () => {
  const unverified = () => ({
    wotbAccountSource: 'MANUAL',
    wotbServer: 'CN',
    wotbAccountId: 1001,
    wotbNickname: 'CNName',
    wotbAccountVerifiedAt: null,
    displayName: 'CN Player'
  })

  async function pickReplay(wrapper, file) {
    const input = wrapper.get('[data-testid="profile-verify-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
  }

  beforeEach(() => {
    api.authenticated = true
    tokenRef.value = null
    currentProfile = unverified()
    hundredApi.hofHundredMyStatus.mockReset().mockResolvedValue({ current: [], pending: [], rejected: [] })
    verifyApi.replayRecorderAccountId.mockReset()
    verifyApi.verifyUserWotbAccountFromReplay.mockReset()
  })

  it('parses the replay locally, submits the recorder id and shows the verified badge', async () => {
    let finish
    verifyApi.replayRecorderAccountId.mockResolvedValue(1001)
    verifyApi.verifyUserWotbAccountFromReplay.mockImplementation(() => new Promise((res) => { finish = res }))
    const wrapper = mountProfile()
    await flushPromises()
    expect(wrapper.get('[data-testid="profile-verify-replay"]').text()).toContain('profile.verifyWithReplay')

    const file = new File(['replay'], 'mine.wotbreplay')
    await pickReplay(wrapper, file)
    await flushPromises()
    expect(verifyApi.replayRecorderAccountId).toHaveBeenCalledWith(file)
    expect(verifyApi.verifyUserWotbAccountFromReplay).toHaveBeenCalledWith(1001)
    const button = wrapper.get('[data-testid="profile-verify-replay"]')
    expect(button.text()).toContain('profile.verifyingReplay')
    expect(button.attributes('disabled')).toBeDefined()

    finish({ ...unverified(), wotbAccountVerifiedAt: '2026-10-02T00:00:00Z' })
    await flushPromises()
    expect(wrapper.text()).toContain('profile.verifiedBadge')
    expect(wrapper.find('[data-testid="profile-verify-replay"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="profile-verify-error"]').exists()).toBe(false)
  })

  it('recorder mismatch from the server shows the stable error and keeps the profile unverified', async () => {
    verifyApi.replayRecorderAccountId.mockResolvedValue(2002)
    verifyApi.verifyUserWotbAccountFromReplay.mockRejectedValue({ code: 'REPLAY_RECORDER_MISMATCH', status: 409 })
    const wrapper = mountProfile()
    await flushPromises()

    await pickReplay(wrapper, new File(['replay'], 'other.wotbreplay'))
    await flushPromises()
    expect(wrapper.get('[data-testid="profile-verify-error"]').text()).toBe('api-error:REPLAY_RECORDER_MISMATCH')
    expect(wrapper.text()).toContain('profile.notVerified')
    expect(wrapper.get('[data-testid="profile-verify-replay"]').attributes('disabled')).toBeUndefined()
  })

  it('a replay that fails to parse locally never reaches the server', async () => {
    verifyApi.replayRecorderAccountId.mockRejectedValue({ code: 'INVALID_REPLAY_FILE', status: 400 })
    const wrapper = mountProfile()
    await flushPromises()

    await pickReplay(wrapper, new File(['junk'], 'bad.wotbreplay'))
    await flushPromises()
    expect(verifyApi.verifyUserWotbAccountFromReplay).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="profile-verify-error"]').text()).toBe('api-error:INVALID_REPLAY_FILE')
  })
})

/**
 * ProfilePage 的连通性门禁（PR #467 review blocker）。
 *
 * 页面所有 backend 动作都必须经 capability 门禁（ACCOUNT_PROFILE / HALL_OF_FAME），
 * offline / unknown / degraded / service-unavailable 一律**不发请求**、不进入 error 态，
 * 恢复在线后自动加载且不产生请求风暴。
 */
describe('ProfilePage connectivity gating', () => {
  function resetApi() {
    for (const spy of Object.values(userApi)) spy.mockClear()
    hundredApi.hofHundredMyStatus.mockReset().mockResolvedValue({ current: [], pending: [], rejected: [] })
    hundredApi.hofHundredCancel.mockReset()
    verifyApi.replayRecorderAccountId.mockReset()
    verifyApi.verifyUserWotbAccountFromReplay.mockReset()
    useConnectivityNotice().close()
  }

  beforeEach(async () => {
    currentProfile = wargamingProfile('ASIA', 123)
    tokenRef.value = { displayName: 'PlayerOne' }
    syncImpl = () => Promise.resolve(null)
    userApi.getUserProfile.mockImplementation(() => Promise.resolve(currentProfile))
    userApi.ensureUserProfile.mockImplementation(() => Promise.resolve(currentProfile))
    userApi.syncUserWotbAccountFromLogin.mockImplementation(() => syncImpl())
    userApi.getUserHofRecords.mockResolvedValue([])
    resetApi()
    useConnectivity().stop()
    setOnline(false)
    await useConnectivity().start()
  })

  afterEach(() => {
    useConnectivity().stop()
    useConnectivityNotice().close()
    setOnline(true)
  })

  it('offline mount issues zero backend requests and shows the neutral connectivity state', async () => {
    const wrapper = mountProfile()
    await flushPromises()

    expect(userApi.ensureUserProfile).not.toHaveBeenCalled()
    expect(userApi.getUserProfile).not.toHaveBeenCalled()
    expect(userApi.syncUserWotbAccountFromLogin).not.toHaveBeenCalled()
    expect(userApi.getUserHofRecords).not.toHaveBeenCalled()
    expect(hundredApi.hofHundredMyStatus).not.toHaveBeenCalled()
    // 中性状态（不是 error / 不是 signedOut），文案来自 capability 模型。
    expect(wrapper.find('[data-testid="profile-connectivity-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('featureOffline.accountProfile')
    expect(wrapper.text()).not.toContain('profile.error')
  })

  it('offline retry stays gated: no request, connectivity notice instead of a business error', async () => {
    const wrapper = mountProfile()
    await flushPromises()
    resetApi()

    await wrapper.get('[data-testid="profile-retry"]').trigger('click')
    await flushPromises()

    expect(userApi.ensureUserProfile).not.toHaveBeenCalled()
    expect(userApi.getUserProfile).not.toHaveBeenCalled()
    expect(useConnectivityNotice().visible.value).toBe(true)
    expect(useConnectivityNotice().notice.value.messageKey).toBe('featureOffline.accountProfile')
    expect(wrapper.text()).not.toContain('profile.error')
  })

  it('losing connectivity blocks every backend action the page would otherwise fire', async () => {
    // CN 手工填写 + 已绑定 + 未验证：edit / unbind / verify-with-replay 三块都会渲染。
    currentProfile = {
      wotbAccountSource: 'USER_FILLED',
      wotbServer: 'CN',
      wotbAccountId: 456,
      wotbNickname: 'PlayerOne',
      displayName: 'PlayerOne',
      wotbAccountVerifiedAt: null
    }
    setOnline(true)
    useConnectivity().stop()
    await useConnectivity().start()
    const wrapper = mountProfile()
    await flushPromises()
    expect(userApi.getUserProfile).toHaveBeenCalledTimes(1)

    // 掉线后（页面已渲染）逐个动作都必须被门禁挡住。
    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    resetApi()

    // unbind（profile 已绑定 → 「解绑」按钮存在）
    const unbind = wrapper.findAll('button').find(b => b.text().includes('profile.unbind'))
    expect(unbind).toBeTruthy()
    await unbind.trigger('click')
    await flushPromises()
    expect(userApi.deleteUserWotbAccount).not.toHaveBeenCalled()

    // 用回放验证：本地解析也不会被触发（门禁在最前，避免用户选完文件才发现无法提交）
    const input = wrapper.get('[data-testid="profile-verify-input"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.wotbreplay')], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(verifyApi.replayRecorderAccountId).not.toHaveBeenCalled()
    expect(verifyApi.verifyUserWotbAccountFromReplay).not.toHaveBeenCalled()

    // edit → save：不得调用 updateUserWotbAccount（放最后：进入编辑态会隐藏 verify 区）
    const edit = wrapper.findAll('button').find(b => b.text().includes('profile.edit'))
    expect(edit).toBeTruthy()
    await edit.trigger('click')
    await flushPromises()
    const save = wrapper.findAll('button').find(b => b.text().includes('profile.save'))
    expect(save).toBeTruthy()
    await save.trigger('click')
    await flushPromises()
    expect(userApi.updateUserWotbAccount).not.toHaveBeenCalled()

    // 掉线期间页面不会重新触发 ensure / get / hof（retry 的离线路径由上一个用例覆盖）
    expect(userApi.ensureUserProfile).not.toHaveBeenCalled()
    expect(userApi.getUserProfile).not.toHaveBeenCalled()
    expect(userApi.getUserHofRecords).not.toHaveBeenCalled()
    expect(hundredApi.hofHundredMyStatus).not.toHaveBeenCalled()
  })

  it('reconnect loads the profile exactly once (no request storm on repeated events)', async () => {
    const wrapper = mountProfile()
    await flushPromises()
    expect(wrapper.find('[data-testid="profile-connectivity-unavailable"]').exists()).toBe(true)
    resetApi()

    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(userApi.getUserProfile).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="profile-connectivity-unavailable"]').exists()).toBe(false)

    // 重复的 online 通知（推送抖动）不得再触发第二次加载
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(userApi.getUserProfile).toHaveBeenCalledTimes(1)
  })

  it('while the reconnect reload is in flight it never claims the profile needs a connection', async () => {
    const wrapper = mountProfile()
    await flushPromises()
    expect(wrapper.text()).toContain('featureOffline.accountProfile')
    resetApi()

    // 挂起资料读取：phase 在请求完成前仍是 connectivity-unavailable。
    let resolveProfile
    userApi.getUserProfile.mockImplementationOnce(() => new Promise((resolve) => { resolveProfile = resolve }))
    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(userApi.getUserProfile).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('featureOffline.accountProfile')
    expect(wrapper.text()).not.toContain('connectivityNotice.')
    expect(wrapper.find('[data-testid="profile-retry"]').exists()).toBe(false)

    resolveProfile(currentProfile)
    await flushPromises()
    expect(wrapper.find('[data-testid="profile-connectivity-unavailable"]').exists()).toBe(false)
    expect(wrapper.find('.profile-main').exists()).toBe(true)
    expect(wrapper.text()).toContain('profile.serverAsia')
  })
})

/** 业务失败与连通性变化分开，异步等待后在真实 backend boundary 再次 gate。 */
describe('ProfilePage bootstrap failure and asynchronous connectivity changes', () => {
  function deferred() {
    let resolve
    const promise = new Promise(res => { resolve = res })
    return { promise, resolve }
  }

  async function disconnect() {
    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
  }

  function button(wrapper, key) {
    const result = wrapper.findAll('button').find(b => b.text() === key)
    expect(result).toBeDefined()
    return result
  }

  beforeEach(() => {
    resetBusinessUserBootstrap()
    api.authenticated = true
    tokenRef.value = null
    profileFailures = 0
    currentProfile = {
      wotbAccountSource: 'MANUAL', wotbServer: 'CN', wotbAccountId: 1001,
      wotbNickname: 'CNName', wotbAccountVerifiedAt: null, displayName: 'CN Player',
    }
    for (const spy of Object.values(userApi)) spy.mockReset()
    userApi.ensureUserProfile.mockResolvedValue(currentProfile)
    userApi.getUserProfile.mockImplementation(async () => currentProfile)
    userApi.getUserHofRecords.mockResolvedValue([])
    userApi.verifyUserWotbAccountFromReplay.mockImplementation((...args) => verifyApi.verifyUserWotbAccountFromReplay(...args))
    confirmDialog.confirm.mockReset().mockResolvedValue(true)
    verifyApi.replayRecorderAccountId.mockReset()
    verifyApi.verifyUserWotbAccountFromReplay.mockReset()
    hundredApi.hofHundredCancel.mockReset()
    hundredApi.hofHundredMyStatus.mockReset().mockResolvedValue({ current: [], pending: [], rejected: [] })
  })

  afterEach(() => resetBusinessUserBootstrap())

  it('online provisioning failure shows profile error, preserves business error, and recovers on explicit retry', async () => {
    const failure = { status: 500, code: 'PROVISIONING_FAILED' }
    userApi.ensureUserProfile.mockRejectedValueOnce(failure)
    const wrapper = mountProfile()
    await flushPromises()
    expect(userApi.getUserProfile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('profile.error')
    expect(wrapper.text()).not.toContain('profile.loading')
    expect(wrapper.find('[data-testid="profile-connectivity-unavailable"]').exists()).toBe(false)
    expect(useConnectivityNotice().visible.value).toBe(false)
    expect(useBusinessUserBootstrap().state.value).toBe('failed')
    expect(useBusinessUserBootstrap().error.value).toEqual(failure)

    // 即使状态重新发布 online，业务 error 也不应自行重试。
    useConnectivity().stop()
    await useConnectivity().start()
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(userApi.ensureUserProfile).toHaveBeenCalledTimes(1)
    expect(userApi.getUserProfile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('profile.error')

    await wrapper.get('[data-testid="profile-retry"]').trigger('click')
    await flushPromises()
    expect(userApi.ensureUserProfile).toHaveBeenCalledTimes(2)
    expect(userApi.getUserProfile).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="profile-logout"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('profile.error')
    expect(useBusinessUserBootstrap().state.value).toBe('ready')
  })

  it('successful bootstrap after disconnect cannot issue a profile read; reconnect resumes once', async () => {
    const ensure = deferred()
    userApi.ensureUserProfile.mockImplementationOnce(() => ensure.promise)
    const wrapper = mountProfile()
    await flushPromises()
    expect(userApi.ensureUserProfile).toHaveBeenCalledTimes(1)
    await disconnect()
    ensure.resolve(currentProfile)
    await flushPromises()
    expect(userApi.getUserProfile).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="profile-connectivity-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('profile.error')

    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(userApi.getUserProfile).toHaveBeenCalledTimes(1)
  })

  it('disconnect during unbind confirmation blocks delete and shows connectivity notice', async () => {
    const confirmation = deferred()
    confirmDialog.confirm.mockImplementationOnce(() => confirmation.promise)
    const wrapper = mountProfile()
    await flushPromises()
    await button(wrapper, 'profile.unbind').trigger('click')
    expect(confirmDialog.confirm).toHaveBeenCalledTimes(1)
    await disconnect()
    confirmation.resolve(true)
    await flushPromises()
    expect(userApi.deleteUserWotbAccount).not.toHaveBeenCalled()
    expect(useConnectivityNotice().notice.value.messageKey).toBe('featureOffline.accountProfile')
  })

  it('disconnect during withdrawal confirmation blocks cancel and status refresh', async () => {
    hundredApi.hofHundredMyStatus.mockResolvedValue({ current: [], pending: [{ id: 7, vehicleName: 'Tank', status: 'PENDING' }], rejected: [] })
    const confirmation = deferred()
    confirmDialog.confirm.mockImplementationOnce(() => confirmation.promise)
    const wrapper = mountProfile()
    await flushPromises()
    await button(wrapper, 'hundred.withdraw').trigger('click')
    expect(confirmDialog.confirm).toHaveBeenCalledTimes(1)
    await disconnect()
    confirmation.resolve(true)
    await flushPromises()
    expect(hundredApi.hofHundredCancel).not.toHaveBeenCalled()
    expect(hundredApi.hofHundredMyStatus).toHaveBeenCalledTimes(1)
    expect(useConnectivityNotice().notice.value.messageKey).toBe('featureOffline.hallOfFame')
  })

  it('disconnect during local replay parse blocks verify API and clears pending state', async () => {
    const parser = deferred()
    verifyApi.replayRecorderAccountId.mockImplementationOnce(() => parser.promise)
    const wrapper = mountProfile()
    await flushPromises()
    const file = new File(['local replay'], 'mine.wotbreplay')
    const input = wrapper.get('[data-testid="profile-verify-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    expect(verifyApi.replayRecorderAccountId).toHaveBeenCalledWith(file)
    await disconnect()
    parser.resolve(1001)
    await flushPromises()
    expect(userApi.verifyUserWotbAccountFromReplay).not.toHaveBeenCalled()
    expect(verifyApi.verifyUserWotbAccountFromReplay).not.toHaveBeenCalled()
    expect(useConnectivityNotice().notice.value.messageKey).toBe('featureOffline.accountProfile')
    expect(wrapper.get('[data-testid="profile-verify-replay"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="profile-verify-error"]').exists()).toBe(false)
  })
})

/**
 * 2.1.0 Phase 6/7：认证状态的**响应式**语义与账户隔离。
 * - 登录回站（false→true）不需要重新挂载/刷新，页面自己进入已登录并恰好加载一次；
 * - 登出（true→false）立即清空上一账号的一切投影；
 * - 账户切换（A→B）时 A 时代的在途请求迟到返回，不得写进 B 的页面（epoch 归属）。
 */
describe('ProfilePage 响应式认证与账户隔离', () => {
  beforeEach(() => {
    profileFailures = 0
    currentProfile = null
    signInAs('user-a')
    userApi.getUserProfile.mockImplementation(() => Promise.resolve(currentProfile))
    userApi.ensureUserProfile.mockImplementation(() => Promise.resolve(currentProfile))
    userApi.getUserHofRecords.mockResolvedValue([])
    hundredApi.hofHundredMyStatus.mockReset().mockResolvedValue({ current: [], pending: [], rejected: [] })
  })


  it('P1 守卫：每个 finally 里的 pending 清理都做身份归属检查（源码级不变量）', () => {
    // review P1：`finally { loading.value = false }` 这类无条件清理会让 A 时代的迟到响应
    // 把 B 正在进行的加载/pending 误判为空闲（重连 / watch 路径可能因此再起一次请求）。
    // 只审 **finally 块**内：登出清理（watcher true→false 分支）无条件清空是刻意的，不在范围内。
    // happy-dom 环境下 import.meta.url 不是 file: URL：按 vitest 的 cwd（frontend/）取源文件
    const source = readFileSync(join(process.cwd(), 'src/components/ProfilePage.vue'), 'utf8')
    const finallyBlocks = []
    let cursor = 0
    while (true) {
      const at = source.indexOf('} finally {', cursor)
      if (at < 0) break
      let depth = 0
      let i = source.indexOf('{', at)
      const from = i
      for (; i < source.length; i++) {
        if (source[i] === '{') depth += 1
        else if (source[i] === '}') { depth -= 1; if (depth === 0) break }
      }
      finallyBlocks.push(source.slice(from, i + 1))
      cursor = i + 1
    }
    expect(finallyBlocks.length).toBeGreaterThanOrEqual(4)

    const pendingVars = ['loading', 'syncFromLoginPending', 'verifyPending', 'hundredWithdrawingId']
    for (const body of finallyBlocks) {
      for (const name of pendingVars) {
        const writes = new RegExp(`(^|\\s)${name}\\.value = `, 'm').test(body)
        if (!writes) continue
        expect(
          new RegExp(`if \\(ownEpoch\\(epoch\\)\\) ${name}\\.value = `).test(body),
          `${name} 在 finally 里的清理缺少 ownEpoch 守卫：${body.trim().slice(0, 80)}`,
        ).toBe(true)
      }
    }
  })

  it('登录回站 false→true：不重挂载即加载资料（恰好一次）', async () => {
    api.authenticated = false
    let calls = 0
    userApi.getUserProfile.mockImplementation(() => {
      calls += 1
      return Promise.resolve(currentProfile)
    })

    const wrapper = mountProfile()
    await flushPromises()
    expect(wrapper.find('[data-testid="profile-signed-out"]').exists()).toBe(true)
    expect(calls).toBe(0)

    // 登录回站：只翻转 authenticated（模拟 Android authChanged 推送 / 浏览器回程），
    // 不重新挂载、不刷新页面
    signInAs('user-b')                                     // 身份变化 → 代数前进（与生产同规则）
    tokenRef.value = { sub: 'user-b', preferred_username: 'back-from-login' }
    await flushPromises()

    expect(calls).toBe(1)                                  // 自己加载，恰好一次
    expect(wrapper.find('[data-testid="profile-signed-out"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('登出 true→false：立即清空上一账号的投影（不切页、不刷新）', async () => {
    currentProfile = wargamingProfile('ASIA', 572253806)
    const wrapper = mountProfile()
    await flushPromises()
    expect(wrapper.text()).toContain('profile.serverAsia')

    signOut()                                              // 登出 → 身份回到 null → 代数前进
    await flushPromises()

    expect(wrapper.find('[data-testid="profile-signed-out"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('572253806')
    wrapper.unmount()
  })

  it('账户切换 A→B：A 时代在途的 profile 迟到返回不得写进 B 的页面', async () => {
    let releaseA
    userApi.getUserProfile.mockImplementationOnce(() => new Promise((resolve) => {
      releaseA = () => resolve({ wotbAccountSource: 'WARGAMING', wotbServer: 'ASIA', wotbAccountId: 111111, wotbNickname: 'PlayerA', displayName: 'PlayerA' })
    }))

    const wrapper = mountProfile()
    await flushPromises()                       // A 的请求在途（挂起）

    // A 登出、B 登录：身份边界两次前进（每次都由身份变化驱动）
    signOut()
    await flushPromises()
    signInAs('user-b')
    currentProfile = { wotbAccountSource: 'WARGAMING', wotbServer: 'EU', wotbAccountId: 222222, wotbNickname: 'PlayerB', displayName: 'PlayerB' }
    await flushPromises()
    expect(wrapper.text()).toContain('profile.serverEu')

    // A 的响应现在才到：必须被丢弃（页面仍是 B 的数据）
    releaseA()
    await flushPromises()
    expect(wrapper.text()).toContain('profile.serverEu')
    expect(wrapper.text()).not.toContain('111111')
    wrapper.unmount()
  })
})
