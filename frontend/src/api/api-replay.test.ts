import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../utils/http.js'
import { getExportJob, getProcessingJob, getProcessingJobResult } from './replay.js'

afterEach(() => vi.unstubAllGlobals())

describe('typed Replay API contracts', () => {
  it('validates a Processing Job status response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      jobId: 'p1', status: 'READY', phase: null, total: 1, processed: 1, valid: 1,
      duplicates: 0, failures: 0, errorCode: null, currentFile: null,
      parseCompleted: 1, parseSucceeded: 1, parseFailed: 0,
      sources: [], activeSources: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(getProcessingJob('p1')).resolves.toMatchObject({ jobId: 'p1', status: 'READY' })
  })

  it('rejects missing job identifiers and incomplete result payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'READY' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))
    await expect(getExportJob('e1')).rejects.toMatchObject({
      name: 'ApiError', errorCode: 'INVALID_RESPONSE',
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ battles: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))
    await expect(getProcessingJobResult('p1')).rejects.toBeInstanceOf(ApiError)
  })
})

