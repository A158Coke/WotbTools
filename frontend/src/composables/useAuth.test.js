// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

const kcLogin = vi.fn(() => Promise.resolve(true))
const kcLogout = vi.fn(() => Promise.resolve(undefined))
const kcUpdateToken = vi.fn(() => Promise.resolve(false))
const kcInit = vi.fn()
const kcInstances = []

/**
 * keycloak-js 替身 scenario：
 * - `initResult` 同时决定 init() 的 resolve 值与落定后的 `adapter.authenticated`
 *   （真实 keycloak-js 中两者同源：check-sso 命中 → true + tokenParsed）；
 * - `initImpl` 覆盖 init 返回的 promise，用于悬挂 / reject 场景；
 * - `tokenParsed` 是 check-sso 命中时 adapter 上的 claims。
 */
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
        // A query-looking return cannot match the SDK's default fragment callback.
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

const ADMIN_CLAIMS = Object.freeze({
  displayName: 'A158布丁',
  realm_access: { roles: ['wotbtools-admin'] },
})
const USER_CLAIMS = Object.freeze({
  displayName: 'CN Player',
  realm_access: { roles: ['wotbtools-user'] },
})

/** 模拟 origin-scoped bridge：postMessage → native reply → 'message' 事件（同 id）。 */
function stubNative(results = {}) {
  const listeners = []
  const calls = []
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      calls.push({ method: msg.method, params: msg.params })
      listeners.forEach(cb =>
        cb({ data: JSON.stringify({ id: msg.id, result: results[msg.method] ?? null }) })
      )
    }),
    addEventListener: vi.fn((type, cb) => listeners.push(cb)),
    removeEventListener: vi.fn((type, cb) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }),
  }
  return { calls, results }
}

function androidBridge(overrides = {}) {
  return stubNative({
    getBridgeVersion: 3,
    getCapabilities: ['native-auth'],
    authGetState: { authenticated: false, expiresAt: null },
    ...overrides,
  })
}

describe('useAuth', () => {
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

  it('普通浏览器 → BrowserAuthProvider：生产 issuer 配置 + check-sso，initPromise 正常落定', async () => {
    const auth = useAuth()
    await expect(auth.initPromise).resolves.toBeUndefined()
    expect(kcInstances).toHaveLength(1)
    expect(kcInstances[0].config).toEqual({
      url: 'https://auth.wotbtools.com',
      realm: 'wotbtools',
      clientId: 'wotbtools-web',
    })
    expect(kcInit).toHaveBeenCalledWith({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      checkLoginIframe: false,
    })
    expect(auth.authInitState.value).toBe('unauthenticated')
    expect(auth.authenticated.value).toBe(false)
    expect(auth.initialized.value).toBe(true)
    expect(auth.initError.value).toBe(null)
  })

  it('check-sso 命中时把 adapter 的 authenticated / tokenParsed 投影到 refs', async () => {
    kcScenario.initResult = true
    kcScenario.tokenParsed = ADMIN_CLAIMS
    const auth = useAuth()
    await expect(auth.retryAuth()).resolves.toBe(true)
    expect(auth.authInitState.value).toBe('authenticated')
    expect(auth.authenticated.value).toBe(true)
    expect(auth.isAuthenticated()).toBe(true)
    expect(auth.tokenParsed.value).toEqual(ADMIN_CLAIMS)
    expect(auth.isAdmin.value).toBe(true)
    expect(auth.token()).toBe('kc-access-token')
  })

  it('Android bridge v3 + native-auth 能力 → AndroidAuthProvider，绝不构造 keycloak-js', async () => {
    const keycloakBefore = kcInstances.length
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
    await expect(auth.retryAuth()).resolves.toBe(true)
    expect(native.calls.map(call => call.method)).toEqual([
      'getBridgeVersion',
      'getCapabilities',
      'authGetState',
      'authGetAccessToken',
    ])
    expect(auth.authInitState.value).toBe('authenticated')
    expect(auth.authenticated.value).toBe(true)
    expect(auth.tokenParsed.value).toEqual(ADMIN_CLAIMS)
    expect(auth.token()).toBe('native-token')
    expect(auth.isAdmin.value).toBe(true)
    expect(kcInstances.length).toBe(keycloakBefore)
    expect(kcInit).not.toHaveBeenCalled()
  })

  it('Android bridge v3 但缺 native-auth 能力 → unsupported（绝不回退 keycloak-js）', async () => {
    const keycloakBefore = kcInstances.length
    const native = stubNative({ getBridgeVersion: 3, getCapabilities: ['replay-open', 'app-update'] })
    const auth = useAuth()
    await expect(auth.retryAuth()).resolves.toBe(false)
    expect(auth.authInitState.value).toBe('failed')
    expect(auth.initFailureReason.value).toBe('init-error')
    expect(auth.initError.value.code).toBe('NATIVE_AUTH_UNSUPPORTED')
    expect(auth.initError.value.reason).toBe('native-auth-capability-missing')
    expect(auth.authenticated.value).toBe(false)
    expect(native.calls.map(call => call.method)).toEqual(['getBridgeVersion', 'getCapabilities'])
    expect(kcInstances.length).toBe(keycloakBefore)
  })

  it('Android bridge v1 → unsupported：显式失败，且绝不构造 keycloak-js / 不调用 auth 方法', async () => {
    const keycloakBefore = kcInstances.length
    const native = stubNative({
      getBridgeVersion: 1,
      getCapabilities: ['replay-open', 'replay-share', 'app-update'],
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
    })
    const auth = useAuth()
    await expect(auth.retryAuth()).resolves.toBe(false)
    expect(auth.authInitState.value).toBe('failed')
    expect(auth.initFailureReason.value).toBe('init-error')
    expect(auth.initError.value.name).toBe('NATIVE_AUTH_UNSUPPORTED')
    expect(auth.initError.value.code).toBe('NATIVE_AUTH_UNSUPPORTED')
    expect(auth.initError.value.reason).toBe('bridge-v1')
    expect(auth.authenticated.value).toBe(false)
    expect(auth.tokenParsed.value).toBe(null)
    expect(auth.token()).toBe('')
    expect(native.calls.map(call => call.method)).toEqual(['getBridgeVersion'])
    expect(kcInstances.length).toBe(keycloakBefore)
    expect(kcInit).not.toHaveBeenCalled()
  })

  it('Android 报不出 bridge 版本（null）→ unsupported：原因显式，不猜能力', async () => {
    const native = stubNative({ getBridgeVersion: null })
    const auth = useAuth()
    await expect(auth.retryAuth()).resolves.toBe(false)
    expect(auth.initError.value.code).toBe('NATIVE_AUTH_UNSUPPORTED')
    expect(auth.initError.value.reason).toBe('bridge-version-unknown')
    expect(native.calls.map(call => call.method)).toEqual(['getBridgeVersion'])
  })

  it('Native 推送 wotbtoolsOnAuthChanged 就地同步登录态（WebView 不重载）', async () => {
    const native = androidBridge()
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(false)
    expect(typeof window.wotbtoolsOnAuthChanged).toBe('function')
    native.results.authGetState = { authenticated: true, expiresAt: 1_700_000_100 }
    native.results.authGetAccessToken = {
      token: 'fresh-token',
      expiresAt: 1_700_000_100,
      claims: USER_CLAIMS,
      error: null,
    }
    window.wotbtoolsOnAuthChanged()
    await vi.waitFor(() => expect(auth.authenticated.value).toBe(true))
    expect(auth.authInitState.value).toBe('authenticated')
    expect(auth.tokenParsed.value).toEqual(USER_CLAIMS)
    expect(auth.token()).toBe('fresh-token')
    expect(auth.displayName.value).toBe('CN Player')
  })

  it('login(view) 在浏览器里带 ?view= 回到本页，且不注入 idpHint', async () => {
    const auth = useAuth()
    await auth.retryAuth()
    await auth.login('profile')
    expect(kcLogin).toHaveBeenCalledWith(expect.objectContaining({ redirectUri: expect.stringContaining('view=profile') }))
    expect(kcLogin).not.toHaveBeenCalledWith(expect.objectContaining({ idpHint: expect.any(String) }))
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

  it('存在"远端登出未收敛"标记时，首屏 init 走 login-recovery（不做 check-sso 静默复登）', async () => {
    window.localStorage.setItem('wotb-auth-pending-remote-logout', '1')
    try {
      kcScenario.initResult = true
      kcScenario.tokenParsed = { ...USER_CLAIMS, sub: 'user-a' }
      kcInit.mockClear()
      vi.resetModules()
      const fresh = await import('./useAuth.js')
      const auth = fresh.useAuth()
      await auth.initPromise
      const lastOptions = kcInit.mock.calls.at(-1)[0]
      expect(lastOptions).not.toHaveProperty('onLoad')
      expect(lastOptions).not.toHaveProperty('silentCheckSsoRedirectUri')
      expect(auth.hasPendingRemoteLogout()).toBe(true)
    } finally {
      window.localStorage.removeItem('wotb-auth-pending-remote-logout')
      vi.resetModules()
    }
  })
})
