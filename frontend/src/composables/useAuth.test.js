// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

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
})
