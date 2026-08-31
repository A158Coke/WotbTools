// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http.js'

// 只 mock useAuth（避免实例化 Keycloak）与全局 fetch——绝不 mock api.js 本身。
const auth = vi.hoisted(() => ({
  token: vi.fn(() => 'test-token'),
  ensureToken: vi.fn(async () => true),
  login: vi.fn(),
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => auth,
}))

import { createExportJob, getExportJob, cancelExportJob, downloadExportJob } from './api.js'

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

function blobResponse(status, { cd = '', type = 'application/octet-stream' } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name === 'Content-Disposition' ? cd : null) },
    blob: async () => new Blob(['xlsx'], { type }),
  }
}

describe('replay export job api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createExportJob posts Dataset-only create and returns 202 job payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(202, { jobId: 'j1', status: 'QUEUED', total: 2 }))
    // Dataset-only：只传 mode + processingJobId（query），无 replay files body / 无 FormData。
    const result = await createExportJob('aggregate', 'p1')
    expect(result).toEqual({ jobId: 'j1', status: 'QUEUED', total: 2 })
    const url = vi.mocked(fetch).mock.calls[0][0]
    expect(url).toBe('/api/replay/export-jobs?mode=aggregate&processingJobId=p1')
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }))
  })

  it('createExportJob appends teamNames multipart field when provided (PR #123 Blocker 1)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(202, { jobId: 'j1', status: 'QUEUED', total: 1 }))
    // Dataset-only：无 body，仅 teamNames → 构造含 teamNames 字段的 FormData（不重新上传 replay）。
    await createExportJob('aggregate', 'p1', '{"battle":{"a:1":"X"}}')
    const [url, opts] = vi.mocked(fetch).mock.calls[0]
    expect(url).toContain('mode=aggregate')
    expect(url).toContain('processingJobId=p1')
    expect(opts.body).toBeInstanceOf(FormData)
    expect(opts.body.get('files')).toBeNull() // Dataset-only：绝不再携带 replay files
    expect(opts.body.get('teamNames')).toBe('{"battle":{"a:1":"X"}}')
  })

  it('createExportJob reuses processing result with bodyless POST (no teamNames)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(202, { jobId: 'j1', status: 'QUEUED', total: 34 }))
    // 生产 500 回归：reuse 解析结果 + 无战队名称覆盖 → body=null + processingJobId。
    // HTTP contract：bodyless POST 合法（backend 不强制 multipart），不得伪造空 FormData。
    const result = await createExportJob('aggregate', 'p1')
    expect(result).toEqual({ jobId: 'j1', status: 'QUEUED', total: 34 })
    const [url, opts] = vi.mocked(fetch).mock.calls[0]
    expect(url).toContain('mode=aggregate')
    expect(url).toContain('processingJobId=p1')
    expect(opts.method).toBe('POST')
    expect(opts.body).toBeUndefined()
    expect(opts.body).not.toBeInstanceOf(FormData)
  })

  it('createExportJob propagates 503 EXPORT_QUEUE_FULL as ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(503, { error: 'EXPORT_QUEUE_FULL' }))
    // 真实 request shape：携带 processingJobId（缺失会先走 410，根本到不了 Export queue）。
    const err = await createExportJob('aggregate', 'p1').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('EXPORT_QUEUE_FULL')
    expect(err.status).toBe(503)
  })

  it('getExportJob returns progress payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {
      jobId: 'j1', status: 'PROCESSING', phase: 'BUILDING_EXCEL', total: 10,
      processed: 5, duplicates: 0, failures: 0, errorCode: null,
      filename: null, contentType: null,
    }))
    const result = await getExportJob('j1')
    expect(result.processed).toBe(5)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/replay/export-jobs/j1')
  })

  it('getExportJob maps 404 JOB_NOT_FOUND to ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(404, { error: 'JOB_NOT_FOUND' }))
    const err = await getExportJob('nope').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('JOB_NOT_FOUND')
  })

  it('cancelExportJob sends DELETE and resolves on 204', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 204, ok: true })
    await cancelExportJob('j1')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/replay/export-jobs/j1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('downloadExportJob triggers blob download on READY', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.mocked(fetch).mockResolvedValue(blobResponse(200, {
      cd: "attachment; filename=\"export.xlsx\"; filename*=UTF-8''export.xlsx",
    }))

    await downloadExportJob('j1', 'export.xlsx')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/replay/export-jobs/j1/download')
    expect(appendSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
  })

  it('downloadExportJob maps 409 JOB_NOT_READY to ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(409, { error: 'JOB_NOT_READY' }))
    const err = await downloadExportJob('j1', 'export.xlsx').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('JOB_NOT_READY')
    expect(err.status).toBe(409)
  })
})
