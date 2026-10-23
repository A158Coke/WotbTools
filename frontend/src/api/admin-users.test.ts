import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminSearchUsers, adminGetUser, adminDeleteUsers } from '../api/admin-users.js'

const auth = vi.hoisted(() => ({ token: vi.fn((): string | null => 'token'), ensureToken: vi.fn(async () => true), login: vi.fn() }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => auth }))

beforeEach(() => {
  vi.clearAllMocks()
  auth.token.mockReturnValue('token')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ preserved: true })))
})
afterEach(() => vi.unstubAllGlobals())

describe('Admin Users HTTP boundary', () => {
  it.each([
    [undefined, undefined, '/api/admin/users?segment=keycloak&page=0&size=25'],
    ['a b', { segment: 'keycloak', idpAlias: 'wg', page: 2, size: 10 }, '/api/admin/users?query=a+b&segment=keycloak&idpAlias=wg&page=2&size=10'],
    ['', { segment: 'local', idpAlias: 'wg' }, '/api/admin/users?segment=local&page=0&size=25'],
  ])('preserves search parameters', async (query, options, url) => {
    await expect(adminSearchUsers(query, options)).resolves.toEqual({ preserved: true })
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(url)
    expect(auth.ensureToken).toHaveBeenCalledExactlyOnceWith(30)
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer token' })
  })

  it('encodes detail ID', async () => {
    await adminGetUser('a/b c')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/admin/users/a%2Fb%20c')
  })

  it.each([true, false, 'true', undefined])('uses strict confirmation and ID array: %s', async confirm => {
    await adminDeleteUsers(['a', 'b'], confirm)
    expect(fetch).toHaveBeenCalledWith(`/api/admin/users?confirm=${confirm === true}`, expect.objectContaining({
      method: 'DELETE', body: '["a","b"]', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    }))
  })

  it.each([401, 403])('does not redirect on %s', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status }))
    await expect(adminGetUser('a')).rejects.toMatchObject({ status })
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('returns null on 204', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(adminDeleteUsers(['a'], true)).resolves.toBeNull()
  })

  it('omits missing Bearer after refresh', async () => {
    auth.ensureToken.mockImplementationOnce(async () => { auth.token.mockReturnValue(null); return true })
    await adminGetUser('a')
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({})
  })
})
