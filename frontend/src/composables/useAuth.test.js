// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { useAuth } from './useAuth.js'

describe('useAuth loginWithWargaming', () => {
  beforeEach(() => {
    kcLogin.mockClear()
    kcInit.mockClear()
  })

  it('maps ASIA/EU/NA to the fixed idpHint aliases', async () => {
    const auth = useAuth()
    await auth.initPromise

    await auth.loginWithWargaming('ASIA', 'profile')
    expect(kcLogin).toHaveBeenLastCalledWith(
      expect.objectContaining({ idpHint: 'wargaming-asia' }))

    await auth.loginWithWargaming('EU', 'profile')
    expect(kcLogin).toHaveBeenLastCalledWith(
      expect.objectContaining({ idpHint: 'wargaming-eu' }))

    await auth.loginWithWargaming('NA', 'profile')
    expect(kcLogin).toHaveBeenLastCalledWith(
      expect.objectContaining({ idpHint: 'wargaming-na' }))

    expect(kcLogin).toHaveBeenCalledTimes(3)
  })

  it('rejects regions outside the fixed whitelist without calling keycloak', async () => {
    const auth = useAuth()
    await auth.initPromise

    await expect(auth.loginWithWargaming('SA', 'profile'))
      .rejects.toThrow('Unsupported Wargaming region')
    await expect(auth.loginWithWargaming('apac', 'profile')).rejects.toThrow()
    expect(kcLogin).not.toHaveBeenCalled()
  })
})
