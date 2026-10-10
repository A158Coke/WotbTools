// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readOnboardingReceipt, saveOnboardingReceipt } from './onboarding.js'
import type { SaveOnboardingReceipt } from './onboarding.js'

const auth = vi.hoisted(() => ({
  epoch: 1, authenticated: true,
  authEpoch: vi.fn(() => auth.epoch),
  isAuthenticated: vi.fn(() => auth.authenticated),
  token: vi.fn(() => 'test-token'),
  ensureToken: vi.fn(async () => true),
}))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => auth }))

describe('onboarding transport', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const receipt = { coreEpoch: 2, disposition: 'COMPLETED' }
  beforeEach(() => {
    vi.clearAllMocks()
    auth.epoch = 1
    auth.authenticated = true
    auth.ensureToken.mockResolvedValue(true)
    auth.token.mockReturnValue('test-token')
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads the current receipt using a refreshed Bearer', async () => {
    fetchMock.mockResolvedValue(Response.json(receipt))
    await expect(readOnboardingReceipt()).resolves.toEqual(receipt)
    expect(fetchMock).toHaveBeenCalledWith('/api/users/onboarding', expect.objectContaining({
      headers: { Authorization: 'Bearer test-token' },
    }))
    expect(auth.ensureToken).toHaveBeenCalledWith(30)
  })

  it('writes only a terminal receipt and returns the persisted merge', async () => {
    fetchMock.mockResolvedValue(Response.json(receipt))
    const signal = new AbortController().signal
    await expect(saveOnboardingReceipt({ coreEpoch: 1, disposition: 'SKIPPED' }, signal)).resolves.toEqual(receipt)
    expect(fetchMock).toHaveBeenCalledWith('/api/users/onboarding', expect.objectContaining({
      method: 'PUT', signal, body: '{"coreEpoch":1,"disposition":"SKIPPED"}',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    }))
  })

  it.each([
    { coreEpoch: 0, disposition: 'SKIPPED' },
    { coreEpoch: 1.5, disposition: 'COMPLETED' },
    { coreEpoch: 2147483648, disposition: 'COMPLETED' },
    { coreEpoch: 1, disposition: 'NONE' },
    { coreEpoch: 1, disposition: 'completed' },
    { coreEpoch: 1, disposition: 'COMPLETED', userId: 'other-user' },
  ])('rejects invalid outgoing receipt %j before sending', async (value) => {
    await expect(saveOnboardingReceipt(value as SaveOnboardingReceipt)).rejects.toMatchObject({ errorCode: 'INVALID_REQUEST' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    null, {}, { ...receipt, coreEpoch: -1 }, { ...receipt, disposition: 'completed' },
    { ...receipt, userId: 'other-user' },
  ])('rejects invalid response %j', async (value) => {
    fetchMock.mockResolvedValue(Response.json(value))
    await expect(readOnboardingReceipt()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE' })
  })

  it('rejects a malformed JSON success response', async () => {
    fetchMock.mockResolvedValue(new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(readOnboardingReceipt()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE' })
  })

  it('preserves canonical profile-not-ready errors for the caller', async () => {
    fetchMock.mockResolvedValue(Response.json({
      id: 'request-id', errorCode: 'PROFILE_NOT_FOUND', errorMsg: null, status: 404,
      retryable: false, details: {}, timestamp: '2026-10-10T00:00:00Z',
    }, { status: 404 }))
    await expect(readOnboardingReceipt()).rejects.toMatchObject({ errorCode: 'PROFILE_NOT_FOUND', status: 404 })
  })

  it('does not send an anonymous request or a request after refresh fails', async () => {
    auth.authenticated = false
    await expect(readOnboardingReceipt()).rejects.toMatchObject({ status: 401 })
    auth.authenticated = true
    auth.ensureToken.mockResolvedValue(false)
    await expect(readOnboardingReceipt()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not issue a request if the account changes during token refresh', async () => {
    auth.ensureToken.mockImplementationOnce(async () => { auth.epoch += 1; return true })
    await expect(readOnboardingReceipt()).rejects.toMatchObject({ errorCode: 'REQUEST_ABORTED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a late receipt after the account changes during transport or JSON decoding', async () => {
    fetchMock.mockImplementationOnce(async () => { auth.epoch += 1; return Response.json(receipt) })
    await expect(readOnboardingReceipt()).rejects.toMatchObject({ errorCode: 'REQUEST_ABORTED' })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => { auth.epoch += 1; return receipt },
    } as Response)
    await expect(readOnboardingReceipt()).rejects.toMatchObject({ errorCode: 'REQUEST_ABORTED' })
  })
})
