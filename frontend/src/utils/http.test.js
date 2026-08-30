import { describe, expect, it } from 'vitest'
import {
  ApiError,
  apiErrorFromResponse,
  apiErrorFromXhr,
  normalizeApiError,
  normalizeJobError,
} from './http.js'

function response(status, body, headers = {}) {
  return {
    status,
    text: async () => body,
    headers: { get: name => headers[name] || headers[name.toLowerCase()] || null },
  }
}

describe('apiErrorFromResponse', () => {
  it.each([
    [400, 'INVALID_ARGUMENT'],
    [401, 'AUTH_UNAUTHENTICATED'],
    [403, 'AUTH_FORBIDDEN'],
    [500, 'INTERNAL_ERROR'],
  ])('parses canonical %s responses', async (status, code) => {
    const error = await apiErrorFromResponse(response(status, JSON.stringify({
      code,
      status,
      messageKey: `errors.${code.toLowerCase()}`,
      traceId: 'trace-1',
      retryable: status >= 500,
      details: {},
      timestamp: '2026-08-30T15:30:00Z',
    })))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code, status, traceId: 'trace-1', retryable: status >= 500 })
  })

  it('keeps legacy {error} compatibility', async () => {
    const error = await apiErrorFromResponse(response(503, '{"error":"REPLAY_BUSY"}'))
    expect(error).toMatchObject({ code: 'REPLAY_BUSY', status: 503, retryable: true })
  })

  it('preserves AI retry policy for legacy error bodies', async () => {
    expect(await apiErrorFromResponse(response(502, '{"error":"AI_TIMEOUT"}')))
      .toMatchObject({ code: 'AI_TIMEOUT', retryable: false })
    expect(await apiErrorFromResponse(response(502, '{"error":"AI_UPSTREAM_UNAVAILABLE"}')))
      .toMatchObject({ code: 'AI_UPSTREAM_UNAVAILABLE', retryable: true })
  })

  it('does not promote arbitrary legacy error text into a contract code', async () => {
    const error = await apiErrorFromResponse(response(401, '{"error":"unauthorized"}'))
    expect(error).toMatchObject({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
  })

  it('maps an empty 403 to authorization instead of a generic playback failure', async () => {
    const error = await apiErrorFromResponse(response(403, '', { 'X-Request-ID': 'proxy-trace' }))
    expect(error).toMatchObject({ code: 'AUTH_FORBIDDEN', traceId: 'proxy-trace', retryable: false })
  })

  it.each([
    [502, 'UPSTREAM_UNAVAILABLE'],
    [503, 'SERVICE_UNAVAILABLE'],
    [504, 'UPSTREAM_TIMEOUT'],
  ])('maps HTML proxy %s responses', async (status, code) => {
    const error = await apiErrorFromResponse(response(status, '<html>proxy error</html>'))
    expect(error).toMatchObject({ code, retryable: true })
  })

  it('maps malformed JSON responses to the protocol error code', async () => {
    const error = await apiErrorFromResponse(response(400, '{invalid', {
      'Content-Type': 'application/json;charset=UTF-8'
    }))
    expect(error.code).toBe('MALFORMED_ERROR_RESPONSE')
  })

  it('keeps non-JSON proxy bodies on the HTTP status fallback', async () => {
    const error = await apiErrorFromResponse(response(400, '{invalid', {
      'Content-Type': 'text/html'
    }))
    expect(error.code).toBe('INVALID_REQUEST')
  })

  it('accepts a stable legacy text code without exposing arbitrary text', async () => {
    expect((await apiErrorFromResponse(response(502, 'AI_UPSTREAM_UNAVAILABLE'))).code)
      .toBe('AI_UPSTREAM_UNAVAILABLE')
    expect((await apiErrorFromResponse(response(502, 'upstream stack trace'))).code)
      .toBe('UPSTREAM_UNAVAILABLE')
  })
})

describe('normalizeApiError', () => {
  it('maps network failures', () => {
    expect(normalizeApiError(new TypeError('Failed to fetch')))
      .toMatchObject({ code: 'NETWORK_ERROR', status: null, retryable: true })
  })

  it('maps AbortError to silent control flow', () => {
    const cause = new Error('cancelled')
    cause.name = 'AbortError'
    expect(normalizeApiError(cause))
      .toMatchObject({ code: 'REQUEST_ABORTED', status: null, retryable: false })
  })
})

describe('XHR and job compatibility', () => {
  it('parses canonical XHR errors', () => {
    const error = apiErrorFromXhr({
      status: 413,
      responseText: '{"code":"FILE_TOO_LARGE","traceId":"upload-trace","retryable":false}',
      getResponseHeader: () => null,
    })
    expect(error).toMatchObject({ code: 'FILE_TOO_LARGE', traceId: 'upload-trace', retryable: false })
  })

  it('maps malformed JSON XHR responses to the protocol error code', () => {
    const error = apiErrorFromXhr({
      status: 500,
      responseText: '{broken',
      getResponseHeader: name => name === 'Content-Type' ? 'application/problem+json' : null,
    })
    expect(error).toMatchObject({ code: 'MALFORMED_ERROR_RESPONSE', status: 500 })
  })

  it('normalizes legacy and structured failed jobs', () => {
    expect(normalizeJobError({ errorCode: 'NO_VALID_REPLAYS' }).code).toBe('NO_VALID_REPLAYS')
    expect(normalizeJobError({ error: {
      code: 'PROCESSING_QUEUE_FULL', messageKey: 'errors.processing_queue_full',
      retryable: true, traceId: 'job-trace',
    }})).toMatchObject({ code: 'PROCESSING_QUEUE_FULL', retryable: true, traceId: 'job-trace' })
  })
})
