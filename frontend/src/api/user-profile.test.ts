import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/user-profile.js'
import { ApiError } from '../utils/http.js'

const auth = vi.hoisted(() => ({ token: vi.fn((): string | null => 'token'), ensureToken: vi.fn(async () => true), login: vi.fn() }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => auth }))

beforeEach(() => {
  vi.clearAllMocks()
  auth.token.mockReturnValue('token')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ preserved: true })))
})
afterEach(() => vi.unstubAllGlobals())

describe('User/Profile HTTP boundary', () => {
  it.each([
    ['getUserProfile', [], '/api/users/profile', 'GET', undefined],
    ['ensureUserProfile', [], '/api/users/profile', 'PUT', undefined],
    ['updateUserWotbAccount', [{ accountId: 42 }], '/api/users/wotb-account', 'PATCH', '{"accountId":42}'],
    ['deleteUserWotbAccount', [], '/api/users/wotb-account', 'DELETE', undefined],
    ['verifyUserWotbAccountFromReplay', [42], '/api/users/wotb-account/verify-replay', 'POST', '{"recorderAccountId":42}'],
    ['syncUserWotbAccountFromLogin', [], '/api/users/wotb-account/from-login', 'PUT', undefined],
    ['getUserHofRecords', [], '/api/users/profile/records', 'GET', undefined],
  ] as const)('%s preserves request and return value', async (name, args, url, method, body) => {
    const result = await (api[name] as (...args: any[]) => Promise<unknown>)(...args)
    expect(result).toEqual({ preserved: true })
    expect(auth.ensureToken).toHaveBeenCalledExactlyOnceWith(30)
    const [actualUrl, options] = vi.mocked(fetch).mock.calls[0]
    expect(actualUrl).toBe(url)
    expect(options?.method ?? 'GET').toBe(method)
    expect(options?.body).toBe(body)
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer token' })
  })

  it('reads token after refresh and omits missing Bearer', async () => {
    auth.ensureToken.mockImplementationOnce(async () => { auth.token.mockReturnValue(null); return true })
    await api.getUserProfile()
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it.each([401, 403])('preserves canonical error for %s and login only for 401', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status }))
    await expect(api.getUserProfile()).rejects.toMatchObject({ status })
    expect(auth.login.mock.calls).toEqual(status === 401 ? [[]] : [])
  })

  it('returns null on 204 without consuming JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(api.deleteUserWotbAccount()).resolves.toBeNull()
  })

  it('does not issue HTTP when token refresh fails', async () => {
    auth.ensureToken.mockRejectedValueOnce(new ApiError({ errorCode: 'AUTH_UNAUTHENTICATED' }))
    await expect(api.getUserProfile()).rejects.toBeInstanceOf(ApiError)
    expect(fetch).not.toHaveBeenCalled()
  })
})
