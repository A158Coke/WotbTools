// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

const kcLogin = vi.fn(() => Promise.resolve(true))
const kcLogout = vi.fn(() => Promise.resolve(undefined))
const kcUpdateToken = vi.fn(() => Promise.resolve(false))
const kcInit = vi.fn()
const kcInstances = []

const kcScenario = {
  initResult: false,
  tokenParsed: null,
  initImpl: null,
}

vi.mock('keycloak-js', () => ({
  default: class {
    constructor(config) {
      this.config = config
      this.authenticated = false
      this.tokenParsed = null
      this.token = 'kc-access-token'
      kcInstances.push(this)
    }
    init = (options) => {
      kcInit(options)
      const returnUrl = new URL(location.href)
      const settle = (value) => {
        this.authenticated = value === true
        this.tokenParsed = value === true ? kcScenario.tokenParsed : null
        if (!this.authenticated && options.onLoad && returnUrl.searchParams.has('state')
          && !new URLSearchParams(returnUrl.hash.slice(1)).has('state')) this.login()
        return value
      }
      if (kcScenario.initImpl) return Promise.resolve(kcScenario.initImpl()).then(settle)
      return Promise.resolve(kcScenario.initResult).then(settle)
    }
    login = kcLogin
    logout = kcLogout
    updateToken = kcUpdateToken
  },
}))

import { useAuth } from './useAuth.js'
import { ADMIN_CLAIMS, USER_CLAIMS, androidBridge } from '../test/useAuthTestHelpers.js'

describe('useAuth — tokens and identity claims', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete window.WotbNative
    delete window.wotbtoolsOnAuthChanged
    kcInit.mockClear()
    kcLogin.mockReset().mockImplementation(() => Promise.resolve(true))
    kcLogout.mockReset().mockImplementation(() => Promise.resolve(undefined))
    kcUpdateToken.mockReset().mockImplementation(() => Promise.resolve(false))
    kcScenario.initResult = false
    kcScenario.tokenParsed = null
    kcScenario.initImpl = null
  })

  it('ensureToken() Web 瞬时刷新失败保留身份、隐藏 token，并允许后续 refresh 恢复', async () => {
    kcScenario.initResult = true
    kcScenario.tokenParsed = USER_CLAIMS
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(true)

    kcUpdateToken.mockRejectedValueOnce(new Error('refresh failed'))

    await expect(auth.ensureToken(30)).resolves.toBe(false)

    expect(kcUpdateToken).toHaveBeenCalledWith(30)
    expect(auth.authenticated.value).toBe(true)
    expect(auth.tokenParsed.value).toEqual(USER_CLAIMS)
    expect(auth.authInitState.value).toBe('authenticated')
    expect(auth.token()).toBe('')

    kcInstances.at(-1).token = 'kc-access-token-recovered'
    kcUpdateToken.mockResolvedValueOnce(true)
    await expect(auth.ensureToken(30)).resolves.toBe(true)
    expect(auth.authenticated.value).toBe(true)
    expect(auth.token()).toBe('kc-access-token-recovered')
  })

  it('ensureToken() Native 离线 refresh-failed 保留 session但返回 false', async () => {
    const native = androidBridge({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: {
        token: 'native-token',
        expiresAt: 1_700_000_000,
        claims: ADMIN_CLAIMS,
        error: null,
      },
    })
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(true)

    native.results.authGetAccessToken = {
      token: null,
      expiresAt: null,
      claims: null,
      error: 'refresh-failed',
    }

    await expect(auth.ensureToken(30)).resolves.toBe(false)

    expect(auth.authenticated.value).toBe(true)
    expect(auth.tokenParsed.value).toEqual(ADMIN_CLAIMS)
    expect(auth.authInitState.value).toBe('authenticated')
    expect(auth.token()).toBe('')
    native.results.authGetState = { authenticated: false }
    await expect(auth.ensureToken(30)).resolves.toBe(false)
    expect(auth.authenticated.value).toBe(false)
  })

  it('hasRole / isAdmin / isHofAdmin / displayName 都来自 tokenParsed claims', async () => {
    const auth = useAuth()
    await auth.retryAuth()

    auth.tokenParsed.value = { realm_access: { roles: ['wotbtools-admin', 'tournament-admin'] } }
    auth.authenticated.value = true
    expect(auth.hasRole('wotbtools-admin')).toBe(true)
    expect(auth.hasRole('HoF-admin')).toBe(false)
    expect(auth.hasRole('')).toBe(false)
    expect(auth.isAdmin.value).toBe(true)
    expect(auth.isHofAdmin.value).toBe(true)
    expect(auth.isTournamentAdmin.value).toBe(true)
    expect(auth.isContentAdmin.value).toBe(false)
    expect(auth.isLeagueBroadcastAdmin.value).toBe(true)
    auth.authenticated.value = false
    expect(auth.isTournamentAdmin.value).toBe(false)
    expect(auth.isLeagueBroadcastAdmin.value).toBe(false)
    auth.authenticated.value = true

    auth.tokenParsed.value = { realm_access: { roles: ['HoF-admin'] } }
    expect(auth.isAdmin.value).toBe(false)
    expect(auth.isHofAdmin.value).toBe(true)
    expect(auth.isTournamentAdmin.value).toBe(false)

    auth.tokenParsed.value = { realm_access: { roles: ['tournament-admin'] } }
    expect(auth.isTournamentAdmin.value).toBe(true)
    expect(auth.isContentAdmin.value).toBe(false)
    expect(auth.isLeagueBroadcastAdmin.value).toBe(false)
    expect(auth.isAdmin.value).toBe(false)
    expect(auth.isHofAdmin.value).toBe(false)

    auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } }
    expect(auth.isContentAdmin.value).toBe(true)
    expect(auth.isTournamentAdmin.value).toBe(false)
    expect(auth.isLeagueBroadcastAdmin.value).toBe(false)
    expect(auth.isAdmin.value).toBe(false)
    expect(auth.isHofAdmin.value).toBe(false)

    auth.tokenParsed.value = { realm_access: { roles: ['wotbtools-user'] } }
    expect(auth.isAdmin.value).toBe(false)
    expect(auth.isHofAdmin.value).toBe(false)
    expect(auth.isTournamentAdmin.value).toBe(false)

    auth.tokenParsed.value = { displayName: 'A158布丁', preferred_username: 'wg_eu_572253806' }
    expect(auth.displayName.value).toBe('A158布丁')

    auth.tokenParsed.value = { preferred_username: 'wg_eu_572253806' }
    expect(auth.displayName.value).toBe('wg_eu_572253806')

    auth.tokenParsed.value = null
    expect(auth.displayName.value).toBe('')
  })

  it('?admin=1 不再提供角色旁路，也绝不伪造登录态', async () => {
    window.history.replaceState({}, '', '/?admin=1&view=agent-replay')
    kcScenario.initResult = false
    kcScenario.tokenParsed = null
    kcInit.mockClear()
    try {
      vi.resetModules()
      const fresh = await import('./useAuth.js')
      const auth = fresh.useAuth()
      await auth.initPromise

      expect(auth.hasRole('wotbtools-admin')).toBe(false)
      expect(auth.hasRole('HoF-admin')).toBe(false)
      expect(auth.isAdmin.value).toBe(false)
      expect(auth.hasRole('content-admin')).toBe(false)
      expect(auth.isContentAdmin.value).toBe(false)
      expect(auth.isTournamentAdmin.value).toBe(false)
      expect(auth.isLeagueBroadcastAdmin.value).toBe(false)
      expect(auth.authenticated.value).toBe(false)
      expect(auth.isAuthenticated()).toBe(false)
      expect(auth.authInitState.value).toBe('unauthenticated')
      expect(auth.tokenParsed.value).toBeNull()
    } finally {
      window.history.replaceState({}, '', '/')
      vi.resetModules()
    }
  })
})
