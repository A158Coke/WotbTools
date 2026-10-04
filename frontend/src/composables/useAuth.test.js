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
      const settle = (value) => {
        this.authenticated = value === true
        this.tokenParsed = value === true ? kcScenario.tokenParsed : null
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
    getBridgeVersion: 2,
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

    await expect(auth.initPromise).resolves.toBe(false)

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

  it('Android bridge v2 + native-auth 能力 → AndroidAuthProvider，绝不构造 keycloak-js', async () => {
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

  it('Android bridge v2 但缺 native-auth 能力 → unsupported（绝不回退 keycloak-js）', async () => {
    const keycloakBefore = kcInstances.length
    const native = stubNative({ getBridgeVersion: 2, getCapabilities: ['replay-open', 'app-update'] })
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

    expect(kcLogin).toHaveBeenCalledWith(expect.objectContaining({
      redirectUri: expect.stringContaining('view=profile'),
    }))
    expect(kcLogin).not.toHaveBeenCalledWith(
      expect.objectContaining({ idpHint: expect.any(String) }))
  })

  it('same capability login preserves query and hash; changing destination drops unrelated context', async () => {
    const auth = useAuth()
    await auth.retryAuth()
    window.history.replaceState({}, '', '/?view=agent-replay&replay=abc#selected')
    try {
      await auth.login('agent-replay')
      expect(new URL(kcLogin.mock.calls.at(-1)[0].redirectUri).searchParams.get('replay')).toBe('abc')
      expect(new URL(kcLogin.mock.calls.at(-1)[0].redirectUri).hash).toBe('#selected')
      await auth.login('profile')
      expect(new URL(kcLogin.mock.calls.at(-1)[0].redirectUri).search).toBe('?view=profile')
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('login accepts a full armor scene location without losing any scene query', async () => {
    const auth = useAuth()
    await auth.retryAuth()
    const query = {
      view: 'agent-armor', tank: '13825', shooter: '19969', config: '1', scfg: '0', shell: '0',
      shot: '2', world: '1', heatmap: '1', az: '45', h: '6', d: '12',
    }
    await auth.login({ path: '/', query, hash: '#shot' })
    const redirect = new URL(kcLogin.mock.calls.at(-1)[0].redirectUri)
    expect(Object.fromEntries(redirect.searchParams)).toEqual(query)
    expect(redirect.hash).toBe('#shot')
    expect(redirect.origin).toBe(window.location.origin)
  })

  it('login rejects an external destination before handing it to the provider', async () => {
    const auth = useAuth()
    await auth.retryAuth()
    await expect(auth.login({ path: 'https://external.example/' })).rejects.toThrow('AUTH_REDIRECT_ORIGIN_MISMATCH')
    expect(kcLogin).not.toHaveBeenCalled()
    expect(auth.loginInFlight.value).toBe(false)
  })

  it('Android login() 走 native external user-agent：不导航 WebView、不构造 keycloak-js', async () => {
    const keycloakBefore = kcInstances.length
    const native = androidBridge({ authLogin: true })
    const hrefBefore = window.location.href
    const auth = useAuth()
    await auth.retryAuth()

    await expect(auth.login('profile')).resolves.toBe(true)

    expect(native.calls.at(-1)).toEqual({ method: 'authLogin', params: {} })
    expect(window.location.href).toBe(hrefBefore)
    expect(kcInstances.length).toBe(keycloakBefore)
    expect(kcInit).not.toHaveBeenCalled()
  })

  it('login() 只对「同一进行中的 redirect」去重，失败/取消后必须能重新发起', async () => {
    const auth = useAuth()
    await auth.retryAuth()

    let rejectFirst
    kcLogin.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject }))
    const first = auth.login('replay')
    await vi.waitFor(() => expect(auth.loginInFlight.value).toBe(true))

    // 同一个进行中的 redirect：不重复发起（不产生第二次导航）
    await expect(auth.login('replay')).resolves.toBe(false)

    rejectFirst(new Error('AUTH_NAVIGATION_FAILED'))
    await expect(first).rejects.toThrow('AUTH_NAVIGATION_FAILED')
    // 不是 component-lifetime 锁：失败后必须回到可重试状态
    expect(auth.loginInFlight.value).toBe(false)

    kcLogin.mockImplementationOnce(() => Promise.resolve(true))
    await expect(auth.login('ai-review')).resolves.toBe(true)
    expect(kcLogin).toHaveBeenLastCalledWith(expect.objectContaining({
      redirectUri: expect.stringContaining('view=ai-review'),
    }))
    expect(auth.loginInFlight.value).toBe(false)
  })

  it('init reject becomes an explicit failed recovery state', async () => {
    kcScenario.initImpl = () => Promise.reject(new Error('fixture init failed'))
    const auth = useAuth()

    await expect(auth.retryAuth()).resolves.toBe(false)

    expect(auth.authInitState.value).toBe('failed')
    expect(auth.initFailureReason.value).toBe('init-error')
    expect(auth.initError.value.message).toBe('fixture init failed')
    expect(auth.initialized.value).toBe(true)
  })

  it('watchdog settles a permanently pending init without changing auth to anonymous', async () => {
    vi.useFakeTimers()
    kcScenario.initImpl = () => new Promise(() => {})
    const auth = useAuth()

    const pending = auth.retryAuth()
    await vi.advanceTimersByTimeAsync(12_000)

    await expect(pending).resolves.toBe(false)
    expect(auth.authInitState.value).toBe('failed')
    expect(auth.initFailureReason.value).toBe('init-timeout')
    expect(auth.authenticated.value).toBe(false)
  })

  it('retry before the watchdog settles the abandoned public promise', async () => {
    vi.useFakeTimers()
    kcScenario.initImpl = () => new Promise(() => {})
    const auth = useAuth()

    const oldInit = auth.retryAuth()
    // provider 解析本身是异步的一步：先让上一代真正进入 init，否则它会在 init 之前就被放弃。
    await Promise.resolve()
    expect(kcInit).toHaveBeenCalledTimes(1)

    kcScenario.initImpl = null
    const newInit = auth.retryAuth()

    await expect(oldInit).resolves.toBe(false)
    await expect(newInit).resolves.toBe(false)
    expect(auth.authInitState.value).toBe('unauthenticated')
  })

  it('late completion from an abandoned generation cannot overwrite the new generation', async () => {
    vi.useFakeTimers()
    const auth = useAuth()

    let resolveOld
    kcScenario.initImpl = () => new Promise(resolve => { resolveOld = resolve })
    const oldInit = auth.retryAuth()
    await vi.advanceTimersByTimeAsync(12_000)
    const abandonedAdapter = kcInstances.at(-1)
    await oldInit

    // 被放弃的一代晚到，而且带着「已登录」的 adapter 状态。
    abandonedAdapter.authenticated = true
    abandonedAdapter.tokenParsed = { displayName: 'stale' }
    kcScenario.initImpl = null
    await auth.retryAuth()

    resolveOld(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(auth.authInitState.value).toBe('unauthenticated')
    expect(auth.authenticated.value).toBe(false)
    expect(auth.tokenParsed.value).toBe(null)
  })

  it('login after timeout creates a fresh non-silent adapter transaction', async () => {
    vi.useFakeTimers()
    kcScenario.initImpl = () => new Promise(() => {})
    const auth = useAuth()

    const oldInit = auth.retryAuth()
    await vi.advanceTimersByTimeAsync(12_000)
    await oldInit
    expect(auth.initFailureReason.value).toBe('init-timeout')

    kcScenario.initImpl = null
    const instancesBefore = kcInstances.length
    kcLogin.mockResolvedValueOnce(true)
    await expect(auth.login('replay')).resolves.toBe(true)

    expect(kcInit).toHaveBeenLastCalledWith({ pkceMethod: 'S256', checkLoginIframe: false })
    expect(kcInstances.length).toBe(instancesBefore + 1)
    expect(kcLogin).toHaveBeenCalledWith(expect.objectContaining({
      redirectUri: expect.stringContaining('view=replay'),
    }))
    expect(auth.loginInFlight.value).toBe(false)
  })

  it('logout() 在浏览器里把回跳地址交给 keycloak（落点固定 HOME，不保留登出前 view）', async () => {
    const auth = useAuth()
    window.history.replaceState({}, '', '/?view=profile')
    try {
      await auth.retryAuth()

      await auth.logout()

      // Phase 5.3：登出落点 = 首页，不是当前 view（否则用户会被 end-session 送回个人中心）
      expect(kcLogout).toHaveBeenCalledWith({ redirectUri: window.location.origin + '/' })
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('logout() 是 local-first：提交 provider 之前本地状态就已清空（当前页面立即 signed-out）', async () => {
    kcScenario.initResult = true
    kcScenario.tokenParsed = USER_CLAIMS
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(true)

    // 让 provider.logout 挂起：本地清理不得等它
    let releaseLogout
    kcLogout.mockImplementationOnce(() => new Promise((resolve) => { releaseLogout = resolve }))
    const pending = auth.logout()

    expect(auth.authenticated.value).toBe(false)      // 未等网络就落回未登录（Phase 5.4）
    expect(auth.authInitState.value).toBe('unauthenticated')
    expect(auth.tokenParsed.value).toBe(null)

    releaseLogout()
    await pending
  })

  it('logout() 在 Android 上**离线也强制清 Native 本地会话**（远端 end-session 才是 best-effort）', async () => {
    // review blocker 1：Native（Keystore）才是 Android 会话的持久 owner。离线时若整条
    // authLogout 都不调用，本地会话残留 → 重启 / auth 同步会把用户"复活"成已登录。
    const native = androidBridge({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: {
        token: 'native-token', expiresAt: 1_700_000_000, claims: ADMIN_CLAIMS, error: null,
      },
      authLogout: true,
    })
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(true)

    const { useConnectivity } = await import('./useConnectivity.js')
    useConnectivity().stop()
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    try {
      await useConnectivity().start()
      expect(useConnectivity().connectivity.value).toBe('offline')

      await auth.logout()

      // 本地会话清理必须已发到 Native（远端 end-session 由 Native 内部 best-effort）
      expect(native.calls.at(-1)).toEqual({ method: 'authLogout', params: {} })
      expect(auth.authenticated.value).toBe(false)
      expect(auth.token()).toBe('')
      expect(auth.authEpoch()).toBeGreaterThan(0)
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
      useConnectivity().stop()
    }
  })

  it('浏览器离线 logout：跳过远端导航但留下"远端未收敛"标记，下一次 init 不静默复登', async () => {
    kcScenario.initResult = true
    kcScenario.tokenParsed = { ...USER_CLAIMS, sub: 'user-a' }
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(true)

    const { useConnectivity } = await import('./useConnectivity.js')
    useConnectivity().stop()
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    try {
      await useConnectivity().start()
      kcLogout.mockClear()
      await auth.logout()

      // 离线：不导航（浏览器会撞错误页），但登出意图必须留下
      expect(kcLogout).not.toHaveBeenCalled()
      expect(auth.hasPendingRemoteLogout()).toBe(true)
      expect(auth.authenticated.value).toBe(false)
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
      useConnectivity().stop()
      window.localStorage.removeItem('wotb-auth-pending-remote-logout')
    }
  })


  it('身份代数：登录前进、登出再前进、A→B 也前进；同身份刷新 claims 不前进', async () => {
    // review blocker 2：归属判定必须绑定**身份边界**，而不是 init 交易代数
    // （Native authChanged 登录、logout、账号切换都发生在同一笔交易里）。
    kcScenario.initResult = true
    kcScenario.tokenParsed = { ...USER_CLAIMS, sub: 'user-a' }
    const auth = useAuth()
    const beforeLogin = auth.authEpoch()
    await auth.retryAuth()
    const afterLoginA = auth.authEpoch()
    expect(afterLoginA).toBeGreaterThan(beforeLogin)

    // 同身份重新投影（刷新后 claims 更新）：不前进
    kcUpdateToken.mockResolvedValueOnce(true)
    kcInstances.at(-1).tokenParsed = { ...USER_CLAIMS, sub: 'user-a', displayName: 'A renamed' }
    await auth.ensureToken(30)
    expect(auth.authEpoch()).toBe(afterLoginA)

    // 账号切换 A → B：前进
    kcScenario.tokenParsed = { ...USER_CLAIMS, sub: 'user-b' }
    await auth.retryAuth()
    const afterSwitchToB = auth.authEpoch()
    expect(afterSwitchToB).toBeGreaterThan(afterLoginA)

    // 登出：前进（身份回到 null）
    await auth.logout()
    expect(auth.authEpoch()).toBeGreaterThan(afterSwitchToB)
  })

  it('logout() 在**明确离线**时跳过 end-session（best effort），本地照常清空', async () => {
    kcScenario.initResult = true
    kcScenario.tokenParsed = USER_CLAIMS
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(true)
    kcLogout.mockClear()
    // 明确离线：Phase 9.2——本地立即退出，不依赖 Keycloak 网络。
    // 连通性状态由 store 经 online/offline 事件维护（直接改 navigator.onLine 不生效）：
    // 重启 store 让初始读取落在 offline。
    const { useConnectivity } = await import('./useConnectivity.js')
    useConnectivity().stop()
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    try {
      await useConnectivity().start()
      expect(useConnectivity().connectivity.value).toBe('offline')
      await auth.logout()
      expect(kcLogout).not.toHaveBeenCalled()
      expect(auth.authenticated.value).toBe(false)
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
      useConnectivity().stop()
    }
  })

  it('logout() 在 Android 上调用 native 会话终结并把本地状态落回未登录', async () => {
    const native = androidBridge({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: {
        token: 'native-token',
        expiresAt: 1_700_000_000,
        claims: ADMIN_CLAIMS,
        error: null,
      },
      authLogout: true,
    })
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(true)

    await auth.logout()

    expect(native.calls.at(-1)).toEqual({ method: 'authLogout', params: {} })
    expect(auth.authenticated.value).toBe(false)
    expect(auth.tokenParsed.value).toBe(null)
    expect(auth.authInitState.value).toBe('unauthenticated')
    expect(auth.token()).toBe('')
    expect(auth.isAuthenticated()).toBe(false)
  })

  it('ensureToken() 刷新失败时退回未登录并返回 false（调用方依赖这个 false）', async () => {
    kcScenario.initResult = true
    kcScenario.tokenParsed = USER_CLAIMS
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authenticated.value).toBe(true)

    kcUpdateToken.mockRejectedValueOnce(new Error('refresh failed'))

    await expect(auth.ensureToken(30)).resolves.toBe(false)

    expect(kcUpdateToken).toHaveBeenCalledWith(30)
    expect(auth.authenticated.value).toBe(false)
    expect(auth.tokenParsed.value).toBe(null)
    expect(auth.authInitState.value).toBe('unauthenticated')
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

    auth.tokenParsed.value = { realm_access: { roles: ['wotbtools-admin'] } }
    expect(auth.hasRole('wotbtools-admin')).toBe(true)
    expect(auth.hasRole('HoF-admin')).toBe(false)
    expect(auth.hasRole('')).toBe(false)
    expect(auth.isAdmin.value).toBe(true)
    // 全站管理员同时具备 HoF 审核权限。
    expect(auth.isHofAdmin.value).toBe(true)

    auth.tokenParsed.value = { realm_access: { roles: ['HoF-admin'] } }
    expect(auth.isAdmin.value).toBe(false)
    expect(auth.isHofAdmin.value).toBe(true)

    auth.tokenParsed.value = { realm_access: { roles: ['wotbtools-user'] } }
    expect(auth.isAdmin.value).toBe(false)
    expect(auth.isHofAdmin.value).toBe(false)

    // WG / QQ 登录：displayName = 官方昵称 / QQ 昵称，preferred_username 是内部登录名。
    auth.tokenParsed.value = { displayName: 'A158布丁', preferred_username: 'wg_eu_572253806' }
    expect(auth.displayName.value).toBe('A158布丁')

    // 缺 claim 的 token（例如映射未生效的旧 token）：退回登录名，绝不渲染 undefined。
    auth.tokenParsed.value = { preferred_username: 'wg_eu_572253806' }
    expect(auth.displayName.value).toBe('wg_eu_572253806')

    auth.tokenParsed.value = null
    expect(auth.displayName.value).toBe('')
  })

  it('存在"远端登出未收敛"标记时，首屏 init 走 login-recovery（不做 check-sso 静默复登）', async () => {
    // 真实路径是"页面加载后第一次 initAuth"（每个 useAuth 模块实例只发生一次）：
    // 用 resetModules 复现首屏，而不是在同一模块态里再 init 一次。
    window.localStorage.setItem('wotb-auth-pending-remote-logout', '1')
    try {
      kcScenario.initResult = true
      kcScenario.tokenParsed = { ...USER_CLAIMS, sub: 'user-a' }
      kcInit.mockClear()
      vi.resetModules()
      const fresh = await import('./useAuth.js')
      const auth = fresh.useAuth()
      await auth.initPromise

      // login-recovery 模式的 init 选项：无 check-sso（不带 onLoad/silentCheckSsoRedirectUri）
      const lastOptions = kcInit.mock.calls.at(-1)[0]
      expect(lastOptions).not.toHaveProperty('onLoad')
      expect(lastOptions).not.toHaveProperty('silentCheckSsoRedirectUri')
      // 且标记仍然在（用户显式登录才会清）
      expect(auth.hasPendingRemoteLogout()).toBe(true)
    } finally {
      window.localStorage.removeItem('wotb-auth-pending-remote-logout')
      vi.resetModules()
    }
  })
})
