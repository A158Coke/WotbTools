import { describe, expect, it } from 'vitest'
import { ApiError, apiErrorFromResponse, normalizeApiError } from './http.js'

describe('typed API error contract', () => {
  it('keeps canonical diagnostic fields and legacy trace correlation separate', async () => {
    const response = new Response(JSON.stringify({
      id: 'error-1', errorCode: 'AUTH_FORBIDDEN', errorMsg: null, status: 403,
      retryable: false, details: {}, timestamp: '2026-08-30T17:00:00Z',
    }), { status: 403, headers: { 'X-Request-ID': 'request-1', 'Content-Type': 'application/json' } })

    await expect(apiErrorFromResponse(response)).resolves.toMatchObject({
      id: 'error-1', errorCode: 'AUTH_FORBIDDEN', status: 403,
      retryable: false, details: {}, timestamp: '2026-08-30T17:00:00Z',
    })
  })

  it('maps malformed JSON and transport aborts to stable errors', async () => {
    const response = new Response('{broken', {
      status: 500, headers: { 'Content-Type': 'application/problem+json' },
    })
    await expect(apiErrorFromResponse(response)).resolves.toMatchObject({
      errorCode: 'MALFORMED_ERROR_RESPONSE', status: 500,
    })

    const abort = new Error('cancelled')
    abort.name = 'AbortError'
    expect(normalizeApiError(abort)).toMatchObject({
      errorCode: 'REQUEST_ABORTED', retryable: false, status: null,
    })
  })

  it('does not silently classify a valid unknown server code as a known code', () => {
    const error = new ApiError({ errorCode: 'FUTURE_DOMAIN_FAILURE', status: 409 })
    expect(error.errorCode).toBe('FUTURE_DOMAIN_FAILURE')
    expect(error.errorCode).not.toBe('INVALID_REQUEST')
  })
})

