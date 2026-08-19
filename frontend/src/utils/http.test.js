import { describe, expect, it } from 'vitest'
import { ApiError, apiErrorFromResponse } from './http.js'

describe('apiErrorFromResponse', () => {
  it('prefers the API error key', async () => {
    const error = await apiErrorFromResponse({ status: 409, json: async () => ({ error: 'ACTIVE_ASSIGNMENT_EXISTS' }) })
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('ACTIVE_ASSIGNMENT_EXISTS')
    expect(error.status).toBe(409)
  })

  it('uses a stable HTTP fallback for non-JSON responses', async () => {
    const error = await apiErrorFromResponse({ status: 502, json: async () => { throw new Error('invalid json') } })
    expect(error.code).toBe('HTTP_502')
  })

  it('ignores non-string error payloads', async () => {
    const error = await apiErrorFromResponse({ status: 400, json: async () => ({ error: { detail: 'hidden' } }) })
    expect(error.code).toBe('HTTP_400')
  })
})
