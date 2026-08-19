// @vitest-environment happy-dom

import {describe, expect, it, vi} from 'vitest'
import {useAuth} from './useAuth.js'

const kcLogin = vi.fn(() => Promise.resolve(undefined))
const kcInit = vi.fn(() => Promise.resolve(true))
const kcLogout = vi.fn(() => Promise.resolve(undefined))
const kcUpdateToken = vi.fn(() => Promise.resolve(false))

vi.mock('keycloak-js', () => ({
  default: class {
    authenticated = true
    init = kcInit
    login = kcLogin
    logout = kcLogout
    updateToken = kcUpdateToken
  }
}))

describe('useAuth', () => {
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
})
