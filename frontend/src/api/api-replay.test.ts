import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../utils/http.js'
import { getExportJob, getProcessingJob, getProcessingJobResult } from './replay.js'

const auth = { token: () => 'test-token', ensureToken: async () => true }

afterEach(() => vi.unstubAllGlobals())

describe('typed Replay API contracts', () => {
  it('validates a Processing Job status response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      jobId: 'p1', status: 'READY', phase: null, total: 1, processed: 1, valid: 1,
      duplicates: 0, failures: 0, errorCode: null, currentFile: null,
      parseCompleted: 1, parseSucceeded: 1, parseFailed: 0,
      sources: [], activeSources: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(getProcessingJob(auth, 'p1')).resolves.toMatchObject({ jobId: 'p1', status: 'READY' })
  })

  it('rejects missing job identifiers and incomplete result payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'READY' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))
    await expect(getExportJob(auth, 'e1')).rejects.toMatchObject({
      name: 'ApiError', errorCode: 'INVALID_RESPONSE',
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ battles: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))
    await expect(getProcessingJobResult(auth, 'p1')).rejects.toBeInstanceOf(ApiError)
  })

  it('processing status/result/cancel 都携带 Bearer token', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      jobId: 'p1', status: 'READY', phase: null, total: 1, processed: 1, valid: 1,
      duplicates: 0, failures: 0, errorCode: null, currentFile: null,
      parseCompleted: 1, parseSucceeded: 1, parseFailed: 0,
      sources: [], activeSources: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await getProcessingJob(auth, 'p1')
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('未登录（ensureToken=false）时抛出 canonical AUTH_UNAUTHENTICATED，不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getProcessingJob({ token: () => '', ensureToken: async () => false }, 'p1'))
      .rejects.toMatchObject({
        name: 'ApiError', errorCode: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false,
      })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
