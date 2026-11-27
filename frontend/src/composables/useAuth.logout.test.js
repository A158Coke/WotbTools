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

describe('useAuth — logout and session transitions', () => {
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

  it('logout() 在浏览器里把回跳地址交给 keycloak（落点固定 HOME，不保留登出前 view）', async () => {
    const auth = useAuth()
    window.history.replaceState({}, '', '/?view=profile')
    try {
      await auth.retryAuth()

      await auth.logout()

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

    let releaseLogout
    kcLogout.mockImplementationOnce(() => new Promise((resolve) => { releaseLogout = resolve }))
    const pending = auth.logout()

    expect(auth.authenticated.value).toBe(false)
    expect(auth.authInitState.value).toBe('unauthenticated')
    expect(auth.tokenParsed.value).toBe(null)

    releaseLogout()
    await pending
  })

  it('initPromise 只是落定信号：logout 后既不携带历史 session，也不会被重建', async () => {
    kcScenario.initResult = true
    kcScenario.tokenParsed = { ...USER_CLAIMS, sub: 'user-a' }
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.isAuthenticated()).toBe(true)

    await auth.logout()
    expect(auth.isAuthenticated()).toBe(false)

    const remounted = useAuth()
    await expect(remounted.initPromise).resolves.toBeUndefined()
    expect(remounted.isAuthenticated()).toBe(false)
    expect(remounted.authenticated.value).toBe(false)
  })

  it('logout() 在 Android 上**离线也强制清 Native 本地会话**（远端 end-session 才是 best-effort）', async () => {
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
    kcScenario.initResult = true
    kcScenario.tokenParsed = { ...USER_CLAIMS, sub: 'user-a' }
    const auth = useAuth()
    const beforeLogin = auth.authEpoch()
    await auth.retryAuth()
    const afterLoginA = auth.authEpoch()
    expect(afterLoginA).toBeGreaterThan(beforeLogin)

    kcUpdateToken.mockResolvedValueOnce(true)
    kcInstances.at(-1).tokenParsed = { ...USER_CLAIMS, sub: 'user-a', displayName: 'A renamed' }
    await auth.ensureToken(30)
    expect(auth.authEpoch()).toBe(afterLoginA)

    kcScenario.tokenParsed = { ...USER_CLAIMS, sub: 'user-b' }
    await auth.retryAuth()
    const afterSwitchToB = auth.authEpoch()
    expect(afterSwitchToB).toBeGreaterThan(afterLoginA)

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
})
