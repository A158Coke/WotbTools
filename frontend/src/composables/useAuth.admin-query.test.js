// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const USER_CLAIMS = Object.freeze({
  sub: 'query-regression-user',
  displayName: 'Query Regression User',
  realm_access: { roles: ['wotbtools-user'] },
})

vi.mock('keycloak-js', () => ({
  default: class {
    authenticated = false
    tokenParsed = null
    token = 'test-access-token'

    async init() {
      this.authenticated = true
      this.tokenParsed = USER_CLAIMS
      return true
    }

    login = vi.fn(() => Promise.resolve(true))
    logout = vi.fn(() => Promise.resolve())
    updateToken = vi.fn(() => Promise.resolve(false))
  },
}))

describe('admin query authorization boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    history.replaceState({}, '', '/?admin=1')
  })

  it('does not synthesize admin roles from the URL in development', async () => {
    const { useAuth } = await import('./useAuth.js')
    const auth = useAuth()
    await auth.initPromise

    expect(auth.authenticated.value).toBe(true)
    expect(auth.hasRole('wotbtools-user')).toBe(true)
    expect(auth.hasRole('wotbtools-admin')).toBe(false)
    expect(auth.hasRole('HoF-admin')).toBe(false)
    expect(auth.hasRole('tournament-admin')).toBe(false)
    expect(auth.hasRole('content-admin')).toBe(false)
    expect(auth.isAdmin.value).toBe(false)
    expect(auth.isHofAdmin.value).toBe(false)
    expect(auth.isTournamentAdmin.value).toBe(false)
    expect(auth.isContentAdmin.value).toBe(false)
  })
})
