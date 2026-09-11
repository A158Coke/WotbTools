// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

const kcLogin = vi.fn(() => Promise.resolve(undefined))
const kcInit = vi.fn(() => Promise.resolve(true))
const kcLogout = vi.fn(() => Promise.resolve(undefined))
const kcUpdateToken = vi.fn(() => Promise.resolve(false))
const kcConfigs = []

vi.mock('keycloak-js', () => ({
  default: class {
    constructor(config) {
      kcConfigs.push(config)
    }
    authenticated = true
    init = kcInit
    login = kcLogin
    logout = kcLogout
    updateToken = kcUpdateToken
  }
}))

import { useAuth } from './useAuth.js'

describe('useAuth', () => {
  afterEach(() => {
    vi.useRealTimers()
    kcInit.mockReset().mockImplementation(() => Promise.resolve(true))
    kcLogin.mockReset().mockImplementation(() => Promise.resolve(undefined))
  })

  it('reuses the production Keycloak issuer configuration', () => {
    const auth = useAuth()

    expect(auth.keycloak).toBeTruthy()
    expect(kcConfigs[0]).toEqual({
      url: 'https://auth.wotbtools.com',
      realm: 'wotbtools',
      clientId: 'wotbtools-web',
    })
  })

  it('login() redirects to the Keycloak login page with the profile view', async () => {
    const auth = useAuth()
    await auth.initPromise

    await auth.login('profile')

    expect(kcLogin).toHaveBeenCalledWith(expect.objectContaining({
      redirectUri: expect.stringContaining('view=profile')
    }))
    expect(kcLogin).not.toHaveBeenCalledWith(
      expect.objectContaining({ idpHint: expect.any(String) }))
  })

  it('logout() delegates to keycloak', async () => {
    const auth = useAuth()
    await auth.logout()
    expect(kcLogout).toHaveBeenCalled()
  })

  it('hasRole() reads the reactive realm roles without granting access to other roles', async () => {
    const auth = useAuth()
    await auth.initPromise

    auth.tokenParsed.value = { realm_access: { roles: ['wotbtools-admin'] } }
    expect(auth.hasRole('wotbtools-admin')).toBe(true)
    expect(auth.hasRole('boost-manager')).toBe(false)
    expect(auth.hasRole('')).toBe(false)

    auth.tokenParsed.value = null
  })

  it('login() 只对「同一进行中的 redirect」去重，失败/取消后必须能重新发起', async () => {
    const auth = useAuth()
    await auth.initPromise

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

  it('正常 anonymous init settles as unauthenticated', async () => {
    const auth = useAuth()
    kcInit.mockImplementationOnce(() => Promise.resolve(false))

    await auth.retryAuth()

    expect(auth.authInitState.value).toBe('unauthenticated')
    expect(auth.authenticated.value).toBe(false)
    expect(auth.initError.value).toBe(null)
  })

  it('init reject becomes an explicit failed recovery state', async () => {
    const auth = useAuth()
    kcInit.mockImplementationOnce(() => Promise.reject(new Error('fixture init failed')))

    await expect(auth.retryAuth()).resolves.toBe(false)

    expect(auth.authInitState.value).toBe('failed')
    expect(auth.initFailureReason.value).toBe('init-error')
    expect(auth.initialized.value).toBe(true)
  })

  it('watchdog settles a permanently pending init without changing auth to anonymous', async () => {
    vi.useFakeTimers()
    const auth = useAuth()
    kcInit.mockImplementationOnce(() => new Promise(() => {}))

    const pending = auth.retryAuth()
    await vi.advanceTimersByTimeAsync(12_000)

    await expect(pending).resolves.toBe(false)
    expect(auth.authInitState.value).toBe('failed')
    expect(auth.initFailureReason.value).toBe('init-timeout')
    expect(auth.authenticated.value).toBe(false)
  })

  it('retry before the watchdog settles the abandoned public promise', async () => {
    vi.useFakeTimers()
    const auth = useAuth()
    kcInit.mockImplementationOnce(() => new Promise(() => {}))

    const oldInit = auth.retryAuth()
    kcInit.mockImplementationOnce(() => Promise.resolve(false))
    const newInit = auth.retryAuth()

    await expect(oldInit).resolves.toBe(false)
    await expect(newInit).resolves.toBe(false)
    expect(auth.authInitState.value).toBe('unauthenticated')
  })

  it('late completion from an abandoned generation cannot overwrite the new generation', async () => {
    vi.useFakeTimers()
    const auth = useAuth()
    let resolveOld
    kcInit.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))

    const oldInit = auth.retryAuth()
    const abandonedAdapter = auth.keycloak
    await vi.advanceTimersByTimeAsync(12_000)
    await oldInit

    kcInit.mockImplementationOnce(() => Promise.resolve(false))
    await auth.retryAuth()
    expect(auth.keycloak).not.toBe(abandonedAdapter)
    resolveOld(true)
    await Promise.resolve()

    expect(auth.authInitState.value).toBe('unauthenticated')
    expect(auth.authenticated.value).toBe(false)
  })

  it('login after timeout creates a fresh non-silent adapter transaction', async () => {
    vi.useFakeTimers()
    const auth = useAuth()
    kcInit.mockImplementationOnce(() => new Promise(() => {}))

    const oldInit = auth.retryAuth()
    await vi.advanceTimersByTimeAsync(12_000)
    await oldInit

    kcInit.mockImplementationOnce(() => Promise.resolve(false))
    kcLogin.mockResolvedValueOnce(true)
    await expect(auth.login('replay')).resolves.toBe(true)

    expect(kcInit).toHaveBeenCalledTimes(2)
    expect(kcInit).toHaveBeenLastCalledWith({ pkceMethod: 'S256', checkLoginIframe: false })
    expect(kcLogin).toHaveBeenCalledWith(expect.objectContaining({
      redirectUri: expect.stringContaining('view=replay'),
    }))
    expect(auth.loginInFlight.value).toBe(false)
  })
})
