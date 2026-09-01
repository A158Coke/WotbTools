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
      errorCode: code,
      errorMsg: null,
      status,
      id: 'err-1',
      retryable: status >= 500,
      details: {},
      timestamp: '2026-08-30T15:30:00Z',
    })))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ errorCode: code, code, status, id: 'err-1', retryable: status >= 500 })
  })

  it('rejects canonical responses whose body status differs from HTTP status', async () => {
    const error = await apiErrorFromResponse(response(500, JSON.stringify({
      errorCode: 'INTERNAL_ERROR', errorMsg: null, status: 400, id: 'err-1',
      retryable: false, details: {}, timestamp: null,
    })))
    expect(error).toMatchObject({ code: 'MALFORMED_ERROR_RESPONSE', status: 500 })
  })

  it('rejects lowercase canonical error codes', async () => {
    const error = await apiErrorFromResponse(response(400, JSON.stringify({
      errorCode: 'invalid_request', errorMsg: null, status: 400, id: 'err-1',
      retryable: false, details: {}, timestamp: null,
    })))
    expect(error.code).toBe('MALFORMED_ERROR_RESPONSE')
  })

  it('rejects incomplete canonical error bodies instead of using their errorCode', async () => {
    const error = await apiErrorFromResponse(response(400, '{"errorCode":"FILE_TOO_LARGE"}'))
    expect(error.code).toBe('MALFORMED_ERROR_RESPONSE')
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
    expect(error).toMatchObject({ errorCode: 'AUTH_FORBIDDEN', traceId: 'proxy-trace', retryable: false })
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
      responseText: '{"errorCode":"FILE_TOO_LARGE","errorMsg":null,"status":413,"id":"upload-id","retryable":false,"details":{},"timestamp":null}',
      getResponseHeader: () => null,
    })
    expect(error).toMatchObject({ errorCode: 'FILE_TOO_LARGE', code: 'FILE_TOO_LARGE', id: 'upload-id', retryable: false })
  })

  it('rejects incomplete canonical XHR errors', () => {
    const error = apiErrorFromXhr({ status: 400, responseText: '{"errorCode":"FILE_TOO_LARGE"}' })
    expect(error).toMatchObject({ code: 'MALFORMED_ERROR_RESPONSE', status: 400 })
  })

  it('rejects canonical XHR errors whose body status differs from HTTP status', () => {
    const error = apiErrorFromXhr({
      status: 500,
      responseText: '{"errorCode":"INTERNAL_ERROR","errorMsg":null,"status":400,"id":"err-1","retryable":false,"details":{},"timestamp":null}',
    })
    expect(error).toMatchObject({ code: 'MALFORMED_ERROR_RESPONSE', status: 500 })
  })

  it('rejects lowercase canonical XHR error codes', () => {
    const error = apiErrorFromXhr({
      status: 400,
      responseText: '{"errorCode":"invalid_request","errorMsg":null,"status":400,"id":"err-1","retryable":false,"details":{},"timestamp":null}',
    })
    expect(error.code).toBe('MALFORMED_ERROR_RESPONSE')
  })

  it('keeps legacy XHR error codes compatible', () => {
    expect(apiErrorFromXhr({ status: 503, responseText: '{"error":"REPLAY_BUSY"}' }))
      .toMatchObject({ code: 'REPLAY_BUSY', status: 503 })
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
      errorCode: 'PROCESSING_QUEUE_FULL', id: 'job-id',
      retryable: true,
    }})).toMatchObject({ errorCode: 'PROCESSING_QUEUE_FULL', code: 'PROCESSING_QUEUE_FULL', retryable: true, id: 'job-id' })
  })
})
