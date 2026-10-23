import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminSearchUsers, adminGetUser, adminDeleteUsers } from '../api/admin-users.js'

const auth = vi.hoisted(() => ({ token: vi.fn((): string | null => 'token'), ensureToken: vi.fn(async () => true), login: vi.fn() }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => auth }))

const page = { items: [], page: 0, size: 25, totalItems: 0, totalPages: 0 }
const detail = { keycloakUserId: 'a', profile: null, keycloak: null, warnings: [] }
const deleted = { requested: 2, deleted: 1, failed: 1, results: [{ userId: 'a', deleted: true, errorCode: null }, { userId: 'b', deleted: false, errorCode: 'USER_NOT_FOUND' }] }

beforeEach(() => {
  vi.clearAllMocks()
  auth.token.mockReturnValue('token')
  vi.stubGlobal('fetch', vi.fn(async (url, options) => Response.json(options?.method === 'DELETE' ? deleted : String(url).includes('/api/admin/users/') ? detail : page)))
})
afterEach(() => vi.unstubAllGlobals())

describe('Admin Users HTTP boundary', () => {
  it.each([
    [undefined, undefined, '/api/admin/users?segment=keycloak&page=0&size=25'],
    ['a b', { segment: 'keycloak', idpAlias: 'wg', page: 2, size: 10 }, '/api/admin/users?query=a+b&segment=keycloak&idpAlias=wg&page=2&size=10'],
    ['', { segment: 'local', idpAlias: 'wg' }, '/api/admin/users?segment=local&page=0&size=25'],
  ] as const)('preserves search parameters', async (query, options, url) => {
    await expect(adminSearchUsers(query, options)).resolves.toEqual(page)
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

const adminCases = [
  ['search', () => adminSearchUsers(), page],
  ['detail', () => adminGetUser('a'), detail],
  ['delete', () => adminDeleteUsers(['a', 'b'], true), deleted],
] as const
it.each(adminCases)('%s validates canonical responses', async (_name, request, value) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(value))
  await expect(request()).resolves.toEqual(value)
})
it.each(adminCases)('%s rejects invalid response shapes', async (_name, request) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ invalid: true }))
  await expect(request()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})
it.each(adminCases)('%s rejects malformed JSON', async (_name, request) => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{'))
  await expect(request()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})
it('accepts real nullable profile and Keycloak fields', async () => {
  const value = { ...detail, profile: { id: 7, displayName: null, wotbAccountId: null, wotbNickname: null, wotbServer: null, createdAt: null, updatedAt: null }, keycloak: { id: 'a', username: null, email: null, firstName: null, lastName: null, enabled: true, federatedIdentities: [{ identityProvider: null, userId: null, userName: null }] } }
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(value))
  await expect(adminGetUser('a')).resolves.toEqual(value)
})
it.each(['profile', 'keycloak'] as const)('accepts missing %s side', async side => {
  const value = { ...detail, [side]: null }
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(value))
  await expect(adminGetUser('a')).resolves.toEqual(value)
})
it('does not reclassify cancellation during decode', async () => {
  const response = Response.json(detail)
  const abort = new DOMException('cancelled', 'AbortError')
  vi.spyOn(response, 'json').mockRejectedValueOnce(abort)
  vi.mocked(fetch).mockResolvedValueOnce(response)
  await expect(adminGetUser('a')).rejects.toBe(abort)
})

it.each(adminCases)('%s rejects HTTP200 JSON null', async (_name, request) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(null))
  await expect(request()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})

it.each(adminCases)('%s preserves204 without reading body', async (_name, request) => {
  const response = new Response(null, { status: 204 })
  const json = vi.spyOn(response, 'json')
  vi.mocked(fetch).mockResolvedValueOnce(response)
  await expect(request()).resolves.toBeNull()
  expect(json).not.toHaveBeenCalled()
})

it.each([
  { ...page, items: {} },
  { ...page, items: [{ keycloakUserId: 'a', hasLocalProfile: 'yes', keycloakUserMissing: false }] },
])('rejects malformed page items', async value => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(value))
  await expect(adminSearchUsers()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})
it('rejects malformed nested detail', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...detail, keycloak: { enabled: 'yes' } }))
  await expect(adminGetUser('a')).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})
