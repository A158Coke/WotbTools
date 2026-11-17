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
import { USER_CLAIMS } from '../test/useAuthTestHelpers.js'

describe('useAuth — init recovery', () => {
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

  it('SDK rejection without an error still provides an explicit authentication failure', async () => {
    kcScenario.initImpl = () => Promise.reject(undefined)
    const auth = useAuth()
    await auth.retryAuth()
    expect(auth.authInitState.value).toBe('failed')
    expect(auth.initError.value).toBeInstanceOf(Error)
    expect(auth.initError.value.message).toBe('AUTH_INIT_FAILED')
    expect(auth.authenticated.value).toBe(false)
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
