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
})
