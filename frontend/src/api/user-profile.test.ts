import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/user-profile.js'
import { ApiError } from '../utils/http.js'

const auth = vi.hoisted(() => ({ token: vi.fn((): string | null => 'token'), ensureToken: vi.fn(async () => true), login: vi.fn() }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => auth }))

const profile = { id: 7, keycloakUserId: 'a', username: 'user', displayName: null, wotbAccountId: null, wotbNickname: null, wotbServer: 'CN', wotbAccountSource: 'MANUAL', wotbAccountVerifiedAt: null }

beforeEach(() => {
  vi.clearAllMocks()
  auth.token.mockReturnValue('token')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(profile)))
})
afterEach(() => vi.unstubAllGlobals())

describe('User/Profile HTTP boundary', () => {
  it.each([
    ['getUserProfile', [], '/api/users/profile', 'GET', undefined],
    ['ensureUserProfile', [], '/api/users/profile', 'PUT', undefined],
    ['updateUserWotbAccount', [{ wotbAccountId: 42 }], '/api/users/wotb-account', 'PATCH', '{"wotbAccountId":42}'],
    ['deleteUserWotbAccount', [], '/api/users/wotb-account', 'DELETE', undefined],
    ['verifyUserWotbAccountFromReplay', [42], '/api/users/wotb-account/verify-replay', 'POST', '{"recorderAccountId":42}'],
    ['syncUserWotbAccountFromLogin', [], '/api/users/wotb-account/from-login', 'PUT', undefined],
  ] as const)('%s preserves request and return value', async (name, args, url, method, body) => {
    const result = await (api[name] as (...args: any[]) => Promise<unknown>)(...args)
    expect(result).toEqual(profile)
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

const userCases = [
  ['get', () => api.getUserProfile()], ['ensure', () => api.ensureUserProfile()],
  ['update', () => api.updateUserWotbAccount({ wotbAccountId: 42 })],
  ['delete', () => api.deleteUserWotbAccount()], ['verify', () => api.verifyUserWotbAccountFromReplay(42)],
  ['sync', () => api.syncUserWotbAccountFromLogin()],
] as const
it.each(userCases)('%s preserves canonical nullable binding', async (_name, request) => {
  await expect(request()).resolves.toEqual(profile)
})
it.each(userCases)('%s rejects invalid shape', async (_name, request) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...profile, id: '7' }))
  await expect(request()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})
it.each(userCases)('%s rejects malformed JSON', async (_name, request) => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{'))
  await expect(request()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})
it.each([{ ...profile, wotbServer: 'ru' }, { ...profile, wotbAccountSource: 'UNKNOWN' }, { username: 'user' }])('rejects enum or required-field violations', async value => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(value))
  await expect(api.getUserProfile()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})
it('accepts omitted optional fields without normalizing', async () => {
  const value = { id: 7, keycloakUserId: 'a', username: 'user', wotbServer: 'CN', wotbAccountSource: 'MANUAL' }
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(value))
  await expect(api.getUserProfile()).resolves.toEqual(value)
})
it('does not reclassify cancellation during decode', async () => {
  const response = Response.json(profile)
  const abort = new DOMException('cancelled', 'AbortError')
  vi.spyOn(response, 'json').mockRejectedValueOnce(abort)
  vi.mocked(fetch).mockResolvedValueOnce(response)
  await expect(api.getUserProfile()).rejects.toBe(abort)
})

it.each(userCases)('%s rejects HTTP200 JSON null', async (_name, request) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(null))
  await expect(request()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE', retryable: false })
})

it.each(userCases)('%s preserves204 without reading body', async (_name, request) => {
  const response = new Response(null, { status: 204 })
  const json = vi.spyOn(response, 'json')
  vi.mocked(fetch).mockResolvedValueOnce(response)
  await expect(request()).resolves.toBeNull()
  expect(json).not.toHaveBeenCalled()
})
